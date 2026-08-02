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

**驗證**：
- [ ] `npm run build` 通過
- [ ] 單元測試：REDIS_URI 未設定時 `getRedis()` 回傳 null
- [ ] 單元測試：REDIS_URI 設定時 `getRedis()` 回傳 Redis instance

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

---

## Task 3：實作 StepTransitionGuard

**檔案**：
- `backend/src/runtime/lock/step-transition-guard.ts`

**實作範圍**：
- `StepTransitionGuard` interface：`transition(stepId, from, to, owner, opts?) → TransitionGuardResult`
- `DefaultStepTransitionGuard` class：
  - 組合 `StepLock` + `PgStepRepository`（或直接使用 DB queryable 進行 CAS）
  - 流程：驗證狀態轉移 → 獲取鎖 → DB CAS → 釋放鎖（finally）
  - DB CAS：`UPDATE task_steps SET status = $to ... WHERE step_id = $stepId AND status = $from RETURNING *`
  - 回傳四種結果：`success` / `lock_contention` / `cas_mismatch` / `invalid_transition`

**驗證**：
- [ ] `npm run lint && npm run test && npm run build` 通過
- [ ] 單元測試：正常轉移成功
- [ ] 單元測試：鎖競爭 → lock_contention
- [ ] 單元測試：CAS mismatch（DB status 不一致）
- [ ] 單元測試：非法轉移 → invalid_transition
- [ ] 單元測試：finally 保證 lock 被釋放（包括錯誤場景）

---

## Task 4：匯出模組與整合測試

**檔案**：
- `backend/src/runtime/lock/index.ts`：barrel export
- `backend/src/runtime/index.ts`：新增 `export * from "./lock/index.js"`

**驗證**：
- [ ] `npm run lint && npm run test && npm run build` 全部通過
- [ ] 整合測試（使用既有 test DB + 真實或 mock Redis）：雙重防護完整流程
