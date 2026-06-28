# Tasks：Agent Artifact Shared State 與結構化交接契約

## Task 批次劃分

本 Change 依下列批次依序執行，每個批次形成一個可階段性人工 Commit 的單位。

---

## Batch 1：契約與狀態機文件

### Task 1.1：建立 Agent Result Envelope Spec

- **修改範圍**：建立 `specs/agent-result-contract/spec.md`
- **內容**：定義共同 Envelope 欄位、discriminated union、schemaVersion 演進規則、各 kind 的 payload 說明
- **Requirement 對應**：AgentResultContract
- **驗證方式**：每個 Requirement 至少一個 Scenario、符合 OpenSpec Spec 格式、通過 `openspec validate --strict`
- **完成條件**：spec.md 包含所有必要 Requirement 與 Scenario

### Task 1.2：建立 Structured Handoff Contract Spec

- **修改範圍**：建立 `specs/handoff-contract/spec.md`
- **內容**：定義 Handoff Envelope、requiredInputRefs、expectedOutputKind、acceptanceCriteriaRefs、onSuccess/onFailure/onConflict 路由、生命週期
- **Requirement 對應**：StructuredHandoffContract
- **驗證方式**：每個 Requirement 至少一個 Scenario、涵蓋正常交接、缺少必要 Artifact、逾時未承接
- **完成條件**：spec.md 包含所有必要 Requirement 與 Scenario

### Task 1.3：建立 Current State Contract Spec

- **修改範圍**：建立 `specs/current-state-contract/spec.md`
- **內容**：定義 current-state.json 的所有欄位、合法值、Terminal/NON_TERMINAL 狀態、latestArtifactRefs 結構、gateStatus 結構
- **Requirement 對應**：CurrentStateContract
- **驗證方式**：每個 Requirement 至少一個 Scenario、涵蓋初始化、更新、衝突處理
- **完成條件**：spec.md 包含所有必要 Requirement 與 Scenario

### Task 1.4：建立 Workflow State Transition Spec

- **修改範圍**：建立 `specs/workflow-state-transition/spec.md`
- **內容**：完整狀態機定義、合法轉移表、禁止轉移表、Gate 條件、各 Phase 的 owner 責任
- **Requirement 對應**：WorkflowStateTransition
- **驗證方式**：每個 Requirement 至少一個 Scenario、涵蓋合法轉移、非法轉移拒絕、Gate 檢查
- **完成條件**：spec.md 包含所有必要 Requirement 與 Scenario

### Task 1.5：建立 Runtime Artifact Boundary Spec

- **修改範圍**：建立 `specs/runtime-artifact-boundary/spec.md`
- **內容**：目錄結構、生命週期、讀取例外規則、Path Traversal 防護、Secret 禁止
- **Requirement 對應**：RuntimeArtifactBoundary
- **驗證方式**：每個 Requirement 至少一個 Scenario、涵蓋正常讀取、越界拒絕、Path Traversal 拒絕、Secret 拒絕
- **完成條件**：spec.md 包含所有必要 Requirement 與 Scenario

### Task 1.6：建立 Qwen Read-only Result Capture Spec

- **修改範圍**：建立 `specs/qwen-readonly-result-capture/spec.md`
- **內容**：Qwen 唯讀邊界保留、輸出格式、三種人工輔助保存方法、INCOMPLETE 條件
- **Requirement 對應**：QwenReadOnlyResultCapture
- **驗證方式**：每個 Requirement 至少一個 Scenario、涵蓋正常輸出、輸出格式不合法、唯讀邊界被嘗試繞過
- **完成條件**：spec.md 包含所有必要 Requirement 與 Scenario

### Task 1.7：建立 HITL Git Gate Spec

- **修改範圍**：建立 `specs/hitl-git-gate/spec.md`
- **內容**：Commit 邊界、commit message 建議格式、不可繞過 Gate 的條件
- **Requirement 對應**：HITLGitGate
- **驗證方式**：每個 Requirement 至少一個 Scenario、涵蓋正常 commit、Blocker 存在時拒絕 commit 建議
- **完成條件**：spec.md 包含所有必要 Requirement 與 Scenario

### Task 1.8：建立 Execution Summary Promotion Spec

- **修改範圍**：建立 `specs/execution-summary-promotion/spec.md`
- **內容**：提升規則、內容範圍、產生時機、不得包含的內容
- **Requirement 對應**：ExecutionSummaryPromotion
- **驗證方式**：每個 Requirement 至少一個 Scenario、涵蓋正常產生、資訊過濾、缺漏欄位
- **完成條件**：spec.md 包含所有必要 Requirement 與 Scenario

---

## Batch 2：JSON Schemas

### Task 2.1：建立 agent-result.schema.json

- **修改範圍**：建立 `specs/agent-result-contract/agent-result.schema.json`
- **內容**：JSON Schema draft-2020-12、共同 Envelope、discriminated union（kind）、required 欄位、additionalProperties: false
- **Requirement 對應**：AgentResultContract
- **驗證方式**：通過 JSON Schema meta-validation、Example Fixtures 可正確 validate
- **完成條件**：Schema 可被標準 JSON Schema validator 接受

### Task 2.2：建立 handoff.schema.json

- **修改範圍**：建立 `specs/handoff-contract/handoff.schema.json`
- **內容**：JSON Schema draft-2020-12、Handoff Envelope、inputRefs/outputRefs 結構、onSuccess/onFailure/onConflict
- **Requirement 對應**：StructuredHandoffContract
- **驗證方式**：通過 JSON Schema meta-validation、Example Fixtures 可正確 validate
- **完成條件**：Schema 可被標準 JSON Schema validator 接受

### Task 2.3：建立 current-state.schema.json

- **修改範圍**：建立 `specs/current-state-contract/current-state.schema.json`
- **內容**：JSON Schema draft-2020-12、CurrentState 所有欄位、Phase enum、TerminalStatus enum、GateStatus 結構
- **Requirement 對應**：CurrentStateContract
- **驗證方式**：通過 JSON Schema meta-validation、Example Fixtures 可正確 validate
- **完成條件**：Schema 可被標準 JSON Schema validator 接受

---

## Batch 3：Example Fixtures

### Task 3.1：建立 Agent Result Envelope Examples

- **修改範圍**：建立 `specs/agent-result-contract/examples/`
- **內容**：至少 coordinator_result + review_result 的 happy path 與 error case
- **Requirement 對應**：AgentResultContract
- **驗證方式**：每個 Example 通過對應 Schema validation
- **完成條件**：至少 4 個 Example（2 happy path + 2 error/edge case）

### Task 3.2：建立 Handoff Contract Examples

- **修改範圍**：建立 `specs/handoff-contract/examples/`
- **內容**：至少 plan-change→review-plan 與 review-result→fix-from-review 兩種場景
- **Requirement 對應**：StructuredHandoffContract
- **驗證方式**：每個 Example 通過對應 Schema validation
- **完成條件**：至少 4 個 Example

### Task 3.3：建立 Current State Contract Examples

- **修改範圍**：建立 `specs/current-state-contract/examples/`
- **內容**：至少 PLAN_DRAFT、REVIEWING、READY_FOR_ARCHIVE、FAILED 四種狀態
- **Requirement 對應**：CurrentStateContract
- **驗證方式**：每個 Example 通過對應 Schema validation
- **完成條件**：至少 4 個 Example

---

## Batch 4：Runtime Boundary 與 .gitignore

### Task 4.1：更新 .gitignore

- **修改範圍**：`.gitignore`
- **內容**：新增 `.agent-runtime/` 忽略規則
- **Requirement 對應**：RuntimeArtifactBoundary
- **驗證方式**：`git status` 確認 `.agent-runtime/` 不會出現在 untracked files
- **完成條件**：`.agent-runtime/` 被 Git 忽略

### Task 4.2：建立 .agent-runtime 目錄結構與 README

- **修改範圍**：建立 `.agent-runtime/README.md`
- **內容**：說明目錄用途、生命週期、讀取規則、不進 Git
- **Requirement 對應**：RuntimeArtifactBoundary
- **驗證方式**：README 內容與 Spec 一致
- **完成條件**：README 可被 Agent 讀取並理解邊界

---

## Batch 5：全域／宿主規則最小調整

### Task 5.1：更新 AGENTS.md（最小增量）

- **修改範圍**：`AGENTS.md`
- **內容**：
  - 新增 Runtime Boundary 感知段落（參考 `.agent-runtime/` 目錄的存在）。
  - 新增 `.gitignore` 讀取例外規則：只有在 Handoff 或 current-state.json 明確引用時可讀取。
  - 不重複或降低任何既有規則。
- **Requirement 對應**：RuntimeArtifactBoundary
- **驗證方式**：與既有 AGENTS.md 規則無衝突
- **完成條件**：新增條款可被 Agent 讀取並遵守

### Task 5.2：更新 CLAUDE.md（最小增量）

- **修改範圍**：`CLAUDE.md`
- **內容**：
  - 新增 Artifact 引用規則：CCR 如何讀取 current-state.json、如何產生 coordinator_result、如何寫入 .agent-runtime。
  - 新增 CurrentState 初始化責任：plan-change 階段由 CCR 建立初始 current-state.json。
  - 不重複或降低任何既有規則。
- **Requirement 對應**：AgentResultContract、CurrentStateContract
- **驗證方式**：與既有 CLAUDE.md 規則無衝突
- **完成條件**：新增條款可被 CCR 讀取並遵守

### Task 5.3：更新 QWEN.md（最小增量）

- **修改範圍**：`QWEN.md`
- **內容**：
  - 新增 review_result 輸出格式：必須同時輸出符合 agent-result.schema.json 的 JSON。
  - 新增 artifact 路徑規則：review_result 的預期保存路徑。
  - 不改變唯讀邊界、Finding 格式或 Verdict 規則。
- **Requirement 對應**：QwenReadOnlyResultCapture
- **驗證方式**：與既有 QWEN.md 規則無衝突
- **完成條件**：新增條款可被 Qwen 讀取並遵守

---

## Batch 6：三端 Router 與 Stage References 改造

### Task 6.1：更新 Codex Router SKILL.md

- **修改範圍**：`.codex/skills/openspec-workflow-router/SKILL.md`
- **內容**：
  - 新增 CurrentState 感知：任務開始時檢查 `.agent-runtime/<change-id>/current-state.json` 是否存在。
  - 新增 ArtifactReferences 讀取規則：依 current-state.json 的 latestArtifactRefs 取得輸入。
- **Requirement 對應**：WorkflowStateTransition
- **驗證方式**：與既有 Codex SKILL.md 無衝突、新增內容與 Spec 一致
- **完成條件**：Codex Router 可感知 CurrentState

### Task 6.2：更新 Claude Router SKILL.md

- **修改範圍**：`.claude/skills/openspec-workflow-router/SKILL.md`
- **內容**：同 Task 6.1，增加 CCR 專屬的 current-state.json 初始化責任
- **Requirement 對應**：WorkflowStateTransition
- **驗證方式**：與既有 Claude SKILL.md 無衝突
- **完成條件**：CCR Router 可感知並初始化 CurrentState

### Task 6.3：更新 Qwen Router SKILL.md

- **修改範圍**：`.qwen/skills/openspec-workflow-router/SKILL.md`
- **內容**：同 Task 6.1，但保持唯讀邊界（不寫入 current-state.json）
- **Requirement 對應**：WorkflowStateTransition、QwenReadOnlyResultCapture
- **驗證方式**：與既有 Qwen SKILL.md 無衝突
- **完成條件**：Qwen Router 可感知 CurrentState 但不寫入

### Task 6.4：補齊 Claude Router References（01-07）

- **修改範圍**：`.claude/skills/openspec-workflow-router/references/01-plan-change.md` ~ `07-archive-change.md`
- **內容**：以 Codex references 為基礎，增加 CCR 專屬協調行為、Artifact 讀寫責任
- **Requirement 對應**：AgentResultContract、CurrentStateContract、WorkflowStateTransition
- **驗證方式**：每個 reference 包含 Input/Output/State Transition 說明、路徑存在
- **完成條件**：7 個 reference 檔案全部建立

### Task 6.5：更新 Codex Router References（01-07）

- **修改範圍**：`.codex/skills/openspec-workflow-router/references/01-plan-change.md` ~ `07-archive-change.md`
- **內容**：每個 reference 增加：
  - 「Input: 從 current-state.json 的哪個欄位取得」
  - 「Output: 產生哪個 artifact，寫入哪個路徑」
  - 「State Transition: 完成後 currentPhase 變為什麼」
- **Requirement 對應**：WorkflowStateTransition、AgentResultContract
- **驗證方式**：每個 reference 的 Input/Output 路徑與 Schema 一致
- **完成條件**：7 個 reference 檔案全部更新

---

## Batch 7：Review Evidence / Artifact Reference 流程

### Task 7.1：定義 Evidence 收集流程

- **修改範圍**：`specs/runtime-artifact-boundary/spec.md`（補充）、`.codex/skills/openspec-workflow-router/references/03-apply-change.md`（補充）
- **內容**：Codex 實作完成後必須收集的 Evidence：
  - `changed-files.txt`（`git status --short`）
  - `diff-stat.txt`（`git diff --stat`）
  - `diff-check.txt`（`git diff --check`）
  - `lint-output.txt`（lint 實際輸出）
  - `test-output.txt`（test 實際輸出）
  - `build-output.txt`（build 實際輸出）
- **Requirement 對應**：RuntimeArtifactBoundary
- **驗證方式**：Evidence 檔案可被 Qwen Router 引用
- **完成條件**：Evidence 收集步驟寫入 Router Reference

### Task 7.2：定義 ArtifactReference 驗證流程

- **修改範圍**：`specs/runtime-artifact-boundary/spec.md`（補充）
- **內容**：Agent 讀取 Artifact 前的驗證步驟：
  1. 檢查 changeId 匹配。
  2. 檢查 relativePath 不含 `..` 或 absolute path。
  3. 檢查 relativePath 在允許的 root 前綴內。
  4. 檢查檔案存在。
  5. 檢查檔案不含 Secret/Token/Credential（基本 regex 檢查）。
- **Requirement 對應**：RuntimeArtifactBoundary
- **驗證方式**：每個步驟有對應 Scenario
- **完成條件**：驗證流程寫入 Spec

---

## Batch 8：Execution Summary 規則

### Task 8.1：定義 execution-summary.md 模板

- **修改範圍**：`specs/execution-summary-promotion/spec.md`（補充）、`.codex/skills/openspec-workflow-router/references/07-archive-change.md`（補充）
- **內容**：execution-summary.md 的固定結構模板，包含：
  - 實際完成內容與 Design 差異
  - 主要修改檔案
  - 驗證結果
  - 接受的風險
  - 未完成項
  - 重要決策
  - Commit 建議
- **Requirement 對應**：ExecutionSummaryPromotion
- **驗證方式**：模板與 Spec 定義的內容範圍一致
- **完成條件**：模板寫入 Router Reference

---

## Batch 9：Dry Run / Dogfooding 驗證與文件一致性

### Task 9.1：以 Weather Change 執行 Dry Run

- **修改範圍**：`.agent-runtime/generalize-weather-location-resolution/`（測試用，不進 Git）
- **內容**：
  1. 建立測試用 `current-state.json`（假設 proposal/design/tasks 已完成，狀態為 PLAN_APPROVED）。
  2. 建立測試用 `coordinator-result.json`。
  3. 建立測試用 `review-result.json`（模擬 Qwen 輸出）。
  4. 驗證：下一位 Agent 可只靠 Change ID + `current-state.json` 判斷階段與必要輸入。
- **Requirement 對應**：全部（整合驗證）
- **驗證方式**：人工模擬 Codex 讀取 current-state.json → 找出必要輸入 → 確認可獨立工作
- **完成條件**：Dry Run 成功，證明 Artifact-based 交接可行

### Task 9.2：Schema 與 Example 一致性核對

- **修改範圍**：無（驗證現有檔案）
- **內容**：
  - 每個 JSON Schema 的 required 欄位在 Example 中都有。
  - 每個 Example 的欄位都在對應 Schema 中定義。
  - enum 值在 Example 中使用合法值。
  - discriminated union 的 kind 對應正確的 payload shape。
- **Requirement 對應**：AgentResultContract、StructuredHandoffContract、CurrentStateContract
- **驗證方式**：人工核對 + 若有 ajv 可用則執行 validation
- **完成條件**：所有 Example 與 Schema 一致

### Task 9.3：Router 引用路徑存在性核對

- **修改範圍**：無（驗證現有檔案）
- **內容**：檢查所有 Router Reference 中引用的檔案路徑是否存在
- **Requirement 對應**：WorkflowStateTransition
- **驗證方式**：人工核對每個 reference 的 Input/Output 路徑
- **完成條件**：所有引用路徑存在或明確標示為「將由 Agent 產生」

### Task 9.4：三端角色與權限無互相覆蓋核對

- **修改範圍**：無（驗證現有檔案）
- **內容**：
  - CCR 規則不得允許 Qwen 的行為（修改原始碼、執行 Bash）。
  - Qwen 規則不得允許 Codex 的行為（修改 OpenSpec、執行 git commit）。
  - Codex 規則不得允許 CCR 的仲裁行為（自行改變 Requirement）。
- **Requirement 對應**：全部
- **驗證方式**：人工核對三端 AGENTS.md / SKILL.md / QWEN.md 的權限邊界
- **完成條件**：無互相覆蓋

### Task 9.5：命名與狀態轉移一致性核對

- **修改範圍**：無（驗證現有檔案）
- **內容**：
  - Phase 名稱在 Spec、Schema、Design、Router Reference 中一致。
  - 狀態轉移在 Design 與 Spec 中一致。
  - artifact kind 在 Schema 與 Spec 中一致。
- **Requirement 對應**：全部
- **驗證方式**：人工核對所有檔案中的 enum/phase/kind 值
- **完成條件**：所有命名一致

### Task 9.6：執行 openspec validate

- **修改範圍**：無
- **內容**：執行 `openspec validate add-agent-artifact-shared-state-handoff --strict`
- **Requirement 對應**：全部
- **驗證方式**：命令實際執行並通過
- **完成條件**：`openspec validate` 通過

### Task 9.7：確認 .agent-runtime 不進 Git

- **修改範圍**：無
- **內容**：執行 `git status` 確認 `.agent-runtime/` 不在 untracked files 中
- **Requirement 對應**：RuntimeArtifactBoundary
- **驗證方式**：`git status` 實際執行
- **完成條件**：`.agent-runtime/` 被 Git 忽略

---

## Batch 10：最終檢查與 review-plan 交接準備

### Task 10.1：最終一致性檢查

- **修改範圍**：無（驗證現有檔案）
- **內容**：核對 proposal/design/tasks/specs 之間的 Requirement 對應、Scenario 覆蓋、Non-goals 一致性
- **Requirement 對應**：全部
- **驗證方式**：人工核對
- **完成條件**：無矛盾、無遺漏

### Task 10.2：準備 review-plan 交接摘要

- **修改範圍**：無（產生交接內容）
- **內容**：準備給 Qwen 執行 review-plan 的最小交接摘要，包含 Change Name、Base Branch、Changed Files、未驗證區域
- **Requirement 對應**：全部
- **驗證方式**：交接摘要包含 QWEN.md §3 要求的所有欄位
- **完成條件**：Qwen 可依交接摘要獨立開始審查

---

## 驗證計畫摘要

| 驗證項目 | 方法 | 自動/人工 |
| --- | --- | --- |
| OpenSpec validate | `openspec validate add-agent-artifact-shared-state-handoff --strict` | 自動 |
| JSON Schema meta-validation | JSON Schema validator (ajv 或等價) | 自動 |
| Example vs Schema 一致性 | ajv validate 每個 Example | 自動 |
| .agent-runtime 不進 Git | `git status` | 自動 |
| Router 引用路徑存在 | 檔案系統 check | 人工 |
| 三端權限無覆蓋 | 人工核對 | 人工 |
| 命名一致性 | 人工核對 | 人工 |
| Dry Run | 人工模擬 | 人工 |
| Business logic 無修改 | `git diff --stat` 限於規則/Skill/OpenSpec | 自動 |
