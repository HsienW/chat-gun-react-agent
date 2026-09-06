# Execution Summary

## 實際完成內容與 Design 差異

- 新增 backend-only `mock-recommendation` 模組，包含 runtime-validated domain types、12 筆 in-memory catalog、`MockRecommendationAdapter`、`MockCandidateRetriever`、engine compose factory 與 barrel export。
- 完成 DomainRoute → Intent → Constraint → Gate → Card 全鏈測試，涵蓋 hard violation、soft adjustment、hard conflict、scope mismatch 與 `mock-v2` adapter swap。
- Recommendation Framework Core、BFF、frontend 與 database migration 均未修改。
- 實作與核准 Design 沒有產品行為差異。Qwen review 提出一項非阻擋 Minor：`extractIntent` 每次建立 `ConstraintEngine`；本 change 接受此維護性風險，未擴大 archive 範圍重構。

## 主要修改檔案

- `backend/src/mock-recommendation/types.ts`、`catalog.ts`：domain types、runtime validation 與 deterministic catalog。
- `backend/src/mock-recommendation/adapter.ts`、`retriever.ts`：signals intent projection、retrieval policy、candidate fields、card 與 catalog retrieval。
- `backend/src/mock-recommendation/compose.ts`、`index.ts`：engine 組裝與公開 export。
- `backend/src/mock-recommendation/*.test.ts`：unit、boundary 與 full-chain integration coverage。
- `openspec/specs/mock-recommendation-adapter/spec.md`：由本 change delta spec 同步建立的 main capability spec。
- 本 archived change 的 `proposal.md`、`design.md`、`tasks.md` 與 `specs/mock-recommendation-adapter/spec.md`。

## 驗證結果

- Mock targeted tests：7 files、28 tests passed。
- Backend full test：109 files、816 tests passed；4 files、37 tests skipped。
- Backend `npm run lint` 與 `npm run build` 通過。
- `openspec validate add-mock-recommendation-adapter --strict` 通過。
- `openspec validate mock-recommendation-adapter --type spec --strict` 通過。
- Qwen implementation review：`APPROVE`，0 Blocker、0 Major、1 Minor。
- CCR readiness-check：`READY_TO_ARCHIVE`；四項 gate 全部通過。
- Archive 階段未重新執行 backend full lint／test／build；採 implementation evidence 與 CCR spot-check。

## 接受的風險與理由

- Factory 預設 provenance writer 為 async noop（Low）：僅供 Mock／test；live 使用必須注入真實 `RecommendationEngineProvenanceWriter`。
- Catalog 固定於單一 demo tenant／owner scope（Low）：engine 對 tenant 與 owner mismatch 採 fail-closed，且已有整合測試。
- `extractIntent` 每次建立 `ConstraintEngine`（Minor）：目前 constructor 無 I/O 或 side effect，對本次 deterministic Mock 驗證不構成行為或效能阻擋。
- Reviewer 未直接執行 lint／test／build（Low）：implementation evidence 已保存完整結果，CCR readiness-check 已抽查一致性。

## 未完成項目

- Git commit、push 與最終 `COMPLETED/TERMINAL` 狀態由 Human 執行。
- Qwen Minor R2-1 可在後續獨立 change 評估 constructor injection，不屬於本次 archive 必要範圍。

## 重要決策與取捨

- Mock catalog 採 in-memory deterministic seeds，不新增 PostgreSQL migration。
- A3 的單一 hard mismatch 使用 `HARD_CONSTRAINT_VIOLATION`；`HARD_CONSTRAINT_CONFLICT` 保留給輸入 signals 互相衝突。
- Intent 僅由結構化 signals 推導，未知欄位忽略；無已知 signal 時 confidence 為 `0`，以 fail-closed 觸發澄清。
- Card ID 採 deterministic `mock-${productId}`；candidate scope 直接投影 `tenantId`／`ownerScopeId`。
- `mock-v2` 以 `size` 取代 `color`，證明 Core 不依賴單一 Adapter 的屬性集合。

## Commit 建議

```text
chore(openspec): archive mock recommendation adapter

- Sync the mock recommendation adapter capability into main specs.
- Preserve implementation decisions and validation evidence in the execution summary.
- Move add-mock-recommendation-adapter into the dated archive.

OpenSpec Change: add-mock-recommendation-adapter

Co-Authored-By: Claude <noreply@anthropic.com>
```
