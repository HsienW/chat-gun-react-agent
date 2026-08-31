# Proposal：add-recommendation-domain-framework

## 變更定位

純 backend、business-neutral 的 Recommendation 框架。在 X8.7 Authorization（`ResourceRef`、`PrincipalContext`、`RuntimeScope`）、X8.8 Interaction Runtime（HITL／`waiting_confirmation`）、X8.9 Decision Provenance／Context Reference（`DecisionRecord`、`EvidenceRef`、`ContextRef`、`ContextReferenceResolver`）之上，建立與任何具體商業領域解耦的推薦框架：DomainRouter、Constraint Engine、BusinessPolicyGate、Clarification flow 與 Generic Card。

本變更對應 `second-stage-plan-en-v3.md` 的 **X9**，是 Layer 3（Recommendation Framework）的第一個 Issue，消費 X8.9 但**不擁有也不重定義** provenance storage。

## 為什麼（Why）

推薦流程的「不變骨架」與「商業規則」若不抽離，未來每個 Domain Adapter 都會各自重寫 routing、constraint 評估、排除規則與澄清流程，導致不一致、重複與難以治理。

核心分離原則：

> Vector recall 找到相似候選；**business rules 決定是否推薦**。

- 框架只負責「決定是否推薦」的骨架：constraint 評估、hard/soft gate、澄清、provenance 寫入。
- 「找相似候選」的實際 recall 由 Adapter 注入，框架只定義 `RetrievalPolicy`，不實作向量檢索。

## 問題描述

1. **無統一的 Domain routing** — 未來多 Domain（Hair／Nail／Food）各自判斷「這個輸入屬於哪個領域」，會形成硬編碼映射或重複邏輯。
2. **無統一 Constraint 評估** — hard／soft constraint 的評估與 source 優先權（使用者文字 > 選擇 > vision > memory > 模型推論）沒有單一實作。
3. **Hard constraint 被當成分數懲罰** — 違反 hard constraint 的候選應被「直接排除」，而非只降分；此語意無一致保證。
4. **低信心無澄清機制** — 意圖信心不足時，缺乏統一「進入 HITL 澄清」的框架，各 Domain 自行處理。
5. **推薦決策無 provenance** — routing／clarification／candidate 排除等重大決策未記錄「為何如此」，無證據引用與 policy version 可追溯。

## 解決方案

### Part A：DomainRouter

```typescript
interface DomainRouter {
  route(input: RecommendationInput): Promise<string>;
  registerAdapter(adapter: RecommendationDomainAdapter): void;
}
```

- 以註冊的 Adapter `domain` 為唯一 route 目標；不硬編碼任何 Domain 名稱或輸入白名單。
- routing 決策由注入的 `DomainRoutingStrategy` 提供（多 Domain 時）；單一註冊 Adapter 時預設確定性 route 至該 domain。策略注入避免在框架內硬編碼領域判定。

### Part B：RecommendationDomainAdapter 泛型介面（唯一業務注入邊界）

```typescript
interface RecommendationDomainAdapter<
  TIntent = unknown,
  TProduct = unknown,
  TCard = unknown
> {
  domain: string;
  extractIntent(input: RecommendationInput): Promise<TIntent>;
  buildRetrievalPolicy(intent: TIntent): RetrievalPolicy;
  toCandidateFields(candidate: TProduct): Record<string, string>;
  buildCard(candidate: TProduct): TCard;
}
```

- 框架 import 零業務常數；所有業務變異經由此泛型介面注入。
- `toCandidateFields` 是 Adapter 的業務對映點（candidate → 欄位）；評估（hard/soft 判定）由框架的 `RecommendationEngine` 擁有（`ConstraintEngine` + `BusinessPolicyGate`），語意集中在框架、Adapter 無法繞過。

### Part C：Constraint Engine（Hard/Soft + source 優先權）

```typescript
type ConstraintSource =
  | "user_text" | "selection" | "vision" | "memory" | "model_inference";

interface Constraint {
  field: string;
  value: string;
  source: ConstraintSource;
  confidence: number;   // 0..1
  mode: "hard" | "soft";
}

interface CandidateDecision {
  eligible: boolean;
  reason?: string;
  reasonCode?: string;
  adjustedScore?: number;
}
```

- 解析衝突：同一 `field` 有來自多 source 的 constraint 時，依固定優先權決定（`user_text` > `selection` > `vision` > `memory` > `model_inference`）；同 source + 同 confidence + value 衝突時**保留兩者並標記衝突**（`ConstraintResolution.conflicts`），不得靜默選一。
- 評估候選：hard 違反 → `eligible=false`；soft 違反 → 調整 `adjustedScore` 而非排除；hard 未解決衝突 → fail-closed 排除（`reasonCode="HARD_CONSTRAINT_CONFLICT"`）並交澄清。

> 註：計劃原文 `Constraint.source` 列舉 3 值（`user_text | vision | memory`）與其「Constraint Priority」5 階不一致；本提案採 5 階優先權為準，將 `source` 定義為涵蓋 5 階的穩定 Domain Constant（見 design 說明）。

### Part D：BusinessPolicyGate

Hard constraint 違反 → **直接排除**（`eligible=false`），而非分數懲罰。soft constraint → 分數調整。`apply` 接受衝突上下文（`context.conflicts`），未解決 hard 衝突一律 fail-closed 排除。

### Part E：Decision provenance 整合（消費 X8.9，不重定義）

- routing／clarification／candidate-policy 等重大決策，經 X8.9 `DecisionRecordStore.record()` 寫入 `DecisionRecord`，並以 `EvidenceStore` 寫入 `EvidenceRef`（引用 candidate／product／input 的 `ResourceRef`）。
- 記錄 `policyVersion` 與 `reasonCode`；X9 不建立任何 Recommendation-only 的 Decision/Evidence/Context 表或 schema。

### Part F：Clarification flow 框架

低信心意圖 → 產生 clarification 請求 → 進入既有 `waiting_confirmation`（HITL）流程；收到 clarification_answer 後重新執行 intent 擷取。X9 只定義「何時澄清、問什麼」，HITL 機制複用 X1 Task State Machine 與 X8.8 Interaction Runtime，不建立平行機制。

### Part G：Generic Card 模型

```typescript
interface RecommendationCard<TCardPayload = unknown> {
  cardId: string;
  domain: string;
  candidateRef: ResourceRef;   // 引用 product／offer resource
  payload: TCardPayload;        // layout 由 Adapter 實作
  createdAt: string;
}
```

## 目標

- ✅ 建立 DomainRouter（註冊制 + 注入式 routing，無硬編碼 domain）
- ✅ 建立 `RecommendationDomainAdapter<TIntent, TProduct, TCard>` 泛型介面，作為唯一業務注入邊界
- ✅ 建立 Constraint Engine（hard/soft 評估 + 5 階 source 優先權衝突解析）
- ✅ 建立 BusinessPolicyGate（hard 違反 → 直接排除，非降分）
- ✅ 重大決策（routing／clarification／candidate-policy）經 X8.9 `DecisionRecord` + `EvidenceRef` 持久化，含 policy version 與證據引用
- ✅ 建立 Clarification flow（低信心 → HITL），複用 X1／X8.8，不建平行機制
- ✅ 建立 Generic Card 模型（layout 由 Adapter 注入）
- ✅ 框架 import 零業務常數；不建立重複 provenance 表或 business-local DecisionRecord schema

## 非目標

- ❌ 任何具體業務 Adapter（Hair／Nail／Food）— X11–X13
- ❌ 向量檢索實作 — 框架只定義 `RetrievalPolicy`，recall 由 Adapter 注入
- ❌ Recommendation-specific 的 Decision/Evidence/Context persistence — 使用 X8.9
- ❌ 自建 queue／scheduler／worker pool 或平行 Run Runtime
- ❌ 硬編碼自然語言關鍵字、句型或使用者輸入白名單作為 routing／intent 判定
- ❌ Knowledge Graph、RDF/OWL、causal engine、vector retrieval 或 semantic inference

## Capabilities

### New Capabilities

- `recommendation-domain-framework`：與業務領域解耦的推薦框架（DomainRouter、RecommendationDomainAdapter、ConstraintEngine、BusinessPolicyGate、ClarificationFlow、RecommendationCard、provenance 整合）。

## 受影響範圍

| 套件 | 影響 |
|------|------|
| backend | 新增 `src/recommendation/`（types、domain-adapter、domain-router、constraint-engine、business-policy-gate、clarification、card、provenance-integration、recommendation-engine、index） |
| backend | 唯讀引用 X8.7 `authorization/`（`ResourceRef`、`PrincipalContext`、`RuntimeScope`）、X8.9 `provenance/`（`DecisionRecordStore`、`EvidenceStore`、`createDecisionRecord`）、X1 `runtime/`（Task state machine）與 X8.8 `interaction/`；不修改其契約 |
| backend | 不新增 migration（X9 無自有表；provenance 持久化走 X8.9 既有 `decision_records`／`decision_evidence_refs`） |

> bff 與 frontend 本次不變動。

## 與既有系統的關係

| 既有系統 | 關係 |
|---------|------|
| X1 Task State Machine | 推薦 Task 繼承泛型 Task；clarification 進入既有 `waiting_confirmation` |
| X8.7 Authorization | 重用 `ResourceRef`／`PrincipalContext`／`RuntimeScope`；provenance 證據引用與授權邊界由 X8.7 提供 |
| X8.8 Interaction Runtime | clarification 複用 HITL／`waiting_confirmation`／`clarification_answer`，不建平行互動機制 |
| X8.9 Decision Provenance | 消費 `DecisionRecord` + `EvidenceRef` 記錄重大決策；不重定義 schema |
| X10 Mock Adapter | 後續以 Mock Domain 驗證框架與業務解耦（非本變更） |

## 風險

| 風險 | 緩解 |
|------|------|
| 框架內滲入業務常數／domain 名稱 | `RecommendationDomainAdapter` 為唯一注入邊界；lint/test 驗證零業務 import；routing 由注入策略提供 |
| source 優先權列舉與原文不一致 | 採 5 階優先權為準，`ConstraintSource` 定義為涵蓋 5 階的穩定 Domain Constant；於 design 記錄決策 |
| 重複 X8.9 provenance 儲存 | X9 不新增表、不建 business-local DecisionRecord；只呼叫 X8.9 stores |
| 澄清機制演成平行 HITL | ClarificationFlow 只產出澄清請求與進入既有 `waiting_confirmation`；不自行排程／儲存 HITL 狀態 |
| recall 邊界不清 | recall 由注入的 `CandidateRetriever` 提供，框架只定義 `RetrievalPolicy` |

## 回滾策略

- 新增 `backend/src/recommendation/` 為全新模組，刪除即可回滾。
- 不新增 migration、無既有資料遷移、無破壞性 schema 變更。
- 唯讀引用既有 `authorization/`、`provenance/`、`runtime/`、`interaction/`，不改其契約；無 bff／frontend 變更。
