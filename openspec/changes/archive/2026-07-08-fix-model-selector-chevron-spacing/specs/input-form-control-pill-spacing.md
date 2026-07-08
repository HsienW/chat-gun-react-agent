# Spec: InputForm 控制 Pill 間距

## MODIFIED Requirements

### Requirement: 控制 Pill 左右內距對稱

InputForm 底部控制列中每個控制 pill（Agent、Effort、Model）MUST 具有對稱的左右 padding，使內部 SelectTrigger 的 chevron 箭頭與 pill 邊框之間保持充足間距，不產生視覺擠壓。

#### Scenario: Model selector chevron 不貼邊

GIVEN InputForm 已渲染且 Model 控制 pill 可見
WHEN 使用者檢視 Model selector 的 chevron 箭頭
THEN chevron 箭頭右緣與 pill 右邊框的間距 SHALL ≥ 8px
AND chevron 箭頭完整可見，不被 pill 邊框遮蔽或擠壓

#### Scenario: 三個控制 pill padding 一致

GIVEN InputForm 已渲染
AND Agent、Effort、Model 控制 pill 中至少一個可見
WHEN 比較各可見 pill 的 CSS computed padding
THEN 每個 pill 的左 padding 與右 padding SHALL 相等

#### Scenario: 窄螢幕控制列換行

GIVEN viewport 寬度 ≤ 375px
AND 控制列包含至少一個控制 pill
WHEN 控制 pill 總寬度超過可用空間
THEN 控制列 SHALL 換行顯示
AND chevron 箭頭 SHALL 保持完整可見，不與文字或相鄰元素重疊

#### Scenario: 長 model name 不破壞 layout

GIVEN Model selector 選取了 AVAILABLE_MODELS 中名稱最長的 model
WHEN 檢視 Model 控制 pill
THEN model name SHALL 在 SelectTrigger 寬度內 truncate（使用 CSS text-overflow）
AND chevron 箭頭 SHALL 保持完整可見，不被 truncation 推出觸發器範圍
