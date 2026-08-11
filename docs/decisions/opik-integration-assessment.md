# Opik Integration Assessment

- 日期：2026-08-11
- Change：`integrate-opik-agent-tracing-evaluation`
- 狀態：Provisional；待 hosted trial、CCR review-result 與 Qwen 獨立審查
- 決策：**僅保留為開發與評估工具；目前不允許 production traffic export**

## 決策摘要

直接使用 Opik TypeScript SDK 能補足 X8 OTel 在開發階段欠缺的 agent hierarchy、versioned dataset、trace-backed metric 與 experiment comparison 工作流。整合已具備 feature flag、dynamic import、no-op degradation、獨立 `AsyncLocalStorage` context、redaction 與離線 experiment JSON；自動化測試也已覆蓋 agent → node → LLM/tool hierarchy、平行 trace isolation、四種 experiment item status 與 judge failure。

目前環境沒有 `OPIK_API_KEY` 與 `OPIK_WORKSPACE`，因此尚未完成 hosted UI hierarchy 檢查、兩組 hosted experiment 並排比較、真實 ingestion latency與資料落地稽核。這些都是 Proposal 的 success criteria，所以本次不建議啟用 production export。`OPIK_ENABLED` 必須維持預設 `false`。

## 驗證證據與限制

| 項目 | 結果 | 限制 |
| --- | --- | --- |
| SDK | optional dependency lockfile resolved `opik@1.11.14`；TypeScript SDK adapter tests通過 | package range為 `^1.11.14`，升版仍須重跑契約測試；見下方 dependency audit 風險 |
| Trace hierarchy | mock client驗證 `agent.weather → node.targeted_tools → llm.call/tool.execute` | 尚未在 hosted UI確認 |
| Correlation/redaction | 自動化覆蓋 thread/run/task/step/tool-call IDs、prompt hash、secret與 PII遮蔽 | 未以真實 customer-like payload做資料落地稽核 |
| Evaluation | versioned dataset、deterministic metric、bounded judge、runner與 offline JSON tests通過 | hosted dataset與 experiment尚未建立 |
| B.5 live command | `cd backend && npm run eval:opik` | 2026-08-11執行結果為 1 skipped；缺少 opt-in與 Opik credentials |
| Build gate | backend lint、523 tests、build通過；29 tests依既有或 opt-in條件 skipped | hosted Opik live驗證仍未執行 |

## Operational cost

### SDK與 ingestion

代表性單一 run 會產生至少 1 個 trace、1 個 node span、1 個 LLM span與1個 tool span；每個 metric另有1筆 feedback event。真實 agent有多個 nodes、tools與 retries，因此 event數隨執行路徑線性增加。SDK會批次送出資料，不能把 logical event數直接視為 HTTP request數；production容量規劃必須以真實 SDK queue/flush telemetry量測。

官方 Cloud限制包括每位使用者 2,000 REST requests/min、10,000 ingestion events/min，以及 workspace/user 5,000 ingestion events/min。現有 runner預設逐 item執行並在 experiment結束前保留 SDK queue，因此正式採用前要驗證 rate-limit、retry與 shutdown flush。[Opik FAQ](https://www.comet.com/docs/opik/faq)

### Hosted service cost

截至 2026-08-11，官方方案為：Open Source $0；Free Cloud $0（25k spans/月、60日保存）；Pro Cloud $19/月（100k spans/月、60日保存）；Enterprise為 custom pricing。這些額度與價格可能變動，採購前須重新確認。[Comet pricing](https://www.comet.com/site/pricing/)

自架 Open Source保留 tracing與evaluation功能，但 local Docker不適合 production；官方建議 production self-host使用 Kubernetes。自架成本需另計 compute、ClickHouse/storage、備份、升級與 on-call。[Self-host overview](https://www.comet.com/docs/opik/self-host/overview)

LLM-as-judge成本不包含在 Opik平台費用內，仍由模型 provider按 token計費。本 runner以 `maxItems`、`perItemTimeoutMs` 與 `maxTotalCostUsd`限制支出；judge temperature固定為0，但仍是 single-run snapshot。

### Dependency audit

`opik` 以 optional dependency 安裝，runtime 僅在 `OPIK_ENABLED=true` 時 dynamic import。2026-08-11 以 npm 官方 registry 執行 production audit：含 optional dependency 為 22 件（1 low、15 moderate、6 high），加上 `--omit=optional` 後為 14 件（1 low、7 moderate、6 high）。差分顯示 Opik 的 AI SDK 子樹新增 8 個受影響套件記錄；其中 nested `undici@5.29.0` 也落在 high advisory 範圍，但 aggregate high 數量未增加，因專案既有 direct `undici@8.4.1` 已讓 `undici` 套件項目被計為 high。

Opik 1.x 與其相同 major 的 AI SDK 目前沒有可用的相容 patch；強制把 `provider-utils` 所需的 `undici ^5.29.0` override 到 6.x 會跨 major，未採用。此風險是維持 dev-only、production install 應 omit optional dependency 的額外理由。正式採用前必須等待上游修補或另立 change 驗證安全升版。

## Trace latency與 overhead

2026-08-11本機 microbenchmark，以500次代表性 `agent → node → LLM/tool`純 callback run量測：

| 模式 | 每 run |
| --- | ---: |
| Disabled no-op | 約 0.0007 ms |
| Enabled、in-memory client | 約 0.0517 ms |
| 估算 instrumentation差值 | 約 0.0509 ms |

重跑命令：

```bash
cd backend
npx vitest run src/platform/tracing/opik/opik-overhead.benchmark.test.ts --disableConsoleIntercept
```

這是單次開發機 microbenchmark，只衡量 redaction、hierarchy與 async context成本；**排除 network、SDK batching、hosted ingestion、agent/model/tool latency**，不能作為 production SLO或 hosted overhead結論。Production gate需以相同 Weather Agent input做 OPIK disabled/enabled交錯測量，至少記錄 p50/p95/p99、span數、payload bytes、queue flush與錯誤率。

## Debugging usefulness

Opik相較僅使用 X8 OTel的增益：

- 直接呈現 agent、LangGraph node、LLM與tool的巢狀 hierarchy。
- trace上可附 metric feedback，能從低分直接回到特定 run/span。
- versioned dataset與不同 agent/judge config的 experiment可比較，不必另建 UI。
- token usage、duration、tool arguments與錯誤狀態在同一 agent視角內聚合。

X8 OTel仍較適合：

- BFF → Backend → Provider的跨服務、vendor-neutral production tracing。
- metrics、collector/exporter、生產告警與既有 runtime governance。
- 不將 application payload交給新的 hosted vendor。

目前沒有 hosted UI操作計時，不能量化「定位問題節省多少時間」。在完成盲測前，只能判定功能可用性提升，不能宣稱具體除錯效率百分比。

## Evaluation usefulness

本次 pipeline將既有 weather golden cases轉為 structured、semver標記且不可覆寫的 dataset；`tool_call_correctness`對相同 input/result為 deterministic，`response_quality`記錄 model/provider/prompt version/hash、固定 temperature 0，judge失敗不會中止其他 metrics或 items。

Runner記錄 dataset、agent config、judge config、item statuses、metric scores、trace IDs與 timestamp；同 config產生相同 comparison key，不同 model產生不同 key。沒有 Opik時仍會輸出 human-readable summary與結構化 JSON。這能作為 prompt/model變更前的開發 quality gate候選，但 hosted B.5完成前不得把 LLM judge分數當成 release blocker。

## Data-governance constraints

不得 export：

- API key、token、authorization、password或其他 credentials。
- 完整 system/user prompt、conversation history或未遮蔽 model/tool raw output。
- Email、電話與其他可識別個人的資料。
- customer proprietary content、上傳原文、內部檢索文件與未核准 attachments。
- stack trace、provider raw body或可能包含 secret的錯誤細節。

允許 export：agent/node/tool/model/provider名稱、status/error type、duration、token counts、prompt hash、structured summary，以及既有 correlation IDs。

現有 redaction已處理常見及衍生 secret欄位、prompt欄位、Email、電話、field-key 型姓名／地址與錯誤訊息；`OPIK_REDACT_ENABLED=false` 會 fail-closed，同時停用 tracing 與 dataset upload。但仍有缺口：非標準欄位中的專有文字、未能被 pattern或 field key辨識的新型 PII、圖像/音訊內容與第三方 tool自訂結構。正式 hosted trial前必須以 allowlist schema取代「一般 object皆可 export」，並由 Security/Data Owner審核 retention、region、RBAC、DPA與刪除流程。

## 與 X8 OTel 的差距

| 場景 | Opik不足 | OTel不足 |
| --- | --- | --- |
| Production跨服務 | hosted governance尚未核准；direct SDK形成第二條 telemetry path | agent語意與 experiment UI較弱 |
| Agent hierarchy | 需要手動 execution-point wrappers；SDK升版有契約風險 | 通用 spans不保證保留 agent/node/tool專屬語意 |
| Evaluation | judge仍有 provider成本與 snapshot變異；UI尚未驗證 | 沒有內建 dataset、feedback與 experiment comparison workflow |
| 資料治理 | 新的外部資料處理者與 retention邊界 | 自有 collector較容易維持既有資料邊界 |
| 可移植性 | dataset/experiment adapter具有 vendor coupling | vendor-neutral標準與既有 collector生態較成熟 |

## 採用與 migration path

目前決策為「dev tool only」。符合以下全部條件後，才可提案升級為 production + dev：

1. 以有效的非 production workspace完成 A.6：Weather run hierarchy、metadata、duration、token/error與 redaction逐項人工驗證並保存截圖。
2. 完成 B.5兩組不同 model/prompt config experiment，確認 metric→trace追溯、judge reasoning與comparison UI。
3. 執行至少30組相同輸入的 enabled/disabled benchmark，產出 p50/p95/p99、payload/event量與 ingestion failure/rate-limit資料。
4. Security/Data Owner核准 export allowlist、retention、region、RBAC、DPA、incident與 deletion流程。
5. 驗證 graceful shutdown會 flush、有界 queue/backpressure、429 retry與 API outage不影響 agent結果。
6. 建立 dependency升版政策、monthly span預算與告警；確認 Cloud方案或 self-host TCO。
7. 經 CCR review-result、Qwen獨立審查與人工 owner批准。

若任一 gate失敗，維持 `OPIK_ENABLED=false`。回滾只需關閉 feature flag；Opik初始化、tracer與dataset upload均會降級或停止，既有 X8 OTel path不受影響。若長期不採用，再以獨立 change移除 `opik` dependency與 Opik-specific evaluation adapter。
