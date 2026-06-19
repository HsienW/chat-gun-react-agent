---
name: chat-gun-fe-react-vite-conventions
description: 定義 React/Vite 專案的編程規約：條件分支超過 2 個必須抽成 Enum、繁體中文常量化、展示文字必須抽成變量為多語系做準備、Vite 環境變數安全、Bundle 控制。
---

# React/Vite 專案限制與編程規約

## 使用時機

當需要處理下列任一情境時使用本 Skill：

- 在 frontend 新增或修改 React 元件。
- 處理條件渲染邏輯（if/else、switch-case、ternary）。
- 新增面向使用者的展示文字。
- 使用 Vite 環境變數。
- 處理 React State、Effect、Event Handler。
- 優化 Bundle size 或 code splitting。
- 處理 TypeScript 型別與 Enum 定義。

## 強制前置條件

依序讀取：

1. `frontend/AGENTS.md` - 完整 Frontend 規則。
2. `frontend/src/lib/error-messages.ts` - 展示文字變量參考模式。
3. `frontend/src/types/agents.ts` - Enum 定義參考。
4. `frontend/src/components/WeatherToolResult.tsx` - STATUS_CONFIG Enum mapping 參考。
5. `frontend/src/lib/runtime-event-config.ts` - 標籤常數參考。
6. `frontend/vite.config.ts` - Vite 設定。

## 核心規約

### 規約 1：條件分支超過 2 個必須抽成 Enum

當條件判斷有 3 個或以上分支時，必須使用 Enum 或 literal union + Record mapping，禁止 switch-case 或 if-else 鏈：

```ts
// 正確：Enum + Record mapping（3 個以上分支）

// 1. 定義 Enum
export enum AgentId {
  DEEP_RESEARCHER = 'deep_researcher',
  CHATBOT = 'chatbot',
  MATH_AGENT = 'math_agent',
  MCP_AGENT = 'mcp_agent',
}

// 2. 定義 mapping table
const AGENT_CONFIG: Record<AgentId, {
  label: string;
  icon: string;
  showTimeline: boolean;
}> = {
  [AgentId.DEEP_RESEARCHER]: {
    label: 'Deep Researcher',
    icon: 'search',
    showTimeline: true,
  },
  [AgentId.CHATBOT]: {
    label: 'Chat Assistant',
    icon: 'message-circle',
    showTimeline: false,
  },
  [AgentId.MATH_AGENT]: {
    label: 'Math Solver',
    icon: 'calculator',
    showTimeline: false,
  },
  [AgentId.MCP_AGENT]: {
    label: 'MCP Agent',
    icon: 'wrench',
    showTimeline: false,
  },
};

// 3. 使用
const config = AGENT_CONFIG[agentId] ?? AGENT_CONFIG[AgentId.DEEP_RESEARCHER];

// 錯誤：switch-case 鏈
switch (agentId) {
  case 'deep_researcher':
    return { label: '...', icon: '...' };
  case 'chatbot':
    return { label: '...', icon: '...' };
  case 'math_agent':
    return { label: '...', icon: '...' };
  case 'mcp_agent':
    return { label: '...', icon: '...' };
}

// 錯誤：if-else 鏈
if (status === 'success') {
  // ...
} else if (status === 'error') {
  // ...
} else if (status === 'running') {
  // ...
} else if (status === 'not_found') {
  // ...
}
```

例外：只有 2 個分支時可以使用 ternary operator：

```ts
// 可接受：只有 2 個分支
const label = isActive ? LABELS.active : LABELS.inactive;
```

### 規約 2：繁體中文常量化

所有面向使用者的繁體中文文字必須抽成常數變量：

```tsx
// 正確：抽成常數
export const TOOL_LABELS = {
  waiting: '等待 tool response...',
  input: '輸入',
  output: '輸出',
  running: '執行中',
  success: '完成',
  error: '錯誤',
  unknown: '未知結果',
  needsClarification: '需補充地點',
  notFound: '找不到地點',
} as const;

// 使用
<Badge>{TOOL_LABELS.running}</Badge>;

// 錯誤：硬寫在 JSX 中
// <Badge>執行中</Badge>
```

常數組織方式：

```ts
// 依功能域分組，集中於 lib/ 或 types/ 目錄
// frontend/src/lib/error-messages.ts
export const FRONTEND_ERROR_MESSAGES = {
  errorEnvelope: {
    source: '來源',
    stage: '階段',
    provider: '服務',
    code: '代碼',
    message: '訊息',
    raw: '原始訊息',
    details: '詳細資料',
    cause: '原因',
  },
  imageUpload: {
    dialogTitle: '圖片處理失敗',
    close: '關閉',
    invalidImage: '圖片格式或內容無效。',
    // 帶參數的訊息使用函式
    tooManyImages: (maxFiles: number) => `最多只能上傳 ${maxFiles} 張圖片。`,
    imageTooLarge: (actual: string, max: string) =>
      `圖片檔案過大：${actual}，上限為 ${max}。`,
  },
} as const;
```

### 規約 3：展示文字必須抽成變量（i18n 準備）

所有展示文字必須為多語系做準備，抽成可替換的變量：

```ts
// 正確：建立 labels 物件，為 i18n 做準備
const WEATHER_LABELS = {
  querying: '查詢天氣中...',
  temperature: 'Temperature',
  feelsLike: 'Feels like',
  humidity: 'Humidity',
  condition: 'Condition',
  wind: 'Wind',
  gusts: 'Gusts',
  precipitation: 'Precipitation',
  rain: 'Rain',
  cloudCover: 'Cloud cover',
  pressure: 'Pressure',
  source: 'Source: Open-Meteo',
  possibleMatches: 'Possible matches:',
  specifyRegion: 'Please specify a country or region and ask again.',
} as const;

// 錯誤：硬寫在元件中
// <span>查詢天氣中...</span>
// <span>Temperature</span>
```

帶動態參數的文字使用函式：

```ts
// 正確：帶參數的文字
const LABELS = {
  removeImage: (fileName: string) => `移除 ${fileName}`,
  tooManyImages: (max: number) => `最多只能上傳 ${max} 張圖片。`,
  contextSourceMessage: (index: number, role: string) =>
    `近期訊息 ${index}（${role}）`,
} as const;
```

### 規約 4：Vite 環境變數安全

所有 `VITE_*` 變數都視為公開資訊，暴露在瀏覽器 Bundle 中：

```dotenv
# 可接受：公開設定
VITE_LANGGRAPH_API_URL=http://localhost:8123
VITE_APP_TITLE=Chat Gun

# 禁止：敏感資訊
VITE_OPENAI_API_KEY=sk-...
VITE_MCP_CREDENTIAL=...
VITE_PRIVATE_TOKEN=...
```

規則：

- 禁止將 API Key、Token、Credential 放入 `VITE_*`。
- 禁止將 `envPrefix` 設為空字串。
- 禁止以 `define` 將 Server Secret 注入 Client Bundle。
- 環境差異透過 BFF 設定注入，不在元件內硬編碼 Host 或 Port。

### 規約 5：React State 最小化

```tsx
// 正確：最小 State，可推導的不重複保存
const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
// derived - 不保存為 state
const isToolExpanded = expandedTools.has(toolId);

// 錯誤：冗餘 state
const [isToolExpanded, setIsToolExpanded] = useState(false);
const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
```

### 規約 6：Effect 清理

```tsx
// 正確：Effect 有明確依賴且清理訂閱
useEffect(() => {
  const controller = new AbortController();
  fetchEvents(controller.signal).then(setEvents);
  return () => controller.abort();
}, [threadId]);

// 錯誤：缺少清理
useEffect(() => {
  fetchEvents().then(setEvents);
}, []);
```

### 規約 7：列表 Key 穩定性

```tsx
// 正確：穩定 key
{candidates.map((c) => (
  <div key={`${c.name}-${c.countryCode}-${c.index}`}>...</div>
))}

// 錯誤：使用會隨排序改變的 index
{candidates.map((c, i) => (
  <div key={i}>...</div>
))}
```

### 規約 8：不可變更新

```tsx
// 正確：不可變更新
setExpandedTools((prev) => {
  const next = new Set(prev);
  next.has(toolId) ? next.delete(toolId) : next.add(toolId);
  return next;
});

// 錯誤：直接 mutate
expandedTools.add(toolId);
setExpandedTools(expandedTools);
```

### 規約 9：Strict Mode 安全

React Strict Mode 下 Effect 會執行兩次。必須確保：

- 不會造成重複 Tool Call 或重複提交。
- 訂閱、Timer、Request 在 cleanup 中正確取消。
- 雙擊不會重複送出請求。

### 規約 10：Bundle 控制

- Vite Chunk Size Warning 在 Exit Code 為 0 時不等於 Build 失敗。
- 若本次修改造成明顯 Bundle 增長，必須回報原因與影響。
- 大型依賴（如 Markdown renderer）應考慮 lazy import。
- 不得為單一功能引入過大的第三方套件。

## 禁止事項

- 禁止條件分支超過 2 個時不使用 Enum 或 literal union + Record mapping。
- 禁止在 JSX 中硬寫面向使用者的中文文字。
- 禁止將 `VITE_*` 用於存放 Secret。
- 禁止以 `dangerouslySetInnerHTML` 渲染未淨化的外部內容。
- 禁止在元件內硬編碼 BFF URL、Agent ID 或 Graph ID。
- 禁止以 `// @ts-ignore` 或 `as any` 掩蓋型別問題。
- 禁止使用會隨排序改變的 array index 作為具狀態項目的 key。
- 禁止在 Effect 中不清理訂閱、Timer 或 Request。
- 禁止以固定延遲（`setTimeout`）模擬真實串流完成。

## 驗證命令

```bash
cd frontend
npm run lint
npm run test
npm run build
```

## 參考檔案

- `frontend/AGENTS.md`
- `frontend/vite.config.ts`
- `frontend/src/lib/error-messages.ts`
- `frontend/src/lib/runtime-event-config.ts`
- `frontend/src/lib/agent-run-config.ts`
- `frontend/src/types/agents.ts`
- `frontend/src/types/models.ts`
- `frontend/src/components/WeatherToolResult.tsx`
- `frontend/src/components/ToolMessageDisplay.tsx`
- `frontend/src/components/ChatMessagesView.tsx`
- `frontend/src/App.tsx`
