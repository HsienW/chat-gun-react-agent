# Proposal：Agent Artifact Shared State 與結構化交接契約

## Intent

目前 CCR、Codex、Qwen 已具備角色分工與七階段 OpenSpec Workflow，`CLAUDE.md` 與 `QWEN.md` 也已定義單一寫入者、交接摘要格式與唯讀審查邊界。

但階段之間的資訊傳遞目前仍依賴人工貼上：

- Change 摘要
- 修改檔案清單
- Git Diff 摘要
- 驗證命令與輸出
- Qwen Findings
- Readiness 證據

這造成幾個具體問題：

1. **交接不完整**：人工轉述容易遺漏必要 input（例如 Base Ref、Diff stat、未驗證項目），導致下一位 Agent 無法獨立作業。
2. **無結構化狀態**：目前無法從單一檔案知道「這個 Change 現在在哪個階段、誰持有寫入權、是否有 Blocker」。
3. **Artifact 無統一參照**：不同 Agent 產生的結果（coordinator_result、implementation_result、review_result）沒有共同 Envelope，難以工具化驗證與引用。
4. **Router 無可靠輸入**：Workflow Router 目前依賴使用者口語判斷階段，沒有結構化的 CurrentState 與 ArtifactReferences 作為路由依據。
5. **Qwen 輸出未結構化保存**：Qwen 的 review_result 目前只在聊天中出現，無法被下一個階段的 Agent 以檔案引用方式讀取。

本 Change 建立「契約層＋最小 Runtime State 地基」，讓未來 Agent 可透過檔案引用完成交接，不必貼入完整聊天或長摘要。

---

## Goals

1. 定義 Agent Result Envelope（`agent-result.schema.json`），使 coordinator_result、implementation_result、review_result、readiness_result、archive_result 有共同欄位與 discriminated union。
2. 定義 Structured Handoff Contract（`handoff.schema.json`），使每次交接有明確 inputRefs、expectedOutputKind、acceptanceCriteriaRefs、onSuccess/onFailure/onConflict 路由。
3. 定義 Current State Contract（`current-state.schema.json`），提供單一 Shared State 檔案作為 Change 的當前事實來源。
4. 定義第一版 Workflow State Machine，明確定義合法與非法狀態轉移，並禁止 Agent 跳過必要 Gate。
5. 規劃最小 Runtime Boundary（`.agent-runtime/<change-id>/`），只保存最新狀態、最新 Artifact 與必要 Review Evidence。
6. 設計 `.gitignore` 嚴格讀取例外：只有在 Handoff 或 current-state.json 明確引用時，Agent 才可讀取對應 Runtime Artifact。
7. 保留 Qwen 唯讀邊界，定義 Qwen 輸出如何被 CLIHost/stdout capture/輸出重導向保存為 structured artifact。
8. 規劃 Workflow Router 改造，使各階段從 CurrentState 與 ArtifactReferences 取得輸入，而非依賴人工摘要。
9. 定義 Execution Summary Promotion 規則，只將長期有價值資訊提升為 `execution-summary.md`。
10. 保留現有 OpenSpec 四件套作為 Durable Knowledge、單一寫入者、Qwen 唯讀、HITL commit 邊界。

---

## Non-goals

本 Change 不得包含：

- Node.js Orchestrator 自動啟動 CCR／Codex／Qwen。
- 自動 Retry、自動 Git commit／push。
- Database、Queue、MCP Agent communication server。
- 完整 Trace／Observability 平台（OpenTelemetry、LLM trace、token trace）。
- frontend／bff／backend 業務邏輯修改。
- 新增 npm dependency。
- Agent Framework 導入（CrewAI、AutoGen、新 LangGraph Workflow）。
- 多工作樹平行寫入。
- Runtime Artifact 長期保存政策、retention policy、日誌輪替。
- events.ndjson、完整歷史版本、SQLite／PostgreSQL／Redis。
- 自動清理機制。

以上屬於第二階段或獨立 Change。

---

## Scope

### 新增檔案

```text
openspec/changes/add-agent-artifact-shared-state-handoff/
  proposal.md
  design.md
  tasks.md
  specs/
    agent-result-contract/spec.md
    handoff-contract/spec.md
    current-state-contract/spec.md
    workflow-state-transition/spec.md
    runtime-artifact-boundary/spec.md
    qwen-readonly-result-capture/spec.md
    hitl-git-gate/spec.md
    execution-summary-promotion/spec.md
```

### 新增或修改規則檔案

```text
AGENTS.md（最小調整：新增 Runtime Boundary 與 .gitignore 例外規則）
CLAUDE.md（最小調整：新增 Artifact 引用與 CurrentState 讀取規則）
QWEN.md（最小調整：新增 review_result 輸出格式與 artifact 路徑規則）
.gitignore（新增 .agent-runtime/ 忽略規則）
```

### 修改 Skill 檔案

```text
.claude/skills/openspec-workflow-router/SKILL.md（新增 CurrentState 與 ArtifactReferences 感知）
.codex/skills/openspec-workflow-router/SKILL.md（同上）
.qwen/skills/openspec-workflow-router/SKILL.md（同上）
```

### 新增 Router Reference 檔案

```text
.claude/skills/openspec-workflow-router/references/（補齊 01-07，含 Artifact-based 輸入）
.codex/skills/openspec-workflow-router/references/（更新 01-07）
.qwen/skills/openspec-workflow-router/references/（更新對應階段）
```

### 新增 JSON Schema 檔案（可獨立引用）

```text
openspec/changes/add-agent-artifact-shared-state-handoff/specs/
  agent-result-contract/agent-result.schema.json
  handoff-contract/handoff.schema.json
  current-state-contract/current-state.schema.json
```

### 新增 Example Fixtures

```text
openspec/changes/add-agent-artifact-shared-state-handoff/specs/
  agent-result-contract/examples/
  handoff-contract/examples/
  current-state-contract/examples/
```

### 受影響的既有檔案

```text
AGENTS.md
CLAUDE.md
QWEN.md
.gitignore
.claude/skills/openspec-workflow-router/SKILL.md
.codex/skills/openspec-workflow-router/SKILL.md
.qwen/skills/openspec-workflow-router/SKILL.md
.codex/skills/openspec-workflow-router/references/01-07
```

---

## Affected capabilities

- `agent-runtime`（新增 Artifact-based Shared State）
- `openspec-workflow`（Router 改造、交接結構化）

不影響：
- `frontend-chat`
- `tool-execution`
- `weather`
- `bff`
- `backend`（LangGraph Runtime）

---

## Current behavior summary

目前已有：

- CCR、Codex、Qwen 角色分工（CLAUDE.md、QWEN.md、AGENTS.md）。
- 七階段 OpenSpec Workflow Router（`.codex/skills/openspec-workflow-router/references/01-07`）。
- 單一寫入者規則、交接摘要格式（CLAUDE.md §7）。
- Qwen 唯讀審查邊界與標準輸出格式（QWEN.md §11）。
- OpenSpec 四件套作為 Durable Knowledge（AGENTS.md §2）。
- HITL commit 邊界（AGENTS.md §12、CLAUDE.md §11）。

目前主要缺口：

1. **無 Shared State**：沒有單一檔案記錄 Change 的當前階段、owner、Blocker、ArtifactReferences。
2. **無結構化交接**：階段之間依賴人工文字摘要，無法被工具驗證完整性。
3. **無統一 Result Envelope**：coordinator_result、implementation_result、review_result 沒有共同 Schema。
4. **Qwen 輸出無法被下階段引用**：review_result 只存在聊天中，Codex 修復時無法以檔案參照方式讀取。
5. **Router 無結構化輸入**：Router 依賴使用者口語判斷階段，而非 CurrentState。
6. **無 Runtime Boundary**：沒有約定 Agent 產生的 intermediate artifact 應放在何處、如何引用、生命週期。

---

## Approach

採用三層契約設計：

```text
Layer 1: Contract Definitions（JSON Schema + Spec）
  ├── Agent Result Envelope (agent-result.schema.json)
  ├── Structured Handoff Contract (handoff.schema.json)
  └── Current State Contract (current-state.schema.json)

Layer 2: Runtime Boundary（.agent-runtime/<change-id>/）
  ├── current-state.json
  ├── artifacts/
  │   ├── coordinator-result.json
  │   ├── implementation-result.json
  │   ├── review-result.json
  │   └── readiness-result.json
  └── evidence/
      ├── diff-stat.txt
      ├── diff-check.txt
      ├── lint-output.txt
      └── test-output.txt

Layer 3: Durable Knowledge Promotion
  └── openspec/changes/<change-id>/execution-summary.md
```

核心原則：

1. **Contract First**：先定義 JSON Schema，再定義檔案路徑，最後才修改 Router 行為。
2. **Minimal Runtime State**：第一階段只保存最新一份必要 Artifact，不建立歷史版本或事件流。
3. **Artifact Reference, Not Copy**：Handoff 只傳遞 ArtifactReference（changeId + artifactId + path），不複製完整內容。
4. **Strict Read Boundary**：Agent 只能讀取 current-state.json 或目前 Handoff 中明確引用的 Runtime Artifact。
5. **Qwen 唯讀不變**：Qwen 不直接寫入檔案，由 CLIHost/stdout capture/輸出重導向保存。
6. **HITL Gate 不變**：Git commit/push 仍由人執行，狀態機只標記 ARCHIVED_AWAITING_HUMAN_COMMIT。
7. **向後相容**：現有 OpenSpec 結構不變，Router 改造為增量修改。

---

## Risks

### Schema 設計過度或不足

第一版 Schema 可能無法覆蓋所有實際交接場景。

緩解方式：
- 使用 `schemaVersion` 欄位允許未來演進。
- Discriminated union 的 `kind` 使用 `unknown` fallback。
- 第一階段以實際 Weather Change 做 Dry Run 驗證。

### .agent-runtime 讀取例外被濫用

若 Agent 誤解例外規則，可能掃描整個 `.agent-runtime/`。

緩解方式：
- 在 `AGENTS.md` 與各宿主規則中寫入明確邊界。
- ArtifactReference 必須限制在允許的 RepositoryRoot／RuntimeRoot。
- 明確禁止讀取其他 Change 或 Run 的 Runtime Artifact。

### Qwen 輸出保存依賴外部機制

目前沒有 Node Orchestrator，Qwen 輸出保存需依賴 CLI host 或人工操作。

緩解方式：
- 第一階段定義契約與人工執行方法。
- 在 tasks.md 中明確標示此為「需人工步驟」。
- 不假裝自動化已完成。

### 三端 Router Reference 不同步

Claude、Codex、Qwen 的 Router Reference 可能出現分歧。

緩解方式：
- Codex reference 為主要事實來源（最完整）。
- Claude 與 Qwen reference 只補充宿主專屬行為，不重複核心流程。
- tasks 中包含三端一致性核對步驟。

---

## Rollback strategy

若新契約造成問題：

1. `.agent-runtime/` 目錄可直接刪除（已在 `.gitignore`），不影響既有 OpenSpec。
2. Router Reference 修改為增量，可透過 git revert 單一 commit 回滾。
3. 既有 OpenSpec 四件套結構完全未變，回滾不影響其他 Change。
4. AGENTS.md / CLAUDE.md / QWEN.md 修改為最小增量，可獨立回滾。

---

## Success criteria

1. `agent-result.schema.json`、`handoff.schema.json`、`current-state.schema.json` 通過 JSON Schema draft-2020-12 validation。
2. 每個 Schema 至少有兩個 Example Fixture（happy path + error/edge case）。
3. Example 與 Schema 欄位一致，可被 `ajv` 或等價工具驗證。
4. 每個 Requirement 至少有一個可驗證 Scenario，涵蓋正常、Schema 不合法、缺少必要 Artifact、ArtifactReference 越界、Qwen INCOMPLETE、Blocker 回流、非法狀態轉移。
5. Workflow State Machine 明確禁止：Qwen 通過後自動 commit、測試失敗仍進入 archive、有 Blocker/Major 仍標記 READY、Codex 自行改變 Requirement、Reviewer 自行修改 OpenSpec 或原始碼、Agent 跳過必要前置 Gate。
6. `.agent-runtime/` 在 `.gitignore` 中，不會進入 Git。
7. 三端 Router SKILL.md 與 References 路徑存在且角色不互相覆蓋。
8. 以既有 Weather Change 做 Dry Run，證明下一位 Agent 可只靠 Change ID、CurrentState 與 ArtifactReferences 工作。
9. `openspec validate add-agent-artifact-shared-state-handoff --strict` 通過。
10. 本 Change 不包含任何業務邏輯修改、npm dependency 變更或自動化 Orchestrator。
