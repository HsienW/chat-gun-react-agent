# Execution Summary

## 實際完成內容與 Design 差異

完全依照 design.md 實作，無偏差。額外基於 live smoke 證據追加了兩項 ADR：
- **ADR-005**：Provider capability-aware JSON planning（CCR/Anthropic 不支援 native responseFormat 時改用 Prompt JSON 約束）
- **ADR-006**：queryName 不得繞過同國行政區歧義（Resolver 新增 administrative ambiguity guard）

兩項均為 design.md 已規劃的 Phase 3 任務，不屬於 scope expansion。

## 主要修改檔案

| 檔案 | 修改內容 |
| :--- | :--- |
| `backend/src/agents/deep-researcher.ts` | Consistency Gate、whole-question rejection、provider capability factory |
| `backend/src/platform/llm-gateway.ts` | 匯出 `LlmCapabilities`、新增 `getConfiguredLlmCapabilities` |
| `backend/src/tools/geocoding/location-resolver.ts` | 同國行政區歧義 guard |
| `backend/src/agents/deep-researcher.weather.test.ts` | Case A-E integration + gate unit + provider capability |
| `backend/src/agents/deep-researcher.query-workflow.test.ts` | routing contract 補充 |
| `backend/src/agents/deep-researcher.weather.live-smoke.test.ts` | 新增 live smoke test |
| `backend/src/platform/llm-gateway.test.ts` | capability accessor 測試 |
| `backend/src/tools/geocoding/location-resolver.test.ts` | 同國行政區歧義測試 |
| `docs/agent-rules/weather.md` | Consistency Gate + admin ambiguity 規則 |

## 驗證結果

- Targeted tests: 4 files, 118 passed
- Backend full suite: 189 passed, 27 skipped
- Lint: passed
- Build: passed
- Live smoke (CCR/Open-Meteo): 3/3 passed
- OpenSpec strict validation: passed
- Git diff check: passed
- Qwen review: APPROVE (PASS WITH MINOR, 2 Minor)

## 接受的風險與理由

1. **ambiguityDelta = 8 門檻**：依賴 scoring 權重分佈，未來 scoring 變更時需重新驗證。現有 live smoke + deterministic fixture 可捕捉回歸。
2. **Frontend clarification resume contract 缺口**：非本 change diff 引入，另開 change 處理。

## 未完成項目

無。21/21 Tasks 全部完成。

## 重要決策與取捨

- Consistency Gate 放在 `coercePlan` 內（ADR-001），確保所有 plan 來源自動受惠
- Provider capability 依 `supportsStructuredOutput` 決策而非 provider 名稱硬分支（ADR-005）
- `coerceWeatherRequestForQuestion` 拒絕完整問題 echo 為 location，解決真實 Planner 失敗模式
- queryName 同國行政區歧義 guard 放在 short CJK guard 之後（ADR-006），不破壞既有 CJK 路徑

## Commit 建議

```text
fix(backend): add weather plan consistency gate and provider capability-aware JSON planning
```
