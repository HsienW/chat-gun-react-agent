---
name: chat-gun-fe-openspec-workflow
description: 引導 OpenSpec spec-driven 變更管理全流程，從 Proposal 到歸檔，確保 Proposal → Specs → Design → Tasks → Verify 的可追溯性與完整性。
---

# OpenSpec 變更管理流程

## 使用時機

當需要新增、修改或移除跨層能力時使用本 Skill：

- 新增 Tool、Agent、MCP 或模型能力。
- 修改跨層契約（Request / Response / Event / State）。
- 重構既有模組（如泛化 Weather、遷移 Provider）。
- 修復需要跨套件協調的 Bug。

## 強制前置條件

依序讀取：

1. `openspec/config.yaml` - 確認 schema 版本與規則。
2. `openspec/changes/` - 確認是否已有相關 Change。
3. 根目錄 `AGENTS.md` - 全域規則。
4. 受影響套件的 `AGENTS.md`。
5. 相關能力域規則（如 `docs/agent-rules/weather.md`）。

## OpenSpec 目錄結構

```text
openspec/
├── config.yaml              # Schema 定義與規則
├── specs/                   # 已核准的穩定規格（Delta Specs 合併後歸入）
│   ├── agent-runtime/
│   ├── frontend-chat/
│   ├── tool-execution/
│   ├── bff-security/
│   └── ...
└── changes/                 # 進行中的變更
    └── <change-name>/
        ├── proposal.md      # 問題描述與解決方案
        ├── design.md        # 技術設計（frontend / bff / backend）
        ├── tasks.md         # 可獨立驗證的任務清單
        ├── specs/           # Delta Specs（按套件拆分）
        │   ├── agent-runtime/spec.md
        │   ├── frontend-chat/spec.md
        │   └── tool-execution/spec.md
        └── archive/         # 完成後歸檔
```

## 流程步驟

### Step 1: Proposal

必須包含：

- **問題描述**：目前存在什麼問題或能力缺口。
- **目標**：本次變更要達成什麼。
- **非目標**：明確排除的範圍。
- **受影響套件**：frontend / bff / backend / 哪些 specs。
- **受影響能力域**：如 weather、tool-execution、agent-runtime。
- **風險與回滾策略**：可能出錯的情境與恢復方式。
- **相容性**：是否破壞既有契約、是否需要 Migration。

禁止：

- 只描述解決方案而不描述問題。
- 在未確認問題前就跳到實作。

### Step 2: Delta Specs

每個受影響套件各寫一份 `spec.md`：

- 每項 Requirement 必須至少包含一個 Scenario。
- 必須涵蓋：成功、失敗、逾時、取消、未知情境。
- 不得在行為規格中混入具體檔案名稱或程式實作。
- Requirement 必須可追溯到 Proposal 的目標。

### Step 3: Design

必須分別說明各層變更：

- **frontend**：元件、型別、事件處理、渲染邏輯。
- **bff**：路由、驗證、錯誤映射、串流代理。
- **backend**：LangGraph State、Node、Edge、Tool、Provider。
- **跨層契約**：Schema 變更、Event Type、Error Code。
- **安全與權限**：Tool 或 MCP 變更必須包含分析。

### Step 4: Tasks

- 每個 Task 必須可獨立驗證。
- 必須包含明確的驗證命令。
- 必須標註對應的 Requirement。
- 不得先勾選 Task 再補實作。

Task 完成條件（全部滿足才能標記完成）：

1. 程式碼已完成。
2. 對應測試已新增或更新。
3. 必要驗證已實際執行並通過。
4. Build 或 Type Check 已通過。
5. OpenSpec Requirement 與 Scenario 已被覆蓋。
6. 沒有未處理的規格衝突。
7. Git Diff 不包含無關修改。
8. 已如實記錄無法驗證的部分。

### Step 5: Verify

跨套件驗證命令：

```bash
# frontend
cd frontend && npm run lint && npm run test && npm run build

# bff
cd bff && npm run build

# backend
cd backend && npm run lint && npm run test && npm run build
```

### Step 6: Archive

完成後將 Change 目錄移至 `openspec/changes/archive/`，並將 Delta Specs 合併至 `openspec/specs/`。

## 禁止事項

- 不得跳過 Proposal 直接寫 Tasks。
- 不得在 Specs 中引用具體實作檔案路徑。
- 不得以聊天記錄或口頭協議取代已核准的 OpenSpec。
- 不得在未完成驗證前標記 Task 完成。
- 不得偷偷擴大本次 Change 範圍。

## 參考檔案

- `openspec/config.yaml`
- `openspec/changes/generalize-weather-location-resolution/proposal.md`
- `openspec/changes/generalize-weather-location-resolution/design.md`
- `openspec/changes/generalize-weather-location-resolution/tasks.md`
- `openspec/changes/generalize-weather-location-resolution/specs/*/spec.md`
