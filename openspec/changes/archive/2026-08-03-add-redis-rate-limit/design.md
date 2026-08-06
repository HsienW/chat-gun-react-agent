# Design：add-redis-rate-limit

## 責任邊界

| 層 | 責任 | 本次變更 |
|---|---|---|
| BFF | Rate Limiter 決策與 Redis 操作 | 新增 `RedisRateLimiter`，修改 `createServer` 使用策略模式選擇 limiter |
| Frontend | 429 錯誤展示 | 在 `App.tsx` 的 `formatStreamError` 路徑中新增限流提示 UI，解析 `retryAfter` 欄位 |

## 行為變更（MAJ-3 對齊）

既有 `InMemoryRateLimiter` 使用**複合 key** `tenantId:userId:clientIp`，同一 user 從不同 IP 訪問共享配額。

升級為 Redis-backed 多維度後，`userId` 與 `IP` 為**獨立維度各自計數**。這表示：

| 情境 | 舊行為（複合 key）| 新行為（獨立維度）|
|---|---|---|
| 同一 user 從 IP-A 發送 10 請求 | 消耗共用配額 | 消耗 user 維度 10 + IP-A 維度 10 |
| 同一 user 從 IP-B 發送 10 請求 | 共用同一配額（與 IP-A 合計）| 消耗 user 維度 10 + IP-B 維度 10 |
| user 維度觸發 429 | 不適用（無獨立 user 維度）| 所有 IP 的同一 user 被阻擋 |
| IP 維度觸發 429 | 不適用（無獨立 IP 維度）| 該 IP 的所有 user 被阻擋 |

**影響**：同一 user 從多個 IP 可消耗更多總配額（user 維度 cap 限制總量）。這是**有意設計**——user 維度負責全局限流，IP 維度負責單一來源限流，兩者互補。

**降級時（InMemory）**：`InMemoryRateLimiterWrapper` 同樣使用獨立維度計數（非複合 key），保持行為一致。各維度以 `{dimensionName}:{extractKey()}` 為 InMemory key。

## 演算法選擇：Sliding Window vs Token Bucket

選用 **Token Bucket**（而非 Sliding Window）理由：

- Redis Token Bucket 只需儲存兩個欄位：`tokens`（剩餘 token 數）+ `lastRefillMs`（上次補充時間戳），對比 Sliding Window sorted set 更節省記憶體
- BFF 層是 API Gateway 入口，token bucket 的「平均速率 + burst tolerance」語意與限流需求完全吻合
- Bucket size = maxRequests，refill rate = maxRequests / windowMs，burst 即為 maxRequests（一次性允許所有配額）

Token Bucket 演算法：

```text
每次 request:
  1. now ← Date.now()
  2. elapsed ← now - lastRefillMs
  3. tokens ← min(bucketSize, tokens + elapsed * refillRate)
  4. lastRefillMs ← now
  5. if tokens >= 1:
       tokens -= 1
       return ALLOWED
     else:
       waitMs ← ceil((1 - tokens) / refillRate)
       return DENIED (resetAt = now + waitMs)
```

## Redis Key 設計（MIN-3 對齊）

Redis key prefix 統一使用 `REDIS_KEY_PREFIX` 環境變數（與 backend lock 模組對齊），預設為空字串。

```text
Redis Key: {REDIS_KEY_PREFIX}:rate_limit:{dimension}:{dimensionValue}
Value: JSON { tokens: number, lastRefillMs: number }
TTL: 2 × window（確保閒置 key 自動清除）
```

範例（REDIS_KEY_PREFIX 為空字串時）：
- `rate_limit:user:alice` → `{"tokens":5.2,"lastRefillMs":1722668400000}`
- `rate_limit:ip:203.0.113.5` → `{"tokens":0,"lastRefillMs":1722668460000}`

每個維度 key 使用獨立的 Redis key，TTL 為 2× window。

## BFF 架構變更

### 新增檔案

**`bff/src/redis-rate-limit.ts`**：

```typescript
interface RateLimitBucket {
  tokens: number;
  lastRefillMs: number;
}

interface RateLimitDimension {
  name: string;       // e.g. "user", "ip", "tenant"
  windowMs: number;
  maxRequests: number;
  extractKey: (req: IncomingMessage, ctx: RequestContext) => string | undefined;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;  // Unix ms
}

interface RateLimiter {
  check(dimension: RateLimitDimension, now?: number): Promise<RateLimitResult>;
}

class RedisRateLimiter implements RateLimiter {
  // 建構時預建 InMemoryRateLimiterWrapper 作為 fallback（MAJ-1 對齊）
  constructor(redisClient: Redis, fallback: RateLimiter) { ... }
}
```

### MVP 維度範圍（MIN-4 對齊）

Proposal 列出 6 個維度目標（userId、tenantId、IP、agentId、toolName、modelName）。MVP（本次 Change）僅實作 **userId** 與 **IP** 兩個維度。

| 維度 | MVP | 理由 |
|---|---|---|
| userId | ✅ | 主要使用者層級限流 |
| IP | ✅ | 防止單一來源濫用 |
| tenantId | Future | 目前尚無多租戶隔離需求 |
| agentId | Future | 目前 agent 數量固定，未來 agent marketplace 時啟用 |
| toolName | Future | 目前 Tool Governance 已有單獨 timeout/limit 機制 |
| modelName | Future | 目前模型由 backend 統一管理，BFF 不直接路由 |

`RateLimitDimension` interface 已預留擴充能力，新增維度只需新增設定欄位 + 建立 dimension 物件，無需改動核心邏輯。

### 修改檔案

**`bff/src/config.ts`**：

新增設定欄位：

```typescript
// Redis Rate Limit（新增）
redisRateLimitUri?: string;           // BFF_RATE_LIMIT_REDIS_URI（未設定時使用 InMemoryRateLimiter）
rateLimitUserMaxRequests: number;     // BFF_RATE_LIMIT_USER_MAX_REQUESTS（預設 30）
rateLimitUserWindowMs: number;        // BFF_RATE_LIMIT_USER_WINDOW_MS（預設 60000）
rateLimitIpMaxRequests: number;       // BFF_RATE_LIMIT_IP_MAX_REQUESTS（預設 20）
rateLimitIpWindowMs: number;          // BFF_RATE_LIMIT_IP_WINDOW_MS（預設 60000）
// 保留既有全域預設（Redis 降級 fallback + 向後相容）：
rateLimitWindowMs: number;            // 全域 fallback window
rateLimitMaxRequests: number;         // 全域 fallback max
```

**`bff/src/server.ts`**：

`createServer` 變更：

1. 初始化時依 `config.redisRateLimitUri` 決定使用 `RedisRateLimiter` 或既有 `InMemoryRateLimiter`
2. 建立 dimension 陣列（user、ip），未設定的維度直接 skip
3. 每個 request 依次檢查所有維度，任一 DENIED 即回 429

```text
createServer:
  if config.redisRateLimitUri:
    redisClient ← new Redis(config.redisRateLimitUri, { lazyConnect: true, ... })
    fallback ← new InMemoryRateLimiterWrapper(config.rateLimitWindowMs, config.rateLimitMaxRequests)
    rateLimiter ← new RedisRateLimiter(redisClient, fallback)
  else:
    rateLimiter ← new InMemoryRateLimiter(config.rateLimitWindowMs, config.rateLimitMaxRequests)
    // 使用複合 key（向後相容）

  dimensions ← [userDimension, ipDimension]（filter 有設定 max > 0 的維度；Redis 模式時才建立多維度）

request handler:
  for each dimension in dimensions:
    result ← await rateLimiter.check(dimension, now)
    if !result.allowed:
      retryAfter ← max(1, ceil((result.resetAt - now) / 1000))
      回傳 429 + Retry-After + body { error, retryAfter }
      return
  continue to proxy...
```

**`bff/src/rate-limit.ts`**：

保留既有 `InMemoryRateLimiter` 不變（作為 Redis 降級 fallback）。為相容 `RateLimiter` interface，作為 adapter 包覆。

## Frontend 變更（MIN-1 對齊）

### 整合點

Frontend 429 處理整合至 **`App.tsx`** 中的既有 stream error handler。`formatStreamError` 函式（`App.tsx:34-50`）目前已解析 `BffErrorEnvelope` 並格式化錯誤訊息。429 處理在此路徑中新增：

1. 在 `formatStreamError` 或呼叫它的 error handler 中，檢查 HTTP status 或 error envelope 是否包含 `retryAfter`
2. 若為 429，設定 `rateLimitState`（`useState`），觸發倒數計時 UI

不新增獨立 hook 或檔案（範圍最小化）。

### 修改檔案

**`frontend/src/lib/error-messages.ts`**：

新增：

```typescript
rateLimit: {
  title: '請求過於頻繁',
  message: (retryAfter: number) => `請稍後再試。（${retryAfter} 秒後可重試）`,
},
```

**`frontend/src/App.tsx`** 或新增 hook `useRateLimit.ts`：

- 在 stream error handler 或 fetch error handler 中攔截 429
- 解析 `retryAfter` 欄位
- 顯示倒數計時 UI（使用 `useState` + `setInterval`）
- 倒數結束後自動清除提示

## 降級策略（MAJ-1 對齊）

### InMemoryRateLimiterWrapper key 建構

當 Redis 不可用時，`RedisRateLimiter` 內部降級至建構時預建的 `InMemoryRateLimiterWrapper`。

`InMemoryRateLimiterWrapper` 是 adapter pattern，將既有 `InMemoryRateLimiter.check(key: string)` 包覆為 `RateLimiter.check(dimension: RateLimitDimension)`。

**key 建構規則**：降級時每個 `RateLimitDimension` 使用 `{dimension.name}:{extractKey()}` 作為 InMemory key。各維度**獨立計數**（與 Redis 模式行為一致）。

範例：
- user 維度 key：`user:alice`
- IP 維度 key：`ip:203.0.113.5`

### 場景

| 場景 | 行為 |
|---|---|
| REDIS_URI 未設定 | 使用既有 `InMemoryRateLimiter`（單維度、複合 key `tenantId:userId:clientIp`），保留向後相容 |
| Redis 連線中斷（runtime）| `RedisRateLimiter` 建構時已預建 `InMemoryRateLimiterWrapper`；每次 `check()` 若 Redis 拋錯，catch 後改呼叫 `fallback.check(dimension)`。各維度獨立計數（與 Redis 模式一致，非複合 key） |
| Redis TTL 過期後再被存取 | Redis key 已不存在 → 視為首次請求，初始化新 bucket |

### 降級時使用全域 fallback 設定（有意設計）

`InMemoryRateLimiterWrapper` 使用全域 `rateLimitWindowMs`（預設 60s）與 `rateLimitMaxRequests`（預設 120）作為所有維度的共享配額，**而非** Redis 模式下的 per-dimension 設定（user: 30/60s, IP: 20/60s）。

這是**有意設計**，理由如下：

1. **降級為暫時狀態** — Redis 連線中斷應觸發告警並修復，不應為短暫降級增加實作複雜度
2. **寬鬆配額作為安全網** — 降級時 120/60s 仍提供基本保護，避免完全無限流
3. **避免假精確** — InMemory 降級本身已失去跨實例共享的精確性，per-dimension 配額在單實例 InMemory 上意義有限
4. **實作簡化** — 單一 fallback 實例比 per-dimension fallback 更簡單，減少降級路徑的 bug 表面

若未來需要降級時也維持 per-dimension 精確度，可將 `InMemoryRateLimiterWrapper` 改為接受 `Map<dimensionName, {windowMs, maxRequests}>`。

## 資料流

```text
Browser Request
  → BFF createServer handler
    → RateLimiter.check(user dimension)
      → Redis: EVAL token_bucket.lua → { allowed, remaining, resetAt }
    → RateLimiter.check(ip dimension) [independent]
      → Redis: EVAL token_bucket.lua → { allowed, remaining, resetAt }
    → if DENIED:
      → res.writeHead(429, { 'Retry-After': seconds })
      → res.end({ error: "Rate limit exceeded", retryAfter: seconds })
    → if ALLOWED:
      → proxy to langGraph upstream

Browser receives 429
  → Frontend parses body.retryAfter
  → Shows countdown UI component
  → Auto-dismisses after countdown
```

## 替代方案

| 方案 | 優點 | 缺點 | 結論 |
|---|---|---|---|
| Sliding Window (sorted set) | 精確到毫秒 | Redis sorted set overhead，key 過多時記憶體壓力 | 不採用 |
| Token Bucket（本方案） | 節省 Redis 記憶體，足夠精確 | burst = maxRequests（可接受） | **採用** |
| Fixed Window Counter | 極簡 | 邊界 burst 問題依然存在 | 不採用 |
| 沿用 InMemoryRateLimiter + sticky session | 無 Redis 相依 | 需要 load balancer 支援，架構耦合 | 不採用 |
