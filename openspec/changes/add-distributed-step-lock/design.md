# Design：add-distributed-step-lock

## 架構分層

```text
backend/src/runtime/
├── types.ts              (X1 - 既有，不修改)
├── state-machine.ts      (X1 - 既有，不修改)
├── events.ts             (X1 - 既有，不修改)
├── persistence/          (X1/X3 - 既有，不修改)
├── retry/                (X2 - 既有，不修改)
├── idempotency/          (X3 - 既有，不修改)
├── audit/                (X3 - 既有，不修改)
├── compensation/         (X4 - 既有，不修改)
└── lock/                 (X5 - 新增)
    ├── redis-client.ts           Redis 連線管理（Singleton）
    ├── step-lock.ts              StepLock interface + Redis 實作（SET NX PX）
    ├── step-transition-guard.ts  StepTransitionGuard interface + 實作（Lock + CAS）
    └── index.ts                  barrel export
```

## 模組責任

| 模組 | 責任 | 副作用 |
|------|------|--------|
| `redis-client.ts` | 封裝 ioredis 連線建立、健康檢查、優雅關閉。從 `REDIS_URI` 環境變數讀取連線字串。Redis 未設定時 `getRedis()` 回傳 null | 有（Redis I/O） |
| `step-lock.ts` | 定義 `StepLock` interface，提供 `acquire(stepId, owner, ttlMs)` / `release(stepId, owner)` / `extend(stepId, owner, ttlMs)`。實作使用 `SET NX PX`（單節點）。Release/Extend 使用 Lua script 確保 atomic check-and-operate | 有（Redis 指令） |
| `step-transition-guard.ts` | 定義 `StepTransitionGuard` interface，組合 StepLock + PgStepRepository 雙重防護。先取得分散式鎖，再以 `WHERE status = $from` 條件執行 DB 更新，確保 compare-and-swap 語意 | 有（Redis + DB） |

## 資料模型

### StepLock

```typescript
interface StepLock {
  /** 嘗試獲取鎖。成功回傳 true，已被其他 owner 持有回傳 false */
  acquire(stepId: string, owner: string, ttlMs: number): Promise<boolean>;

  /** 釋放鎖。只有鎖的 owner 本人才能釋放（使用 Lua script 確保 atomic check-and-delete） */
  release(stepId: string, owner: string): Promise<void>;

  /** 延長鎖的 TTL。只有鎖的 owner 本人才能延長。用於長時間執行的 Step */
  extend(stepId: string, owner: string, ttlMs: number): Promise<boolean>;
}
```

### StepTransitionGuard

```typescript
interface StepTransitionGuard {
  /**
   * 在分散式鎖保護下執行 Step 狀態轉移。
   *
   * 雙重防護：
   * 1. Redis Lock (primary): 防止併發 worker 同時進入 critical section
   * 2. DB CAS (secondary): UPDATE ... WHERE status = $from，即使 Redis 不可用也不損壞資料
   */
  transition(
    stepId: string,
    from: StepStatus,
    to: StepStatus,
    owner: string,
    opts?: StepTransitionOptions
  ): Promise<TransitionGuardResult>;
}

type TransitionGuardResult =
  | { outcome: "success"; step: AgentStep }
  | { outcome: "lock_contention"; currentOwner?: string }
  | { outcome: "cas_mismatch"; currentStatus: StepStatus }
  | { outcome: "invalid_transition"; reason: string };
```

## Lock Key 設計

```text
Redis Key: step_lock:{stepId}
Value: owner (UUID string)
TTL: 可配置，預設 30 秒（DEFAULT_LOCK_TTL_MS = 30_000）
```

## 生命週期管理

1. **Lock TTL 自動過期**：防止 worker crash 後鎖永久持有。`acquire` 必須帶 TTL，Redis `SET NX PX` 保證原子性
2. **持有者定期續約**：長時間執行的 Step 透過 `extend()` 延長 TTL；續約失敗表示鎖已過期或被其他 worker 搶走，caller 應自我中止
3. **Owner 身份驗證**：`release` 使用 Lua script 確保只有 lock holder 能釋放：
   ```lua
   if redis.call("GET", KEYS[1]) == ARGV[1] then
     return redis.call("DEL", KEYS[1])
   else
     return 0
   end
   ```
4. **Redis 不可用時的降級**：`StepTransitionGuard` 若 Redis 不可用（`getRedis()` 回傳 null 或連線失敗），跳過 lock 階段，僅依賴 DB CAS（`WHERE status = $from`）作為最後防線。不會因為 Redis 故障而阻塞所有 Step 轉移

## Redis 連線設計

```typescript
// redis-client.ts
import Redis from "ioredis";
import { getEnv } from "../../platform/env.js";

const REDIS_URI_ENV = "REDIS_URI";

let redis: Redis | null = undefined; // undefined = 未初始化, null = 不可用

export function getRedis(): Redis | null {
  if (redis !== undefined) return redis;
  const uri = getEnv(REDIS_URI_ENV);
  if (!uri) { redis = null; return null; }
  redis = new Redis(uri, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    connectTimeout: 3000,
  });
  return redis;
}

export async function closeRedis(): Promise<void> {
  if (redis) { await redis.quit(); redis = null; }
}
```

設計決策：
- `lazyConnect: true`：不阻塞應用啟動，首次使用時才連線
- `maxRetriesPerRequest: 2`：快速失敗，不讓 lock 操作等待過久
- `connectTimeout: 3000`：3 秒連線 timeout
- `getRedis()` 回傳 null 時，caller 走安全降級路徑

## StepTransitionGuard 流程

```text
transition(stepId, from, to, owner)
  │
  ├─ 1. 驗證狀態轉移合法性（呼叫 state-machine.transitionStep）
  │     └─ invalid → return { outcome: "invalid_transition" }
  │
  ├─ 2. 嘗試獲取 Redis lock
  │     ├─ Redis 不可用 → 跳過 lock，直接進入 DB CAS（降級模式）
  │     ├─ acquire 失敗 → return { outcome: "lock_contention" }
  │     └─ acquire 成功 → 進入 critical section
  │
  ├─ 3. DB CAS: UPDATE task_steps
  │     SET status = $to, ...
  │     WHERE step_id = $stepId AND status = $from
  │     ├─ affected rows = 1 → success
  │     └─ affected rows = 0 → cas_mismatch (讀取目前狀態)
  │
  └─ 4. finally: release lock (若曾獲取)
```

## 相依性

| 相依 | 類型 | 說明 |
|------|------|------|
| `ioredis` | npm 相依 | Redis client，需新增至 `package.json` |
| `pg` (既有的 pg Pool) | npm 相依 | 用於 DB CAS（透過既有的 `PgStepRepository`，但 StepTransitionGuard 直接執行 CAS query 以取得 affected row count） |
| X1 `types.ts` | 內部相依 | `StepStatus`、`AgentStep`、`StepError` |
| X1 `state-machine.ts` | 內部相依 | `isTransitionAllowed`（用於預先驗證轉移合法性） |
| `platform/env.ts` | 內部相依 | `getEnv` 讀取 `REDIS_URI` |

## 替代方案與風險

| 方案 | 優點 | 缺點 | 決策 |
|------|------|------|------|
| Redis Lock + DB CAS（本設計） | 兩層防護，Redis 不可用時降級到 DB CAS | 需要 Redis；CAS query 不同於既有 `PgStepRepository.updateStatus` | ✅ 採用 |
| 純 DB row-level lock（`SELECT ... FOR UPDATE`） | 不需 Redis | 跨 process 的 lock 粒度較粗；長時間 lock 會阻塞 connection pool | ❌ 不採用 |
| 僅 DB CAS（不引入 Redis） | 最簡單 | 沒有 primary guard；極端競爭場景下無法區分 lock contention 與 cas mismatch；不符合 X5 spec 要求 | ❌ 不採用 |
| Redlock 多節點 | 高可用 | 複雜度過高；目前 Docker 環境為單節點 Redis；interface 保留擴充空間 | ❌ 本次不採用 |
