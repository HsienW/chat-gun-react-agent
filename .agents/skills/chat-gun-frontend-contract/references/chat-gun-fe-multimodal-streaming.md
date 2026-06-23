---
name: chat-gun-fe-multimodal-streaming
description: 通用多模態流式上下行鏈路處理，涵蓋深度思考、文字生成、視覺理解、圖片生成、影片生成、語音模型的流式 I/O 抽象。Weather 視為其中一種 domain-specific 實作。
---

# 通用多模態流式鏈路處理

## 使用時機

當需要處理或擴充下列任一多模態能力時使用本 Skill：

- 深度思考（Thinking / Reasoning）流式輸出。
- 文字生成（Text Generation）串流。
- 視覺理解（Vision）圖片輸入 + 文字輸出。
- 圖片生成（Image Generation）非同步結果。
- 影片生成（Video Generation）長時間任務 + 進度更新。
- 語音模型（Audio / TTS / STT）串流音訊。
- 任何新的 Tool 或 Provider 的結構化流式結果。

## 強制前置條件

依序讀取：

1. `frontend/src/types/agent-runtime-events.ts` - 事件型別。
2. `frontend/src/lib/agent-runtime-events.ts` - 事件 adapter。
3. `backend/src/tools/weather-types.ts` - 參考：discriminated union 模式。
4. `frontend/src/types/weather.ts` - 參考：前端 runtime parser 模式。
5. `frontend/src/components/ToolMessageDisplay.tsx` - Tool 渲染委派。
6. `backend/src/platform/agent-runtime-events.ts` - Backend 事件。
7. `frontend/AGENTS.md` §5 §6 - 串流與 Tool 渲染規則。

## 核心抽象

### MultimodalStreamDescriptor

定義每種多模態能力的元資料：

```ts
type ModalityType =
  | 'text-generation'
  | 'deep-thinking'
  | 'vision-understanding'
  | 'image-generation'
  | 'video-generation'
  | 'audio-processing'
  | 'structured-tool';

type MultimodalStreamDescriptor<TInput, TOutput> = {
  /** 唯一識別 */
  modality: ModalityType;
  /** 輸入型別 */
  inputSchema: TInput;
  /** 最終輸出的結構化結果型別 */
  outputSchema: TOutput;
  /** 串流中間產出的 chunk 型別 */
  streamChunkType?: string;
  /** 是否支援串流輸出 */
  supportsStreaming: boolean;
  /** 是否為非同步長任務 */
  isAsync: boolean;
  /** 預估延遲（用於 UI 降級策略） */
  estimatedLatencyMs?: number;
};
```

### 通用執行狀態

```ts
type ExecutionStatus<TOutput> =
  | { status: 'idle' }
  | { status: 'running'; startedAt: number }
  | { status: 'streaming'; progress?: number; partialResult?: unknown }
  | { status: 'success'; result: TOutput; completedAt: number }
  | { status: 'needs_clarification'; result: TOutput }
  | { status: 'error'; code: string; retryable: boolean; message: string }
  | { status: 'timeout' }
  | { status: 'cancelled' }
  | { status: 'unknown'; raw?: unknown };
```

### 通用結果型別（Discriminated Union）

```ts
type MultimodalResult<TStatus extends string, TData = unknown> = {
  schemaVersion: string;
  tool: string;
  status: TStatus;
  summary: string;
} & TData;
```

各領域實作只需擴展 `TData`：

```ts
// Weather 實作
type WeatherSuccessData = {
  requestedLocation: LocationQuery;
  resolvedLocation: LocationCandidate;
  current: WeatherCurrentData;
  // ...
};

type WeatherResult = MultimodalResult<
  'success' | 'needs_clarification' | 'not_found' | 'error',
  WeatherSuccessData
>;

// 圖片生成實作（未來）
type ImageGenSuccessData = {
  imageUrl: string;
  width: number;
  height: number;
  model: string;
};

type ImageGenResult = MultimodalResult<
  'success' | 'error' | 'timeout',
  ImageGenSuccessData
>;
```

## 流式上行鏈路（Input → Backend）

### 輸入正規化

所有多模態輸入必須經過：

1. **型別驗證**：Runtime Schema Validation。
2. **正規化**：Trim、Unicode 正規化、空值處理。
3. **結構化**：轉換為 Domain Type，不保留原始 Transport 格式。

```ts
function normalizeInput<TInput>(
  raw: unknown,
  validator: (input: unknown) => TInput | null
): { ok: true; value: TInput } | { ok: false; error: string } {
  const result = validator(raw);
  if (!result) return { ok: false, error: 'Invalid input' };
  return { ok: true, value: result };
}
```

### 輸入型別範本

| 模態 | 輸入型別 | 特殊處理 |
| --- | --- | --- |
| 文字生成 | `{ prompt: string; systemPrompt?: string }` | 長度限制 |
| 深度思考 | `{ prompt: string; effort: 'low' \| 'medium' \| 'high' }` | effort 映射 |
| 視覺理解 | `{ prompt: string; images: ImageAttachment[] }` | 圖片大小驗證 |
| 圖片生成 | `{ prompt: string; size?: ImageSize; style?: string }` | 尺寸白名單 |
| 影片生成 | `{ prompt: string; duration?: number }` | 長時間任務 |
| 語音模型 | `{ audio: ArrayBuffer; format: AudioFormat }` | 格式驗證 |

## 流式下行鏈路（Backend → UI）

### 事件映射

每種模態的後端輸出必須映射為 `AgentRuntimeEvent`：

| 模態 | 事件序列 |
| --- | --- |
| 文字生成 | `agent.answer.stream` (delta chunks) |
| 深度思考 | `agent.plan.start` → `agent.answer.stream` |
| 視覺理解 | `agent.tool.start` → `agent.tool.success` (structured) |
| 圖片生成 | `agent.tool.start` → `agent.card.emit` (image URL) |
| 影片生成 | `agent.tool.start` → `agent.card.emit` (progress) → `agent.card.emit` (result) |
| 語音模型 | `agent.tool.start` → `agent.card.emit` (audio chunks) |

### 前端渲染策略

```ts
type RenderStrategy<TOutput> = {
  /** 執行中：顯示進度或骨架 */
  renderRunning: () => ReactNode;
  /** 串流中：顯示部分結果 */
  renderStreaming?: (partial: unknown) => ReactNode;
  /** 成功：顯示結構化結果 */
  renderSuccess: (result: TOutput) => ReactNode;
  /** 需澄清：顯示互動提示 */
  renderClarification?: (result: TOutput) => ReactNode;
  /** 錯誤：顯示降級訊息 */
  renderError: (error: { code: string; message: string }) => ReactNode;
  /** 未知：顯示通用降級 */
  renderUnknown: (raw: unknown) => ReactNode;
};
```

## Weather 作為 Domain-Specific 實作

Weather 是本架構的第一個實作案例：

```text
MultimodalStreamDescriptor<LocationQuery, WeatherToolResult>
  ↓
ExecutionStatus<WeatherToolResult>
  ↓
WeatherToolResult = MultimodalResult<'success' | 'needs_clarification' | 'not_found' | 'error', WeatherSuccessData>
  ↓
RenderStrategy<WeatherToolResult>
  → WeatherToolResultCard (6 種狀態渲染)
```

未來新增圖片生成時：

```text
MultimodalStreamDescriptor<ImageGenInput, ImageGenResult>
  ↓
ExecutionStatus<ImageGenResult>
  ↓
ImageGenResult = MultimodalResult<'success' | 'error' | 'timeout', ImageGenSuccessData>
  ↓
RenderStrategy<ImageGenResult>
  → ImageGenResultCard (新元件)
```

## Provider 隔離

每個 Provider 必須透過 Adapter 隔離：

```ts
interface MultimodalProvider<TInput, TOutput> {
  readonly name: string;
  execute(input: TInput, signal?: AbortSignal): Promise<TOutput>;
  validate?(output: unknown): TOutput | null;
}
```

- Provider 差異不得污染 Domain Schema。
- Provider 錯誤必須映射為標準 Error Code。
- Provider 不得直接暴露給 Frontend。

## 禁止事項

- 不得為特定模態建立硬編碼的 UI 分支（一律走 `RenderStrategy`）。
- 不得在 Frontend 直接呼叫 Provider API。
- 不得以自然語言文字判斷模態結果狀態。
- 不得跳過 Schema Validation 直接使用模型輸出。
- 不得將 Provider 特定錯誤碼暴露給使用者。

## 驗證命令

```bash
cd frontend && npm run lint && npm run test && npm run build
cd backend && npm run lint && npm run test && npm run build
```

測試必須覆蓋：每種狀態的成功/失敗/逾時/取消、未知欄位降級、重複事件。

## 參考檔案

- `backend/src/tools/weather-types.ts` - Discriminated Union 參考。
- `frontend/src/types/weather.ts` - Runtime Parser 參考。
- `frontend/src/components/WeatherToolResult.tsx` - RenderStrategy 參考。
- `frontend/src/types/agent-runtime-events.ts` - 事件型別。
- `backend/src/tools/geocoding/location-resolver.ts` - Provider Adapter 參考。
