# Spec：Opik Evaluation Pipeline

## ADDED Requirements

### Requirement: Dataset 建立與版本管理

系統 MUST 支援從既有的 golden case 建立 versioned Opik dataset。Dataset MUST 有明確的 version identifier。

#### Scenario: 從 weather golden case 建立 dataset

- **GIVEN** `backend/src/tools/weather-golden-eval.ts` 中存在已核准的 weather golden case
- **WHEN** 執行 dataset creation script
- **THEN** 在 Opik 中建立名為 `weather-golden` 的 dataset
- **AND** Dataset version 設為 `v1.0.0`（或指定的 semver）
- **AND** 每個 dataset item 包含：id、input（redacted）、expected tool calls、metadata

#### Scenario: Dataset version 不可變

- **GIVEN** Dataset `weather-golden` version `v1.0.0` 已存在
- **WHEN** 嘗試以相同 version 再次建立
- **THEN** 操作被拒絕並回傳錯誤，要求指定新的 version identifier
- **AND** 不覆蓋既有 `v1.0.0` 資料

#### Scenario: Dataset item 不包含 raw prompt 或 PII

- **GIVEN** Golden case 包含完整 conversation history
- **WHEN** Dataset item 被建立
- **THEN** Dataset input 僅保留 structured intent/parameters（非 raw prompt）
- **AND** 不包含 API key、token、PII
- **AND** 若原始資料含有 PII，redaction 在 dataset creation 時執行（非 export 時）

---

### Requirement: Deterministic Metric：Tool Call Correctness

系統 MUST 提供至少一個 deterministic metric，檢查 agent 是否呼叫了預期的 tool 與 arguments。

#### Scenario: Tool call 完全符合預期

- **GIVEN** Dataset item 的 expected tool call 為 `get_weather(city="Tokyo")`
- **WHEN** Agent 執行結果為 `get_weather(city="Tokyo")`
- **THEN** `tool_call_correctness` score = 1.0
- **AND** Reason 為 "Tool call matches expected"

#### Scenario: Tool call 不符合預期

- **GIVEN** Dataset item 的 expected tool call 為 `get_weather(city="Tokyo")`
- **WHEN** Agent 執行結果為 `get_weather(city="Osaka")`
- **THEN** `tool_call_correctness` score < 1.0（partial match）
- **AND** Reason 說明差異（城市不符）

#### Scenario: Agent 未呼叫任何 tool

- **GIVEN** Dataset item 預期至少一個 tool call
- **WHEN** Agent 執行結果沒有任何 tool call
- **THEN** `tool_call_correctness` score = 0.0
- **AND** Reason 為 "No tool calls executed"

---

### Requirement: LLM-as-Judge Metric：Response Quality

系統 MUST 提供一個 bounded LLM-as-judge metric，用於評估 agent response 品質。Judge 配置 MUST be versioned 且 temperature MUST be 0。

#### Scenario: Judge 評估高品質回應

- **GIVEN** Judge config 為 `{ model: "gpt-4o-mini", temperature: 0, promptTemplate: "rate response quality 1-5..." }`
- **WHEN** Agent response 完整且正確地回答使用者問題
- **THEN** `response_quality` score >= 0.8
- **AND** Judge 輸出包含 reasoning

#### Scenario: Judge 評估低品質回應

- **GIVEN** 同上 judge config
- **WHEN** Agent response 內容不相關或包含幻覺資訊
- **THEN** `response_quality` score < 0.5
- **AND** Judge 輸出包含 reasoning 指出問題點

#### Scenario: Judge 不可變性

- **GIVEN** Experiment config 指定 judge prompt template version `v1`
- **WHEN** 執行 experiment
- **THEN** 使用的 judge prompt 必須為 `v1` 版本內容
- **AND** Judge model temperature = 0（不可變）
- **AND** Experiment result 記錄 judge config（model、prompt version、timestamp）

#### Scenario: LLM judge 失敗應優雅降級

- **GIVEN** Judge model API 無法連線或回傳格式錯誤
- **WHEN** 執行 evaluation
- **THEN** 該 metric 標記為 `FAILED` 而非 crash
- **AND** Evaluation 繼續執行其他 metric
- **AND** Experiment result 記錄 judge failure reason

---

### Requirement: Experiment 可重現性

Experiment MUST 在相同 dataset version + agent config 條件下產生可比較的結果。Deterministic metric（如 tool_call_correctness）MUST 在相同輸入下產生完全一致的 score；stochastic metric（如 LLM-as-judge response_quality）MUST 記錄 judge model 與溫度，其 score 為 single-run snapshot 而非絕對值。

#### Scenario: Deterministic metric 必須完全一致

- **GIVEN** Dataset version `v1.0.0` + agent config `{ model: "gpt-4o-mini" }`
- **WHEN** 執行兩次 experiment
- **THEN** `tool_call_correctness` score 兩次完全一致（相同輸入 → 相同輸出）
- **AND** 若不一致，判定為 agent 行為變更而非 metric 誤差

#### Scenario: Stochastic metric 記錄為 single-run snapshot

- **GIVEN** Dataset version `v1.0.0` + agent config `{ model: "gpt-4o-mini" }` + judge config `{ temperature: 0 }`
- **WHEN** 執行兩次 experiment
- **THEN** `response_quality` score 記錄為 single-run snapshot
- **AND** Experiment result 標註此 metric 為 stochastic（LLM-as-judge），非絕對值
- **AND** 兩次 experiment 可分別在 Opik UI 中檢視比較

#### Scenario: 不同 model 可比較

- **GIVEN** Dataset version `v1.0.0`
- **WHEN** 以 agent config A（model: "gpt-4o-mini"）與 agent config B（model: "qwen-plus"）各執行一次 experiment
- **THEN** 兩次 experiment 的 metric scores 可在 Opik UI 中並排比較
- **AND** 可比較 trace hierarchy、token 用量、latency 差異

#### Scenario: Experiment 記錄完整 config

- **GIVEN** 執行一次 experiment
- **WHEN** Experiment 完成
- **THEN** Experiment result 包含：
  - dataset name + version
  - agent model + provider
  - prompt version（若有）
  - judge model + temperature + prompt version
  - 每個 metric 的 score + reason
  - 所有關聯的 Opik trace IDs
  - timestamp

---

### Requirement: Trace-backed Evaluation

Evaluation metric scores MUST 關聯至對應的 Opik traces，使評估結果可追溯至特定 agent run。

#### Scenario: Metric score 寫入 Opik trace

- **GIVEN** 執行一次 evaluation experiment
- **WHEN** 每個 dataset item 的 agent run 完成且 metric 計算完成
- **THEN** Metric score 作為 feedback 寫入該 agent run 的 Opik trace
- **AND** Feedback 包含 metric name、score value、reason

#### Scenario: 無 Opik 時仍可計算 metric

- **GIVEN** `OPIK_ENABLED=false`
- **WHEN** 執行 evaluation（僅計算 metric，不建立 trace）
- **THEN** Deterministic metric 仍正確計算
- **AND** Metric scores 輸出為結構化 JSON 至 `{OPIK_EVAL_OUTPUT_DIR:-./eval-results}/experiment-{timestamp}.json`
- **AND** JSON 格式包含：experimentId、datasetVersion、agentConfig、metrics（name + score + reason）、timestamp
- **AND** Console 輸出 human-readable summary（非原始 JSON）
