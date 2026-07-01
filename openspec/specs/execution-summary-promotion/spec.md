# Execution Summary Promotion

## Purpose

本規格定義 execution-summary-promotion 能力的正式需求，涵蓋其資料契約、狀態邊界、角色責任、失敗處理與驗證情境，作為實作、審查及後續演進的主要行為依據。

## Requirements

### Requirement: Execution Summary 產生時機

每個 Change 在 Archive 時 MUST 產生 execution-summary.md，將長期有價值資訊從 Runtime Artifact 提升為 Durable Knowledge。

#### Scenario: Archive 階段產生

GIVEN `currentPhase` 為 `"READY_FOR_ARCHIVE"`
WHEN Codex 執行 archive-change 階段
THEN Codex MUST 產生 `openspec/changes/<change-name>/execution-summary.md`
AND 或依 OpenSpec Archive 後的適當位置（例如 `openspec/changes/archive/<date>-<change-name>/execution-summary.md`）

#### Scenario: 從 Runtime Artifact 提取資訊

GIVEN `.agent-runtime/<change-id>/` 中有完整的 current-state.json 與各類 *-result.json
WHEN Codex 產生 execution-summary.md
THEN Codex MUST 從 current-state.json 與各 Artifact 中提取必要資訊
AND MUST NOT 從聊天紀錄或記憶中推測

---

### Requirement: Execution Summary 內容範圍

execution-summary.md MUST 只包含長期有價值的資訊。

#### Scenario: 必須包含的內容

GIVEN execution-summary.md
WHEN 檢查內容
THEN MUST 包含以下章節：
  1. 實際完成內容與原 Design 的差異
  2. 主要修改檔案清單
  3. 驗證結果摘要（哪些通過、哪些未執行）
  4. 接受的風險與理由
  5. 未完成項目
  6. 重要決策與取捨
  7. Commit 建議

#### Scenario: 不得包含的內容

GIVEN execution-summary.md
WHEN 檢查內容
THEN MUST NOT 包含：
  - 完整 CLI 對話或聊天紀錄
  - 完整 Trace、Log 或 Token 使用量
  - 全部中間輸出（所有 Agent 的每輪執行細節）
  - Secret、Token、API Key 或 Credential

#### Scenario: 資訊過濾

GIVEN Codex 從 Runtime Artifact 提取資訊時
WHEN 遇到不屬於長期有價值範圍的內容（如完整 diff、完整 lint 輸出）
THEN Codex MUST 產生摘要而非完整複製
AND SHOULD 提供 reference 指向完整內容所在位置（如 evidence/ 目錄）

---

### Requirement: Execution Summary 與 OpenSpec 的關係

execution-summary.md MUST 是 Durable Knowledge 的一部分，保存在 OpenSpec Change 目錄中。

#### Scenario: 與既有 OpenSpec 共存

GIVEN `openspec/changes/<change-name>/` 中已有 proposal.md、design.md、tasks.md、specs/
WHEN 加入 execution-summary.md
THEN 不得覆蓋、修改或刪除任何既有 OpenSpec 檔案
AND execution-summary.md 是補充性記錄

#### Scenario: Archive 後的保存位置

GIVEN Change 已 Archive 到 `openspec/changes/archive/<date>-<change-name>/`
WHEN execution-summary.md 被提升
THEN MUST 保存在與 proposal.md 同層的目錄
AND 不得只留在 `.agent-runtime/` 中（會被忽略或清理）

---

### Requirement: Execution Summary 不取代 OpenSpec

execution-summary.md MUST NOT 取代或覆蓋 OpenSpec 四件套的內容。

#### Scenario: 規格衝突時以 OpenSpec 為準

GIVEN execution-summary.md 中的描述與 proposal.md 或 specs/ 中的 Requirement 不一致
WHEN 未來 Agent 或人類讀取
THEN MUST 以 OpenSpec（proposal/design/specs）為準
AND execution-summary.md 只是執行記錄，不是規格來源

#### Scenario: 不得用 execution-summary 修改 Requirement

GIVEN execution-summary.md 中記載了某個 Requirement 因實作困難而未完成
WHEN 未來 Agent 讀取
THEN 該 Requirement 在 OpenSpec 中仍為未完成狀態
AND 必須透過正規 OpenSpec Change 流程修改 Requirement

---

### Requirement: Execution Summary 固定模板

Archive 階段產生的 execution-summary.md MUST 使用一致章節，避免遺漏長期必要資訊。

#### Scenario: 模板章節完整

GIVEN Codex 準備產生 execution-summary.md
WHEN 建立文件
THEN MUST 依序包含「實際完成內容與 Design 差異」、「主要修改檔案」、「驗證結果」、「接受的風險與理由」、「未完成項目」、「重要決策與取捨」、「Commit 建議」
AND 每個章節 MUST 從 CurrentState、Result Artifact 或 Evidence 提取
AND 不得以聊天紀錄補猜
