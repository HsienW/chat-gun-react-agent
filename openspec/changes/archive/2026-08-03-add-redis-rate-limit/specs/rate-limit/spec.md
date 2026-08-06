# Spec：Redis Rate Limit 分散式限流

## ADDED Requirements

### Requirement: Redis-backed Rate Limiter

BFF 必須支援 Redis-backed Rate Limiter，以 Sliding Window 或 Token Bucket 演算法實現精確限流，並支援多維度獨立配額。

#### Scenario: Sliding Window 限流成功

GIVEN Redis 可用
AND 維度 `userId` 的 window 為 60s，max 為 10
WHEN user "alice" 在 60 秒內發送第 8 個請求
THEN 回傳 `{ allowed: true, remaining: 2 }`
AND BFF 在 response header 中寫入 `x-ratelimit-remaining: 2`

#### Scenario: 超過限流門檻

GIVEN user "alice" 的 window 已累積 10 個請求
WHEN user "alice" 發送第 11 個請求
THEN 回傳 `{ allowed: false, remaining: 0, resetAt: <window_reset_timestamp> }`
AND BFF 回傳 HTTP 429
AND response header 包含 `Retry-After: <seconds>`
AND response body 為 `{ error: "Rate limit exceeded", retryAfter: <seconds> }`

#### Scenario: 不同維度獨立計數

GIVEN `userId` 維度 max 為 10，`IP` 維度 max 為 20
AND user "alice" 從 IP-A 發送請求造成 `userId` 已達上限
WHEN user "bob" 從 IP-A 發送請求
THEN `userId` 限流不影響 bob（bob 的 `userId` 未被限流）
AND bob 的請求正常通過

GIVEN `IP` 維度 max 為 20
AND IP-A 已有 20 個請求觸發 IP 維度限流
WHEN user "alice" 從 IP-B 發送請求
THEN alice 不受 IP-A 限流影響，正常通過
AND IP-B 獨立計數

#### Scenario: Redis 不可用時降級為 InMemoryRateLimiter

GIVEN Redis 連線失敗或未設定 REDIS_URI
WHEN BFF 初始化 RateLimiter
THEN 自動降級為 InMemoryRateLimiter（使用既有 `rateLimitWindowMs` 與 `rateLimitMaxRequests` 設定）
AND 所有請求仍可正常處理
AND 限流行為與現有 InMemoryRateLimiter 一致

---

### Requirement: 多維度限流設定

BFF 必須支援多個限流維度，每個維度可獨立設定 window 與 max。

#### Scenario: 設定檔支援多維度

GIVEN `BFF_RATE_LIMIT_REDIS_URI` 已設定
AND 設定中包含：
  - `BFF_RATE_LIMIT_USER_MAX_REQUESTS=30`
  - `BFF_RATE_LIMIT_USER_WINDOW_MS=60000`
  - `BFF_RATE_LIMIT_IP_MAX_REQUESTS=20`
  - `BFF_RATE_LIMIT_IP_WINDOW_MS=60000`
WHEN BFF 啟動
THEN `userId` 維度使用 max=30, window=60s
AND `IP` 維度使用 max=20, window=60s
AND 未設定維度（如 `agentId`）使用全域預設值

#### Scenario: 未設定 Redis URI 時沿用既有行為

GIVEN `BFF_RATE_LIMIT_REDIS_URI` 未設定
WHEN BFF 啟動
THEN 使用既有 InMemoryRateLimiter
AND window 與 max 沿用 `BFF_RATE_LIMIT_WINDOW_MS` 與 `BFF_RATE_LIMIT_MAX_REQUESTS`
AND 多維度設定欄位被忽略（不影響既有行為）

---

### Requirement: 429 Response 契約

BFF 在觸發限流後，必須回傳包含 `Retry-After` header 的標準化 429 response。

#### Scenario: 429 response 包含 Retry-After

GIVEN user "alice" 觸發限流
AND resetAt 為未來 45 秒
WHEN BFF 回傳 429
THEN response header 包含 `Retry-After: 45`
AND response header 包含 `x-ratelimit-reset: <unix_timestamp>`
AND response header 包含 `x-ratelimit-remaining: 0`
AND response body 為 `{ error: "Rate limit exceeded", retryAfter: 45 }`

#### Scenario: Retry-After 最小值為 1

GIVEN user "alice" 觸發限流
AND resetAt 為未來 0.3 秒（不足 1 秒）
WHEN BFF 回傳 429
THEN `Retry-After` header 值為 `1`（最小 1 秒）
AND `retryAfter` 在 body 中為 `1`

---

### Requirement: Frontend Rate Limit UI

Frontend 必須在收到 429 response 時顯示使用者友善的提示，包含剩餘等待時間。

#### Scenario: 收到 429 後顯示重試提示

GIVEN user 發送請求後收到 429 response
AND `retryAfter` 為 45 秒
WHEN Frontend 解析 response
THEN 顯示錯誤訊息包含：「請求過於頻繁，請稍後再試。（45 秒後可重試）」
AND 顯示倒數計時（每秒更新）

#### Scenario: 倒數結束後恢復可操作狀態

GIVEN 429 提示顯示中，倒數計時為 1 秒
WHEN 倒數結束
THEN 提示自動消失
AND 使用者可重新發送訊息

#### Scenario: 非 429 錯誤不觸發限流 UI

GIVEN user 發送請求後收到 5xx 或其他非 429 錯誤
WHEN Frontend 解析 response
THEN 顯示原有錯誤訊息
AND 不顯示限流倒數計時
