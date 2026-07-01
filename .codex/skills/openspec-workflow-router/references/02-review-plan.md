# 02 Review Plan

Use this prompt when an OpenSpec proposal, design, tasks, or delta specs need review before implementation.

```text
請以 Qwen Code Reviewer / Secondary Architecture Reviewer 身分，審查 OpenSpec change 計劃。

Change：
{change_name}

請只 review，不修改檔案。優先讀取：

- openspec/changes/{change_name}/proposal.md
- openspec/changes/{change_name}/design.md
- openspec/changes/{change_name}/tasks.md
- openspec/changes/{change_name}/specs/
- AGENTS.md 中與審查規則相關的片段

不要重掃整個 repo。忽略 `.gitignore` 內文件、node_modules、dist、build、coverage、lockfile。

審查重點：

- Proposal / Design / Specs / Tasks 是否一致。
- Tasks 是否可驗證，且沒有跳過必要驗證。
- 是否維持受影響套件 / 子系統責任邊界。本專案常見邊界為 frontend / bff / backend。
- 是否有 API、event、state、schema、tool contract、error code 風險。
- 若涉及解析、分類、tool、provider 或 planner，是否有 hard-coded mapping、keyword shortcut、特殊案例分支風險。

輸出格式：

### Findings

每項包含：

- 嚴重程度：Blocker / Major / Minor
- 檔案位置
- 問題
- 影響
- 建議修正
- 對應 Requirement / Task / Contract

### Open Questions

無則寫「無」。

### Verdict

- PASS：可交給 Codex 實作
- PASS WITH MINOR：可實作，但有 Minor
- FAIL：不可實作，需先修正計劃

請使用繁體中文。
```

## Artifact Contract

- **Input**：CurrentState 的 proposal/design/tasks/coordinatorResult 與目前 Handoff。
- **Output**：Qwen stdout 的 `review_result`；由人工或 CLIHost 驗證後保存。
- **State Transition**：`PLAN_REVIEW` → `PLAN_APPROVED`、`PLAN_DRAFT` 或 `INCOMPLETE`。
- **Validation**：缺 Base、OpenSpec 或必要輸入時輸出 `INCOMPLETE`；Qwen 不寫檔。
