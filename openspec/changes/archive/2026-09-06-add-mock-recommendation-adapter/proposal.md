# Proposal：add-mock-recommendation-adapter

## 變更定位

純 backend、以最簡 Mock Domain 驗證 X9 Recommendation 框架與業務解耦性。對應 `second-stage-plan-en-v3.md` 的 **X10**（Layer 3 Recommendation Framework 的第二個 Issue，Dependencies: X9）。

X10 不新增框架能力，而是以一個僅含 `category`／`color`／`price` 三屬性的 Mock Adapter 注入 `RecommendationDomainAdapter`，並以 A1/A2/A3 hard-negative 案例與全鏈整合測試證明：框架骨架（DomainRoute → Intent → Constraint → Gate → Card）在不接觸任何真實業務屬性的前提下正確運作，且 hard-constraint 衝突候選被「直接排除」而非降分。

## 為什麼（Why）

X9 建立了與業務解耦的推薦框架，但「解耦」本身尚未被驗證——若框架 Core 在真實 Adapter 接入時仍需被修改，或 hard/soft 語意可被 Adapter 繞過，則框架的業務中立性未達成。X10 用最簡 Mock Domain 回答一個問題：

> 在不接觸任何真實業務屬性的前提下，框架能否只靠注入的 Adapter 完成 routing → intent → constraint → gate → card 全鏈，並正確排除 hard-constraint 衝突候選？

核心分離原則（承繼 X9）：

> Vector recall 找到相似候選；**business rules 決定是否推薦**。

## 問題描述

1. **框架解耦未經驗證** — X9 建立框架後，尚無一個「極簡、無真實業務」的 Adapter 證明 Core 不需為新 Domain 修改。
2. **hard 排除語意未以具體案例固化** — 需要 A1/A2/A3「向量相似但業務衝突」案例證明 hard constraint 是直接排除（`eligible=false`），而非降分。
3. **框架的 recall 注入邊界未以真實 Adapter 走過** — `CandidateRetriever`／`toCandidateFields`／`buildCard` 的泛型注入邊界需要一個可執行範例。

## 解決方案

### Part A：Mock Domain Adapter（唯一業務注入）

```typescript
interface MockProduct {
  productId: string;
  category: string;      // 開放字串（如 "X" | "Y"），不閉合
  color: string;         // 開放字串（如 "red" | "blue"）
  price: number;         // 僅展示用，非 A1/A2/A3 的 constraint field
  tenantId: string;      // X8.7 scope 投影
  ownerScopeId: string;
}

interface MockIntent {
  category?: string;
  color?: string;
  price?: string;
  confidence: number;
}

class MockRecommendationAdapter
  implements RecommendationDomainAdapter<MockIntent, MockProduct, RecommendationCard<MockCardPayload>> {
  readonly domain = "mock";
  // extractIntent：由 input.signals 結構化推導，MUST NOT 以 rawText 關鍵字判定
  // buildRetrievalPolicy：{ domain: "mock", candidateLimit, filters?: { category } }
  // toCandidateFields：{ category, color, price: String(price) }
  // buildCard：RecommendationCard，candidateRef 由 candidate.tenantId/ownerScopeId 投影
}
```

- Mock Adapter 是注入框架的唯一業務邊界；框架 Core（`backend/src/recommendation/`）零變更、零業務 import。
- `extractIntent` 只由 `input.signals`（已結構化 `Constraint[]`）推導 `MockIntent`，MUST NOT 以 `rawText` 自然語言關鍵字／句型／白名單判定（遵守 AGENTS.md §6）。

### Part B：Mock Catalog 與 Hard Negative Dataset

- 種子 `MockProduct[]` 10–20 筆，含 hard-negative 三例：
  - A1：category=X, color=red
  - A2：category=X, color=blue
  - A3：category=Y, color=red（color 與 A1 相同 → vector-similar，但 category 衝突）
- 當 user hard constraint `category=X` 時：A1/A2 eligible，A3 因 `category=Y` 違反 hard constraint → `eligible=false`。

### Part C：全鏈整合測試

- 組合 `RecommendationEngine`（DomainRouter + MockRecommendationAdapter + MockCandidateRetriever + ConstraintEngine + BusinessPolicyGate + ClarificationFlow + ProvenanceWriter test double），跑 DomainRoute → Intent → Constraint → Gate → Card 全鏈。
- 驗證 A3 排除、A1/A2 產出 card、candidate decision 進入 provenance 路徑。

## 目標

- ✅ 建立 `MockRecommendationAdapter`（domain `mock`，3 屬性 category/color/price）
- ✅ 建立 10–20 筆種子 catalog 含 A1/A2/A3 hard-negative set
- ✅ 建立 `MockCandidateRetriever`（recall 注入）
- ✅ hard-constraint 違反 → 直接排除（`eligible=false`）
- ✅ 全鏈整合測試（DomainRoute → Intent → Constraint → Gate → Card）
- ✅ 框架 Core 零業務 import、零變更

## 非目標

- ❌ 任何真實業務 Adapter（Hair／Nail／Food）— X11–X13
- ❌ 向量檢索或語意召回 — recall 由 `MockCandidateRetriever` 以結構化 filter 提供
- ❌ 修改 X9 框架 Core 或既有 authorization／provenance／interaction 契約
- ❌ 建立 Recommendation-only 持久化表或 migration（Mock catalog 為記憶體種子資料）
- ❌ 自然語言關鍵字／句型／白名單作為 routing 或 intent 判定

## 規格疑問

1. **catalog 是否需 PostgreSQL？** Issue 原文寫「10–20 rows in PostgreSQL」，但 X10 的 4 條 acceptance criteria 皆未要求 DB 持久化，且 X9 明訂「不新增 migration」。本提案建議採 **記憶體種子 catalog**（deterministic、無 migration、符合最小變更），PostgreSQL-backed catalog 留待 X11+ 真實 Adapter。若 PG 為硬性要求，需新增 migration + repository，屬額外範圍。

2. **A3 的 reasonCode 語意**：Issue 範例輸出 `HARD_CONSTRAINT_CONFLICT`，但依 X9 實作語意，單一 hard constraint 與候選值不符屬 `HARD_CONSTRAINT_VIOLATION`；`HARD_CONSTRAINT_CONFLICT` 保留給「輸入 signals 本身有未解決 hard 衝突」。本提案 A3 案例採 `HARD_CONSTRAINT_VIOLATION`，另以衝突案例覆蓋 `HARD_CONSTRAINT_CONFLICT` 路徑。

## Capabilities

### New Capabilities

- `mock-recommendation-adapter`：以 category/color/price 三屬性的 Mock Adapter 驗證 X9 框架（MockRecommendationAdapter、MockCandidateRetriever、Mock catalog 種子、A1/A2/A3 hard-negative 整合測試）。

## 受影響範圍

| 套件 | 影響 |
|------|------|
| backend | 新增 `src/mock-recommendation/`（types、catalog、adapter、retriever、compose、index + 測試） |
| backend | 唯讀引用 X9 `recommendation/`（RecommendationDomainAdapter、CandidateRetriever、RecommendationEngine、RecommendationCard、types）、X8.7 `authorization/`（ResourceRef）；不修改其契約 |
| backend | 不新增 migration（catalog 為記憶體種子） |

> bff 與 frontend 本次不變動。

## 與既有系統的關係

| 既有系統 | 關係 |
|---------|------|
| X9 Recommendation Framework | Mock Adapter 注入 `RecommendationDomainAdapter`；框架 Core 零變更 |
| X8.7 Authorization | `MockProduct.tenantId/ownerScopeId` 投影至 `ResourceRef`；engine 以 `resourceTenantMatches`／`resourceOwnerMatches` 驗證 |
| X8.9 Decision Provenance | 整合測試沿用框架的 candidate decision provenance 路徑（test double），不另建儲存 |
| X11 Hair Adapter | 後續以真實業務 Adapter 取代 Mock，驗證框架可重用性（非本變更） |

## 風險

| 風險 | 緩解 |
|------|------|
| Mock catalog 使用 PostgreSQL 與否不明 | 見規格疑問；本提案採記憶體種子，並於 design 記錄仲裁 |
| A3 範例 reasonCode 與框架實作不一致 | 於 design 記錄仲裁；spec 以 `HARD_CONSTRAINT_VIOLATION` 為準，另補 conflict 案例 |
| `buildCard` 無法取得 scope | `MockProduct` 承載 tenantId/ownerScopeId，buildCard 由 candidate 投影 candidateRef；engine 驗證 |
| Mock 內滲入自然語言判定 | extractIntent 只讀 signals；spec 有對應 Scenario；test 驗證 rawText 不參與判定 |
| 整合測試依賴真實 DB | ProvenanceWriter 以 test double 注入；catalog 記憶體種子；無 PG 依賴 |

## 回滾策略

- 新增 `backend/src/mock-recommendation/` 為全新模組，刪除即可回滾。
- 不新增 migration、無既有資料遷移、無破壞性 schema 變更。
- 唯讀引用既有 `recommendation/`、`authorization/`，不改其契約；無 bff／frontend 變更。
