# OpenSpec Agent Workflow Prompts

本文件是本專案 OpenSpec 多 agent 流程的入口說明。完整 prompt 模板已下沉到 Codex skill：

```text
.codex/skills/openspec-workflow-router/
```

目的：

- 用短 prompt 觸發正確流程，避免每次載入 7 組完整模板。
- 讓 Codex 依階段漸進讀取對應 reference。
- 讓 CCR、Qwen Reviewer、Codex 在 OpenSpec change lifecycle 中使用一致交接語言。

## 角色對應

| 流程角色 | 本專案常用工具 | 責任 |
| --- | --- | --- |
| Planner | CCR | 前期需求評估，產生 proposal / design / tasks 草案 |
| Reviewer | Qwen | 審查計劃與實作結果，找 Blocker / Major / Minor |
| Implementer | Codex | 依 OpenSpec 實作、測試、更新 tasks |
| Coordinator | CCR | 完成判定，確認是否可 archive |
| Archivist | Codex + 人工 | 執行 OpenSpec archive；git commit / push 由人完成 |

## 階段路由

| 階段 | 使用時機 | Skill reference |
| --- | --- | --- |
| 1. plan-change | 需求尚未形成 OpenSpec change | `.codex/skills/openspec-workflow-router/references/01-plan-change.md` |
| 2. review-plan | proposal / design / tasks 需要先審 | `.codex/skills/openspec-workflow-router/references/02-review-plan.md` |
| 3. apply-change | OpenSpec 計劃已通過，交給 Codex 實作 | `.codex/skills/openspec-workflow-router/references/03-apply-change.md` |
| 4. review-result | Codex 完成後交給 Qwen 審查 | `.codex/skills/openspec-workflow-router/references/04-review-result.md` |
| 5. fix-from-review | Qwen 找到 Blocker / Major / Minor 後交回 Codex | `.codex/skills/openspec-workflow-router/references/05-fix-from-review.md` |
| 6. readiness-check | Codex 修完且 Qwen 通過後，CCR 做完成判定 | `.codex/skills/openspec-workflow-router/references/06-readiness-check.md` |
| 7. archive-change | 完成判定通過後，啟動 archive 與 commit message 建議 | `.codex/skills/openspec-workflow-router/references/07-archive-change.md` |

## 建議短 Prompt

使用 Codex 時，優先用 skill route：

```text
使用 openspec-workflow-router，對 {change_name} 做 {stage}。
必要上下文如下：
{context}
```

範例：

```text
使用 openspec-workflow-router，對 weather-cjk-geocoding-query-name 做 review-result。
Codex 摘要如下：
...
修改檔案如下：
...
驗證結果如下：
...
```

## 上下文策略

預設只讀最小必要內容：

- 相關 OpenSpec artifacts。
- 使用者提供的 diff / 摘要 / 驗證結果。
- 直接受影響的檔案與相鄰測試。
- 必要的 AGENTS.md 規則片段。

預設不要讀取：

- `.gitignore` 已忽略的內容。
- `node_modules/`、`dist/`、`build/`、`coverage/`。
- lockfile，除非本 change 涉及 dependency 變更。
- 大量無關檔案或完整遞迴輸出。

只有在以下情況才擴大讀取：

- OpenSpec、程式碼或專案規則互相衝突。
- 變更涉及跨層契約、安全、權限、資料格式或 migration。
- 測試失敗且無法用相鄰上下文定位。
- Reviewer finding 指向更上游的架構問題。

## 專案注意事項

- 本文件是本 repo 的專案版 workflow，不是通用開源版。
- 本專案常見邊界是 `frontend` / `bff` / `backend`，但具體仍以 change scope 為準。
- 涉及 resolver / provider / tool / planner 時，必須避免 hard-coded mapping、keyword shortcut、phrase stripping 或特殊案例分支取代正式契約。
- git commit / push 一律由人執行；agent 最多產生 commit message 建議。
