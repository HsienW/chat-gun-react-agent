# Proposal：add-distributed-step-lock

## 變更定位

純 Runtime，零業務依賴。建立 Redis 支援的分散式 Step 鎖與 Step Transition Guard，防止兩個併發 Worker 同時修改同一個 Step 狀態。這是分散式狀態一致性的最後一塊拼圖。

## 問題描述

X3 Idempotency 防止「相同請求重複執行」，但不能防止以下併發場景：

1. **兩個不同請求同時操作同一 Task** — 兩個併發請求帶著相同 taskId 到達，Idempotency 不阻止不同請求同時操作
2. **LangGraph resume 與外部 retry 同時觸發** — Resume 和 Retry 可能同時對同一個 Step 發起狀態轉移
3. **Compensation 與 normal flow 同時執行** — X4 Compensation 可能在 Task 尚未完全終止時被觸發

這些場景中，Idempotency 透過 DB unique constraint 防止重複建立，但 **Step 狀態轉移在併發下的競爭**需要分散式鎖來保護。

## 解決方案

建立兩層防護：

1. **Redis Distributed Lock（主要防線）** — 使用 `SET NX PX` 實現 Step-level 分散式鎖，確保同一時間只有一個 worker 能進入 critical section
2. **DB Compare-And-Swap（最後防線）** — `UPDATE ... WHERE status = $from`，即使 Redis 不可用也不損壞資料

架構：

```text
StepTransitionGuard
  ├── StepLock (Redis SET NX PX + Lua release)
  └── PgStepRepository (DB CAS: WHERE status = $from)
```

## 目標

- ✅ Redis 支援的分散式 Step Lock：acquire / release / extend
- ✅ Owner 身份驗證（防止釋放他人的鎖）
- ✅ TTL 自動過期（防止 worker crash 後永久鎖定）
- ✅ StepTransitionGuard 雙重防護（Redis Lock + DB CAS）
- ✅ Redis 不可用時安全降級（僅依賴 DB CAS）
- ✅ 純 Runtime，不 import 任何業務常數

## 非目標

- ❌ Redlock 多節點實作（單節點 `SET NX PX` 對目前 Docker 環境已足夠；interface 保留未來擴充空間）
- ❌ Cross-Task 全域鎖（Admission Control — Layer 2 範圍）
- ❌ 自動整合進 LangGraph agent flow（Lock 為獨立防護層，由 caller 決定何時使用）
- ❌ BFF 層鎖傳播（BFF 的 request dedup 由 X3 Idempotency + X6 Rate Limit 處理）

## 受影響範圍

| 套件 | 影響 |
|------|------|
| backend | 新增 `src/runtime/lock/` 目錄：redis-client、step-lock、step-transition-guard |
| backend | 修改 `src/runtime/index.ts`：匯出新模組 |
| backend | `package.json`：新增 `ioredis` 相依 |
| bff | 本次不變動 |
| frontend | 本次不變動 |

## 風險

| 風險 | 緩解 |
|------|------|
| Redis 單節點故障導致鎖服務中斷 | 安全降級：Redis 不可用時跳過 lock，僅依賴 DB CAS（`WHERE status = $from`）作為最後防線 |
| ioredis 新增相依增加 bundle 複雜度 | ioredis 為成熟且廣泛使用的 Redis client（TypeScript 原生支援）；僅在 `lock/` 模組中使用，不影響其他模組 |
| Lock TTL 設定過短導致 lock 提前釋放 | 提供 `extend()` 續約機制；預設 TTL 30s 對 Step 轉移操作（通常 < 1s）已足夠 |
| 與既有 compensation flow 的互動 | `StepTransitionGuard` 是獨立防護層，不修改任何既有模組；caller 自行決定何時使用 |

## 回滾策略

- `backend/src/runtime/lock/` 為全新目錄，刪除即可回滾
- `backend/src/runtime/index.ts` 只新增一行 export，移除即可
- `ioredis` 可從 `package.json` 移除（若無其他模組使用）
