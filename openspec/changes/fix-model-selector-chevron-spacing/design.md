# Design: fix-model-selector-chevron-spacing

## 責任邊界

本變更僅涉及 frontend 層的 CSS/layout 調整，不涉及任何行為、狀態、事件或資料流變更。

```text
frontend（InputForm.tsx controlClass）
  → 無 bff 變更
  → 無 backend 變更
```

## 變更點

### frontend/src/components/InputForm.tsx

**`controlClass`（line 246-247）**

現狀：
```
flex flex-row gap-2 bg-card/90 border border-border text-[#E7D9C1] rounded-xl rounded-t-sm pl-2 max-w-[100%] sm:max-w-[90%] shadow-sm
```

變更後：
```
flex flex-row gap-2 bg-card/90 border border-border text-[#E7D9C1] rounded-xl rounded-t-sm pl-2 pr-2 max-w-[100%] sm:max-w-[90%] shadow-sm
```

差異：加入 `pr-2`。

理由：
- 控制 pill 左右內距對稱，SelectTrigger 右側自然與 pill 邊框保持 `pr-2`（8px）間距。
- SelectTrigger 本身的 `px-3`（12px）繼續提供 trigger 內部 padding，chevron 位於 trigger 右側內部，與 pill 邊框合計約 20px 間距，視覺上不再擠壓。
- Agent、Effort、Model 三個 pill 共用 `controlClass`，一致性同時受益。

### 不變更的檔案

- **`frontend/src/components/ui/select.tsx`**：SelectTrigger 基礎樣式（`px-3`、`gap-2`、chevron 固定渲染）屬共用元件，不應為此單一使用情境變更，避免影響其他 Select 使用處。
- **所有非 frontend 檔案**：無關。

## 資料流

無變化。Model value、effort、agentId、onSubmit payload 保持不變。

## 替代方案評估

| 方案 | 評估 |
|------|------|
| A. 在 `controlClass` 加入 `pr-2`（選用） | 最小變更，一次解決三個 pill，左右對稱 |
| B. 僅在 Model SelectTrigger 加入 `pr-1` | 只修 Model，Agent/Effort 仍不對稱；治標不治本 |
| C. 在 `select.tsx` 中為所有 SelectTrigger 增加 padding | 影響所有 Select 使用處，風險過大 |

選擇方案 A。
