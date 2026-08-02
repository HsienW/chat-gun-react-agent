# Tasks：add-distributed-step-lock

## Task 1：安裝 ioredis 相依並建立 Redis 連線模組

**檔案**：
- `backend/package.json`：新增 `ioredis` dependency
- `backend/src/runtime/lock/redis-client.ts`：`getRedis()` / `closeRedis()` / `isRedisAvailable()`

**實作範圍**：
- `getRedis()` 從 `REDIS_URI` 讀取連線字串，使用 `lazyConnect: true`
- 未設定 REDIS_URI 時回傳 null（不拋錯）
- `closeRedis()` 優雅關閉連線
- `isRedisAvailable()` 回傳 boolean（用於降級判斷）
- 支援 `REDIS_KEY_PREFIX` 環境變數作為 key namespace prefix

**驗證**：
- [ ] `npm run build` 通過
- [ ] 單元測試：REDIS_URI 未設定時 `getRedis()` 回傳 null
- [ ] 單元測試：REDIS_URI 設定時 `getRedis()` 回傳 Redis instance
- [ ] 單元測試：`REDIS_KEY_PREFIX` 為空字串時 key 格式正確
- [ ] 單元測試：`REDIS_KEY_PREFIX` 設定時 key 包含 prefix

---

## Task 2：實作 StepLock interface 與 Redis 實作

**檔案**：
- `backend/src/runtime/lock/step-lock.ts`

**實作範圍**：
- `StepLock` interface：`acquire` / `release` / `extend`
- `RedisStepLock` class：
  - `acquire` 使用 `SET step_lock:{stepId} {owner} NX PX {ttlMs}`，成功回傳 `true`，失敗回傳 `false`
  - `release` 使用 Lua script atomic check-and-delete
  - `extend` 使用 Lua script atomic check-and-extend
- `NoopStepLock` class：Redis 不可用時的降級實作（`acquire` 永遠回傳 `true`，`release` no-op，`extend` 回傳 `true`）
- `createStepLock()` 工廠函式：自動選擇 Redis 或 Noop 實作

**驗證**：
- [ ] `npm run lint && npm run test && npm run build` 通過
- [ ] 單元測試：正常 acquire/release（mock Redis）
- [ ] 單元測試：兩個 worker 競爭同一 step（第二個 acquire 回傳 false）
- [ ] 單元測試：release 時 owner 不匹配 → 鎖未被釋放
- [ ] 單元測試：extend 成功與失敗（owner mismatch）
- [ ] 單元測試：NoopStepLock 行為正確
- [ ] 單元測試：TTL 過期後其他 worker 可重新獲取鎖（邊界測試）
- [ ] 單元測試：`createStepLock()` 工廠依 REDIS_URI 正確選擇實作
- [ ] 單元測試：`RedisStepLock` TTL 非法值（NaN / 0 / 負數）拋出錯誤

---

## Task 3：實作 StepTransitionGuard

**檔案**：
- `backend/src/runtime/lock/step-transition-guard.ts`

**實作範圍**：
- `StepTransitionGuard` interface：`transition(stepId, from, to, owner, opts?) → TransitionGuardResult`
  - `opts` 复用 `state-machine.ts` 的 `StepTransitionOptions`（不新建型別）
- `DefaultStepTransitionGuard` class：
  - constructor injection：`{ db: Queryable; lock?: StepLock; lockTtlMs?: number }`
  - 流程：讀取 step → 驗證狀態轉移 → 獲取鎖 → DB CAS（完整 COALESCE/CASE WHEN）→ 釋放鎖（finally）
  - DB CAS SQL 精確複製 `PgStepRepository.updateStatus` 的 COALESCE/CASE WHEN 語意
  - `lock_contention` 的 `currentOwner` 為 best-effort GET（非原子操作）
  - 回傳四種結果：`success` / `lock_contention` / `cas_mismatch` / `invalid_transition`

**驗證**：
- [ ] `npm run lint && npm run test && npm run build` 通過
- [ ] 單元測試：正常轉移成功（含 output/error 寫入）
- [ ] 單元測試：轉移中 `started_at` / `completed_at` 正確設定
- [ ] 單元測試：鎖競爭 → lock_contention（含 currentOwner best-effort）
- [ ] 單元測試：CAS mismatch（DB status 不一致 → 回傳 currentStatus）
- [ ] 單元測試：非法轉移 → invalid_transition（state-machine 拒絕）
- [ ] 單元測試：finally 保證 lock 被釋放（正常、錯誤、CAS mismatch 三場景）
- [ ] 單元測試：step 不存在時回傳 invalid_transition
- [ ] 單元測試：Redis 連線錯誤時 acquire 拋錯 → lock_contention（不自動降級為 CAS-only）
- [ ] 單元測試：NoopStepLock 路徑（REDIS_URI 未設定時 Guard 正常運作）
- [ ] 單元測試：lock release 總在 finally 執行（使用 spy 驗證呼叫次數）

---

## Task 4：匯出模組與整合測試

**檔案**：
- `backend/src/runtime/lock/index.ts`：barrel export
- `backend/src/runtime/index.ts`：新增 `export * from "./lock/index.js"`

**驗證**：
- [ ] `npm run lint && npm run test && npm run build` 全部通過
- [ ] 整合測試（使用既有 test DB + 真實或 mock Redis）：雙重防護完整流程
