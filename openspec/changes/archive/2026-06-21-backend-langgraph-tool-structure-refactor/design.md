# Design：Backend LangGraph Tool Contract 通用強化

## 1. 現況分析

Backend 的查詢能力集中在 `deep-researcher.ts`（1837 行），其核心結構：

```text
DeepResearchState（14 個 Annotation）
  ├── messages: BaseMessage[]
  ├── contextPack: ImAgentContextPack
  ├── plan: ResearchPlan | undefined
  ├── searchResults → rankedSources → fetchedSources → extractedSources → verification
  ├── weatherExecution: WeatherExecutionState | undefined
  ├── imageObservations: string[]
  ├── uploadError: string | undefined
  └── initial_search_query_count, max_research_loops, reasoning_model
```

Graph 拓撲（10 個 node）：
```text
START → validateUploads → buildContextPack → analyzeImages → planResearch
  → routeAfterPlan →
    ├── targetedTools（weather/calculation）→ synthesizeAnswer → END
    ├── searchWeb → rankSources → fetchSources → extractEvidence → verifyCitations → synthesizeAnswer → END
    └── synthesizeAnswer（clarify/direct）→ END
```

現有隱含契約（尚未在 OpenSpec 中明確定義）：
- Plan 必須有 `answerMode`（`direct|weather|calculation|research|clarify`）。
- `targetedTools` node 中 tool 執行後以 structured parser 解析 output。
- `synthesizeAnswer` 在 LLM 失敗時 fallback 到 structured tool answer。
- `createPlannerFailureRoutingDecision` 使用 keyword matching（`includesAnyKeyword`）作為 Planner 失敗時的 fallback routing——這與 `weather.md` 及 `AGENTS.md` 禁止 keyword regex 的規則衝突。
- `inferErrorCode` 仍以 `/fetch failed|network|connect|timeout|aborted/i` regex 作為公開 error code 的兜底來源。

## 2. 設計目標與非目標

**目標：**
- 顯式化 Query Workflow 的 lifecycle、state transitions 與 terminal state 規則，不改變既有執行期行為。
- 強化 Tool 輸入/輸出的 Runtime Validation，確保 structured output 有 schema guard。
- 將 Provider Capability 從資訊型改為 enforcement gate。
- 降級 `inferErrorCode` 的 regex fallback 為 telemetry-only。
- 文件化 `AgentRuntimeEvent` 的 backend↔frontend 同步契約。

**非目標：**
- 不修改天氣功能、weather tool、地理解析。
- 不變更 Graph topology（不新增/移除 node 或 edge）。
- 不變更既有 `ResearchPlan` answer mode 的列舉值。
- 不修改 `useStream` callback signatures、BFF route、Tool Result schema。
- 不新增 Provider、不移除 MCP 能力。
- 不修改 MCP agent、chatbot、math-agent 的行為。
- 不做 production live provider 驗證。

## 3. 設計決策

### 決策 1：Query Workflow Invariant 定義

定義查詢工作流的通用 lifecycle，與具體 answer mode 無關：

```text
idle → running（plan 建立）→ executing（tool 或研究）→ synthesizing → done
```

Terminal state 規則（與 frontend Change 2 reducer 一致）：
- `done` 之後不得回到 `running`。
- Error path 收斂到 terminal（error message 或 fallback answer）。
- Cancel path 收斂到 terminal（cancelled message）。
- Late progress events 被 idempotently ignore。

此 invariant 文件化在 spec 中。本 Change 不修改程式碼中的 graph routing 邏輯，只文件化既有行為。**未來修改查詢 workflow 時必須先更新對應的 invariant spec。**

替代方案：
| 方案 | 結論 | 理由 |
|------|------|------|
| 不改 — 繼續依賴隱含行為 | 不採用 | 正是「改 A 壞 B」的根源 |
| 將 invariant 寫成程式碼驗證層 | 超出 scope | 本次只做文件化，不新增 runtime assertion |

### 決策 2：LangGraph State 欄位歸類

將 `DeepResearchState` 的 14 個 Annotation 歸類，明確每個欄位的擁有關係：

**通用查詢欄位：**
| 欄位 | Owner Node | Readers | Checkpoint |
|------|-----------|---------|------------|
| `messages` | ALL（reducer: concat） | ALL | 可序列化 |
| `plan` | `planResearch` | `routeAfterPlan`, `targetedTools`, `searchWeb`, `synthesizeAnswer` | 可序列化 |

**研究流程欄位：**
| 欄位 | Owner Node | Readers |
|------|-----------|---------|
| `contextPack` | `buildContextPack` | `planResearch` |
| `searchResults` | `searchWeb` | `rankSources` |
| `rankedSources` | `rankSources` | `fetchSources` |
| `fetchedSources` | `fetchSources` | `extractEvidence` |
| `extractedSources` | `extractEvidence` | `verifyCitations`, `synthesizeAnswer` |
| `verification` | `verifyCitations` | `synthesizeAnswer` |
| `initial_search_query_count` | 設定層 | `planResearch`, `searchWeb` |
| `max_research_loops` | 設定層 | `fetchSources` |

**領域擴充欄位（domain-specific extension）：**
| 欄位 | 領域 | Owner Node | Readers |
|------|------|-----------|---------|
| `weatherExecution` | 天氣 | `targetedTools` | `synthesizeAnswer`, `targetedTools` |
| `imageObservations` | 圖片 | `analyzeImages` | `planResearch`, `synthesizeAnswer` |
| `uploadError` | 上傳 | `validateUploads` | `routeAfterUploadValidation`, `synthesizeAnswer` |

**設定欄位：**
| 欄位 | 來源 |
|------|------|
| `reasoning_model` | Frontend submit payload |

此歸類文件化在 spec 中。程式碼不做變更。未來新增領域欄位時必須明確歸類為「領域擴充」，並定義 owner node 與 readers。

替代方案：
| 方案 | 結論 | 理由 |
|------|------|------|
| 拆分 State 為多個 sub-state | 不採用 | 需要修改 graph topology 與所有 node 簽名，破壞性過大 |
| 不做歸類 | 不採用 | 無法區分通用契約與領域擴充，回歸風險依舊 |

### 決策 3：Provider Capability Enforcement

現有 `LlmCapabilities`（`llm-gateway.ts:46-51`）已是 capability model，但目前僅作為 response metadata（`response_metadata.capabilities`），不強制執行。

變更：在 `OpenAiCompatibleChatModel` 的 `bindTools` 方法加入 enforcement：

```ts
bindTools(tools, kwargs) {
  if (!capabilities.supportsToolCalling) {
    throw new Error(
      `Provider ${provider} does not support tool calling. Use a provider with supportsToolCalling capability.`
    );
  }
  // 既有邏輯不變
}
```

在 `invoke` 方法加入 `responseFormat` enforcement：

```ts
async invoke(input) {
  if (this.options.responseFormat && !capabilities.supportsStructuredOutput) {
    throw new Error(
      `Provider ${provider} does not support structured output.`
    );
  }
  // 既有邏輯不變
}
```

CCR provider 的 `capabilitiesForProvider` 保持 `supportsToolCalling: false`、`supportsStructuredOutput: false`。這表示如果 CCR 被用於需要 tool calling 或 structured output 的場景，會 fail fast 而非 silent skip——這是預期的行為改善。

替代方案：
| 方案 | 結論 | 理由 |
|------|------|------|
| 保持現狀（資訊型） | 不採用 | Silent degradation 導致難以除錯 |
| 讓 CCR 支援 tool calling | 超出 scope | CCR 是 Anthropic Messages API，需要獨立的 tool use 實作 |

### 決策 4：Structured Output Validation 分級處理

定義三級處理流程。現有 `deep-researcher.ts` 的 `planResearch` 中的 try-catch + `parseJsonObjectWithDiagnostics` + `coercePlan` + `fallbackPlan` 已經是此模式的實現。本 Change 將其正規化為文件契約：

| 階段 | 觸發條件 | 行為 | Audit / Diagnostic |
|------|---------|------|-------------------|
| **Level 1: Parse** | JSON.parse 失敗、找不到 `{...}` | 重試一次（不超過 `maxRetries`） | 記錄 `parse_failed` diagnostic，含 responseContentLength |
| **Level 2: Schema** | JSON 正確但欄位不符合 schema | 嘗試 coerce/repair（如既有 `coercePlan`） | 記錄 `schema_rejected` diagnostic，含 plannerJson |
| **Level 3: Fallback** | 兩次都失敗或 LLM unavailable | 使用 deterministic fallback（如既有 `fallbackPlan`） | 記錄 `llm_unavailable` diagnostic |

Rules：
- Level 1 失敗 → retry once（已有 `maxRetries` 機制）。
- Level 2 失敗 → 嘗試 coercion（只接受安全欄位，拒絕 forbidden 欄位如 latitude/longitude）。
- Level 3 失敗 → fallback，不無限重試。
- 所有 path 的 terminal state 不得回到 running。

替代方案：
| 方案 | 結論 | 理由 |
|------|------|------|
| 只 catch 不 retry | 不採用 | 暫時性 JSON parse failure（如模型輸出截斷）可透過一次 retry 修復 |
| 無限 retry | 不採用 | 禁止；會造成無限 loop |

### 決策 5：Error Code 結構化

`backend/src/platform/errors.ts:108` 的 regex fallback：

```ts
if (/fetch failed|network|connect|timeout|aborted/i.test(message)) {
  return { code: "network_error" };
}
```

變更：此 regex 不再決定公開 error code。公開 error code 的分類順序改為：

1. `error.name === "AbortError"` → `"timeout"`
2. `statusCode`（401/403 → provider_auth_error, 429 → quota_or_rate_limit_exceeded, 400 → provider_request_validation_error, 5xx → provider_unavailable, 4xx → provider_http_error）
3. `error.cause.code` → 對應的結構化 code
4. 其他 → `"unknown_error"`

原有的 regex matching 僅用於 internal audit log（telemetry hint），不影響公開 error code。

替代方案：
| 方案 | 結論 | 理由 |
|------|------|------|
| 完全移除 regex | 不採用 | Regex 作為 telemetry 仍有 debug 價值 |
| 保留 regex 作為公開 code | 不採用 | 與 Change 3（BFF）的結構化契約不一致；`bff/AGENTS.md` 禁止 |

### 決策 6：AgentRuntimeEvent 同步契約

定義 backend ↔ frontend 的同步規則（文件契約，不修改程式碼）：

1. `AgentRuntimeEvent` type 的唯一事實來源在 backend（`backend/src/platform/agent-runtime-events.ts`）。
2. Frontend 的 `frontend/src/types/agent-runtime-events.ts` 必須與 backend 保持結構一致。
3. 新增 event type 時必須同時更新兩邊檔案。
4. Frontend 的 `agent.unknown` fallback（Change 2 已實作）保護未來新增 event type 時 frontend 不崩潰。
5. `AgentRuntimeEvent` 的 union 不得放寬成任意 string；closed union extension 使用明確 unknown variant（與 Change 2 frontend 策略一致）。

## 4. 分層變更

### Backend

- 文件化 Query Workflow Invariant（spec 層面，不修改程式碼）。
- 文件化 State 欄位歸類（spec 層面，不修改程式碼）。
- `backend/src/platform/llm-gateway.ts`：`bindTools` 與 structured output 的 enforcement gate。
- `backend/src/platform/errors.ts`：regex fallback 降級為 telemetry-only。
- 新增測試：provider capability enforcement、error code 結構化、query workflow terminal state。

### BFF

- 不修改 source。
- 確認 backend 新增的 error code 不破壞 BFF 既有 mapping（BFF 以 `inferCode` 類似邏輯運作，但 BFF 已有 Change 3 的結構化 `AbortReason`）。
- 確認 BFF 對 backend error envelope 的透傳不受影響。

### Frontend

- 不修改 source。
- 確認 `agent.unknown` fallback 正確處理未來新增的 event type。
- 確認 `classifyStreamError` 對未知 error code 的正確分類（Change 3）。

## 5. 風險與緩解

| 風險 | 緩解 |
|------|------|
| Capability enforcement 破壞 CCR provider 既有使用場景 | Enforcement 只在 `bindTools` 和 `responseFormat` 兩個方法。CCR 目前不支援這些路徑，fail fast 是行為改善而非回歸 |
| `inferErrorCode` regex 降級後，部分錯誤從 `network_error` 變成 `unknown_error` | `unknown_error` 有 safe message；audit log 保留 telemetry detail。BFF 與 frontend 均可正確處理 `unknown_error` |
| State 欄位歸類可能過於僵化 | 歸類是文件契約而非程式碼；新增領域擴充欄位時在 spec 中註冊即可 |
| Query Workflow Invariant 僅文件化，沒有 enforcement | 本 Change 的目標是顯式化契約而非新增 runtime assertion。後續 Change 可基於此 invariant 新增 enforcement |

## 6. 測試策略

新增 Backend 測試：

- **Provider capability enforcement**：CCR provider `bindTools` throw、`responseFormat` throw。
- **Error code 結構化**：regex pattern 不決定公開 code、結構化來源（statusCode/cause.code）正確分類。
- **Query workflow**：將既有 terminal state 行為記錄為 regression baseline。

不新增 Frontend / BFF 測試（source 未變更）。

## 7. Migration 與 Rollback

無 migration 需求（不變更 State schema、不變更 Graph topology、不變更 Checkpoint 格式）。

Rollback：
- Capability enforcement：回滾 `llm-gateway.ts` 的 enforcement gate。
- Error code：回滾 `errors.ts` 至既有 `inferCode` 行為。
- Query Workflow Invariant / State 歸類：純文件，不影響執行期。

## 8. 開放問題

1. **四個 agent（chatbot、math-agent、mcp-agent、deep-researcher）中哪些適用 Query Workflow Invariant？** 目前只有 deep-researcher 具備 plan→route→tool→synthesis 流程。其他三個 agent 行為不同。Design 以 deep-researcher 為參考但不強制套用到其他 agent。

2. **`AgentRuntimeEvent` backend↔frontend 同步是否需要 shared type package？** 此 Change 不引入 shared package。手動同步加上 spec 規範已足夠。若未來 type drift 頻繁發生，可在後續 Change 評估 shared types 方案。

3. **既有的 `createPlannerFailureRoutingDecision` keyword matching 是否應在本 Change 移除？** 這是 Planner 失敗時的 fallback，不影響 Planner 成功路徑。移除它需要確保 Planner 不會在 production 中高頻率失敗。此議題不在本 Change scope，建議另開 change 處理。
