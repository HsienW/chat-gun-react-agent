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
    ├── step-lock.ts              StepLock interface + RedisStepLock / NoopStepLock
    ├── step-transition-guard.ts  StepTransitionGuard interface + DefaultStepTransitionGuard
    └── index.ts                  barrel export
```

## 模組責任

| 模組 | 責任 | 副作用 |
|------|------|--------|
| `redis-client.ts` | 封裝 ioredis 連線建立、健康檢查、優雅關閉。從 `REDIS_URI` 環境變數讀取連線字串。Redis 未設定時 `getRedis()` 回傳 null | 有（Redis I/O） |
| `step-lock.ts` | 定義 `StepLock` interface，提供 `acquire(stepId, owner, ttlMs)` / `release(stepId, owner)` / `extend(stepId, owner, ttlMs)`。`RedisStepLock` 使用 `SET NX PX` + Lua scripts；`NoopStepLock` 為 Redis 不可用時的降級實作。`createStepLock()` 工廠依 `REDIS_URI` 環境變數自動選擇 | 有（Redis 指令） |
| `step-transition-guard.ts` | 定義 `StepTransitionGuard` interface，組合 StepLock + DB Queryable 雙重防護。先取得分散式鎖，再以 `WHERE status = $from` 條件執行 DB 更新 | 有（Redis + DB） |

## 降級責任分工（對齊 MAJ-3）

降級邏輯統一由 `createStepLock()` 工廠與 `NoopStepLock` 負責，`RedisStepLock.acquire` 本身**不**做任何降級：

| 場景 | 行為 | 負責元件 |
|------|------|----------|
| `REDIS_URI` 未設定 | `createStepLock()` 回傳 `NoopStepLock`，`acquire` 永遠回傳 `true`，`release` 為 no-op | `createStepLock` 工廠 + `NoopStepLock` |
| Redis 連線建立成功 | `createStepLock()` 回傳 `RedisStepLock`，執行真實 SET NX PX | `createStepLock` 工廠 + `RedisStepLock` |
| Redis 連線中斷（runtime） | `RedisStepLock.acquire` 拋出 ioredis 錯誤 → Guard 的 `try/catch` 捕捉後走 `lock_contention`（安全失敗）或 caller 自行 retry | `RedisStepLock` + caller（Guard 不降級） |

**設計決策**：`RedisStepLock` 永不降級——連線失敗時讓它 fail fast（`maxRetriesPerRequest: 2`）。`StepTransitionGuard.transition` 捕捉 lock 錯誤後回傳 `{ outcome: "lock_contention" }` 而非自行進入 CAS-only mode。這確保降級路徑單一且可預測。

## 資料模型

### StepLock

```typescript
interface StepLock {
  /** 嘗試獲取鎖。成功回傳 true，已被其他 owner 持有回傳 false。
   *  RedisStepLock: 連線失敗時拋出錯誤（不降級）。
   *  NoopStepLock: 永遠回傳 true。 */
  acquire(stepId: string, owner: string, ttlMs: number): Promise<boolean>;

  /** 釋放鎖。只有鎖的 owner 本人才能釋放。
   *  RedisStepLock: 使用 Lua script atomic check-and-delete。
   *  NoopStepLock: no-op。 */
  release(stepId: string, owner: string): Promise<void>;

  /** 延長鎖的 TTL。只有鎖的 owner 本人才能延長。
   *  RedisStepLock: 使用 Lua script atomic check-and-extend。
   *  NoopStepLock: 永遠回傳 true。 */
  extend(stepId: string, owner: string, ttlMs: number): Promise<boolean>;
}
```

### StepTransitionGuard

```typescript
// opts 复用 state-machine.ts 的 StepTransitionOptions（MAJ-2 對齊）
import type { StepTransitionOptions } from "../state-machine.js";

interface StepTransitionGuard {
  /**
   * 在分散式鎖保護下執行 Step 狀態轉移。
   *
   * 雙重防護：
   * 1. Redis Lock (primary): 防止併發 worker 同時進入 critical section
   * 2. DB CAS (secondary): UPDATE ... WHERE status = $from，即使 Redis 不可用也不損壞資料
   *
   * @param stepId 目標 Step ID
   * @param from   預期目前狀態（CAS 前置條件）
   * @param to     目標狀態
   * @param owner  lock owner 識別（UUID）
   * @param opts   狀態轉移附加選項，复用 state-machine.ts 的 StepTransitionOptions
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

> **`currentOwner` 語意（MIN-1 對齊）**：`lock_contention` 的 `currentOwner` 為 **best-effort** 查詢結果。實作在 `acquire` 失敗後以 `GET step_lock:{stepId}` 讀取目前持有者，但該值可能在讀取後立即過期或變更。consumer 不應依賴此值做決策，僅用於日誌／診斷。

### DefaultStepTransitionGuard constructor（MAJ-4 對齊）

```typescript
class DefaultStepTransitionGuard implements StepTransitionGuard {
  constructor(opts: {
    db: Queryable;        // 直接注入 DB queryable，用於 CAS SQL 與 step 查詢
    lock?: StepLock;      // 可選注入 StepLock；未提供時由內部 createStepLock() 建立
    lockTtlMs?: number;   // Lock TTL，預設 DEFAULT_LOCK_TTL_MS (30_000)
  });
}
```

遵循既有 `SagaOrchestratorImpl` 的明確 constructor injection 模式。`lock` 參數可選以支援測試注入 mock。

## Lock Key 設計（MIN-3 對齊）

```text
Redis Key: {REDIS_KEY_PREFIX}step_lock:{stepId}
Value: owner (UUID string)
TTL: 可配置，預設 30 秒（DEFAULT_LOCK_TTL_MS = 30_000）
```

`REDIS_KEY_PREFIX` 從環境變數讀取，預設為空字串。允許部署時設定如 `dev:` / `staging:` / `prod:` 以隔離共用 Redis 實例的 key 空間。

```typescript
// redis-client.ts
const REDIS_KEY_PREFIX = getEnv("REDIS_KEY_PREFIX", "");

function lockKey(stepId: string): string {
  return `${REDIS_KEY_PREFIX}step_lock:${stepId}`;
}
```

## 生命週期管理

1. **Lock TTL 自動過期**：防止 worker crash 後鎖永久持有。`acquire` 必須帶 TTL，Redis `SET NX PX` 保證原子性
2. **持有者定期續約**：長時間執行的 Step 透過 `extend()` 延長 TTL；續約失敗表示鎖已過期或被其他 worker 搶走，caller 應自我中止
3. **Owner 身份驗證 — Release Lua Script**：

   ```lua
   if redis.call("GET", KEYS[1]) == ARGV[1] then
     return redis.call("DEL", KEYS[1])
   else
     return 0
   end
   ```

4. **Owner 身份驗證 — Extend Lua Script**（MIN-2 對齊）：

   ```lua
   if redis.call("GET", KEYS[1]) == ARGV[1] then
     return redis.call("PEXPIRE", KEYS[1], ARGV[2])
   else
     return 0
   end
   ```

   `acquire` 失敗後的 `currentOwner` 查詢使用非原子的 `GET`（best-effort，可能過期）。

## Redis 連線設計

```typescript
// redis-client.ts
import { Redis } from "ioredis";
import { getEnv } from "../../platform/env.js";

const REDIS_URI_ENV = "REDIS_URI";
const REDIS_KEY_PREFIX = getEnv("REDIS_KEY_PREFIX", "");

let redis: Redis | null | undefined; // undefined = 未初始化, null = 不可用

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

export function isRedisAvailable(): boolean {
  return getRedis() !== null;
}

/** 注意：closeRedis() 後 getRedis() 會重新建立連線（無 shutdown guard）。
 *  預期僅在應用優雅關閉時呼叫一次。 */
export async function closeRedis(): Promise<void> {
  if (redis) { await redis.quit(); redis = null; }
}
```

設計決策：
- `lazyConnect: true`：不阻塞應用啟動，首次使用時才連線
- `maxRetriesPerRequest: 2`：快速失敗，不讓 lock 操作等待過久
- `connectTimeout: 3000`：3 秒連線 timeout
- `createStepLock()` 工廠在 `isRedisAvailable()` 為 false 時回傳 `NoopStepLock`

## StepTransitionGuard 流程

```text
transition(stepId, from, to, owner, opts)
  │
  ├─ 1. 讀取目前 step 狀態（SELECT ... FROM task_steps WHERE step_id = $1）
  │     └─ step 不存在 → return { outcome: "invalid_transition", reason: "step not found" }
  │
  ├─ 2. 驗證狀態轉移合法性（呼叫 state-machine.transitionStep(currentStep, to, opts)）
  │     └─ invalid → return { outcome: "invalid_transition", reason: ... }
  │
  ├─ 3. 嘗試獲取 Redis lock
  │     ├─ acquire 拋出錯誤（Redis 連線中斷）→ return { outcome: "lock_contention" }
  │     ├─ acquire 回傳 false → GET current owner（best-effort）→ return { outcome: "lock_contention", currentOwner }
  │     └─ acquire 回傳 true → 進入 critical section
  │
  ├─ 4. DB CAS SQL（MAJ-1 對齊 — 完整複製既有 updateStatus 語意）:
  │
  │     UPDATE task_steps
  │     SET status = $2,
  │         output = COALESCE($3, output),
  │         error_code = COALESCE($4, error_code),
  │         error_message = COALESCE($5, error_message),
  │         error_details = COALESCE($6, error_details),
  │         started_at = CASE WHEN $2 = 'running' AND started_at IS NULL
  │                          THEN NOW() ELSE started_at END,
  │         completed_at = CASE WHEN $2 IN ('succeeded', 'terminal_failed',
  │                                         'compensated', 'skipped')
  │                             THEN NOW() ELSE completed_at END,
  │         updated_at = NOW()
  │     WHERE step_id = $1 AND status = $7
  │     RETURNING step_id, task_id, step_name, status, attempt, max_attempts,
  │               input, output, error_code, error_message, error_details,
  │               started_at, completed_at, created_at, updated_at
  │
  │     ├─ affected rows = 1 → return { outcome: "success", step: mappedRow }
  │     └─ affected rows = 0 → re-read current status → return { outcome: "cas_mismatch", currentStatus }
  │
  └─ 5. finally: release lock（若 step 3 成功獲取）
```

> **CAS SQL 語意保證**：CAS query 精確複製既有 `PgStepRepository.updateStatus` 的 `COALESCE` 與 `CASE WHEN` 邏輯，確保 output/error/started_at/completed_at 行為一致。

## 相依性

| 相依 | 類型 | 說明 |
|------|------|------|
| `ioredis` | npm 相依 | Redis client，需新增至 `backend/package.json` |
| `pg` (既有的 pg Pool / Queryable) | npm 相依 | 用於 DB CAS query 與 step 查詢 |
| X1 `types.ts` | 內部相依 | `StepStatus`、`AgentStep`、`StepError` |
| X1 `state-machine.ts` | 內部相依 | `transitionStep` 函式 + `StepTransitionOptions` 型別（复用，不新建） |
| `persistence/rows.ts` | 內部相依 | `Queryable` interface、`StepRow`、`mapStepRow` |
| `platform/env.ts` | 內部相依 | `getEnv` 讀取 `REDIS_URI`、`REDIS_KEY_PREFIX` |

## 替代方案與風險

| 方案 | 優點 | 缺點 | 決策 |
|------|------|------|------|
| Redis Lock + DB CAS（本設計） | 兩層防護，Redis 不可用時由 NoopStepLock 降級 | 需要 Redis；CAS query 需精確複製既有 update 語意 | ✅ 採用 |
| 純 DB row-level lock（`SELECT ... FOR UPDATE`） | 不需 Redis | 跨 process 的 lock 粒度較粗；長時間 lock 會阻塞 connection pool | ❌ 不採用 |
| 僅 DB CAS（不引入 Redis） | 最簡單 | 沒有 primary guard；極端競爭場景下無法區分 lock contention 與 cas mismatch；不符合 X5 spec 要求 | ❌ 不採用 |
| Redlock 多節點 | 高可用 | 複雜度過高；目前 Docker 環境為單節點 Redis；interface 保留擴充空間 | ❌ 本次不採用 |
