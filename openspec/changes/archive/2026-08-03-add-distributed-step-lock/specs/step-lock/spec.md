# Spec：Step Lock 分散式鎖

## ADDED Requirements

### Requirement: 分散式 Step 鎖獲取與釋放

StepLock 必須提供 Redis 支援的分散式鎖，確保同一 stepId 同時只有一個 owner 能持有鎖。

#### Scenario: 單一 worker 成功獲取並釋放鎖

GIVEN stepId "step-1" 沒有被鎖定
WHEN owner "worker-A" 呼叫 `acquire("step-1", "worker-A", 30000)`
THEN 回傳 `true`
AND Redis 中存在 key `step_lock:step-1`，值為 `"worker-A"`，TTL 為 30000ms
WHEN "worker-A" 呼叫 `release("step-1", "worker-A")`
THEN 鎖被釋放
AND Redis 中 key `step_lock:step-1` 不存在

#### Scenario: 兩個併發 worker 競爭同一 Step

GIVEN stepId "step-1" 已被 "worker-A" 持有
WHEN "worker-B" 呼叫 `acquire("step-1", "worker-B", 30000)`
THEN 回傳 `false`（鎖競爭失敗）

#### Scenario: 鎖持有者 crash 後 TTL 過期

GIVEN stepId "step-1" 被 "worker-A" 持有，TTL 為 1 秒
WHEN 1 秒後 "worker-A" 仍未釋放（模擬 crash）
AND "worker-B" 呼叫 `acquire("step-1", "worker-B", 30000)`
THEN 回傳 `true`（過期鎖被 Redis 自動刪除，新 worker 成功獲取）

#### Scenario: 非持有者嘗試釋放鎖

GIVEN stepId "step-1" 被 "worker-A" 持有
WHEN "worker-B" 呼叫 `release("step-1", "worker-B")`
THEN 鎖未被釋放（Lua script 拒絕非持有者的操作）
AND "worker-A" 仍持有鎖

#### Scenario: 持有者延長鎖 TTL

GIVEN stepId "step-1" 被 "worker-A" 持有，TTL 為 30 秒
WHEN "worker-A" 呼叫 `extend("step-1", "worker-A", 60000)`
THEN 回傳 `true`
AND Redis 中 key 的 TTL 更新為 60000ms

#### Scenario: 非持有者嘗試延長鎖 TTL

GIVEN stepId "step-1" 被 "worker-A" 持有
WHEN "worker-B" 呼叫 `extend("step-1", "worker-B", 60000)`
THEN 回傳 `false`（非持有者無法延長他人的鎖）

#### Scenario: Redis 不可用時的 NoopStepLock 降級行為

GIVEN Redis 連線不可用（未設定 REDIS_URI）
AND `createStepLock()` 工廠回傳 `NoopStepLock` 實例
WHEN 任何 worker 呼叫 `acquire("step-1", "worker-A", 30000)`
THEN 回傳 `true`（NoopStepLock 安全降級：放行但依賴 DB CAS）
AND `release` 為 no-op（不擲出錯誤）
AND `extend` 回傳 `true`

---

### Requirement: Step Transition Guard 雙重防護

StepTransitionGuard 必須組合 StepLock（Redis）與 DB CAS（PostgreSQL），確保 Step 狀態轉移在併發場景下的一致性。

#### Scenario: 正常轉移成功

GIVEN stepId "step-1" 目前狀態為 `pending`
AND 沒有其他 worker 持有此 step 的鎖
WHEN owner "worker-A" 呼叫 `transition("step-1", "pending", "running", "worker-A")`
THEN 回傳 `{ outcome: "success", step: { status: "running", ... } }`
AND DB 中 step 狀態更新為 `running`
AND 鎖被釋放

#### Scenario: 鎖競爭導致轉移失敗

GIVEN stepId "step-1" 的鎖已被 "worker-B" 持有
WHEN "worker-A" 呼叫 `transition("step-1", "pending", "running", "worker-A")`
THEN acquire 回傳 false
AND Guard 回傳 `{ outcome: "lock_contention" }`（currentOwner 為 best-effort GET 結果，可能過期）

#### Scenario: DB CAS 偵測到競爭寫入

GIVEN "worker-A" 成功獲取 stepId "step-1" 的鎖
AND 在 lock 與 DB update 之間，step-1 的狀態已被外部變更為 `running`（極端場景）
WHEN "worker-A" 呼叫 `transition("step-1", "pending", "running", "worker-A")`
THEN DB update 影響 0 rows（`WHERE status = 'pending'` 條件不符合）
AND 回傳 `{ outcome: "cas_mismatch", currentStatus: "running" }`
AND 鎖仍被釋放（finally 區塊保證）

#### Scenario: 非法狀態轉移

GIVEN stepId "step-1" 目前狀態為 `succeeded`
WHEN worker 呼叫 `transition("step-1", "succeeded", "running", "worker-A")`
THEN 回傳 `{ outcome: "invalid_transition", reason: "..." }`
AND 鎖被釋放（不持有無效轉移的鎖）

#### Scenario: 操作過程中鎖必定被釋放

GIVEN stepId "step-1" 目前狀態為 `pending`
WHEN transition 操作無論成功、失敗、或擲出例外
THEN 鎖在最終於 finally 區塊被釋放
AND 不會殘留未釋放的鎖

#### Scenario: Redis 不可用（REDIS_URI 未設定）時的 NoopStepLock 路徑

GIVEN REDIS_URI 未設定
AND `createStepLock()` 回傳 `NoopStepLock`
WHEN worker 呼叫 `transition("step-1", "pending", "running", "worker-A")`
THEN lock.acquire 回傳 true（NoopStepLock 永遠放行）
AND 執行 DB CAS（`UPDATE ... WHERE status = 'pending'`）
AND 轉移成功時回傳 `{ outcome: "success", ... }`

#### Scenario: Redis 連線中斷（runtime）時 lock_contention

GIVEN RedisStepLock 已建立但 Redis 連線在 acquire 時中斷
WHEN worker 呼叫 `transition("step-1", "pending", "running", "worker-A")`
THEN acquire 拋出錯誤
AND Guard 回傳 `{ outcome: "lock_contention" }`（安全失敗，不自動降級為 CAS-only）
