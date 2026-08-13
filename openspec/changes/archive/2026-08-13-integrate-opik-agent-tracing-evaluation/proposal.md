# Proposal：integrate-opik-agent-tracing-evaluation

## 問題描述

X8（add-observability-metrics-tracing）已建立生產環境的可觀測性基礎：OTel 分散式追蹤、Metrics 收集與 Model Provider Fallback。但開發階段的 Agent 除錯與品質評估仍有以下缺口：

1. **缺乏開發階段 Agent 執行樹視覺化**：OTel trace 主要服務生產環境監控，開發階段需要看到 Agent/LangGraph Node/LLM Call/Tool Call 的巢狀執行階層、失敗點、延遲與 token 成本，而非只是分散的 span 列表。
2. **缺乏結構化 Agent 評估工作流程**：目前依賴單元測試與手動檢查，缺少以 versioned dataset、scoring metric、trace-backed experiment 為基礎的評估循環。
3. **評估重現性不足**：每次變更 Prompt、模型或 Agent 配置後，沒有機制能對同一組 golden case 做可比較的 experiment。

## 解決方案

整合 [Opik](https://github.com/comet-ml/opik) 作為開發階段的主要 tracing 與 evaluation 工具，透過以下路徑：

### Part A：Opik Agent Tracing

- 優先使用 Opik SDK（`opik` TypeScript package）在關鍵檢測點建立 trace/spans，確保 Agent 執行階層完整保留（Agent → LangGraph Node → LLM Call → Tool Call）
- 若 OTel export 路徑足以保留語意，亦可使用 `opik.configure` 的 OTel integration
- 對齊 X8 的 `taskId`、`stepId`、`toolCallId` 等 correlation ID 至 Opik metadata
- 套用與 X8 相同的 redaction 規則：不匯出完整 prompt、API key、unmasked PII

### Part B：Opik Evaluation Pipeline

- 從既有 golden case（`weather-golden-eval.ts`）建立 versioned dataset
- 設計至少一個 deterministic metric（如 schema conformance / tool call correctness）與一個 bounded LLM-as-judge metric
- 建立可重現 experiment：固定 dataset version + 指定 model/prompt config → 產生可比對的 trace + score
- 記錄 judge model 配置（model、temperature、prompt），確保 judge 行為可審計

### Part C：Decision Record

- 產出 `docs/decisions/opik-integration-assessment.md`
- 記錄：operational cost、trace latency/overhead、debugging usefulness、evaluation usefulness、data-governance constraints、與 X8 OTel 的差距

## 受影響套件與能力域

| 套件 | 能力域 | 變更類型 |
|------|--------|---------|
| backend | Opik Tracing | 新增 `backend/src/platform/tracing/opik/` 模組 |
| backend | Opik Evaluation | 新增 evaluation dataset loader 與 experiment runner |
| backend | Runtime Config | 新增 Opik 相關 env key |
| backend | 相依套件 | 新增 `opik` dependency |

## 目標

- Opik 可透過環境變數啟用／停用；未設定或不連線時不影響正常 Agent 流程
- 至少一個完整 Agent run（Weather 或 Deep Research）在 Opik UI 中顯示為可導航的執行階層（Agent/LangGraph/LLM/Tool）
- Trace metadata 保留專案 correlation ID，但不洩漏 secret、完整 prompt 或 unmasked PII
- 建立 version-pinned dataset 與可重現 experiment，覆蓋至少一個完整 agent flow
- 同一 dataset version 可比較兩個 model/prompt/agent 配置而無需修改測試輸入
- 與 X8 OTel 共存，不產生重複 logical span 或 context propagation 衝突
- 產出決策記錄，明確建議是否採用、拒絕或保留為開發工具

## 非目標

- 不取代 X8 OTel Tracing 或既有單元／整合測試
- 不部署 Opik self-hosted infrastructure（使用 hosted UI 進行初始 trial）
- 不將 production traffic export 至 Opik（保留、存取控制、redaction、資料落地尚未審核前不允許）
- 不進行無限制的 LLM-as-a-judge 運行；不以未版本化 dataset 作為 quality gate
- 不重複 SDK instrumentation 產生相同 logical span 兩次

## 與 X8 OTel 的關係

| 維度 | OTel（X8，自建） | Opik（X8.5A，外部 primary track） |
|---|---|---|
| 目的 | 生產環境 Runtime governance、vendor-neutral telemetry | 開發階段 tracing、evaluation 與 experiment 比較 |
| 部署 | 分散式（BFF→Backend→Model） | Cloud-first UI（初始 trial）；self-hosting 不在範圍內 |
| 輸出 | OTel spans、metrics、專案自有 Dashboard | 巢狀 traces、feedback scores、datasets、experiment results |
| 整合 | 既有 OTel SDK + Collector/exporter | 優先使用 Opik SDK 直接 instrumentation；若 OTel export 保留足夠語意則考慮 reuse |
| 品質評估 | 專案自有測試與 metrics | Dataset-based metrics + bounded LLM-as-a-judge |

## 風險與回滾策略

- **風險**：Opik SDK 可能與既有 OTel SDK 產生 context propagation 衝突 → 使用獨立的 trace provider 或明確的 context 隔離；透過 `OPIK_ENABLED` 開關控制
- **風險**：Hosted Opik 涉及資料外洩風險 → 強制 redaction layer 在 export 前過濾；不傳送 production traffic；記錄所有 export 的資料類別
- **風險**：增加 npm dependency 與 bundle size → `opik` 為 optional dependency，僅在 `OPIK_ENABLED=true` 時動態 import
- **回滾**：`OPIK_ENABLED=false` 完全關閉所有 Opik 行為；移除 `opik` dependency 不影響任何既有功能
