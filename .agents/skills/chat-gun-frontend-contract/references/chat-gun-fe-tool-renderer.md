---
name: chat-gun-fe-tool-renderer
description: 定義 Tool Result 渲染層級架構：通用 ToolMessageDisplay 外殼 → 結構化 Parser → 專項卡片委派 → 狀態 Enum 驅動渲染 → 降級 fallback 的完整模式。
---

# Tool Renderer 層級

## 使用時機

當需要處理下列任一情境時使用本 Skill：

- 新增或修改 Tool Result 的前端渲染元件。
- 建立專項 Tool 卡片（如 Weather、Calculator、Web Search 等結構化結果）。
- 修改 `ToolMessageDisplay.tsx` 的狀態判斷或委派邏輯。
- 處理 Tool 狀態 Enum 與 Badge / Icon / Label 的映射。
- 新增 Tool 類型的 fallback 或 unknown 降級渲染。

## 強制前置條件

依序讀取：

1. `frontend/AGENTS.md` - 第 6 節 Tool Result 渲染規則。
2. `frontend/src/components/ToolMessageDisplay.tsx` - 通用 Tool 外殼元件。
3. `frontend/src/components/WeatherToolResult.tsx` - 專項卡片參考實作。
4. `frontend/src/types/weather.ts` - `parseWeatherToolResult` + `getWeatherDisplayStatus` 參考模式。
5. `frontend/src/types/tools.ts` - `ToolCall` 與 `ToolMessage` 介面。
6. `frontend/src/types/errors.ts` - `ErrorEnvelope` 解析。
7. `frontend/src/lib/error-messages.ts` - 展示文字變量參考。
8. 對應的 Backend Tool Output Schema。

## 核心原則

### 三層渲染架構

```text
Layer 1: ChatMessagesView
  └─ 從 MessageGroup 提取 ToolCall[]，配對 ToolMessage
  └─ 委派給 ToolMessageDisplay

Layer 2: ToolMessageDisplay（通用外殼）
  └─ 可折疊面板、Tool 名稱、輸入 JSON
  └─ 狀態 Badge（Enum 驅動）
  └─ 判斷是否委派給專項卡片
  └─ 非結構化結果 fallback 為純文字 / JSON

Layer 3: 專項卡片（如 WeatherToolResultCard）
  └─ 依 discriminated union status 分支渲染
  └─ 每種狀態有獨立子元件
  └─ 所有展示文字抽成變量
```

### 狀態 Enum 驅動

所有 Tool 狀態必須使用 Enum 或 literal union，禁止以字串字面量散落在多個元件中：

```tsx
// 正確：Enum/literal union + Record mapping
type ToolDisplayStatus =
  | 'running'
  | 'success'
  | 'needs_clarification'
  | 'not_found'
  | 'error'
  | 'timeout'
  | 'cancelled'
  | 'denied'
  | 'unknown';

const STATUS_CONFIG: Record<ToolDisplayStatus, {
  label: string;
  className: string;
  icon: React.ReactNode;
}> = {
  running: { label: LABELS.running, className: '...', icon: <Clock /> },
  success: { label: LABELS.success, className: '...', icon: <CheckCircle /> },
  needs_clarification: { label: LABELS.needsClarification, className: '...', icon: <HelpCircle /> },
  not_found: { label: LABELS.notFound, className: '...', icon: <SearchX /> },
  error: { label: LABELS.error, className: '...', icon: <AlertTriangle /> },
  timeout: { label: LABELS.timeout, className: '...', icon: <TimerOff /> },
  cancelled: { label: LABELS.cancelled, className: '...', icon: <CircleSlash /> },
  denied: { label: LABELS.denied, className: '...', icon: <ShieldX /> },
  unknown: { label: LABELS.unknown, className: '...', icon: <AlertTriangle /> },
};

// 錯誤：在元件內 switch-case 硬寫字串
```

### 委派模式

`ToolMessageDisplay` 使用 tool name 判斷是否委派給專項卡片：

```tsx
// ToolMessageDisplay.tsx 的委派邏輯
const isWeatherTool = toolCall.name === 'current_weather' && toolMessage;
const weatherResult = isWeatherTool
  ? parseWeatherToolResult(toolMessage.content)
  : undefined;
const isStructuredWeather = weatherResult !== undefined;

// 渲染時
{isStructuredWeather ? (
  <WeatherToolResultCard content={toolMessage.content} />
) : (
  <GenericOutputDisplay content={displayContent} />
)}
```

新增 Tool 卡片時，遵循相同模式：

1. 在 `ToolMessageDisplay` 新增 tool name 判斷。
2. 建立對應的 `parse*ToolResult` 純函式。
3. 建立專項卡片元件。

### Parser 規範

每個專項 Tool 必須有獨立的 runtime parser：

```ts
// 參考 frontend/src/types/weather.ts 的 parseWeatherToolResult
export function parseWeatherToolResult(
  content: string
): WeatherToolResult | undefined {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.schemaVersion === 'string' &&
      parsed.tool === 'current_weather' &&
      typeof parsed.status === 'string'
    ) {
      // 依 status 驗證必要欄位
      // Forward-compat: 未知 schemaVersion 仍嘗試解析
    }
  } catch {
    // Not JSON → undefined
  }
  return undefined;
}
```

Parser 必須：

- 接受 `string`，回傳 discriminated union 或 `undefined`。
- 驗證 `schemaVersion` + `tool` + `status` 三個必要欄位。
- 對未知 `schemaVersion` 或 `status` 安全降級，不拋出例外。
- 不依賴 Backend 內部型別，前端獨立定義。

## 專項卡片實作模式

```tsx
// 參考 WeatherToolResultCard 結構
export function WeatherToolResultCard({ content }: Props) {
  const result = parseWeatherToolResult(content);
  const displayStatus = getWeatherDisplayStatus(result);
  const config = STATUS_CONFIG[displayStatus] ?? STATUS_CONFIG.unknown;

  return (
    <div>
      {/* 狀態 header - 所有卡片共用模式 */}
      <StatusHeader config={config} />

      {/* 依 status 分支渲染 */}
      {displayStatus === 'success' && result?.status === 'success' && (
        <SuccessDisplay result={result} />
      )}
      {displayStatus === 'needs_clarification' &&
        result?.status === 'needs_clarification' && (
          <ClarificationDisplay result={result} />
        )}
      {displayStatus === 'error' && result?.status === 'error' && (
        <ErrorDisplay result={result} />
      )}
      {displayStatus === 'not_found' && result?.status === 'not_found' && (
        <NotFoundDisplay result={result} />
      )}
      {(displayStatus === 'unknown' || !result) && (
        <FallbackDisplay summary={getSummary(result)} />
      )}
      {displayStatus === 'running' && <RunningDisplay />}
    </div>
  );
}
```

## 展示文字變量化

所有面向使用者的文字必須抽成常數或函式，為多語系做準備：

```ts
// 正確：抽成變量
const TOOL_LABELS = {
  waiting: '等待 tool response...',
  input: '輸入',
  output: '輸出',
} as const;

// 錯誤：硬寫在 JSX 中
// <span>等待 tool response...</span>
```

參考 `frontend/src/lib/error-messages.ts` 的模式建立各 Tool 的 label 常數。

## 禁止事項

- 禁止在 `ToolMessageDisplay` 內以自然語言文字判斷 Tool 狀態。
- 禁止將 Tool Output 當作可信 HTML 直接渲染。
- 禁止在專項卡片內重複實作通用外殼邏輯（折疊、Badge、JSON 顯示）。
- 禁止以 tool name 字串散落在多個元件中，應集中於委派層。
- 禁止在錯誤顯示中暴露 Stack Trace、API Key 或 Provider 憑證。
- 禁止以 `displayContent` 字串內容反推 Tool 是否成功。
- 禁止在條件判斷超過 2 個分支時不使用 Enum 或 literal union + mapping。

## 驗證命令

```bash
cd frontend
npm run lint
npm run test
npm run build
```

測試至少覆蓋：

- 結構化結果每種 status 的渲染。
- 非 JSON 內容的 fallback。
- 未知 schemaVersion 的降級。
- 未知 status 的降級。
- ErrorEnvelope 的解析與格式化。
- 缺少可選欄位的安全處理。

## 參考檔案

- `frontend/src/components/ToolMessageDisplay.tsx`
- `frontend/src/components/WeatherToolResult.tsx`
- `frontend/src/components/WeatherToolResult.test.tsx`
- `frontend/src/components/ChatMessagesView.tsx`
- `frontend/src/types/weather.ts`
- `frontend/src/types/tools.ts`
- `frontend/src/types/errors.ts`
- `frontend/src/lib/error-messages.ts`
