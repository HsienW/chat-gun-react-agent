# Tasks: fix-model-selector-chevron-spacing

## Task 1：在 controlClass 加入 pr-2

**需求對應**：MODIFIED Requirements — InputForm 控制 pill 左右 padding 對稱

- [ ] 在 `frontend/src/components/InputForm.tsx` 的 `controlClass` 字串中加入 `pr-2`
- [ ] 不變更任何其他 class、邏輯或 JSX

**驗證**：
```bash
cd frontend
npm run lint
npm run build
```
瀏覽器 DevTools 檢查 chevron icon 右緣到 pill border 的 spacing ≥ 12px。

---

## Task 2：確認三個控制 pill 視覺一致性

**需求對應**：MODIFIED Requirements — Agent、Effort、Model 控制列高度、左右 padding、間距一致

- [ ] 桌面 viewport（≥1024px）下檢查 Agent、Effort、Model 三個 pill 的左右 padding 對稱
- [ ] 確認 chevron 箭頭在所有可見 pill 中都不貼邊

**驗證**：DevTools computed padding 比較，截圖確認。

---

## Task 3：窄螢幕換行與 chevron 空間驗證

**需求對應**：MODIFIED Requirements — 窄螢幕下控制列可正常換行，不發生文字與 chevron 重疊

- [ ] 使用 Chrome DevTools 模擬 375px viewport（iPhone SE）
- [ ] 確認控制列 pill 正確換行
- [ ] 確認 text truncation（長 model name）與 chevron 不重疊

**驗證**：375px viewport 截圖，chevron 完整可見。

---

## Task 4：既有功能回歸驗證

**需求對應**：驗證無回歸

- [ ] 執行完整 frontend 驗證：`npm run lint && npm run test && npm run build`
- [ ] 手動提交一次對話，確認 model 選擇與提交正常運作

**驗證**：CLI 全部通過，提交 payload 中 model 參數正確。
