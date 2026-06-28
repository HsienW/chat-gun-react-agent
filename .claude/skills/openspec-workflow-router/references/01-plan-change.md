# 01 Plan Change（CCR）

- **Input**：需求與直接相關 OpenSpec；CurrentState 不存在時由 CCR 初始化。
- **Output**：proposal/design/tasks、coordinator_result、review-plan Handoff。
- **State Transition**：`PLAN_DRAFT` → `PLAN_REVIEW`，owner → Qwen。
- **CCR 責任**：驗證 Schema、保存 artifacts、更新 CurrentState，不以聊天摘要替代狀態。
