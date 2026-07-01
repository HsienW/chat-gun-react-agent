# weather-golden-eval (Phase 3 Update)

## MODIFIED Requirements

### Requirement: Multi-turn clarification cases transition from known gap to passing

Phase 1 baseline 中的 `WGE-MULTITURN-CANDIDATE-KNOWN-GAP` 與所有多輪澄清相關 known gap cases MUST 轉為 passing。

#### Scenario: Candidate selection by index passes

- **GIVEN** 使用 deterministic mock 模擬 ambiguous location → interrupt → 使用者回覆「第二個」
- **WHEN** golden eval matrix 執行 `clarification-candidate-index` case
- **THEN** result classification MUST be `pass`
- **AND** MUST NOT be `known_gap` or `fail`

#### Scenario: Region supplement passes

- **GIVEN** 使用 deterministic mock 模擬 ambiguous location → interrupt → 使用者回覆「Illinois」
- **WHEN** golden eval matrix 執行 `clarification-region-supplement` case
- **THEN** result classification MUST be `pass`

#### Scenario: Location change during clarification passes

- **GIVEN** 使用 deterministic mock 模擬 ambiguous location → interrupt → 使用者回覆「換高雄」
- **WHEN** golden eval matrix 執行 `clarification-location-change` case
- **THEN** result classification MUST be `pass`

#### Scenario: Cancel during clarification passes

- **GIVEN** 使用 deterministic mock 模擬 ambiguous location → interrupt → 使用者取消
- **WHEN** golden eval matrix 執行 `clarification-cancel` case
- **THEN** result classification MUST be `pass`
- **AND** terminal state MUST be `cancelled`

### Requirement: Existing Phase 1 and Phase 2 cases remain passing

所有 Phase 1 與 Phase 2 的 current weather 與 forecast golden cases MUST 維持 `pass`，不得回歸。

#### Scenario: Current weather regression

- **GIVEN** Phase 1 baseline 中所有 `pass` cases
- **WHEN** golden eval matrix 執行 after Phase 3 implementation
- **THEN** all previously-passing cases MUST still be `pass`

#### Scenario: Forecast regression

- **GIVEN** Phase 2 forecast cases（daily success、hourly success 等）
- **WHEN** golden eval matrix 執行 after Phase 3 implementation
- **THEN** all forecast cases MUST still be `pass`

### Requirement: Golden eval matrix includes clarification cases

Golden eval matrix MUST 新增多輪澄清的 deterministic 與 mock integration cases。

#### Scenario: New clarification cases in matrix

- **GIVEN** weather-clarification-workflow 實作完成
- **WHEN** golden eval matrix 被更新
- **THEN** MUST 至少包含以下 cases：
  - `clarification-candidate-index`：候選編號選擇（deterministic）
  - `clarification-region-supplement`：補充國家／區域（deterministic）
  - `clarification-location-change`：更換地點（deterministic）
  - `clarification-cancel`：取消澄清（deterministic）
  - `clarification-unrecognizable-reply`：無法辨識的回覆（deterministic）
  - `clarification-ambiguous-forecast`：ambiguous forecast 多輪澄清（mock integration）
- **AND** 每個 case MUST 有 `case id`、`mode`、`capability category`、`expected outcome`、`result classification`

#### Scenario: Baseline report updated

- **GIVEN** golden eval cases 已更新
- **WHEN** baseline report 重新產出
- **THEN** `WGE-MULTITURN-CANDIDATE-KNOWN-GAP` MUST 從 `known_gap` 轉為 `pass`
- **AND** summary stats MUST 反映 Phase 3 known gap 已關閉
- **AND** report MUST NOT 包含 API key、credential、完整 prompt 或 raw provider body

### Requirement: Relationship invariants preserved

多輪澄清 MUST 維持 Phase 1 定義的關係型不變量。

#### Scenario: Candidate selection preserves geographic invariants

- **GIVEN** `台北` 與 `臺北` 在 Phase 1 中被驗證為相容地理實體
- **WHEN** clarification workflow 中候選包含台北時
- **THEN** `台北` 與 `臺北` 的候選 MUST 指向相同或等價的 provider candidate

#### Scenario: Clarification error not confused with not_found

- **GIVEN** clarification workflow 中的 provider error
- **WHEN** error 被傳遞
- **THEN** MUST NOT 被 mapping 為 `not_found`
- **AND** MUST NOT 觸發 interrupt（應直接 terminal error）
