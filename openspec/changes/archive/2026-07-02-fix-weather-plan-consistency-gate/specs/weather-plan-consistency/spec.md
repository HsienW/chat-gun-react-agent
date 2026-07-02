# Spec：Weather Plan Consistency Gate

## MODIFIED Requirements

### Requirement: Planner Output Routing
Planner 結構化輸出中的 `answerMode` 與 `weather` 欄位組合 MUST 由 Consistency Gate 正規化後，才進行 Graph 路由決策。

#### Scenario: 矛盾 Plan 正規化（有 location 但 clarify）
- **GIVEN** Main Planner 回傳 `answerMode = "clarify"` 且 `weather.location` 為非空有效字串
- **WHEN** `coercePlan` 處理此輸出
- **THEN** `answerMode` MUST 被正規化為 `"weather"`
- **AND** `clarification` MUST 被設為 `undefined`
- **AND** 此正規化 MUST NOT 增加任何 LLM Call
- **AND** `routeAfterPlan` MUST 回傳 `"targeted_tools"`

#### Scenario: 合法 Weather Plan 不受影響
- **GIVEN** Main Planner 回傳 `answerMode = "weather"` 且 `weather.location` 為非空有效字串
- **WHEN** `coercePlan` 處理此輸出
- **THEN** `answerMode` MUST 保持 `"weather"`
- **AND** `weather` 欄位 MUST 保持不變

#### Scenario: 缺少 Location 的 Weather Plan 保持 Clarify
- **GIVEN** Main Planner 回傳 `answerMode = "weather"` 但 `weather.location` 為空或不存在
- **WHEN** `coercePlan` 處理此輸出
- **THEN** 最終 `answerMode` MUST 為 `"clarify"`
- **AND** `missingWeatherLocationPlan` 守衛 MUST 觸發

#### Scenario: 真正 Clarify 不受影響
- **GIVEN** Main Planner 回傳 `answerMode = "clarify"` 且 `weather` 為 `undefined` 或 `weather.location` 為空
- **WHEN** `coercePlan` 處理此輸出
- **THEN** `answerMode` MUST 保持 `"clarify"`
- **AND** Consistency Gate MUST NOT 誤觸發

#### Scenario: 非 Weather Mode 不受影響
- **GIVEN** Main Planner 回傳 `answerMode = "direct"` 或 `"research"` 或 `"calculation"`
- **WHEN** `coercePlan` 處理此輸出
- **THEN** `answerMode` MUST 保持原值
- **AND** Consistency Gate MUST NOT 改變任何欄位

---

### Requirement: Weather Tool Invocation
當 `answerMode` 被正規化為 `"weather"` 後，Graph MUST 進入 `targeted_tools` 節點並執行 Weather Tool。

#### Scenario: 矛盾 Plan 最終進入 Weather Tool
- **GIVEN** Consistency Gate 已將 `answerMode` 正規化為 `"weather"`
- **WHEN** Graph 執行路由
- **THEN** `routeAfterPlan` MUST 回傳 `"targeted_tools"`
- **AND** `targetedTools` MUST 呼叫 Weather Tool 至少一次
- **AND** `weatherExecution.status` MUST 不為 `undefined`

#### Scenario: Weather Tool 成功後進入 Synthesis
- **GIVEN** Weather Tool 回傳 `status = "success"`
- **WHEN** Graph 執行路由
- **THEN** `routeAfterTargetedTools` MUST 回傳 `"synthesize"`
- **AND** `weatherExecution.status` MUST 為 `"success"`

#### Scenario: Weather Tool 回傳 Provider Ambiguity
- **GIVEN** Weather Tool 回傳 `status = "needs_clarification"` 且有 >= 2 個合法候選
- **WHEN** Graph 執行路由
- **THEN** `routeAfterTargetedTools` MUST 回傳 `"clarify_interrupt"`
- **AND** Clarification interrupt payload MUST 包含候選清單

#### Scenario: Country 不足以解除同國行政區歧義
- **GIVEN** query含 country但不含 region
- **AND** queryName取得多個分數接近、同國但行政區不同的 Provider候選
- **WHEN** Resolver評估候選
- **THEN** Resolver MUST 回傳 `ambiguous`
- **AND** Weather Tool MUST 回傳 `needs_clarification`
- **AND** Resolver MUST NOT 因 queryName存在而自動選擇第一候選

---

### Requirement: Bounded Extraction 上限
對缺少 location 的 Weather Intent，Bounded Extraction MUST 每個 Graph Run 最多執行一次。

#### Scenario: Planner 提前 Clarify 後 Bounded Extraction 觸發
- **GIVEN** Main Planner 回傳 `answerMode = "clarify"` 且無有效 `weather.location`
- **AND** deterministic routing policy 判定為 Weather Intent
- **WHEN** `shouldRetryWeatherPlannerExtraction` 回傳 `true`
- **THEN** `retryWeatherPlannerExtraction` MUST 被呼叫一次
- **AND** 若 extraction 找到 location，`answerMode` MUST 變為 `"weather"`
- **AND** 若 extraction 未找到 location，`answerMode` MUST 保持 `"clarify"`
- **AND** 不得遞迴呼叫 bounded extraction

#### Scenario: 完全無地點時不進入 Weather Tool
- **GIVEN** 使用者輸入不包含任何地點名稱
- **AND** Bounded Extraction 未找到 location
- **WHEN** Graph 執行路由
- **THEN** `answerMode` MUST 為 `"clarify"`
- **AND** Weather Tool invocation count MUST 為 0

---

## ADDED Requirements

### Requirement: Weather Plan Consistency Gate
系統 MUST 在 `coercePlan` 正規化階段，以純函式偵測並修正 Planner 的矛盾輸出。

#### Scenario: Gate 為純函式
- **GIVEN** 任何 `answerMode` 與 `WeatherRequest | undefined` 的組合
- **WHEN** `normalizeWeatherPlanConsistency` 被呼叫
- **THEN** 函式 MUST 為 pure（相同輸入→相同輸出）
- **AND** 函式 MUST NOT 進行任何 I/O、LLM Call 或非確定運算
- **AND** 函式 MUST NOT 拋出例外

#### Scenario: Gate 對所有 Plan 來源一致
- **GIVEN** Plan 來源為 Main Planner、fallbackPlan、bounded extraction 或 resumeClarify
- **WHEN** `coercePlan` 處理該 Plan
- **THEN** Consistency Gate MUST 對所有來源套用相同邏輯
- **AND** 不得因來源不同而有不同行為

---

### Requirement: Non-Weather Query Isolation
非天氣查詢 MUST NOT 因 Consistency Gate 而誤觸發 Weather Tool。

#### Scenario: 非天氣問題不觸發 Weather Tool
- **GIVEN** 使用者輸入為非天氣意圖（例如「介紹一下大寮的歷史」）
- **AND** Main Planner 正確回傳 `answerMode = "research"` 且無 `weather` 欄位
- **WHEN** `coercePlan` 處理此輸出
- **THEN** `answerMode` MUST 保持 `"research"`
- **AND** Weather Tool invocation count MUST 為 0

#### Scenario: 非天氣問題附帶 weather 欄位
- **GIVEN** 使用者輸入為非天氣意圖
- **AND** Main Planner 回傳 `answerMode = "research"` 但附帶無效的 `weather` 欄位（location 為空）
- **WHEN** `coercePlan` 處理此輸出
- **THEN** Consistency Gate MUST NOT 正規化為 `"weather"`
- **AND** `answerMode` MUST 保持 `"research"`

---

### Requirement: Provider Capability Compatibility
JSON 型 Planner 路徑 MUST 依 configured provider capability 選擇 native structured
output 或 prompt-driven JSON，且兩種模式都 MUST 經過相同 Runtime Validation。

#### Scenario: Provider 支援 Native Structured Output
- **GIVEN** configured provider 的 `supportsStructuredOutput = true`
- **WHEN** Deep Researcher 建立 JSON 型 research model
- **THEN** model options MUST 包含 `responseFormat = {"type":"json_object"}`
- **AND** model output MUST 經過既有 parser 與 coercion

#### Scenario: Provider 不支援 Native Structured Output
- **GIVEN** configured provider 的 `supportsStructuredOutput = false`
- **WHEN** Deep Researcher 建立 JSON 型 research model
- **THEN** model options MUST NOT 包含 unsupported `responseFormat`
- **AND** Prompt MUST 仍要求只回傳 JSON
- **AND** model output MUST 經過既有 parser 與 coercion
- **AND** Planner MUST NOT 因 unsupported native capability 在 request 前直接失敗

#### Scenario: CCR Adapter 保持 Fail Fast
- **GIVEN** 呼叫者直接要求 CCR `anthropic-messages` 使用 native `responseFormat`
- **WHEN** `CcrGateway.createChatModel` 驗證 capability
- **THEN** Gateway MUST 維持 fail-fast
- **AND** Agent MUST 透過 capability accessor 避免送入不相容 options
