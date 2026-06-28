# Design：Agent Artifact Shared State 與結構化交接契約

## 1. 現況分析

### 1.1 目前交接流程

```text
使用者 → CCR (plan-change)
  → 使用者貼 proposal/design/tasks 給 Qwen (review-plan)
  → 使用者貼 Qwen 結果給 CCR 仲裁
  → 使用者貼 approved plan 給 Codex (apply-change)
  → Codex 實作完成，使用者貼 diff + 驗證結果給 Qwen (review-result)
  → 使用者貼 Qwen findings 給 Codex (fix-from-review)
  → 使用者貼修復結果給 Qwen 再審
  → 使用者貼最終結果給 CCR (readiness-check)
  → 使用者貼 readiness 給 Codex (archive-change)
  → 人工 commit
```

每步都是人工轉述。沒有結構化狀態可查。

### 1.2 現有契約盤點

| 契約類型 | 現狀 | 缺失 |
| --- | --- | --- |
| Agent 角色 | CLAUDE.md §6、QWEN.md §2、AGENTS.md | 無 |
| 交接摘要格式 | CLAUDE.md §7 定義文字欄位 | 無結構化 Schema、無檔案路徑 |
| Qwen 輸出格式 | QWEN.md §11 標準 Markdown 模板 | 無 JSON Schema、無 artifact 保存路徑 |
| OpenSpec 四件套 | AGENTS.md §2 定義 | 無 |
| 單一寫入者 | CLAUDE.md §7、AGENTS.md §8 | 無狀態機強制 |
| 階段路由 | docs/openspec/agent-workflow-prompts.md | 無 CurrentState 輸入 |

### 1.3 核心斷層

```text
┌──────────────┐   人工文字    ┌──────────────┐
│  CCR Output  │ ───────────→ │  Qwen Input   │
│  (聊天內容)   │              │  (聊天內容)    │
└──────────────┘              └──────────────┘
       ↑                            ↓
       │ 人工貼上              人工貼上 │
       │                            ↓
┌──────────────┐   人工文字    ┌──────────────┐
│  使用者判斷   │ ←─────────── │  Codex Output │
│  「下一步？」  │              │  (聊天內容)    │
└──────────────┘              └──────────────┘
```

本 Change 目標轉為：

```text
┌──────────────┐               ┌──────────────┐
│  CCR Output  │ ── artifact ─→│  Qwen Input   │
│  → .agent-   │   reference   │  ← current-   │
│    runtime/   │               │    state.json │
└──────────────┘               └──────────────┘
       ↑                            ↓
       │ artifact              artifact │
       │ reference             reference │
       │                            ↓
┌──────────────┐               ┌──────────────┐
│ current-state│ ←── artifact ─│  Codex Output │
│    .json     │    reference  │  → .agent-    │
│  (單一事實)   │               │    runtime/   │
└──────────────┘               └──────────────┘
```

---

## 2. 設計原則

### 2.1 Contract First

所有 Agent 輸出入先定義 JSON Schema，再定義檔案路徑，最後才修改 Router 行為。

### 2.2 Artifact Reference, Not Copy

Handoff 只傳遞 ArtifactReference（changeId + artifactId + relativePath），接收方依 reference 讀取完整 Artifact。避免同一個 Artifact 在多個 Handoff 中被重複複製。

### 2.3 Minimal Runtime State

第一階段只保存：
- 最新一份 `current-state.json`
- 最新一份各階段 `*-result.json`
- 最新一份必要 Evidence 檔案

不建立歷史版本、events.ndjson、token trace 或 LLM trace。

### 2.4 Strict Read Boundary

Agent 只能讀取：
1. 目前 Handoff 中 `requiredInputRefs` 引用的 Artifact
2. `current-state.json` 中 `latestArtifactRefs` 引用的 Artifact
3. `.agent-runtime/<change-id>/current-state.json` 本身

不得掃描整個 `.agent-runtime/`，不得讀取其他 Change 或 Run 的 Runtime Artifact。

### 2.5 Qwen 唯讀不變

Qwen 不直接 Write Runtime Artifact。Qwen 輸出由以下方式之一保存：
- CLIHost stdout capture → 寫入 `.agent-runtime/<change-id>/artifacts/review-result.json`
- 人工從 Qwen 輸出複製 → 寫入上述路徑
- 未來 Node Orchestrator（第二階段）

第一階段只定義契約與人工執行方法。

### 2.6 HITL Git Gate 不變

狀態機的最終 state 是 `ARCHIVED_AWAITING_HUMAN_COMMIT`，不是 `COMPLETED`。Git commit/push 一律由人執行。

### 2.7 向後相容

- 現有 OpenSpec 四件套結構不變。
- 既有 Router Reference 內容保留，只增加 Artifact-based 輸入說明。
- 既有 AGENTS.md / CLAUDE.md / QWEN.md 規則保留，只增加最小必要條款。

---

## 3. Agent Result Envelope 設計

### 3.1 共同 Envelope

所有 Agent 輸出（coordinator_result、implementation_result、review_result、readiness_result、archive_result）都包在共同 Envelope 中：

```jsonc
{
  "schemaVersion": "1.0.0",
  "artifactId": "uuid-or-deterministic-id",
  "changeId": "add-agent-artifact-shared-state-handoff",
  "runId": "run-2026-06-29-001",
  "producer": "CCR",           // CCR | Codex | Qwen
  "stage": "plan-change",      // OpenSpec workflow stage
  "kind": "coordinator_result", // discriminated union key
  "status": "success",         // success | failure | partial
  "createdAt": "2026-06-29T10:00:00Z",
  "summary": "完成 proposal、design、tasks 初稿",
  "inputRefs": [               // 本產出引用了哪些上游 Artifact
    {
      "artifactId": "parent-handoff-id",
      "changeId": "add-agent-artifact-shared-state-handoff",
      "runId": "run-2026-06-29-001",
      "kind": "handoff",
      "relativePath": ".agent-runtime/add-agent-artifact-shared-state-handoff/artifacts/plan-change-handoff.json"
    }
  ],
  "outputRefs": [              // 本產出產生了哪些可供下游引用的 Artifact
    {
      "artifactId": "proposal-id",
      "changeId": "add-agent-artifact-shared-state-handoff",
      "relativePath": "openspec/changes/add-agent-artifact-shared-state-handoff/proposal.md"
    }
  ],
  "verification": {
    "executed": ["openspec validate add-agent-artifact-shared-state-handoff --strict"],
    "passed": ["openspec validate add-agent-artifact-shared-state-handoff --strict"],
    "failed": [],
    "notExecuted": ["lint", "test", "build"]
  },
  "risks": [
    {
      "severity": "Medium",
      "description": "Schema 可能在實際使用中需調整",
      "mitigation": "使用 schemaVersion 欄位"
    }
  ],
  "nextHandoff": {
    "handoffId": "hdo-001",
    "stage": "review-plan",
    "to": "Qwen",
    "reason": "Proposal/design/tasks 完成，需要獨立架構審查"
  }
}
```

### 3.2 Discriminated Union

`kind` 欄位決定 payload 的具體 shape：

| kind | producer | payload 說明 |
| --- | --- | --- |
| `coordinator_result` | CCR | proposal/design/tasks 建立的結果 |
| `implementation_result` | Codex | 實作完成後的 diff、驗證結果 |
| `review_result` | Qwen | Findings、Verdict、殘餘風險 |
| `readiness_result` | CCR | 是否 ready for archive 的判定 |
| `archive_result` | Codex | execution-summary 產生結果 |
| `handoff` | CCR | 交接指令本身（也是一種 Artifact） |

### 3.3 版本演進策略

- `schemaVersion` 使用 semver。
- 讀取方 MUST 檢查 `schemaVersion`。
- 未知 major version MUST 拒絕處理（不能 silent ignore）。
- 未知 minor/patch version SHOULD 盡力解析已知欄位。
- `kind` enum 為封閉集合：Schema Validation 階段 MUST 拒絕不在 enum 中的未知 kind。這是正確的第一道防線。
- 新增 `kind` enum 值視為 Schema 變更，必須伴隨 schemaVersion 遞增（純新增遞增 minor，改變 required 欄位遞增 major）。
- 未來若需要開放式 kind（允許 Agent 傳遞不完全理解的 Artifact），可透過 Schema 新增 `"other"` fallback kind 與 raw payload 欄位，但第一版本不採用此設計。

### 3.4 Schema kind enum 取捨

AgentResultEnvelope 頂層 `kind`（6 個值：coordinator_result、implementation_result、review_result、readiness_result、archive_result、handoff）與 ArtifactReference 的 `kind`（11 個值：上述 6 個加 proposal、design、tasks、spec、evidence）是不同層級的列舉，不應混淆。

三個 JSON Schema（agent-result、handoff、current-state）各自定義了相同的 ArtifactReference `$defs`，包含相同的 `kind` enum。這是刻意的取捨：

- **保持自包含**：每個 Schema 有獨立 `$id`，可單獨引用與驗證，不需外部 `$ref`。
- **避免外部引用複雜度**：JSON Schema draft-2020-12 的跨檔 `$ref` 需要 resolver 設定，增加第一階段實作風險。
- **規範來源**：`agent-result.schema.json` 的 `$defs` 為規範來源（canonical）。若未來需修改 ArtifactReference 結構，以 agent-result.schema.json 為準，同步更新其他兩個 Schema。

若第二階段引入 Node Orchestrator 或 Schema 工具鏈，可考慮抽取為共用 `$defs` 檔案。

---

## 4. Structured Handoff Contract 設計

### 4.1 Handoff Schema

```jsonc
{
  "schemaVersion": "1.0.0",
  "handoffId": "hdo-001",
  "changeId": "add-agent-artifact-shared-state-handoff",
  "runId": "run-2026-06-29-001",
  "from": "CCR",
  "to": "Qwen",
  "stage": "review-plan",
  "reason": "Proposal/design/tasks 已完成，需要獨立架構審查",
  "requiredInputRefs": [
    {
      "artifactId": "coordinator-result-id",
      "changeId": "add-agent-artifact-shared-state-handoff",
      "runId": "run-2026-06-29-001",
      "kind": "coordinator_result",
      "relativePath": ".agent-runtime/add-agent-artifact-shared-state-handoff/artifacts/coordinator-result.json"
    }
  ],
  "expectedOutputKind": "review_result",
  "acceptanceCriteriaRefs": [
    {
      "artifactId": "spec-agent-result-contract",
      "changeId": "add-agent-artifact-shared-state-handoff",
      "relativePath": "openspec/changes/add-agent-artifact-shared-state-handoff/specs/agent-result-contract/spec.md"
    }
  ],
  "onSuccess": {
    "nextStage": "apply-change",
    "nextOwner": "Codex"
  },
  "onFailure": {
    "nextStage": "plan-change",
    "nextOwner": "CCR",
    "reason": "Qwen 找到 Blocker，需要 CCR 重新協調"
  },
  "onConflict": {
    "strategy": "coordinator_arbitration",
    "nextOwner": "CCR",
    "reason": "若 Codex 與 Qwen 判斷衝突，由 CCR 仲裁"
  },
  "requiresHumanApproval": false,
  "createdAt": "2026-06-29T10:00:00Z"
}
```

### 4.2 Handoff 生命週期

```text
PENDING → ACCEPTED → IN_PROGRESS → COMPLETED
                                  → FAILED
                                  → REJECTED (需要人工介入)
        → EXPIRED (逾時未承接)
```

### 4.3 Handoff 與 Artifact 關係

- Handoff 本身也是一個 Artifact（kind: `handoff`）。
- 接收方讀取 Handoff → 依 `requiredInputRefs` 讀取必要 Artifact → 執行工作 → 產生 output Artifact → 更新 CurrentState。
- Handoff 不複製 Artifact 內容，只持有 Reference。

---

## 5. Current State Contract 設計

### 5.1 current-state.json Schema

```jsonc
{
  "schemaVersion": "1.0.0",
  "changeId": "add-agent-artifact-shared-state-handoff",
  "runId": "run-2026-06-29-001",
  "currentPhase": "PLAN_REVIEW",
  "currentOwner": "Qwen",
  "attempt": 1,
  "latestArtifactRefs": {
    "proposal": {
      "artifactId": "proposal-001",
      "changeId": "add-agent-artifact-shared-state-handoff",
      "relativePath": "openspec/changes/add-agent-artifact-shared-state-handoff/proposal.md"
    },
    "design": {
      "artifactId": "design-001",
      "changeId": "add-agent-artifact-shared-state-handoff",
      "relativePath": "openspec/changes/add-agent-artifact-shared-state-handoff/design.md"
    },
    "tasks": {
      "artifactId": "tasks-001",
      "changeId": "add-agent-artifact-shared-state-handoff",
      "relativePath": "openspec/changes/add-agent-artifact-shared-state-handoff/tasks.md"
    },
    "coordinatorResult": {
      "artifactId": "cr-001",
      "changeId": "add-agent-artifact-shared-state-handoff",
      "runId": "run-2026-06-29-001",
      "kind": "coordinator_result",
      "relativePath": ".agent-runtime/add-agent-artifact-shared-state-handoff/artifacts/coordinator-result.json"
    }
  },
  "latestHandoff": {
    "handoffId": "hdo-001",
    "stage": "review-plan",
    "from": "CCR",
    "to": "Qwen",
    "status": "PENDING"
  },
  "gateStatus": {
    "proposalApproved": false,
    "reviewPassed": false,
    "implementationVerified": false,
    "readinessConfirmed": false
  },
  "blockers": [],
  "nextActions": [
    "Qwen 執行 review-plan 唯讀審查",
    "輸出 review_result 並由人工保存至 .agent-runtime/.../artifacts/review-result.json"
  ],
  "updatedAt": "2026-06-29T10:00:00Z",
  "terminalStatus": "NON_TERMINAL"
}
```

### 5.2 狀態欄位說明

| 欄位 | 說明 |
| --- | --- |
| `changeId` | OpenSpec Change 名稱 |
| `runId` | 本次執行識別（同一個 Change 可能多輪修改） |
| `currentPhase` | 目前 Workflow Phase（見狀態機） |
| `currentOwner` | 目前持有寫入權的 Agent |
| `attempt` | 目前 Phase 的嘗試次數（Review→Fix→Review 會遞增） |
| `latestArtifactRefs` | 各類最新 Artifact 的 Reference |
| `latestHandoff` | 目前進行中的 Handoff |
| `gateStatus` | 各 Gate 通過狀態 |
| `blockers` | 目前 unresolved Blocker 清單 |
| `nextActions` | 建議下一步（人類可讀） |
| `terminalStatus` | `NON_TERMINAL` 或 `TERMINAL`（僅進入 COMPLETED/FAILED 時為 TERMINAL；INCOMPLETE 可補齊輸入後恢復） |

### 5.3 Single Source of Truth

`current-state.json` 是唯一事實來源：
- Workflow Router 依 `currentPhase` 決定階段。
- Agent 依 `latestArtifactRefs` 找到必要輸入。
- Coordinator 依 `blockers` 判斷是否可進入下一階段。
- 任何 Agent 不得依賴聊天紀錄或記憶推測狀態。

---

## 6. Workflow State Machine 設計

### 6.1 狀態定義

```text
PLAN_DRAFT
  CCR 正在建立 proposal/design/tasks，尚未完成

PLAN_REVIEW
  proposal/design/tasks 已交給 Qwen 審查

PLAN_APPROVED
  Qwen 審查通過（APPROVE 或 COMMENT_ONLY 且無 Blocker），CCR 已仲裁確認

READY_FOR_IMPLEMENTATION
  所有 Gate 滿足，等待 Codex 開始實作

IMPLEMENTING
  Codex 正在實作

READY_FOR_REVIEW
  Codex 實作完成，等待 Qwen 審查

REVIEWING
  Qwen 正在審查實作結果

CHANGES_REQUESTED
  Qwen 回報 Blocker/Major，等待 Codex 修復

NEEDS_COORDINATOR_ARBITRATION
  多個 Agent 判斷衝突，需要 CCR 仲裁

READY_FOR_READINESS_CHECK
  修復完成且 Qwen 通過，等待 CCR 最終判定

READY_FOR_ARCHIVE
  CCR 判定 ready，等待 Codex 產生 execution-summary

ARCHIVED_AWAITING_HUMAN_COMMIT
  archive 完成，等待人工 git commit

COMPLETED
  人工 commit 完成，Change 關閉

FAILED
  不可恢復的失敗（例如需求取消、能力不存在）

INCOMPLETE
  Qwen 無法完成審查（缺 Base/Diff/關鍵驗證），需補證據後重新進入
```

### 6.2 合法狀態轉移

```text
PLAN_DRAFT → PLAN_REVIEW
PLAN_REVIEW → PLAN_DRAFT (Qwen REQUEST_CHANGES)
PLAN_REVIEW → PLAN_APPROVED
PLAN_APPROVED → READY_FOR_IMPLEMENTATION
READY_FOR_IMPLEMENTATION → IMPLEMENTING
IMPLEMENTING → READY_FOR_REVIEW
IMPLEMENTING → PLAN_DRAFT (實作中發現規格問題)
READY_FOR_REVIEW → REVIEWING
REVIEWING → CHANGES_REQUESTED
REVIEWING → READY_FOR_READINESS_CHECK
REVIEWING → INCOMPLETE
CHANGES_REQUESTED → IMPLEMENTING (Codex 修復)
CHANGES_REQUESTED → NEEDS_COORDINATOR_ARBITRATION (衝突)
NEEDS_COORDINATOR_ARBITRATION → PLAN_DRAFT (CCR 決定改規格)
NEEDS_COORDINATOR_ARBITRATION → IMPLEMENTING (CCR 決定繼續修復)
NEEDS_COORDINATOR_ARBITRATION → READY_FOR_READINESS_CHECK (CCR 接受風險)
READY_FOR_READINESS_CHECK → READY_FOR_ARCHIVE
READY_FOR_READINESS_CHECK → IMPLEMENTING (CCR 發現問題需修復)
READY_FOR_ARCHIVE → ARCHIVED_AWAITING_HUMAN_COMMIT
ARCHIVED_AWAITING_HUMAN_COMMIT → COMPLETED (人工 commit 後)
INCOMPLETE → PLAN_REVIEW (補證據後重新進入)
任何 NON_TERMINAL → FAILED (不可恢復失敗)
```

### 6.3 禁止的狀態轉移

以下轉移 MUST NOT 發生：

1. **Qwen APPROVE 後自動進入 COMPLETED**：必須經過 CCR readiness-check。
2. **測試失敗仍進入 READY_FOR_ARCHIVE**：`gateStatus.implementationVerified` 必須為 true。
3. **有 unresolved Blocker 仍標記 READY_FOR_READINESS_CHECK**：`blockers` 必須為空。
4. **Codex 自行從 IMPLEMENTING 跳到 READY_FOR_READINESS_CHECK**：必須經過 Qwen REVIEWING。
5. **Codex 自行改變 Requirement**：若實作中發現規格問題，必須回到 PLAN_DRAFT。
6. **Reviewer（Qwen）自行修改 OpenSpec 或原始碼**：Qwen 沒有 Write 權限。
7. **Agent 跳過必要前置 Gate**：例如未經 review-plan 就直接 apply-change。
8. **從 ARCHIVED_AWAITING_HUMAN_COMMIT 回到任何 NON_TERMINAL**：一旦 archive，只能由人 commit 或手動 reset。
9. **自動 git commit**：狀態機不觸發 git 操作。

### 6.4 Gate 狀態

```text
proposalApproved: Qwen review-plan 通過 + CCR 仲裁確認
reviewPassed: Qwen review-result 通過（無 Blocker）
implementationVerified: lint/test/build 全部通過
readinessConfirmed: CCR readiness-check 通過
```

四個 Gate 全部為 `true` 才能進入 `READY_FOR_ARCHIVE`。

---

## 7. Runtime Artifact Boundary 設計

### 7.1 目錄結構

```text
.agent-runtime/
  <change-id>/
    current-state.json
    artifacts/
      coordinator-result.json
      implementation-result.json
      review-result.json
      readiness-result.json
      archive-result.json
    evidence/
      diff-stat.txt
      diff-check.txt
      changed-files.txt
      lint-output.txt
      test-output.txt
      build-output.txt
```

### 7.2 生命週期

- **建立**：`plan-change` 階段由 CCR 初始化 `current-state.json`。
- **更新**：每次 Agent 完成工作後更新 `current-state.json` 並寫入新的 `*-result.json`。
- **覆蓋**：同一個 stage 重新執行時覆蓋既有 artifact（不保留歷史版本）。
- **清理**：Archive 後可手動刪除整個 `.agent-runtime/<change-id>/`。
- **不進 Git**：`.agent-runtime/` 加入 `.gitignore`。

### 7.3 讀取例外規則

Agent 預設遵守 `.gitignore`，不讀取被忽略的內容。

唯一的嚴格例外：

> Agent 只有在以下條件全部滿足時，才可讀取 `.agent-runtime/<change-id>/` 下的檔案：
> 1. `current-state.json` 中 `latestHandoff.to` 為該 Agent。
> 2. 該檔案被 `latestHandoff.requiredInputRefs` 或 `current-state.json` 的 `latestArtifactRefs` 明確引用。
> 3. 該檔案的 `changeId` 與當前任務的 `changeId` 一致。

禁止：
- 遞迴掃描整個 `.agent-runtime/`。
- 讀取其他 Change 的 Runtime Artifact。
- 讀取其他 Run 的 Runtime Artifact（除非是目前 Handoff 明確引用）。
- Runtime Artifact 包含 Secret、API Key、Token 或 Credential。

### 7.4 Path Traversal 防護

ArtifactReference 的 `relativePath` MUST：
- 以以下已知安全前綴之一開頭：
  - `openspec/changes/`（OpenSpec Change 文件）
  - `.agent-runtime/`（Runtime Artifact）
- 其他前綴 MUST 拒絕。不得以模糊的「專案根目錄下的已知安全前綴」作為兜底。
- 不包含 `..`。
- 不包含 absolute path（`C:\`、`/etc/` 等）。
- 經過驗證後才可讀取。

---

## 8. Qwen Read-only Result Capture 設計

### 8.1 第一階段方法

Qwen 不直接寫入檔案。第一階段支援以下人工輔助方法：

**方法 A：CLIHost stdout capture（建議）**

Qwen 輸出符合 `agent-result.schema.json` 的 JSON（可包在 markdown code fence 中）。CLIHost 擷取 stdout，提取 JSON，驗證 Schema，寫入：

```text
.agent-runtime/<change-id>/artifacts/review-result.json
```

**方法 B：人工複製**

人從 Qwen 輸出複製 JSON 內容，手動寫入上述路徑。

**方法 C：輸出重導向**

Qwen CLI 啟動時使用 stdout 重導向，後處理 script 提取 JSON。

### 8.2 Qwen 輸出格式

Qwen 的 `review_result` 必須包含：

```jsonc
{
  "schemaVersion": "1.0.0",
  "artifactId": "review-result-001",
  "changeId": "add-agent-artifact-shared-state-handoff",
  "runId": "run-2026-06-29-001",
  "producer": "Qwen",
  "stage": "review-plan",
  "kind": "review_result",
  "status": "success",
  "createdAt": "2026-06-29T12:00:00Z",
  "summary": "完成 proposal/design/tasks 審查，無 Blocker，3 Major",
  "inputRefs": [],
  "outputRefs": [],
  "verification": {
    "executed": [],
    "passed": [],
    "failed": [],
    "notExecuted": ["lint", "test", "build", "git diff"]
  },
  "payload": {
    "verdict": "REQUEST_CHANGES",
    "findings": {
      "blocker": [],
      "major": [],
      "minor": []
    },
    "crossLayerContractCheck": {},
    "residualRisks": [],
    "positiveNotes": []
  },
  "risks": [],
  "nextHandoff": {}
}
```

### 8.3 Qwen 唯讀邊界保留

- Qwen 不得使用 Write、Edit、Bash Tool。
- Qwen 只輸出 review_result 內容（markdown 或 JSON）。
- 實際寫入 `.agent-runtime/` 由 CLIHost 或人工完成。
- 若 Qwen 的權限設定可能覆蓋唯讀邊界，必須輸出 `INCOMPLETE`。

---

## 9. HITL Git Gate 設計

### 9.1 Commit 邊界

狀態機的最終 state 是 `ARCHIVED_AWAITING_HUMAN_COMMIT`：

- Agent 可以產生 commit message 建議。
- Agent MUST NOT 執行 `git commit`、`git push`、`git tag`。
- 人在確認 execution-summary 與 diff 後，自行 commit。

### 9.2 Commit Message 建議格式

Agent 在 archive 階段產生：

```text
<type>(<scope>): <description>

<execution-summary 摘要>

OpenSpec Change: <change-name>
Co-Authored-By: Claude <noreply@anthropic.com>
```

### 9.3 不可繞過 Gate

以下情況 MUST NOT 建議 commit：
- `blockers` 不為空。
- `gateStatus` 任一 Gate 不為 true。
- `currentPhase` 不是 `ARCHIVED_AWAITING_HUMAN_COMMIT`。
- `terminalStatus` 不是 `TERMINAL`。

---

## 10. Execution Summary Promotion 設計

### 10.1 提升規則

每個 Change 完成／Archive 時，將以下長期有價值資訊從 Runtime Artifact 提升為 Durable Knowledge：

```text
openspec/changes/<change-name>/execution-summary.md
```

或依 OpenSpec Archive 後的適當位置保存（例如 `openspec/changes/archive/<date>-<change-name>/execution-summary.md`）。

### 10.2 內容範圍

只包含：

- 實際完成內容與原 Design 的差異。
- 主要修改檔案清單。
- 驗證結果摘要（哪些通過、哪些未執行）。
- 接受的風險與理由。
- 未完成項目。
- 重要決策與取捨。
- Commit 建議。

不得包含：
- 完整 CLI 對話。
- 完整 Trace、Log 或 Token 使用量。
- 全部中間輸出。
- 每個 Agent 的每輪執行細節。

### 10.3 產生時機

- 由 Codex 在 `archive-change` 階段產生。
- 從 `current-state.json`、各 `*-result.json` 與 `evidence/` 中提取必要資訊。
- 不需要重新執行任何 Agent。

---

## 11. Workflow Router 改造規劃

### 11.1 現有 Router 行為

目前 Router 依賴使用者口語指定階段，沒有結構化輸入。Agent 從使用者提供的文字摘要中提取必要資訊。

### 11.2 改造後 Router 行為

每個階段從以下來源取得輸入：

| 階段 | 主要輸入來源 | 次要輸入 |
| --- | --- | --- |
| `plan-change` | 使用者需求描述 | 無（初始化） |
| `review-plan` | `current-state.json` → `latestArtifactRefs.proposal/design/tasks` | OpenSpec 四件套 |
| `apply-change` | `current-state.json` → `latestArtifactRefs` + approved plan | OpenSpec 四件套 |
| `review-result` | `current-state.json` → `latestArtifactRefs.implementationResult` + `evidence/` | OpenSpec 四件套 + diff |
| `fix-from-review` | `current-state.json` → `latestArtifactRefs.reviewResult` | implementation result + evidence |
| `readiness-check` | `current-state.json`（blockers、gateStatus、全部 latestArtifactRefs） | 所有 evidence |
| `archive-change` | `current-state.json`（全部狀態）+ 全部 results | evidence |

### 11.3 Router Reference 更新計畫

**Codex references（最完整，作為事實來源）**

更新 `01-plan-change.md` ~ `07-archive-change.md`：
- 每個 reference 增加「Input: 從 current-state.json 的哪個欄位取得」。
- 每個 reference 增加「Output: 產生哪個 artifact，寫入哪個路徑」。
- 每個 reference 增加「State Transition: 完成後 currentPhase 變為什麼」。

**Claude references（補充 CCR 專屬協調行為）**

補齊 `.claude/skills/openspec-workflow-router/references/01-07`：
- 01: plan-change（CCR 建立 proposal/design/tasks）
- 02: review-plan（CCR 協調 Qwen 審查並仲裁）
- 06: readiness-check（CCR 最終判定）
- 其餘階段為 handoff prompt 產生（交給 Codex 或 Qwen）。

**Qwen references（補充審查專屬行為）**

既有 Qwen router 以 Codex references 為基礎，本 Change 只補充 Artifact 讀取路徑。

### 11.4 不新增第二套 Router

本 Change 改造現有 Router，不新增功能重疊的第二套路由 Skill。三個 Agent 仍然每次只載入一個 Stage Reference。

---

## 12. 與既有 Weather Change 的 Dry Run 關聯

### 12.1 Dry Run 目的

以既有的 `generalize-weather-location-resolution` Change 為例，模擬以下流程：

1. 初始化 `current-state.json`（假設 proposal/design/tasks 已完成）。
2. 產生 `coordinator-result.json`（模擬 CCR plan-change 輸出）。
3. 產生 `review-result.json`（模擬 Qwen review-plan 輸出）。
4. 驗證 Router 可依 `current-state.json` 決定下一步。
5. 驗證下一位 Agent 可只靠 Change ID + CurrentState + ArtifactReferences 工作。

### 12.2 限制

- 不修改 Weather Change 的任何 OpenSpec 或程式碼。
- 只在 `.agent-runtime/generalize-weather-location-resolution/` 下建立測試用的 Runtime Artifact。
- Dry Run 完成後可選擇保留或刪除測試 Artifact。

---

## 13. 替代方案與取捨

### 13.1 方案 A：完整 Node Orchestrator（本 Change 不採用）

建立 Node.js 服務自動啟動 Agent、傳遞 Artifact、管理狀態機。

- 優點：完全自動化。
- 缺點：範圍過大、引入執行依賴、與本 Change 的「契約層優先」目標不符。
- 決定：第二階段再評估。

### 13.2 方案 B：SQLite 狀態儲存（本 Change 不採用）

使用 SQLite 儲存所有狀態、Artifact 與歷史。

- 優點：可查詢、可追蹤歷史。
- 缺點：引入 dependency、schema migration、超出第一階段範圍。
- 決定：第一階段使用檔案系統 JSON，未來可遷移。

### 13.3 方案 C：只定義 Markdown 模板（本 Change 不採用）

不建立 JSON Schema，只用 Markdown 模板定義交接格式。

- 優點：簡單。
- 缺點：無法工具驗證、無法結構化查詢、人與 Agent 容易遺漏欄位。
- 決定：JSON Schema 是必要的最小嚴謹度。
