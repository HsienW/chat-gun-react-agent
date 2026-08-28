# Proposal：add-decision-provenance-context-references

## 變更定位

純 Runtime／平台治理，零業務依賴。在 X3 Audit、X8 OTel、X8.6 ToolExecution、X8.7 AuthorizationDecision 之上，新增一層「薄、business-neutral」的語意證據層（Decision Provenance + Context References），回答四個問題：

1. Agent 做了什麼決策？（`DecisionRecord`）
2. 哪些可觀測證據支持或反駁該決策？（`EvidenceRef`）
3. 套用了哪個 policy／version？（`policyVersion`）
4. 哪些已授權資源直接相關於該決策？（`ContextRef`）

本變更對應 `second-stage-plan-en-v3.md` 的 **X8.9**，是 Production Hardening Gate 的一員（X8.6–X8.9）。X8.8 與 X8.9 為 X8.7 之後的獨立 siblings，可並行實作：X8.8 管「並發使用者互動與 active-run ownership」，X8.9 管「Decision Provenance／Context Reference 原語」。X9 消費 X8.9，但**不擁有也不重定義 provenance storage**。

## 為什麼（Why）

Runtime 已具備互補紀錄，各自回答不同問題：

| 能力 | 回答 |
|---|---|
| X3 Audit | 誰在何時做了什麼、allow/deny 決策？ |
| X8 OTel | 執行期間發生什麼、時間花在哪？ |
| X8.6 ToolExecution | 外部 side effect 是否真的發生？ |
| X8.7 AuthorizationDecision | 此 principal/scope 是否被允許對該 resource 行動？ |
| **X8.9 Decision Provenance** | **為什麼做出此業務／runtime 決策、哪些證據支持它？** |

現況缺口：當一個 recommendation 被選出、一個 candidate 被排除、一個 policy 被套用、一次 routing 或 clarification 發生時，系統只記錄了「結果」，沒有記錄「為何如此」的結構化語意與「哪些證據支撐」。

> 不持久化 model chain-of-thought。只持久化結構化 outcome、reason code、可觀測證據引用、policy version 與資源關係。

## 問題描述

1. **無「為何做此決策」的結構化紀錄** — 決策的 `decisionType`／`outcome`／`reasonCode`／`confidence`／`policyVersion` 未正規化、不可查詢。
2. **無 evidence 關聯** — 哪些可觀測資源支持（supporting）／反駁（contradicting）該決策，未記錄；後續資源變更會摧毀歷史可解釋性。
3. **無 policy/version 追蹤** — 決策依賴 versioned policy 時，未記錄套用版本，無法事後對齊。
4. **無資源間關係的引用原語** — `derived_from`／`produced_by`／`supports`／`contradicts` 等直接關係沒有統一的 `ContextRef`，各 Domain 各自推導。
5. **無授權門檻的引用查詢** — 直接引用查詢若無 tenant/scope 授權門檻，會造成跨 tenant 洩漏。

## 解決方案

### Part A：Decision Record

```typescript
interface DecisionRecord {
  decisionId: string;

  requestId?: string;
  threadId?: string;
  runId?: string;
  taskId?: string;
  stepId?: string;

  decisionType: string;
  outcome: string;
  reasonCode: string;

  confidence?: number;
  policyVersion?: string;

  createdAt: string;
}
```

- `decisionType`／`outcome`／`reasonCode` 結構化且可查詢。
- MUST NOT 存 raw hidden reasoning／chain-of-thought。
- 結果依賴 versioned policy 時記錄 `policyVersion`。

### Part B：Evidence References

重用 X8.7 `ResourceRef`；不引進競爭資源身份模型。

```typescript
interface EvidenceRef {
  evidenceRefId: string;
  decisionId: string;

  resource: ResourceRef;

  role:
    | "input"
    | "supporting"
    | "contradicting"
    | "policy"
    | "memory"
    | "tool_result";

  observedAt: string;
  resourceVersion?: string;
  snapshotHash?: string;
}
```

- 存 reference／version／hash，不複製 unrestricted raw payload。
- `observedAt` 記錄 Runtime 評估該資源的時間。
- `resourceVersion`／`snapshotHash` 在被引用資源後續變更時保護歷史可解釋性。

### Part C：Context References

```typescript
interface ContextRef {
  contextRefId: string;
  source: ResourceRef;
  target: ResourceRef;

  relationType: string;

  createdAt: string;
}
```

- `relationType` open-set；建議初始 relation：`derived_from`／`produced_by`／`supports`／`contradicts`／`mentions`／`selected_from`／`generated_from`。
- MUST NOT 把所有 relation 名集中成 closed union，迫使每個未來 Domain 修改 Core。

### Part D：PostgreSQL Persistence

新增持久化：`decision_records`、`decision_evidence_refs`、`context_refs`。透過引用的 `ResourceRef` 保留既有 Task/Step/Run correlation 與 tenant/scope ownership。

### Part E：Direct Authorized Reference Queries

```typescript
interface ContextReferenceResolver {
  findRelated(
    resource: ResourceRef,
    options?: { relationType?: string; limit?: number }
  ): Promise<ResourceRef[]>;
}
```

- 引用讀取 MUST 通過 X8.7 tenant/scope authorization。
- 預設 direct／1-hop relation；MUST NOT 任意遞迴圖遍歷。
- X7 可在 Context assembly 期間消費已授權相關資源，但 X8.9 不擁有 token budgeting 或 semantic retrieval。

### Part F：Correlation

Decision record 於可用時關聯：`requestId`、`threadId`、`runId`、`taskId`、`stepId`、`toolExecutionId`（經 `ResourceRef`）、Audit events、OTel trace/span identifiers。

## 目標

- ✅ 建立 `DecisionRecord`（decisionType／outcome／reasonCode／confidence／policyVersion）
- ✅ 建立 `EvidenceRef`（重用 X8.7 `ResourceRef`，role + observedAt + version/hash）
- ✅ 建立 `ContextRef`（source/target + open-set relationType）
- ✅ 三表持久化 + additive migration，保留 Task/Step/Run correlation 與 tenant/scope ownership
- ✅ `ContextReferenceResolver.findRelated` 直接/1-hop 授權查詢，無遞迴遍歷
- ✅ 跨 tenant／未授權引用讀取在回傳前被 X8.7 deny
- ✅ Audit + OTel 可 correlate，不重複其儲存語意
- ✅ raw prompt／CoT／credential／unmasked PII／unrestricted tool output 一律不持久化

## 非目標

- ❌ Knowledge Graph platform 或 Graph Database
- ❌ RDF／OWL／SHACL／ontology 層
- ❌ causal-reasoning engine
- ❌ vector retrieval 或 semantic relation inference
- ❌ 任意 multi-hop graph traversal
- ❌ raw prompt／raw chain-of-thought 持久化
- ❌ 重複 X3 Audit storage
- ❌ 重複 X8.6 ToolExecution ledger
- ❌ Recommendation-specific schema 或 business constant

## Capabilities

### New Capabilities

- `decision-provenance-context-references`：Decision Provenance／Context Reference 的語意證據層（DecisionRecord、EvidenceRef、ContextRef、授權引用查詢與持久化）。

## 受影響範圍

| 套件 | 影響 |
|------|------|
| backend | 新增 `src/runtime/provenance/`（decision-record、evidence-ref、context-ref、decision-store、evidence-store、context-ref-store、context-reference-resolver） |
| backend | 新增 migrations：`014_create_decision_records.sql`、`015_create_decision_evidence_refs.sql`、`016_create_context_refs.sql` |
| backend | 唯讀引用 X8.7 `authorization/`（ResourceRef、authorization engine、ContextRedactor）與 X3 `audit/`；不修改其契約 |

> bff 與 frontend 本次不變動。

## 與既有系統的關係

| 既有系統 | 關係 |
|---------|------|
| X3 Audit | 互補：Audit 回答「誰何時做了什麼」，X8.9 回答「為何如此決定」；X8.9 不重複 Audit 儲存 |
| X8 OTel | correlation：trace/span ID 作 attribute，不重複 OTel 語意 |
| X8.6 ToolExecution | 引用 `tool_execution` 作為 evidence resource（經 `ResourceRef`），不重複 ledger |
| X8.7 Authorization | 重用 `ResourceRef` + `authorize()` 作為引用讀取授權門檻；不引進競爭資源身份或授權模型 |
| X7 Context Budget | 可消費已授權相關資源，但 X8.9 不擁有 token budgeting／semantic retrieval |
| X9 Recommendation | 消費 X8.9 記錄 routing/clarification/candidate-policy outcome；X9 不重定義 provenance schema |

## 風險

| 風險 | 緩解 |
|------|------|
| 引用讀取洩漏跨 tenant 資料 | `findRelated` 每次先經 X8.7 `authorize()`，deny 不回傳 |
| 持久化 raw CoT／prompt | DecisionRecord 只存結構化欄位；evidence 只存 ref/version/hash；寫入前 redaction |
| 歷史可解釋性被後續資源變更摧毀 | `observedAt` + `resourceVersion`/`snapshotHash` |
| relationType 閉合阻礙 Domain 擴充 | open-set string；Core 不維護 closed union |
| 引用查詢退化成任意圖遍歷 | resolver 預設 1-hop + `limit`，無 recursive traversal API |
| 重複 X3/X8.6 儲存語意 | X8.9 只存 ref/correlation，不複製 audit 或 tool_execution 內容 |

## 回滾策略

- 新增 `backend/src/runtime/provenance/` 為全新模組，刪除即可回滾。
- 新增 migrations 採 additive（`CREATE TABLE IF NOT EXISTS`），不刪改 001–013。
- 無既有資料遷移、無破壞性 schema 變更；無 bff／frontend 變更。
