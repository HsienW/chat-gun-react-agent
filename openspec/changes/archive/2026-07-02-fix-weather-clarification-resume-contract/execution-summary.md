# Execution Summary：fix-weather-clarification-resume-contract

## Run 資訊

- **Change ID**：`fix-weather-clarification-resume-contract`
- **Run ID**：`2026-07-02-001`
- **執行日期**：2026-07-02

## 變更摘要

修正 Frontend 天氣澄清流程的 resume contract：從 `thread.submit({messages})`（一般 HumanMessage）改為 `thread.submit(null, {command: {resume: ...}})`（LangGraph Command(resume)），使 Graph 正確從 interrupt 恢復進入 `resume_clarify` 節點，而非重新進入 `plan_research`。

## Gate 狀態

| Gate | 狀態 |
|------|------|
| proposalApproved | ✅ true |
| reviewPassed | ✅ true（Qwen APPROVE，40/40 tasks，0 blocker，0 major，1 minor non-blocking） |
| implementationVerified | ✅ true |
| readinessConfirmed | ✅ true |

## 驗證結果

| 項目 | 結果 |
|------|------|
| OpenSpec strict validation | ✅ passed |
| Frontend lint | ✅ 0 errors |
| Frontend test | ✅ 57 passed |
| Frontend build | ✅ passed |
| Backend lint | ✅ passed |
| Backend test | ✅ 189 passed, 27 skipped |
| Backend build | ✅ passed |
| Human live smoke | ✅ 4/4 passed |

## 修改檔案

| 檔案 | 變更 |
|------|------|
| `frontend/src/App.tsx` | 新增 `handleClarificationResume` callback，調用 `thread.submit(null, {command: {resume: ...}})`；新增 `clarificationResumePendingRef` once-only guard；`handleSubmit` 新增 clarification guard |
| `frontend/src/components/ChatMessagesView.tsx` | `handleClarificationReply` 改用 `onClarificationResume`；新增 `handleClarificationCancel`；型別全鏈一致 |
| `frontend/src/components/ToolMessageDisplay.tsx` | `onClarificationReply` prop 型別同步 |
| `frontend/src/components/WeatherToolResult.tsx` | 匯出 `ClarificationReplyPayload` / `ClarificationResumeValue` type；新增 `selectedIndex` state；`onReply` callback 改為結構化 payload |
| `frontend/src/components/WeatherToolResult.test.tsx` | 更新測試斷言為結構化 payload；新增 candidateIndex 邊界測試 |
| `frontend/src/App.stream-activity.test.tsx` | 新增 Command(resume) transport 測試 |

## Review Finding

| ID | Severity | 說明 | 處置 |
|----|----------|------|------|
| MINOR-001 | Minor | candidateIndex 對稱邊界：編輯文字剛好匹配另一候選 displayName 時不會清除 selectedIndex | 不阻擋。Backend 以 userReply 為 authoritative source；candidates 通常有唯一 displayName |

## 相容性

- **BFF**：零變更（LangGraph SDK 直接處理 Command）
- **Backend**：零 production code 變更（`parseClarificationResumeInput` 已正確處理三種 resume value 形狀）
- **既有一般 submit 流程**：不受影響（`handleSubmit` guard 只在 clarification 進行中生效）

## 最終判定

**READY_TO_ARCHIVE** ✅
