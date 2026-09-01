# Tasks：add-mock-recommendation-adapter

> 對應 `second-stage-plan-en-v3.md` X10（Layer 3 Recommendation Framework 的 Mock Adapter），backend-only。每個 Task 只有在實作完成、測試新增、驗證實際執行通過後才勾選 `- [x]`。

## Phase 1：Mock 型別與種子 catalog（backend）

### Task 1.1：MockProduct / MockIntent / MockCardPayload 型別 + runtime validation

- [ ] 建立 `backend/src/mock-recommendation/types.ts`
- [ ] 定義 `MockProduct`（`productId`／`category`／`color`／`price: number`／`tenantId`／`ownerScopeId`）
- [ ] 定義 `MockIntent`（`category?`／`color?`／`price?`／`confidence`）
- [ ] 定義 `MockCardPayload`（`title`／`category`／`color`／`price` 展示欄位）
- [ ] runtime validation：`tenantId`／`ownerScopeId`／`productId` 非空字串；`confidence` ∈ [0,1] finite；`price` finite number
- [ ] 唯讀引用 X9 `recommendation/` 與 X8.7 `authorization/`，不重定義身份模型

**驗證：** `cd backend && npx vitest run src/mock-recommendation/types.test.ts`

### Task 1.2：Mock catalog 種子（10–20 筆，含 A1/A2/A3 hard-negative set）

- [ ] 建立 `backend/src/mock-recommendation/catalog.ts`
- [ ] 定義 `MOCK_CATALOG: readonly MockProduct[]`，筆數介於 10–20
- [ ] 明確包含 A1（category=X, color=red）、A2（category=X, color=blue）、A3（category=Y, color=red）
- [ ] 每筆含非空 `tenantId`／`ownerScopeId`（單一 demo tenant/scope）
- [ ] 以型別化常數為單一來源；無 DB、無 migration

**驗證：** `cd backend && npx vitest run src/mock-recommendation/catalog.test.ts`

---

## Phase 2：Mock Adapter 與 Retriever（backend）

### Task 2.1：MockRecommendationAdapter（implements RecommendationDomainAdapter）

- [ ] 建立 `backend/src/mock-recommendation/adapter.ts`
- [ ] `domain = "mock"`（封閉常數，單一來源）
- [ ] `extractIntent`：只由 `input.signals` 推導 `MockIntent`（category/color/price 欄位），MUST NOT 解析 `rawText`；未知欄位忽略不臆測
- [ ] `buildRetrievalPolicy`：`{ domain: "mock", candidateLimit, filters?: { category } }`
- [ ] `toCandidateFields`：`{ category, color, price: String(price) }`（純對映，不判定 hard/soft）
- [ ] `buildCard`：`candidateRef` 以 candidate 的 tenantId/ownerScopeId 投影，`resourceType: "mock_product"`，`payload` 含展示欄位
- [ ] 測試：signals 推導、rawText 不參與、未知欄位忽略、policy domain 恆 mock、card candidateRef 匹配 scope

**驗證：** `cd backend && npx vitest run src/mock-recommendation/adapter.test.ts`

### Task 2.2：MockCandidateRetriever（implements CandidateRetriever）

- [ ] 建立 `backend/src/mock-recommendation/retriever.ts`
- [ ] `retrieve(policy)`：依 `policy.filters.category` 過濾 catalog，截斷至 `policy.candidateLimit`
- [ ] 無 filter 回傳前 `candidateLimit` 筆；回傳筆數 MUST NOT 超過 `candidateLimit`
- [ ] 不實作向量檢索／語意召回
- [ ] 測試：category filter 命中、candidateLimit 截斷、空結果

**驗證：** `cd backend && npx vitest run src/mock-recommendation/retriever.test.ts`

---

## Phase 3：compose factory 與全鏈整合測試（backend）

### Task 3.1：createMockRecommendationEngine factory

- [ ] 建立 `backend/src/mock-recommendation/compose.ts`
- [ ] 組裝 `DomainRouter`（單一註冊 MockRecommendationAdapter）+ `MockCandidateRetriever` + `ConstraintEngine` + `BusinessPolicyGate` + `ClarificationFlow` + provenance writer
- [ ] provenance writer 可注入 test double（預設亦可提供不寫 DB 的實作）
- [ ] `getIntentConfidence` 由 MockIntent.confidence 提供；可配置 confidenceThreshold／candidateLimit
- [ ] 測試：factory 產出可用 engine，單一註冊 route 確定性回傳 `mock`

**驗證：** `cd backend && npx vitest run src/mock-recommendation/compose.test.ts`

### Task 3.2：全鏈整合測試（DomainRoute → Intent → Constraint → Gate → Card）

- [ ] 建立 `backend/src/mock-recommendation/integration.test.ts`
- [ ] 案例 A3 排除：hard `category=X` → A3 `category=Y` → `eligible=false`，`reasonCode=HARD_CONSTRAINT_VIOLATION`
- [ ] 案例 A1/A2 保留：`category=X` → eligible，產出 card
- [ ] 案例 hard conflict：兩個同 source 同 confidence 的 hard `category`（X/Y）→ `eligible=false` + `clarificationRequested=true`
- [ ] 案例 candidateRef 不匹配 scope → engine fail-closed 拒絕
- [ ] 案例換 Adapter（第二個 mock domain 變體）→ 框架語意一致、Core 零修改
- [ ] 全程以 ProvenanceWriter test double，無真實 DB 依賴

**驗證：** `cd backend && npx vitest run src/mock-recommendation/integration.test.ts`

---

## Phase 4：barrel export 與全量驗證（backend）

### Task 4.1：barrel export 與零業務 import 邊界驗證

- [ ] 建立 `backend/src/mock-recommendation/index.ts` barrel export
- [ ] 驗證 X9 框架 Core（`backend/src/recommendation/`）不 import `mock-recommendation` 或任何 Mock 業務常數
- [ ] 驗證不新增 migration、無自有持久化表

**驗證：** `cd backend && npx vitest run src/mock-recommendation/*.test.ts`

### Task 4.2：lint / test / build 全量

- [ ] `cd backend && npm run lint` 通過
- [ ] `cd backend && npm run test` 通過（含既有 recommendation／authorization／provenance 回歸）
- [ ] `cd backend && npm run build` 通過
- [ ] 驗證無不必要的 `any`；Mock domain 常數有單一來源與未知值處理
- [ ] `openspec validate add-mock-recommendation-adapter --strict` 通過

**驗證：** Backend lint/test/build 通過；OpenSpec strict validation 0 issues
