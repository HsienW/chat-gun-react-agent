## MODIFIED Requirements

### Requirement: Provider Capability Enforcement

Backend Runtime 的 Provider Capability MUST be enforced rather than informational。當 Provider 不支援特定能力時，MUST fail fast at model creation stage，SHALL NOT silently degrade。

#### Scenario: Tool calling capability 不足時 fail fast

- **GIVEN** 選定的 Provider 的 `supportsToolCalling` 為 `false`（如 CCR provider）
- **WHEN** Agent 嘗試呼叫 `bindTools` 建立工具綁定模型
- **THEN** 必須擲回明確錯誤，包含 Provider 名稱與缺少的能力
- **AND** 不得 silent skip 工具綁定導致後續 tool call 靜默失敗

#### Scenario: Structured output capability 不足時 fail fast

- **GIVEN** 選定的 Provider 的 `supportsStructuredOutput` 為 `false`
- **WHEN** Agent 在 `ChatModelOptions` 中傳入 `responseFormat: { type: "json_object" }`
- **THEN** 必須擲回明確錯誤，包含 Provider 名稱與缺少的能力
- **AND** 不得 silent skip response format 導致 LLM 回傳非 JSON

#### Scenario: 既有 Provider 成功路徑不受影響

- **GIVEN** Provider 的 capability 滿足 Agent 需求（如 Qwen 的 `supportsToolCalling: true`）
- **WHEN** Agent 呼叫 `bindTools` 或傳入 `responseFormat`
- **THEN** 既有行為保持不變，模型正常建立與呼叫

#### Scenario: Capability 不足錯誤包含診斷資訊

- **WHEN** Capability enforcement 觸發 error
- **THEN** error message 必須包含：provider name、缺少的 capability 名稱
- **AND** error 不得包含 API key 或 credential
- **AND** error 必須可被既有 `formatLlmError` / `createErrorEnvelope` 正確包裝

---

## ADDED Requirements

### Requirement: Error code 分類 MUST 來自結構化來源

Backend 的公開 error code MUST be determined from structured sources（HTTP status code、error name、cause code），SHALL NOT use error message regex matching 作為主要分類。

#### Scenario: 結構化來源優先決定 error code

- **GIVEN** Backend 收到 Provider HTTP 錯誤
- **WHEN** `inferErrorCode` 進行分類
- **THEN** 分類必須優先使用：statusCode（401→provider_auth_error、429→quota_or_rate_limit_exceeded 等）、error.name（AbortError→timeout）、error.cause.code
- **AND** 不得先以 `/timeout|network|fetch failed|connect|aborted/i` 正則匹配決定公開 code

#### Scenario: 無結構化來源時使用 unknown_error

- **GIVEN** Backend 收到無法從結構化來源分類的錯誤
- **WHEN** `inferErrorCode` 進行分類
- **THEN** 公開 error code 必須為 `unknown_error`
- **AND** error message 的文字內容僅作為 internal audit log 的 telemetry hint
- **AND** 不得因 message 包含 "timeout" 字樣就將 code 設為 timeout

#### Scenario: 既有 error code 保持不變

- **GIVEN** 既有 error code（`provider_auth_error`、`quota_or_rate_limit_exceeded`、`provider_unavailable` 等）
- **WHEN** 修改 `inferErrorCode` 的分類邏輯
- **THEN** 既有的 structure-driven code 不得更名或移除
- **AND** 只能新增 code，不得改變既有 code 的語意
