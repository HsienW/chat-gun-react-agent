# Proposal: fix-model-selector-chevron-spacing

## 問題描述

`InputForm` 底部控制列中，Model 下拉選單（SelectTrigger）的 chevron／下拉箭頭區域視覺上太靠近外層控制 pill 的右邊框，形成擠壓感。

根因：控制 pill 的 `controlClass` 僅設定 `pl-2`（左 padding），缺少右側 padding（無 `pr-2`）。Model SelectTrigger 又設為 `bg-transparent` + `border-none`，chevron 右側的間距僅來自 Radix `SelectPrimitive.Trigger` 基礎樣式中的 `px-3`。在透明 trigger 與無外層 pill 右內距的組合下，chevron 箭頭幾乎貼近 pill 邊框。

Agent 與 Effort selector 使用相同的 `controlClass` 與透明 SelectTrigger，因此存在相同潛在問題，但 Model selector 永遠顯示，最為明顯。

## 解決方案

在 `controlClass` 加入 `pr-2`，使控制 pill 左右 padding 對稱（`pl-2 pr-2`）。這是最小、最安全的修改，不需要變更共用 UI 元件（`select.tsx`），也不會影響 SelectTrigger 在其他場景的使用。

若 `pr-2` 加入後對最長 model name 仍顯擁擠，可在後續微調中處理 SelectTrigger 寬度（如 `min-w-[150px]`），但不作為本次必要變更。

## 目標

- Model chevron 箭頭右側與 pill 邊框之間有充足間距，不再貼邊。
- Agent、Effort、Model 三個控制 pill 的左右 padding 一致。
- 窄螢幕下控制列可正常換行，chevron 不重疊或隱藏。
- 長 model name 在 trigger 內 truncate，chevron 保持完整可見。

## 非目標

- 不改變 model id、提交 payload、下拉選單行為或資料流。
- 不修改 `SelectContent`、`SelectItem` 或其他 Radix 行為。
- 不修改共用 UI 元件 `select.tsx`。
- 不觸及 backend、bff、MCP、LangGraph 或模型 contract。

## 受影響套件與能力域

| 套件 | 影響 |
|------|------|
| frontend | `src/components/InputForm.tsx`：`controlClass` 樣式 |

無跨層影響。

## 風險

| 風險 | 嚴重度 | 緩解 |
|------|--------|------|
| `pr-2` 造成窄螢幕下 pill 過寬，內容擠出 | Low | 外層已設 `flex-wrap` 與 `max-w-[100%]`，pill 會自然換行 |
| `pr-2` 後仍感擁擠，需調整 SelectTrigger 寬度 | Low | 可在後續微調中處理，非 blocker |

## 回滾策略

還原 `controlClass` 至修改前的字串值即可。
