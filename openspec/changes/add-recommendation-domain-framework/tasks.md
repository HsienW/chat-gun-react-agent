# Tasks：add-recommendation-domain-framework

> 對應 `second-stage-plan-en-v3.md` X9（Layer 3 Recommendation Framework），消費 X8.9 Decision Provenance、X8.8 Interaction Runtime、X8.7 Authorization 與 X1 Task State Machine。backend-only。每個 Task 只有在實作完成、測試新增、驗證實際執行通過後才勾選 `- [x]`。

> **Review 決議備註（Qwen review-plan COMMENT_ONLY）**：
> - MAJOR-001 衝突解析型別：`resolve` 回傳 `ConstraintResolution { resolved, conflicts }`；hard 未解決衝突 → fail-closed 排除（`HARD_CONSTRAINT_CONFLICT`）。
> - MAJOR-002 評估組合：Adapter `validateCandidate` → `toCandidateFields`；評估由 `RecommendationEngine` 擁有。
> - Minor（實作中處理，非阻擋）：MINOR-001 soft penalty 預設、MINOR-002 空候選集與澄清迴圈保護、MINOR-003 import-boundary 靜態檢查、MINOR-004 `confirmationType:"clarification"`、MINOR-005 精確相等語意。

## Phase 1：泛型型別與注入邊界（backend）

### Task 1.1：RecommendationInput / RetrievalPolicy / Constraint / CandidateDecision 型別

- [ ] 建立 `backend/src/recommendation/types.ts`
- [ ] 定義 `RecommendationInput`（`requestId?`／`threadId?`／`runId?`／`taskId?`／`stepId?`／`principal: PrincipalContext`／`scope: RuntimeScope`／`signals: Constraint[]`／`rawText?`）
- [ ] 定義 `RetrievalPolicy`（`domain`／`candidateLimit`／`filters?`）
- [ ] 定義 `ConstraintSource`（`user_text`／`selection`／`vision`／`memory`／`model_inference`）與 `Constraint`（`field`／`value`／`source`／`confidence`／`mode`）
- [ ] 定義 `CandidateDecision`（`eligible`／`reason?`／`reasonCode?`／`adjustedScore?`）與 `RecommendationResult`
- [ ] runtime validation：`confidence` 越界 [0,1] 或非 finite 拒絕；`mode` 僅 `hard`/`soft`；`signals` 為陣列
- [ ] 唯讀 `import` X8.7 `PrincipalContext`／`RuntimeScope`，不重定義身份模型
- [ ] 測試：越界 confidence 拒絕、未知 mode 拒絕

**驗證：** `cd backend && npx vitest run src/recommendation/types.test.ts`

### Task 1.2：RecommendationDomainAdapter 與 CandidateRetriever 介面

- [ ] 建立 `backend/src/recommendation/domain-adapter.ts`
- [ ] 定義 `RecommendationDomainAdapter<TIntent, TProduct, TCard>`（`domain`／`extractIntent`／`buildRetrievalPolicy`／`toCandidateFields`／`buildCard`）
- [ ] 定義 `CandidateRetriever<TProduct>`（`retrieve(policy)`）
- [ ] `toCandidateFields` 只做 candidate → 欄位對映（MAJOR-002：評估由框架擁有，Adapter 不判定 hard/soft）
- [ ] 型別層級保證框架零業務 import：介面只引用本模組泛型與既有契約型別
- [ ] 測試：以 Mock 泛型 Adapter 驗證泛型參數推導

**驗證：** `cd backend && npx vitest run src/recommendation/domain-adapter.test.ts`

### Task 1.3：RecommendationCard 泛型模型

- [ ] 建立 `backend/src/recommendation/card.ts`
- [ ] 定義 `RecommendationCard<TCardPayload>`（`cardId`／`domain`／`candidateRef: ResourceRef`／`payload`／`createdAt`）與 factory + runtime validation
- [ ] `candidateRef` 重用 X8.7 `ResourceRef`；不引進第二套資源身份
- [ ] 測試：cardId 非空、candidateRef 有效 tenantId

**驗證：** `cd backend && npx vitest run src/recommendation/card.test.ts`

---

## Phase 2：Constraint Engine 與 BusinessPolicyGate（backend）

### Task 2.1：ConstraintEngine（source 優先權衝突解析 + hard/soft 評估）

- [ ] 建立 `backend/src/recommendation/constraint-engine.ts`
- [ ] 定義 `ResolvedConstraint`、`ConstraintConflict`、`ConstraintResolution` 與 `ConstraintEngine`（`resolve`／`evaluateCandidate`）
- [ ] `resolve`：同 `field` 多 source 依固定優先權（`user_text` > `selection` > `vision` > `memory` > `model_inference`）選勝出者；同 source 取較高 confidence；同 source + 同 confidence + value 衝突 → 輸出至 `conflicts`（MAJOR-001）
- [ ] `evaluateCandidate`：hard 違反 → `eligible=false`（`reasonCode` 標記）；soft 違反 → `adjustedScore` 調整；hard 未解決衝突 → `eligible=false` + `HARD_CONSTRAINT_CONFLICT`
- [ ] 測試：user_text 覆寫 memory、同 source confidence 取高者、hard/soft 分離、衝突標記

**驗證：** `cd backend && npx vitest run src/recommendation/constraint-engine.test.ts`

### Task 2.2：BusinessPolicyGate（hard → 直接排除）

- [ ] 建立 `backend/src/recommendation/business-policy-gate.ts`
- [ ] 定義 `BusinessPolicyGate.apply(decision, context?)`：hard-violation → 強制 `eligible=false`；未解決 hard 衝突（`context.conflicts`）→ fail-closed 排除；soft → 保留 eligible 僅調分
- [ ] Gate 為純函數、無 IO、無副作用
- [ ] 測試：hard 排除非降分、soft 不排除、衝突 fail-closed、輸入 eligible=false 不被翻轉為 true

**驗證：** `cd backend && npx vitest run src/recommendation/business-policy-gate.test.ts`

---

## Phase 3：DomainRouter 與 Orchestration（backend）

### Task 3.1：DomainRouter（註冊制 + 注入式 routing）

- [ ] 建立 `backend/src/recommendation/domain-router.ts`
- [ ] 定義 `DomainRoutingStrategy` 與 `DomainRouter`（`route`／`registerAdapter`）
- [ ] 單一註冊 Adapter → 確定性 route；多 Domain → 委派注入 `DomainRoutingStrategy`
- [ ] route 未註冊／未知 → fail-closed 回傳錯誤，不得猜測 domain
- [ ] 測試：單一確定性、多 Domain 委派策略、未註冊 fail-closed

**驗證：** `cd backend && npx vitest run src/recommendation/domain-router.test.ts`

### Task 3.2：RecommendationEngine（orchestrator 全鏈）

- [ ] 建立 `backend/src/recommendation/recommendation-engine.ts`
- [ ] 定義 `RecommendationEngine.recommend(input)`，依序 route → extractIntent → buildRetrievalPolicy → retrieve → resolve → 每 candidate 經 `toCandidateFields` + `evaluateCandidate` + `gate.apply`（orchestrator 擁有評估，MAJOR-002）→ buildCard → provenance
- [ ] 低信心意圖觸發 ClarificationFlow，`clarificationRequested=true`；空候選集依 MINOR-002 記錄 DecisionRecord 並定義澄清迴圈保護
- [ ] 測試：以 Mock Adapter 驗證 route→intent→constraint→gate→card 全鏈

**驗證：** `cd backend && npx vitest run src/recommendation/recommendation-engine.test.ts`

---

## Phase 4：Clarification 與 Provenance 整合（backend）

### Task 4.1：ClarificationFlow（低信心 → HITL）

- [ ] 建立 `backend/src/recommendation/clarification.ts`
- [ ] 定義 `ClarificationFlow`（`shouldClarify`／`request`）與 `ClarificationRequest`
- [ ] `shouldClarify` 依可配置信心門檻與 hard-constraint 缺失判定；配置驅動，非硬編碼句型
- [ ] 澄清請求進入既有 `waiting_confirmation`（X1／X8.8）契約，不建立平行 HITL 排程或狀態儲存
- [ ] 測試：低信心觸發、高信心不觸發、門檻可配置

**驗證：** `cd backend && npx vitest run src/recommendation/clarification.test.ts`

### Task 4.2：ProvenanceWriter（消費 X8.9 DecisionRecord + EvidenceRef）

- [ ] 建立 `backend/src/recommendation/provenance-integration.ts`
- [ ] 定義 `ProvenanceWriter`（`writeRouting`／`writeClarification`／`writeCandidateDecision`）
- [ ] 呼叫 X8.9 `createDecisionRecord` + `DecisionRecordStore.record()`；`EvidenceStore.record()` 寫 `EvidenceRef`（input／candidate／policy role）
- [ ] 不建立任何 Recommendation-only 表或 business-local DecisionRecord schema
- [ ] 只存 reference／version／hash，遵守 X8.9 redaction 契約
- [ ] 測試：寫入呼叫 X8.9 stores、證據 role 正確、無自有 schema

**驗證：** `cd backend && npx vitest run src/recommendation/provenance-integration.test.ts`

---

## Phase 5：barrel export 與全量驗證（backend）

### Task 5.1：barrel export 與零業務 import 驗證

- [ ] 建立 `backend/src/recommendation/index.ts` barrel export
- [ ] 驗證 `src/recommendation/` 不 import 任何具體業務 domain／產品 schema／業務常數
- [ ] 驗證不新增 migration、無自有持久化表

**驗證：** `cd backend && npx vitest run src/recommendation/*.test.ts`

### Task 5.2：lint / test / build 全量

- [ ] `cd backend && npm run lint` 通過
- [ ] `cd backend && npm run test` 通過（含既有 authorization／provenance／interaction 回歸）
- [ ] `cd backend && npm run build` 通過
- [ ] 驗證無不必要的 `any`；`ConstraintSource`／`decisionType`／`reasonCode` 型別有單一來源與未知值處理
- [ ] `openspec validate add-recommendation-domain-framework --strict` 通過

**驗證：** Backend lint/test/build 通過；OpenSpec strict validation 0 issues
