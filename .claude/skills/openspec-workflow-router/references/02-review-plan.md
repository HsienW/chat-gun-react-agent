# 02 Review Plan（CCR）

- **Input**：CurrentState 的 OpenSpec references、coordinatorResult 與 review Handoff。
- **Output**：保存經驗證的 review_result，記錄仲裁結果。
- **State Transition**：`PLAN_REVIEW` → `PLAN_APPROVED`、`PLAN_DRAFT` 或 `INCOMPLETE`。
- **CCR 責任**：Qwen 維持唯讀；review_result 保存成功後才更新 CurrentState。
