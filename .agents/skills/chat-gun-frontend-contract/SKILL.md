---
name: chat-gun-frontend-contract
description: Chat Gun React Agent 的前端、OpenSpec、Streaming Event、Tool Renderer、型別邊界、多模態流式鏈路與 React/Vite 編程約束。Use when working on frontend code, tool rendering, streaming contracts, multimodal requests/responses, Weather legacy refactors, or OpenSpec-driven changes in this repository.
---

# Chat Gun Frontend Contract

所有回覆、計畫、進度、錯誤說明與完成摘要一律使用繁體中文。技術名詞、API 名稱、套件名稱、函式名稱、CLI 命令與程式碼保留英文原文。

## 快速流程

1. 先讀根目錄 `AGENTS.md`、受影響套件的 `AGENTS.md` 與 `openspec/config.yaml`。
2. 判斷任務類型，依下表載入對應 reference。
3. 修改前先定位問題層級與契約邊界，不得直接跨層大範圍修改。
4. 修改後執行受影響套件的驗證命令，未執行或失敗必須如實回報。

## Reference 載入規則

| 任務類型 | 必讀文件 |
| --- | --- |
| OpenSpec Proposal、Specs、Design、Tasks、Verify、Archive | `references/chat-gun-fe-openspec-workflow.md` |
| LangGraph → BFF → Frontend 串流事件、SSE、Reducer、Terminal State | `references/chat-gun-fe-streaming-event-contract.md` |
| 歷史包袱、模組泛化、重構方案挑選、Weather 類案例 | `references/chat-gun-fe-legacy-refactor.md` |
| 深度思考、文字生成、視覺理解、圖片/影片/語音、多模態流式上下行 | `references/chat-gun-fe-multimodal-streaming.md` |
| Tool Result、ToolMessageDisplay、專項卡片、fallback 渲染 | `references/chat-gun-fe-tool-renderer.md` |
| frontend/bff/backend 型別邊界、泛型、runtime validation、schemaVersion | `references/chat-gun-fe-type-boundary.md` |
| React/Vite 元件、條件分支、Enum、i18n、環境變數、Bundle | `references/chat-gun-fe-react-vite-conventions.md` |

## 硬性規則摘要

- 非簡單變更以已核准 OpenSpec 作為產品行為事實來源。
- Streaming Event、Tool Result 與多模態請求/響應的跨層資料必須有 runtime validation。
- 流式 I/O 與多模態請求/響應的 TypeScript 型別必須使用泛型。
- 條件分支超過 2 個時，使用 Enum 或 literal union 加上 `Record` mapping。
- 所有面向使用者的展示文字必須抽成變量，為 i18n 做準備。
- Frontend 不得持有模型、Tool、MCP 憑證，也不得直接呼叫受保護 Runtime。
- 不得以自然語言文字、顯示文案或錯誤訊息反推狀態。

## 驗證命令

```bash
cd frontend
npm run lint
npm run test
npm run build
```

```bash
cd bff
npm run build
```

```bash
cd backend
npm run lint
npm run test
npm run build
```

只修改單一套件時，至少執行該套件全部既有驗證。跨層契約變更必須執行所有受影響套件的驗證。
