# Design：add-recommendation-domain-framework

## 架構分層

```text
backend/src/recommendation/               (X9 - 新增，backend-only)
├── types.ts                   RecommendationInput / RetrievalPolicy / Constraint / ConstraintSource /
│                              CandidateDecision / RecommendationResult 型別 + runtime validation
├── domain-adapter.ts          RecommendationDomainAdapter<TIntent,TProduct,TCard> 泛型介面 +
│                              CandidateRetriever<TProduct>（recall 注入）
├── domain-router.ts           DomainRouter + 註冊表 + 注入式 DomainRoutingStrategy
├── constraint-engine.ts       ConstraintEngine（source 優先權衝突解析 + hard/soft 評估）
├── business-policy-gate.ts    BusinessPolicyGate（hard → 排除；soft → 調整分數）
├── clarification.ts           ClarificationFlow（低信心 → HITL 澄清請求）
├── card.ts                    RecommendationCard 泛型模型 + factory + validation
├── provenance-integration.ts  ProvenanceWriter（消費 X8.9 DecisionRecordStore + EvidenceStore）
├── recommendation-engine.ts   RecommendationEngine（orchestrator：route → intent → retrieve → gate → card → provenance）
└── index.ts                   barrel export

backend/src/runtime/authorization/   (X8.7 - 唯讀引用 ResourceRef、PrincipalContext、RuntimeScope)
backend/src/runtime/provenance/      (X8.9 - 唯讀引用 DecisionRecordStore、EvidenceStore、createDecisionRecord)
backend/src/runtime/                 (X1 - 唯讀引用 Task state machine)
backend/src/runtime/interaction/     (X8.8 - 唯讀引用 HITL / waiting_confirmation 契約)
```

X9 不新增 migration，無自有持久化表。

## 核心模型

### RecommendationInput（承載 trusted identity + 訊號）

```typescript
interface RecommendationInput {
  requestId?: string;
  threadId?: string;
  runId?: string;
  taskId?: string;
  stepId?: string;
  principal: PrincipalContext;     // X8.7 trusted identity
  scope: RuntimeScope;             // X8.7 active scope
  signals: Constraint[];           // 各 source 的結構化 constraint 訊號
  rawText?: string;                // 僅供 evidence/provenance 引用，不作 routing/intent 判定邏輯
}
```

- `principal`／`scope` 承接 X8.7 trusted identity 資料流；X9 不自行解析身份，不信任任意 client identity header。
- `signals` 為已結構化的 `Constraint[]`（由上游／Adapter 產生）；框架不做 NLU，避免硬編碼自然語言關鍵字或句型。
- `rawText` 僅作為 evidence 的來源引用（如 `role: "input"` 的 `ResourceRef` 或 snapshot），不參與 routing／intent 判定。

### Constraint 與 ConstraintSource（5 階優先權）

```typescript
type ConstraintSource =
  | "user_text" | "selection" | "vision" | "memory" | "model_inference";

interface Constraint {
  field: string;                 // 開放字串；Domain 自定義欄位（如 category／style／price）
  value: string;                 // 開放字串
  source: ConstraintSource;      // 封閉 Domain Constant（見下方決策說明）
  confidence: number;            // 0..1，runtime validation 拒絕越界
  mode: "hard" | "soft";
}
```

**決策（source 列舉不一致的仲裁）**：`second-stage-plan-en-v3.md` 的 `Constraint.source` 列舉 `user_text | vision | memory`，但其「Constraint Priority」明列 5 階（User explicit text > User current selection > High-confidence Vision > Historical preference Memory > Low-confidence model inference）。本 design 採 5 階優先權為準，將 `ConstraintSource` 定義為涵蓋 5 階的封閉 Domain Constant：

```text
user_text > selection > vision > memory > model_inference
```

`ConstraintSource` 是穩定 Protocol Enum（單一來源、有型別、有未知值處理、有測試），符合 AGENTS.md §6「封閉 Mapping 僅限穩定 Domain Constant」；不承擔自然語言理解或地理解析。

### ConstraintEngine

```typescript
interface ResolvedConstraint {
  field: string;
  value: string;
  source: ConstraintSource;   // 勝出的 source
  confidence: number;
  mode: "hard" | "soft";
}

interface ConstraintConflict {
  field: string;
  constraints: Constraint[];  // 相同 source + 相同 confidence 但 value 衝突的原始 constraints
}

interface ConstraintResolution {
  resolved: ResolvedConstraint[];
  conflicts: ConstraintConflict[];
}

interface ConstraintEngine {
  resolve(constraints: Constraint[]): ConstraintResolution;
  evaluateCandidate(
    resolution: ConstraintResolution,
    candidateFields: Record<string, string>
  ): CandidateDecision;
}
```

- `resolve`：同一 `field` 有來自多 source 的 constraint 時，依固定優先權選擇勝出者（`user_text` 最高、`model_inference` 最低）；同 source 同 field 取 confidence 較高者；優先權相等且語意衝突時**保留兩者並標記衝突**（輸出至 `resolution.conflicts`，不得靜默選一）。
- `evaluateCandidate`：hard constraint 違反 → `eligible=false`；soft 違反 → `adjustedScore` 調整。**hard constraint 存在未解決衝突**（`resolution.conflicts` 含該 field）→ fail-closed，`eligible=false` 且 `reasonCode="HARD_CONSTRAINT_CONFLICT"`，交由 ClarificationFlow 澄清，不得選一。

### BusinessPolicyGate

```typescript
interface BusinessPolicyGate {
  apply(
    decision: CandidateDecision,
    context?: { conflicts?: ConstraintConflict[] }
  ): CandidateDecision;
}
```

- Hard constraint 違反（`reasonCode` 為 hard-violation）→ 強制 `eligible=false`，`adjustedScore` 不適用。
- **未解決 hard 衝突**（`context.conflicts` 含該 field）→ 強制 `eligible=false`（fail-closed），`reasonCode` 標記 `HARD_CONSTRAINT_CONFLICT`。
- soft 違反 → 保留 `eligible`，僅調整 `adjustedScore`。
- Gate 是純函數、無副作用、無 IO；hard 排除語意集中在此，Adapter 不得自行「降分代替排除」。

### RecommendationDomainAdapter 與 CandidateRetriever

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

interface CandidateRetriever<TProduct = unknown> {
  retrieve(policy: RetrievalPolicy): Promise<TProduct[]>;
}

interface RetrievalPolicy {
  domain: string;
  candidateLimit: number;
  filters?: Record<string, string>;   // 由 intent 推導的結構化過濾
}
```

- Adapter 是唯一業務注入邊界；框架 import 零業務常數、零 domain schema。
- **`toCandidateFields`（MAJOR-002 決策）**：Adapter 只負責將 `candidate` 對映為 `candidateFields: Record<string,string>`（純業務對映）；**評估由框架的 `RecommendationEngine` 擁有**（`ConstraintEngine.evaluateCandidate` + `BusinessPolicyGate.apply`），hard/soft 語意集中在框架、Adapter 無法繞過。原計劃 `validateCandidate` 更名為 `toCandidateFields`，以消除「Adapter 自行判定 vs 框架判定」的歧義。
- recall 由注入的 `CandidateRetriever` 提供（對應計劃「recall 由 Adapter 注入」；計劃原文 Adapter 介面無 retrieve 方法，故以獨立 `CandidateRetriever` 承接）。

### DomainRouter

```typescript
type DomainRoutingStrategy = (
  input: RecommendationInput,
  domains: string[]
) => Promise<string>;

interface DomainRouter {
  route(input: RecommendationInput): Promise<string>;
  registerAdapter(adapter: RecommendationDomainAdapter): void;
}
```

- `registerAdapter` 以 `adapter.domain` 為 key；`route` 只回傳已註冊 domain 之一。
- 單一註冊 Adapter → 確定性 route 至該 domain。
- 多 Domain → 委派注入的 `DomainRoutingStrategy`；策略由 config／capability 注入，框架不硬編碼 domain 名稱或輸入白名單。
- route 結果未知／未註冊時 fail-closed（回傳錯誤），不得猜測 domain。

### RecommendationCard

```typescript
interface RecommendationCard<TCardPayload = unknown> {
  cardId: string;
  domain: string;
  candidateRef: ResourceRef;   // 引用 product／offer resource（X8.7）
  payload: TCardPayload;        // layout 由 Adapter 實作
  createdAt: string;
}
```

- `candidateRef` 重用 X8.7 `ResourceRef`（`resourceType` 開放字串，已知含 `product`／`offer`／`recommendation_card`）；不引進第二套資源身份。
- `payload` 泛型，rendering layout 由 Adapter 決定；框架只提供 envelope。

### RecommendationEngine（orchestrator）

```typescript
interface RecommendationResult {
  domain: string;
  candidates: CandidateDecision[];   // 評估後（含 eligible/excluded）
  cards: RecommendationCard[];
  clarificationRequested: boolean;
}

interface RecommendationEngine {
  recommend(input: RecommendationInput): Promise<RecommendationResult>;
}
```

資料流：

```text
recommend(input)
  ├─ router.route(input) → domain
  ├─ adapter.extractIntent(input) → intent
  ├─ adapter.buildRetrievalPolicy(intent) → policy
  ├─ retriever.retrieve(policy) → candidates
  ├─ resolution = constraintEngine.resolve(input.signals)
  ├─ for each candidate:
  │     fields = adapter.toCandidateFields(candidate)
  │     decision = constraintEngine.evaluateCandidate(resolution, fields)
  │     decision = businessPolicyGate.apply(decision, { conflicts: resolution.conflicts })
  ├─ low-confidence intent → clarification.request() → clarificationRequested=true
  ├─ eligible candidates → adapter.buildCard → cards
  └─ provenanceWriter 寫入 routing / clarification / candidate-policy DecisionRecord + EvidenceRef
```

## 澄清流程（ClarificationFlow）

```typescript
interface ClarificationFlow {
  shouldClarify(confidence: number, resolved: ResolvedConstraint[]): boolean;
  request(
    input: RecommendationInput,
    reason: string
  ): Promise<ClarificationRequest>;
}

interface ClarificationRequest {
  clarificationId: string;
  taskId?: string;
  reasonCode: string;
  question: string;          // 由 Adapter 提供問句內容
  requestedAt: string;
}
```

- `shouldClarify` 依可配置信心門檻與 hard-constraint 缺失判定；判定為配置驅動，非硬編碼句型。
- 澄清請求進入既有 `waiting_confirmation`（HITL）流程（X1 Task State Machine + X8.8 Interaction Runtime）；X9 不建立平行排程或 HITL 狀態儲存。
- 收到 clarification_answer 後，由呼叫端以更新後的 input 重新呼叫 `recommend`；X9 只定義「何時澄清、問什麼」，不擁有 HITL 生命週期。

## 資料模型

X9 不新增任何 PostgreSQL 表、不新增 migration。所有重大決策的持久化走 X8.9 既有 stores：

- `DecisionRecordStore.record()` → `decision_records`
- `EvidenceStore.record()` → `decision_evidence_refs`

candidate／product 以 X8.7 `ResourceRef`（`resourceType: "product"` 或 `"recommendation_card"`）投影，保留 tenant/scope ownership。X9 不建 `recommendation_decisions` 或任何 business-local DecisionRecord schema。

## Provenance 整合（ProvenanceWriter）

```typescript
interface ProvenanceWriter {
  writeRouting(input: RecommendationInput, domain: string): Promise<void>;
  writeClarification(input: RecommendationInput, clarification: ClarificationRequest): Promise<void>;
  writeCandidateDecision(
    input: RecommendationInput,
    decision: CandidateDecision,
    candidateRef: ResourceRef
  ): Promise<void>;
}
```

- 每個 write 呼叫 X8.9 `createDecisionRecord`（`decisionType`／`outcome`／`reasonCode`／`confidence`／`policyVersion`）＋ `DecisionRecordStore.record()`。
- 以 `EvidenceStore` 寫入 `EvidenceRef`：input（`role: "input"`）、candidate/product（`role: "supporting"` 或 `"contradicting"`，依 `eligible`）、policy（`role: "policy"`）。
- `decisionType` 建議值：`domain_routing`、`clarification`、`candidate_decision`（open string，Core 不閉合）。`reasonCode` 例如 `HARD_CONSTRAINT_CONFLICT`、`SOFT_CONSTRAINT_ADJUSTED`、`LOW_CONFIDENCE_CLARIFICATION`。
- 只存 reference／version／hash，不複製 raw payload；遵守 X8.9 redaction 契約（不寫 raw prompt／CoT／credential／unmasked PII）。

## 授權整合

- `RecommendationInput.principal`／`scope` 由呼叫者注入（承接 X8.7 trusted identity）。
- provenance 證據引用與 candidate `ResourceRef` 的 tenant 邊界由 X8.9 stores 既有授權邏輯承接；X9 不自行解析身份、不重複授權。
- 澄清與 HITL 相關的敏感後續動作依 X8.7 authorization 執行（承繼 X8.8 既有契約）。

## 觀測性（Telemetry）

- `decisionId`／correlation id（`threadId`／`taskId`／`stepId`／`runId`）作 trace attribute，MUST NOT 作 metric label（高基數）。
- 聚合 metric（如 candidate 評估總數、排除率）可帶 `decisionType`／`reasonCode` 為 label，不帶 resource/principal ID。
- X9 不重複 X8.9 provenance 語意；重大決策只走 X8.9 寫入路徑。

## 替代方案

| 方案 | 評估 |
|------|------|
| 在各 Domain 各自實作 constraint/gate | ❌ 重複且不一致；hard 排除語意無法統一保證 |
| 框架內建向量檢索 | ❌ 超出 X9 非目標；recall 由 `CandidateRetriever` 注入 |
| 為 Recommendation 建獨立 provenance 表 | ❌ 違反「X9 消費 X8.9 不重定義」；採 X8.9 stores |
| routing 硬編碼 domain 關鍵字／白名單 | ❌ 違反 §9；採注入式 `DomainRoutingStrategy` |
| `ConstraintSource` 只用 3 值 | ❌ 與 5 階優先權衝突；採 5 階封閉 Domain Constant |
| 澄清自建排程／HITL 儲存 | ❌ 複用 X1／X8.8；X9 只定義觸發與問句 |

## Review 澄清決議（MAJOR-001 / MAJOR-002）

### MAJOR-001：衝突解析的型別表達（已決議）

`resolve` 回傳 `ConstraintResolution { resolved, conflicts }`；同 source + 同 confidence + value 衝突時，保留兩者於 `conflicts`，不得靜默選一。`evaluateCandidate` 遇 hard 衝突 → `eligible=false`（`reasonCode="HARD_CONSTRAINT_CONFLICT"`）並交由 ClarificationFlow 澄清。`BusinessPolicyGate.apply` 增加 `context.conflicts` 輸入，強制 fail-closed。

### MAJOR-002：評估組合方式（已決議）

採 orchestrator 擁有的評估：`RecommendationEngine` 直接呼叫 `ConstraintEngine.evaluateCandidate` + `BusinessPolicyGate.apply`；Adapter 的 `validateCandidate` 更名為 `toCandidateFields`（純 candidate → candidateFields 對映）。框架 hard/soft 語意不可被 Adapter 繞過。

### 附帶 Minor（實作中處理，非阻擋）

- MINOR-001 adjustedScore 策略：提供預設 soft penalty（每違反一項 soft constraint 調降），可注入覆寫。
- MINOR-002 空候選集：記錄 `DecisionRecord`（`outcome="empty_candidates"`）→ 可選澄清 → 回傳空結果；定義最大澄清次數避免澄清無限迴圈。
- MINOR-003 零業務 import 驗證：Task 5.1 增設 import-boundary 靜態檢查（eslint restricted imports）。
- MINOR-004 ClarificationRequest 對應 X8.8：`ClarificationRequest` 增加 `confirmationType: "clarification"`，對應 X8.8 `WaitingTaskReference.confirmationType`。
- MINOR-005 match 語意：`evaluateCandidate` 預設精確相等；非精確匹配由 Adapter 於 `toCandidateFields` 階段正規化。

## 責任邊界

| 套件 | 責任 |
|------|------|
| backend（X9 recommendation） | DomainRouter、RecommendationDomainAdapter 邊界、ConstraintEngine、BusinessPolicyGate、ClarificationFlow、RecommendationCard、provenance 整合、RecommendationEngine orchestration；不擁有業務決策語意、不建自有表 |
| bff | 本次不變動 |
| frontend | 本次不變動 |

Domain（X10 Mock 及後續 X11–X13）注入 `domain`、intent 擷取、retrieval policy、candidate 欄位對映與 card layout；Core 不硬編碼任何業務 domain、欄位或 relation 語意。
