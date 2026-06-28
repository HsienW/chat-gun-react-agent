# 06 Readiness Check（CCR）

- **Input**：CurrentState、implementationResult、reviewResult、Evidence、OpenSpec。
- **Output**：readiness_result 與 archive-change Handoff。
- **State Transition**：`READY_FOR_READINESS_CHECK` → `READY_FOR_ARCHIVE` 或 `IMPLEMENTING`。
- **CCR 責任**：核對 Gate、blockers、Tasks 與 Requirement evidence，不依長摘要判定。
