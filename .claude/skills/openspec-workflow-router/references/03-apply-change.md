# 03 Apply Change（CCR Handoff）

- **Input**：已核准 OpenSpec、coordinatorResult、CurrentState。
- **Output**：交給 Codex 的 Handoff，列明 implementationResult 與 Evidence 路徑。
- **State Transition**：`PLAN_APPROVED` → `READY_FOR_IMPLEMENTATION`，owner → Codex。
- **CCR 責任**：確認 proposalApproved、無 blockers，不代替 Codex 實作。
