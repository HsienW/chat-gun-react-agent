# Tasks：add-redis-rate-limit

## Task 1：新增 ioredis 相依至 BFF、建立 Redis 連線模組與測試基礎設施

**檔案**：
- `bff/package.json`：新增 `ioredis` dependency 與 `vitest` devDependency（與 frontend/backend 對齊），新增 `test` script
- `bff/src/redis-client.ts`：`getRedis()` / `closeRedis()` / `isRedisAvailable()`
- `bff/vitest.config.ts`：vitest 設定

**實作範圍**：
- 從 `BFF_RATE_LIMIT_REDIS_URI` 環境變數讀取連線字串（MIN-3 對齊：BFF 有自己的 Redis URI，與 backend `REDIS_URI` 獨立）
- 使用 `lazyConnect: true`，`connectTimeout: 3000`，`maxRetriesPerRequest: 2`
- 未設定 URI 時 `getRedis()` 回傳 null（不拋錯）
- `closeRedis()` 優雅關閉
- `isRedisAvailable()` 回傳 boolean
- Redis key prefix 使用 `buildRateLimitKey` helper 函式讀取 `REDIS_KEY_PREFIX`（與 backend lock 模組共用相同環境變數），格式：`{REDIS_KEY_PREFIX}:rate_limit:{dimension}:{value}`，預設 prefix 為空字串
- `bff/package.json` 新增 `"test": "vitest run"` script（MAJ-2 對齊：使用 vitest 與專案其他套件一致）
- 測試使用 `vitest` 框架（`describe`/`it`/`expect`/`vi`），與 frontend/backend 對齊

**驗證**：
- [x] `npm run build` 通過
- [x] `npm run test` 通過
- [x] 單元測試（vitest）：`BFF_RATE_LIMIT_REDIS_URI` 未設定時 `getRedis()` 回傳 null
- [x] 單元測試（vitest）：`BFF_RATE_LIMIT_REDIS_URI` 設定時 `getRedis()` 回傳 Redis instance
- [x] 單元測試（vitest）：`isRedisAvailable()` 行為正確

---

## Task 2：實作 RedisRateLimiter（Token Bucket）

**檔案**：
- `bff/src/redis-rate-limit.ts`

**實作範圍**：
- `RateLimitResult` type：`{ allowed, remaining, resetAt }`
- `RateLimitDimension` type：`{ name, windowMs, maxRequests, extractKey }`
- `RateLimiter` interface：`check(dimension, now?) → RateLimitResult`
- `RedisRateLimiter` class：
  - `acquire(key, windowMs, maxRequests, now?) → RateLimitResult`
  - 使用 Lua script（`EVAL`）atomically 執行 token bucket refill + consume
  - Key TTL = `2 × windowMs`（redis auto-expiry）
  - 首次請求或 key 不存在時初始化 bucket = `{ tokens: maxRequests, lastRefillMs: now }`
  - `remaining` 回傳 `floor(tokens)`
  - `resetAt` 計算：若 `tokens >= 1` 回傳 `null`（無 wait）；否則 `now + ceil((1 - tokens) / refillRate)`
- Redis 錯誤處理：catch Redis error → 降級為 `InMemoryRateLimiterWrapper`（內部建立 InMemoryRateLimiter）
- `InMemoryRateLimiterWrapper`：將既有的 `InMemoryRateLimiter` 包覆成 `RateLimiter` interface（adapter pattern）

**Lua Script**（atomic token bucket，MIN-2 對齊 — 含 cjson 損壞防護）：

```lua
-- KEYS[1]: rate limit key
-- ARGV[1]: maxRequests (bucket size)
-- ARGV[2]: windowMs
-- ARGV[3]: now (epoch ms)
local bucketRaw = redis.call('GET', KEYS[1])
local tokens = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local lastRefillMs = now

if bucketRaw then
  local ok, decoded = pcall(cjson.decode, bucketRaw)
  if ok and decoded then
    local elapsed = now - decoded.lastRefillMs
    tokens = math.min(tonumber(ARGV[1]), decoded.tokens + elapsed * (tonumber(ARGV[1]) / windowMs))
    lastRefillMs = now
  end
  -- pcall 失敗時：視為 key 不存在，使用初始化值（tokens = maxRequests, lastRefillMs = now）
end

local refillRate = tonumber(ARGV[1]) / windowMs
local allowed = 0
local resetAt = 0

if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
  resetAt = 0
else
  allowed = 0
  resetAt = now + math.ceil((1 - tokens) / refillRate)
end

redis.call('SET', KEYS[1], cjson.encode({tokens = tokens, lastRefillMs = lastRefillMs}), 'PX', windowMs * 2)
return {allowed, math.floor(tokens), resetAt}
```

**驗證**：
- [x] `npm run build` 通過
- [x] 單元測試：首次請求 → allowed, remaining = max-1
- [x] 單元測試：連續請求直到 token 耗盡 → DENIED + resetAt
- [x] 單元測試：等待 window/2 後 token 部分恢復（refill 驗證）
- [x] 單元測試：等待完整 window 後 bucket 重置為 max
- [x] 單元測試：不同 key 獨立計數
- [x] 單元測試：`BFF_RATE_LIMIT_REDIS_URI` 未設定時使用 InMemoryRateLimiter
- [x] 單元測試：mock Redis 拋錯 → 降級至 InMemoryRateLimiter
- [x] 單元測試：Redis key TTL 設定為 2× window

---

## Task 3：修改 BFF server.ts 與 config.ts 整合 RedisRateLimiter

**檔案**：
- `bff/src/config.ts`
- `bff/src/server.ts`

**實作範圍**：

**config.ts** 新增：
- `BFF_RATE_LIMIT_REDIS_URI` 環境變數讀取
- `BFF_RATE_LIMIT_USER_MAX_REQUESTS`（預設 30）
- `BFF_RATE_LIMIT_USER_WINDOW_MS`（預設 60000）
- `BFF_RATE_LIMIT_IP_MAX_REQUESTS`（預設 20）
- `BFF_RATE_LIMIT_IP_WINDOW_MS`（預設 60000）

**server.ts** 變更：
- `createServer` 初始化時依設定選擇 `RedisRateLimiter` 或 `InMemoryRateLimiter`
- 建立 dimension 陣列（user、ip），未設定的維度 skip
- 每個 request 依序檢查所有維度，任一 DENIED 回傳 429 + `Retry-After` + body `{ error, retryAfter }`
- `Retry-After` 計算：`max(1, ceil((resetAt - now) / 1000))`
- 保留既有的 `x-ratelimit-limit`、`x-ratelimit-remaining`、`x-ratelimit-reset` header
- Server close 時呼叫 `closeRedis()` 優雅關閉

**驗證**：
- [x] `npm run build` 通過
- [x] `npm run test` 通過（既有 BFF 測試繼續通過）
- [x] 整合測試：多維度限流（user + ip）任一觸發 → 429
- [x] 整合測試：429 response 包含 `Retry-After` header
- [x] 整合測試：429 response body 包含 `error` 與 `retryAfter` 欄位
- [x] 整合測試：`BFF_RATE_LIMIT_REDIS_URI` 未設定時使用 InMemoryRateLimiter（既有行為不變）

---

## Task 4：Frontend Rate Limit UI 提示（MIN-1 對齊）

**檔案**：
- `frontend/src/lib/error-messages.ts`
- `frontend/src/App.tsx`（在既有 `formatStreamError` / error handler 路徑中整合，不新增獨立檔案）

**實作範圍**：

**error-messages.ts** 新增：

```typescript
rateLimit: {
  title: '請求過於頻繁',
  message: (retryAfter: number) => `請稍後再試。（${retryAfter} 秒後可重試）`,
},
```

**Frontend 429 handling**（整合至 `App.tsx`）：

- 在 `formatStreamError`（`App.tsx:34-50`）中新增對 `retryAfter` 欄位的解析
- 若 error envelope 包含 `retryAfter` 欄位（429 回應），設定 local state `rateLimitRetryAfter`
- 使用 `useState` + `useEffect`（`setInterval`）倒數
- 倒數結束後自動清除 `rateLimitRetryAfter` state
- 在 chat message area 中顯示限流提示（使用 `FRONTEND_ERROR_MESSAGES.rateLimit.message`）
- 不改變既有的 stream error / abort error 處理行為
- 在 `formatStreamError` 或既有 error handler 中解析 `retryAfter`
- 新增 `useRateLimit` hook 或用 local state 管理倒數
- 倒數結束後自動清除提示
- 不改變既有的 stream error / abort error 行為

**驗證**：
- [x] `npm run lint && npm run test && npm run build` 通過
- [x] 單元測試：收到 429 error envelope 時顯示限流提示
- [x] 單元測試：`retryAfter` 倒數正確顯示
- [x] 單元測試：非 429 錯誤不觸發限流 UI
- [x] 單元測試：倒數結束後提示自動消失
