# Design：add-mock-recommendation-adapter

## 架構分層

```text
backend/src/mock-recommendation/            (X10 - 新增，backend-only，注入方)
├── types.ts               MockProduct / MockIntent / MockCardPayload 型別 + runtime validation
├── catalog.ts             Mock 種子 catalog（10–20 筆）含 A1/A2/A3 hard-negative set
├── adapter.ts             MockRecommendationAdapter（implements RecommendationDomainAdapter）
├── retriever.ts           MockCandidateRetriever（implements CandidateRetriever）
├── compose.ts             createMockRecommendationEngine()（組裝 engine 的 factory）
├── index.ts               barrel export
├── adapter.test.ts        單元測試（extractIntent / buildRetrievalPolicy / toCandidateFields / buildCard）
├── retriever.test.ts      單元測試（filter / candidateLimit）
└── integration.test.ts    全鏈整合測試（route → intent → constraint → gate → card）

backend/src/recommendation/                (X9 - 唯讀引用，零變更)
backend/src/runtime/authorization/         (X8.7 - 唯讀引用 ResourceRef)
```

X10 不新增 migration、無自有持久化表；Mock catalog 為記憶體種子資料。

## 核心模型

### MockProduct（3 屬性 + scope 投影）

```typescript
interface MockProduct {
  productId: string;
  category: string;      // 開放字串（如 "X" | "Y"），不閉合、不承擔 NLU
  color: string;         // 開放字串（如 "red" | "blue"）
  price: number;         // 僅展示用，非 A1/A2/A3 的 constraint field
  tenantId: string;      // X8.7 scope 投影
  ownerScopeId: string;
}
```

- `category`／`color`／`price` 是 Mock 的三個業務屬性；`price` 為 number，於 `toCandidateFields` 轉字串以符合 `Record<string, string>`。
- `tenantId`／`ownerScopeId` 承接 X8.7 scope，使 `buildCard` 能投影出可通過 engine 驗證的 `candidateRef`。

### MockIntent（由 signals 推導）

```typescript
interface MockIntent {
  category?: string;
  color?: string;
  price?: string;
  confidence: number;    // 0..1
}
```

- `extractIntent(input)` 只讀 `input.signals`（`Constraint[]`），將 `field=category/color/price` 的 resolved 值對映進 `MockIntent`；MUST NOT 解析 `rawText`。
- `confidence` 用於框架的 `getIntentConfidence`（clarification 判定），採已解析且已知欄位 signals 的最高 confidence；signals 為空或沒有已知欄位時固定為 `0`，以 fail-closed 觸發澄清。
- 未知欄位（`field` 不屬於 category/color/price）直接忽略，不臆測為業務屬性。

### MockCandidateRetriever（recall 注入）

```typescript
class MockCandidateRetriever implements CandidateRetriever<MockProduct> {
  constructor(private readonly catalog: readonly MockProduct[]) {}
  async retrieve(policy: RetrievalPolicy): Promise<MockProduct[]>;
}
```

- `retrieve` 依 `policy.filters`（如 `{ category: "X" }`）過濾 catalog，並截斷至 `policy.candidateLimit`。
- 無 filter 時回傳前 `candidateLimit` 筆；不實作向量檢索或語意召回。
- 回傳筆數 MUST NOT 超過 `policy.candidateLimit`（engine 有 fail-closed 驗證）。

### MockRecommendationAdapter（唯一業務注入邊界）

```typescript
class MockRecommendationAdapter
  implements RecommendationDomainAdapter<MockIntent, MockProduct, RecommendationCard<MockCardPayload>> {
  readonly domain = "mock";
  async extractIntent(input: RecommendationInput): Promise<MockIntent>;
  buildRetrievalPolicy(intent: MockIntent): RetrievalPolicy;
  toCandidateFields(candidate: MockProduct): Record<string, string>;
  buildCard(candidate: MockProduct): RecommendationCard<MockCardPayload>;
}
```

- `buildRetrievalPolicy`：`{ domain: "mock", candidateLimit: N, ...(intent.category ? { filters: { category: intent.category } } : {}) }`。`domain` MUST 恆為 `mock`（engine 驗證 policy.domain === routed domain）。
- `toCandidateFields`：`{ category, color, price: String(price) }`；純欄位對映，不判定 hard/soft。
- `buildCard`：以 `mock-${candidate.productId}` 為 deterministic `cardId`、`candidate.productId` 為 `resourceId`、`resourceType: "mock_product"`、`tenantId`/`ownerScopeId` 取自 candidate，產出 `RecommendationCard<MockCardPayload>`（`payload` 含 title/category/color/price 展示欄位）。

### compose factory（組裝 engine）

```typescript
interface MockRecommendationEngineOptions {
  catalog?: readonly MockProduct[];
  candidateLimit?: number;
  confidenceThreshold?: number;
  provenanceWriter?: RecommendationEngineProvenanceWriter;  // 測試可注入 test double
  now?: () => Date;
}
function createMockRecommendationEngine(options?): RecommendationEngine<MockIntent, MockProduct, RecommendationCard<MockCardPayload>>;
```

- 集中組裝 `DomainRouter`（單一註冊 `MockRecommendationAdapter`）、`MockCandidateRetriever`、`ConstraintEngine`、`BusinessPolicyGate`、`ClarificationFlow` 與 provenance writer，供整合測試與未來 live smoke 使用。
- 未注入 `provenanceWriter` 時使用 async noop，確保 Mock/test 不依賴 DB；任何 live 使用 MUST 注入真實 writer，不能把 noop 當成正式決策稽核。
- Adapter-swap 測試的第二個變體固定為 `mock-v2`，保留 `category` 並以 `size` 取代 `color`，藉此驗證 Core 不依賴 Mock v1 的屬性集合。

## Hard Negative 案例與 reasonCode 仲裁

### 案例 1：hard violation（A1/A2/A3 主案例）

| 候選 | category | color | user hard `category=X` | 結果 |
|------|----------|-------|------------------------|------|
| A1 | X | red | ✅ 相符 | eligible=true |
| A2 | X | blue | ✅ 相符 | eligible=true |
| A3 | Y | red | ❌ 違反 hard | eligible=false, `HARD_CONSTRAINT_VIOLATION` |

**仲裁（reasonCode）**：Issue 範例輸出 `HARD_CONSTRAINT_CONFLICT`，但依 X9 已實作語意，單一 hard constraint 與候選值不符屬 `HARD_CONSTRAINT_VIOLATION`；`HARD_CONSTRAINT_CONFLICT` 專指「輸入 signals 本身有未解決 hard 衝突」。故 A3 案例採 `HARD_CONSTRAINT_VIOLATION`。

### 案例 2：hard conflict（補充案例）

輸入 signals 對 `category` 有兩個 hard constraint（`value=X` 與 `value=Y`，同 source、同 confidence）→ `ConstraintEngine.resolve` 輸出至 `conflicts` → `evaluateCandidate` fail-closed（`eligible=false`, `HARD_CONSTRAINT_CONFLICT`）→ `RecommendationEngine` 觸發澄清（`clarificationRequested=true`）。

## catalog 持久化仲裁（PostgreSQL vs 記憶體）

Issue 原文「10–20 rows in PostgreSQL」。仲裁：**Mock catalog 採記憶體種子資料**。

理由：
- X10 的 4 條 acceptance criteria 皆未要求 DB 持久化；框架驗證與 catalog 儲存媒介正交。
- X9 明訂「不新增 migration」；為 throwaway Mock 資料新增 migration + repository 屬過度工程與技術債，違反「最小且完整變更」。
- 記憶體種子 deterministic、無 PG 依賴、CI 快速。
- `CandidateRetriever` 是注入邊界，未來 X11+ 真實 Adapter 可自行接 PostgreSQL catalog 而不改框架。

PostgreSQL-backed catalog 留待 X11+ 真實 Adapter 依需要引入。

## 資料模型

X10 不新增任何 PostgreSQL 表、不新增 migration。Mock catalog 為 `backend/src/mock-recommendation/catalog.ts` 內的型別化種子常數（10–20 筆 `MockProduct`）。

- 每個 `MockProduct` 承載 `tenantId`/`ownerScopeId`，投影至 `RecommendationCard.candidateRef`（`resourceType: "mock_product"`）。
- provenance 決策走 X9 既有路徑（整合測試以 `RecommendationEngineProvenanceWriter` test double 承接，避免真實 DB 依賴）。

## 授權整合

- `RecommendationInput.principal`／`scope` 由呼叫者注入（承接 X8.7）。
- `buildCard` 以 candidate 的 `tenantId`/`ownerScopeId` 投影 `candidateRef`；`RecommendationEngine` 以 `resourceTenantMatches`／`resourceOwnerMatches` 驗證 scope 一致性，不一致 fail-closed。
- Mock 不自行解析身份、不重複授權。

## 觀測性（Telemetry）

- Mock 不新增 metric 或 trace 語意；重大決策沿用 X9 `ProvenanceWriter` 路徑（整合測試以 test double 承接）。
- 不在 card payload 或 candidateRef 內暴露 raw prompt／credential／PII。

## 替代方案

| 方案 | 評估 |
|------|------|
| Mock catalog 使用 PostgreSQL + migration | ❌ 過度工程；違反最小變更與 X9 無 migration；留待 X11+ |
| 在框架 Core 內建 Mock 測試 Adapter | ❌ 汙染 Core 業務中立性；Mock 為注入方，獨立目錄 |
| extractIntent 以 rawText 關鍵字判定 | ❌ 違反 AGENTS.md §6；signals 已結構化，MUST NOT 走 NL 關鍵字 |
| A3 用 `HARD_CONSTRAINT_CONFLICT` | ❌ 與 X9 已實作語意衝突；採 `HARD_CONSTRAINT_VIOLATION` |
| buildCard 由 adapter 內部持有固定 scope | ❌ 易與 input.scope 脫節；由 `MockProduct` 承載 scope 投影 |

## 責任邊界

| 套件 | 責任 |
|------|------|
| backend（X10 mock-recommendation） | 提供 `MockRecommendationAdapter`、`MockCandidateRetriever`、Mock catalog 種子、compose factory 與整合測試；不修改框架 Core、不建自有表 |
| backend（X9 recommendation） | 零變更；持續提供泛型框架與評估語意 |
| bff | 本次不變動 |
| frontend | 本次不變動 |
