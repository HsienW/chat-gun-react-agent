# Proposal：add-redis-rate-limit

## 變更定位

Layer 2 Platform Governance。將 BFF 的 In-Memory Rate Limiter 升級為 Redis-backed Token Bucket 實作；本次 MVP 支援 `userId` 與 `IP` 兩個獨立維度，並在 Frontend 新增 429 提示 UI。

## 問題描述

目前 BFF `InMemoryRateLimiter`（`bff/src/rate-limit.ts`）存在以下限制：

1. **單一 BFF 實例計數** — 兩個 BFF 實例獨立計數，無法共享配額。Docker Compose 或 horizontal scale 時，同一用戶可跨實例消耗雙倍額度。
2. **單一維度限流** — 目前 key 固定為 `tenantId:userId:clientIp`，無法對不同 agentId、toolName 或 modelName 設定獨立限流策略。
3. **無 Sliding Window** — 目前是 fixed-window counter，邊界時間點可能出現 double-spike（前一窗口末尾 + 新窗口開頭）。
4. **無 Retry-After Header** — 429 response 缺少 `Retry-After` header，Frontend 無從得知何時可以重試。
5. **無 Frontend Rate Limit UI** — 用戶收到 429 後只有原始 `"Rate limit exceeded"` 文字，體驗較差。

## 解決方案

建立兩層變更：

1. **BFF：Redis Rate Limiter** — 使用 ioredis（backend 既有的相依）實作 Sliding Window 或 Token Bucket，支援多維度獨立 window 與 max 設定。429 response 增加 `Retry-After` header。
2. **Frontend：Rate Limit UI 提示** — 攔截 429 response，顯示剩餘等待時間與重試建議。

架構：

```text
BFF createServer
  ├── RedisRateLimiter（新）
  │     ├── Token Bucket
  │     ├── MVP 維度：userId, IP
  │     └── 降級：Redis runtime 失敗時 fallback 至 InMemoryRateLimiterWrapper（獨立維度計數）
  └── Frontend 429 UI（新）
        └── 顯示 Retry-After 剩餘時間 + 重試按鈕
```

## 目標

- ✅ Redis-backed Rate Limiter（Token Bucket）
- ✅ 多維度限流（MVP）：`userId` 與 `IP` 兩個獨立維度，各維度可獨立設定 window 與 max；`RateLimitDimension` interface 預留 `tenantId`、`agentId`、`toolName`、`modelName` 擴充能力
- ✅ 429 response 包含 `Retry-After` header
- ✅ Redis 未設定時維持既有複合 key limiter；Redis runtime 失敗時降級至 InMemoryRateLimiterWrapper（獨立維度計數）
- ✅ Frontend 429 UI：剩餘等待時間倒數 + 重試提示
- ✅ BFF 既有測試繼續通過，新增限流測試

## 非目標

- ❌ Backend Tool-layer rate limiting（Tool Governance 責任）
- ❌ Distributed rate limit across multiple Redis instances（Redlock）
- ❌ Granular per-route 限流（全局限流即可滿足目前需求）
- ❌ 動態 policy hot-reload
- ❌ `tenantId`、`agentId`、`toolName`、`modelName` 維度限流（Future；`RateLimitDimension` interface 已預留擴充點）

## 受影響範圍

| 套件 | 影響 |
|---|---|
| bff | 新增 `src/redis-rate-limit.ts`；修改 `src/server.ts`（使用新 RateLimiter）與 `src/config.ts`（新增 Redis 與多維度限流設定） |
| backend | 本次不變動（ioredis 為既有相依，BFF 可直接引入） |
| frontend | 修改 `src/lib/error-messages.ts`（新增 429 文字）；修改 `src/App.tsx` 或新增 rate-limit hook（攔截 429） |

## 風險

| 風險 | 緩解 |
|---|---|
| Redis 單節點故障導致限流服務中斷 | 安全降級：Redis runtime 失敗時 fallback 至 InMemoryRateLimiterWrapper（獨立維度計數，見 Design §降級策略） |
| 多維度限流 key 數量成長 | 每個維度的 key 使用 `2 × window` TTL，閒置後自動清除 |
| BFF 新增 ioredis 相依（目前僅 backend 使用） | ioredis 已在專案中驗證（backend lock 模組），版本一致 |
| Frontend 429 UI 複雜化 App.tsx | 抽取為獨立 hook 或 error handler，不變更現有 stream error 邏輯 |

## 回滾策略

- 移除 `bff/src/redis-rate-limit.ts`
- 恢復 `server.ts` 使用 `InMemoryRateLimiter`
- 移除 `config.ts` 中新增的 Redis 設定欄位
- 移除 Frontend 429 UI 相關程式
- 若無其他模組使用，可從 BFF `package.json` 移除 `ioredis`
