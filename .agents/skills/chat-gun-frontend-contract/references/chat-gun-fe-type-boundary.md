---
name: chat-gun-fe-type-boundary
description: 定義前後端型別邊界規範：流式輸入輸出與多模態請求響應必須使用 TypeScript 泛型，discriminated union 跨層同步，runtime validation，schemaVersion 版本化機制。
---

# 前後端型別邊界

## 使用時機

當需要處理下列任一情境時使用本 Skill：

- 定義或修改跨 frontend / bff / backend 的共用型別。
- 設計 Tool Input / Output Schema。
- 設計 Streaming Event 的 TypeScript 型別。
- 處理多模態（文字、圖片、影片、語音）請求響應的型別。
- 新增或修改 discriminated union 狀態型別。
- 建立 runtime validation / parser 函式。
- 處理 `schemaVersion` 或 API 版本化。

## 強制前置條件

依序讀取：

1. `AGENTS.md` - 第 7 節 TypeScript 與契約規則。
2. `frontend/AGENTS.md` - 第 2 節修改前必查範圍、第 6 節 Tool Result 渲染規則。
3. `backend/src/tools/weather-types.ts` - 權威 domain types 參考。
4. `frontend/src/types/weather.ts` - 前端複製型別 + runtime parser 參考。
5. `frontend/src/types/agent-runtime-events.ts` - discriminated union 事件型別參考。
6. `frontend/src/types/errors.ts` - ErrorEnvelope + runtime parser 參考。
7. `bff/src/errors.ts` - BFF error envelope。
8. `backend/src/platform/errors.ts` - Backend error envelope 建立。
9. `openspec/changes/generalize-weather-location-resolution/specs/` - Delta Spec 參考。

## 核心原則

### 型別不共享，各自定義

本專案 frontend、bff、backend 三個套件各自獨立定義型別，不共用 TypeScript package：

```text
backend/src/tools/weather-types.ts   ← 權威定義（strict types）
frontend/src/types/weather.ts        ← 手動複製（寬鬆 types + runtime parser）
bff/src/errors.ts                    ← BFF 獨立定義
```

原因：

- 三個套件有不同的 build target 與部署週期。
- 前端必須對不可信的 Backend 輸出做 runtime validation。
- 前端型別允許更寬鬆的欄位（如 `string` 代替 literal type），以容納未知版本。

### 流式 I/O 必須使用泛型

所有流式輸入輸出與多模態請求響應的型別定義，必須使用 TypeScript 泛型：

```ts
// 正確：泛型化的流式處理器
interface StreamHandler<TInput, TOutput> {
  parse(input: unknown): TInput | undefined;
  transform(input: TInput): AsyncIterable<TOutput>;
  validate(output: unknown): output is TOutput;
}

// 正確：泛型化的 Tool Result
interface ToolResult<
  TStatus extends string,
  TData extends Record<string, unknown>
> {
  schemaVersion: string;
  tool: string;
  status: TStatus;
  data: TData;
  summary: string;
}

// 正確：泛型化的 Streaming Event
interface StreamingEvent<TType extends string, TPayload = unknown> {
  type: TType;
  payload: TPayload;
  ts: number;
}

// 錯誤：使用 any 或 unknown 而不做泛型約束
function processResult(result: any): void {
  // ...
}
```

### Discriminated Union 跨層同步

狀態型別必須使用 discriminated union，且 `status` 欄位為 discriminant：

```ts
// Backend 權威定義 - backend/src/tools/weather-types.ts
export type WeatherToolResult =
  | WeatherSuccessResult       // status: "success"
  | WeatherClarificationResult // status: "needs_clarification"
  | WeatherNotFoundResult      // status: "not_found"
  | WeatherErrorResult;        // status: "error"

// 前端複製 - frontend/src/types/weather.ts
// 使用較寬鬆的型別以容納未來版本
export type WeatherSuccessResult = {
  schemaVersion: string; // Backend 用 "1.0" literal，前端用 string
  tool: string;          // Backend 用 "current_weather" literal，前端用 string
  status: 'success';     // discriminant 保持一致
  // ...
};
```

規則：

- Discriminant 欄位（`status`）在前後端必須使用相同的 literal values。
- 非 discriminant 欄位，前端可使用較寬鬆的型別（`string` 代替 `"literal"`）。
- 新增 status 值時，必須同步更新前後端，並提供 unknown fallback。

### Runtime Validation 必須存在

前端接收的任何 Backend 輸出都必須經過 runtime validation：

```ts
// 正確：完整的 runtime validation
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
      const status = parsed.status;
      if (status === 'success' && parsed.current && parsed.resolvedLocation) {
        return parsed as unknown as WeatherSuccessResult;
      }
      if (status === 'needs_clarification' && parsed.candidates) {
        return parsed as unknown as WeatherClarificationResult;
      }
      if (status === 'not_found') {
        return parsed as unknown as WeatherNotFoundResult;
      }
      if (status === 'error') {
        return parsed as unknown as WeatherErrorResult;
      }

      // Forward-compat: 未知 status 安全降級
      if (parsed.summary || status) {
        console.warn('Unknown weather status', {
          schemaVersion: parsed.schemaVersion,
          status,
        });
        return parsed as unknown as WeatherToolResult;
      }
    }
  } catch {
    // Not JSON
  }
  return undefined;
}

// 錯誤：直接 as assertion，不做 runtime check
const result = JSON.parse(content) as WeatherToolResult;
```

### schemaVersion 版本化

所有結構化 Tool Result 必須包含 `schemaVersion` 欄位：

```ts
// Backend
export type WeatherSuccessResult = {
  schemaVersion: '1.0'; // literal type，強制版本
  tool: 'current_weather';
  status: 'success';
  // ...
};

// Frontend
export type WeatherSuccessResult = {
  schemaVersion: string; // 寬鬆型別，容納未來版本
  tool: string;
  status: 'success';
  // ...
};
```

規則：

- 版本號使用 semver 格式（`"1.0"`, `"1.1"`, `"2.0"`）。
- MAJOR 版本變更（`1.x` → `2.x`）表示破壞性修改，需要 migration。
- MINOR 版本變更（`1.0` → `1.1`）表示新增可選欄位，向後相容。
- 前端 parser 必須能處理未知 `schemaVersion`，安全降級而非崩潰。

### ErrorEnvelope 跨層一致

錯誤信封必須在三個套件保持一致的結構：

```ts
// 統一的 ErrorEnvelope 結構
interface ErrorEnvelope {
  error: {
    source: string;    // 來源套件：'frontend' | 'bff' | 'backend'
    stage: string;     // 失敗階段
    provider?: string; // 外部服務名稱
    code: string;      // 結構化錯誤碼
    message: string;   // 面向使用者的訊息
    rawMessage?: string;
    details?: Record<string, unknown>;
    cause?: {
      name?: string;
      code?: string;
      message?: string;
    };
  };
}
```

規則：

- `code` 必須使用穩定的 Error Code Enum，不得以自然語言訊息判斷。
- `message` 面向使用者，不得包含 Stack Trace 或敏感資訊。
- `details` 面向 Log，可包含技術細節。
- `cause` 保留原始錯誤鏈，用於 debug。

### 多模態型別模式

處理不同模態（文字、圖片、影片、語音）的請求響應時，使用泛型 + discriminated union：

```ts
// 多模態輸入
type MultimodalInput =
  | { kind: 'text'; content: string }
  | { kind: 'image'; url: string; mimeType: string; caption?: string }
  | { kind: 'audio'; url: string; duration?: number; transcript?: string }
  | { kind: 'video'; url: string; duration?: number; thumbnailUrl?: string };

// 多模態輸出 - 泛型化
type MultimodalOutput<T extends string, TData = unknown> = {
  schemaVersion: string;
  modality: T;
  status: 'success' | 'error' | 'processing' | 'timeout';
  data: TData;
  summary: string;
};

// 專屬實作
type ImageGenerationOutput = MultimodalOutput<'image', {
  url: string;
  width: number;
  height: number;
  mimeType: string;
}>;
```

### 跨層契約同步檢查清單

修改任何跨層型別時，必須同步檢查：

```text
□ Request Schema（frontend → bff → backend）
□ Response Schema（backend → bff → frontend）
□ Event Schema（LangGraph → frontend）
□ Tool Input Schema
□ Tool Output Schema
□ ErrorEnvelope code 與 message
□ schemaVersion 一致性
□ requestId / threadId / runId / toolCallId 傳遞
□ Terminal State 定義一致
□ 新增欄位的向後相容性
```

## 禁止事項

- 禁止使用 `any` 作為跨層資料的型別。
- 禁止以 Type Assertion (`as`) 取代 runtime validation。
- 禁止在 discriminant 欄位使用 `string` 代替 literal type（Backend 端）。
- 禁止在沒有 `schemaVersion` 的情況下定義結構化 Tool Result。
- 禁止以 Optional 欄位逃避必要的狀態建模。
- 禁止在前端直接 import Backend 的型別檔案。
- 禁止以 Error message 字串反推 Error Code。
- 禁止將不同錯誤一律轉成無法辨識的通用錯誤。

## 驗證命令

```bash
# Frontend
cd frontend && npm run lint && npm run test && npm run build

# Backend
cd backend && npm run lint && npm run test && npm run build

# BFF
cd bff && npm run build
```

## 參考檔案

- `backend/src/tools/weather-types.ts`
- `frontend/src/types/weather.ts`
- `frontend/src/types/agent-runtime-events.ts`
- `frontend/src/types/tools.ts`
- `frontend/src/types/errors.ts`
- `frontend/src/types/messages.ts`
- `frontend/src/types/agents.ts`
- `frontend/src/types/models.ts`
- `bff/src/errors.ts`
- `backend/src/platform/errors.ts`
- `backend/src/platform/agent-runtime-events.ts`
