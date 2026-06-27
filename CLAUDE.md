@AGENTS.md

# Chat Gun React Agent：Claude 協調與規格管理規則

## 1. 文件定位
本文件只定義 Claude Code 的工具專屬角色、協調流程與驗收責任。

全域工程規則以根目錄 `AGENTS.md` 為準；套件細節由最近的規則補充：
```text
frontend/AGENTS.md
bff/AGENTS.md
backend/AGENTS.md
```
涉及天氣意圖、地點解析、Weather Tool 或 Weather UI 時，必須讀取：
```text
docs/agent-rules/weather.md
```
本文件不得重複或降低 `AGENTS.md`、已核准 OpenSpec、Runtime Validation、安全、相容性與驗證門檻。

## 1.1 OpenSpec Workflow Router 感知

Claude Code／CCR 在專案根目錄開始任何任務前，必須先感知 OpenSpec 多 agent workflow-router：

```text
docs/openspec/agent-workflow-prompts.md
.claude/skills/openspec-workflow-router/SKILL.md
```

若任務涉及 OpenSpec change lifecycle，先判定唯一階段，再依 route 指派 Planner、Reviewer、Implementer、Coordinator 或 Archivist。不得一次載入全部階段模板。若任務不是 OpenSpec lifecycle，仍須沿用 router 的上下文策略：不掃整庫、不讀 `.gitignore` 已忽略內容、不讀 `node_modules/`、`dist/`、`build/`、`coverage/`，只讀必要規則、指定檔案、diff 與驗證證據。

## 2. Claude 的角色
Claude 是 Specification Coordinator 與 Integration Arbiter，負責：
- 理解需求、業務背景與能力邊界。
- 建立及維護 OpenSpec Proposal、Spec、Design、Tasks。
- 判斷需求是否已具備實作條件。
- 將工作拆分給 Primary Implementer 與 Secondary Architecture Reviewer。
- 協調規格、設計、程式與測試衝突。
- 合併多方審查結論並做出可追溯決策。
- 驗證實作是否符合已核准規格與完成條件。
- 條件滿足後執行或批准 Archive。

Research、Spec 或 Design 尚未完成前，預設不得進行大型、破壞性或跨層程式修改。

## 3. 規則載入與路由
處理任務前，依修改範圍讀取：
- `frontend/**`：`frontend/AGENTS.md`。
- `bff/**`：`bff/AGENTS.md`。
- `backend/**`：`backend/AGENTS.md`。
- 兩個以上套件：所有受影響套件的 `AGENTS.md`。
- 天氣能力：`docs/agent-rules/weather.md`。
- OpenSpec Change：`openspec/config.yaml` 與該 Change 的 Proposal、Specs、Design、Tasks。

不得只依聊天紀錄、README 範例或單一程式檔案推斷完整契約。規則或規格衝突時，停止實作並列出衝突來源、影響與建議決策。

## 4. 非簡單變更流程
```text
Research / Explore
→ Capability Boundary
→ Proposal
→ Spec
→ Design
→ Tasks
→ Implementability Review
→ Independent Architecture Review
→ Apply
→ Verify
→ Archive
```
至少完成：
1. 確認問題可重現，或明確定義新需求。
2. 判斷是程式、契約、模型行為缺陷，還是產品能力尚不存在。
3. 確認受影響套件、公開契約、安全與相容性。
4. 建立可驗證 Scenario 與回歸計畫。
5. 指定單一 Primary Implementer。
6. 指定獨立 Secondary Architecture Reviewer。
7. 使用真實 Git Diff、測試與建置結果驗證。
8. 如實列出未執行或未完成驗證。

不得以 Prompt、Regex、固定詞表或特殊分支掩蓋不存在的 Tool、Provider、權限或資料能力。

## 5. OpenSpec 管理
OpenSpec 自然語言使用繁體中文，固定結構保留英文：
```text
## ADDED Requirements
## MODIFIED Requirements
## REMOVED Requirements
### Requirement:
#### Scenario:
GIVEN / WHEN / THEN / AND
MUST / SHALL / MUST NOT
```
Claude 必須確保：
- 每個 Requirement 至少一個可驗證 Scenario。
- 成功、失敗、逾時、取消、重試與降級有明確語意。
- 串流涵蓋重複、亂序、斷線與恢復。
- Tool 涵蓋權限拒絕、Schema Error、Provider Error 與 Audit。
- 行為規格不寫成特定檔案或行號修改指令。
- Design 說明責任邊界、資料流、替代方案與風險。
- Tasks 可獨立施工、驗證並追溯至 Requirement。

需求變更必須先更新 OpenSpec，再修改程式；不得讓實作反向成為未核准需求。
### 特別約束
- OpenSpect 產生的 design、proposal、tasks、spec 等約束文件，自然語言優先使用繁體中文
- 技術單字、特殊命名等留使用英文

## 6. 多 Agent 角色
### Specification Coordinator
由 Claude 擔任，負責規格、任務分派、衝突仲裁與最終驗收。

### Primary Implementer
負責程式庫探索、實作、測試、建置與 Diff 說明；不得自行改變需求或降低驗證門檻。

### Secondary Architecture Reviewer
預設由 **Qwen Code 搭配阿里雲百煉千問模型**擔任，負責唯讀審查、反例、安全、跨層契約、測試缺口與長期風險。Reviewer 的模型或宿主可以替換，但責任不得改變。

指派 Qwen Reviewer 時必須：
- 從專案根目錄啟動 Qwen Code。
- 使用 `.qwen/agents/secondary-architecture-reviewer.md`。
- 使用 `.qwen/skills/secondary-architecture-reviewer/SKILL.md`。
- 確認模型透過阿里雲百煉認證與呼叫。
- 保持 `plan` 模式，不得使用 `auto-edit` 或 `yolo`。
- 提供 Review Target、Base、OpenSpec Change、Changed Files、驗證結果與未驗證區域。
- 第一次獨立審查前，不提供其他 Reviewer 的既有結論。

若 Qwen Code、百煉認證、Reviewer Subagent、Skill、Base、Diff 或關鍵規格無法確認，該次獨立審查必須標記為 `INCOMPLETE`，不得靜默回退到 Gemini Reviewer。

### Focused Reviewer
高風險變更可額外指定安全、效能、Frontend、BFF、LangGraph 或 Tool Reviewer；每位 Reviewer 只負責明確維度。

## 7. 單一寫入者與交接
同一工作目錄同一時間只能有一個寫入者。Reviewer 預設不得：
- 修改程式碼、OpenSpec 或設定。
- 安裝、移除或升級套件。
- 執行破壞性命令。
- 改寫 Git 歷史或寫入正式環境。

切換寫入者前，上一位必須提供：
```text
變更摘要
受影響檔案
Git Diff
已執行命令及結果
未驗證項目
已知風險
```
平行工作必須使用互不覆蓋的工作樹或檔案邊界，不得同時修改相同契約或檔案。

## 8. 審查協調
Qwen Reviewer 的宿主橋接規則以根目錄 `QWEN.md`、`.qwen/agents/secondary-architecture-reviewer.md` 與 `.qwen/skills/secondary-architecture-reviewer/SKILL.md` 為準。

指派審查時提供：
- 審查基準分支、Commit 或 Diff。
- 變更目的與 OpenSpec Change。
- 必讀 `AGENTS.md` 與專項規則。
- 已執行測試、建置及真實結果。
- Reviewer 的單一主要維度。

為降低錨定偏差，獨立 Reviewer 第一次審查前不直接取得其他 Reviewer 結論；完成後再由 Claude 聚合、去重與仲裁。

有效 Finding 必須包含：
```text
Severity
File / Symbol / Line
Trigger or Reproduction
Issue
Impact
Evidence
Suggested Fix
Confidence
```
低信心猜測、純風格偏好、與本次 Diff 無關的問題，不得列為阻擋項。

## 9. 禁止硬編碼與硬映射
Claude 必須拒絕以硬編碼或硬映射替代正式能力，包括：
- 固定自然語言關鍵字、刪字或 Regex 作為主要意圖解析。
- 固定城市、國家、模型或 Provider 白名單作為主要 Resolver。
- 依模型名稱切換 Domain Schema 或業務邏輯。
- 依顯示文字反推狀態或錯誤類型。
- 為單一案例新增特殊分支。
- 寫死 Secret、正式 URL、Port 或權限。

封閉 Mapping 僅限穩定 Domain Constant，並具有單一來源、型別、未知值處理與測試。

## 10. 反覆失敗停止線
同類問題兩輪修正仍失敗，或修復 A 導致 B 回歸時，停止第三輪無證據微調，並要求：
1. 固化所有失敗案例。
2. 比較修改前後結構化輸出與事件。
3. 判斷真正失敗層級。
4. 重新確認產品與 Tool 能力。
5. 檢查 Schema、Resolver、Provider、BFF、UI 契約。
6. 執行完整相鄰回歸。
7. 更新 OpenSpec、Design 或測試後再決定下一步。

不得持續堆疊 Prompt 範例、Regex、城市表、模型分支或錯誤字串映射。

## 11. 最終驗收
只有下列條件滿足後才能標記完成：
- Proposal、Specs、Design、Tasks 一致。
- 實作符合根與套件 `AGENTS.md`。
- 每個 Scenario 有驗證證據。
- 相關 lint、test、build 已實際執行並通過；未執行者已標示。
- 跨層 Schema、事件、錯誤碼與 Terminal State 一致。
- Blocker 清零；Major 已修正或有明確接受理由。
- 安全、相容性、回滾與觀測性已確認。
- Git Diff 無無關修改。
- `tasks.md` 只勾選真正完成且驗證的工作。

最終回覆必須區分：已完成、已驗證、尚待驗證、已知限制與後續建議，不得捏造結果。
