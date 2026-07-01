# 05 Fix From Review（CCR Handoff）

- **Input**：最新 reviewResult、implementationResult、OpenSpec 與 Evidence。
- **Output**：交給 Codex 的 fix Handoff，列出 references 與接受條件。
- **State Transition**：`CHANGES_REQUESTED` → `IMPLEMENTING`；衝突時 → `NEEDS_COORDINATOR_ARBITRATION`。
- **CCR 責任**：保留 Finding severity/evidence，只在衝突時仲裁。
