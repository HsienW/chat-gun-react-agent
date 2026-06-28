# 04 Review Result（CCR Handoff）

- **Input**：CurrentState、implementationResult、Diff／Validation Evidence、OpenSpec references。
- **Output**：交給 Qwen 的唯讀 Handoff；預期輸出 review_result。
- **State Transition**：`READY_FOR_REVIEW` → `REVIEWING`；完成後依 Verdict 路由。
- **CCR 責任**：不要求重貼已有 Artifact；保存 Qwen stdout 後才更新狀態。
