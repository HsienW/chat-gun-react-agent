# Tasks嚗dd-decision-provenance-context-references

> 靘?`second-stage-plan-en-v3.md` X8.9 ??proposal/design/specs ????鞈?X3 Persistent Audit?8 OTel?8.7 ResourceRef ??tenant/scope authorization?ackend-only????Task ??`- [x]` ?澆祕雿蒂撽???敺?賂?銝???詨?鋆祕雿?
## Phase 1嚗rovenance 璅∪?嚗ackend嚗?
### Task 1.1嚗遣蝡?DecisionRecord 璅∪?

- [x] 撱箇? `backend/src/runtime/provenance/decision-record.ts`
- [x] 摰儔 `DecisionRecord`嚗ecisionId?equestId??hreadId??unId??askId??tepId??ecisionType?utcome?easonCode?onfidence??olicyVersion??reatedAt嚗?- [x] 摰儔 `createDecisionRecord(input)` factory ??runtime validation嚗ecisionId嚗ecisionType嚗utcome嚗easonCode ?征嚗onfidence ?亙??券??嗥 [0,1] ??finite number嚗?蝯?NaN嚗nfinity嚗?0嚗?- [x] MUST NOT ?思遙雿?raw reasoning嚗hain-of-thought 甈?
- [x] ?桀?皜祈岫嚗?瘜遣蝡撩甈????onfidence 頞???? raw CoT 甈?

**撽嚗?* `cd backend && npx vitest run src/runtime/provenance/decision-record.test.ts` ??

### Task 1.2嚗遣蝡?EvidenceRef 璅∪?嚗???X8.7 ResourceRef嚗?
- [x] 撱箇? `backend/src/runtime/provenance/evidence-ref.ts`
- [x] 摰儔 `EvidenceRole`嚗nput嚗upporting嚗ontradicting嚗olicy嚗emory嚗ool_result嚗? `EvidenceRef`嚗videnceRefId?ecisionId?esource: ResourceRef?ole?bservedAt?esourceVersion??napshotHash?嚗?- [x] 敺?`backend/src/runtime/authorization/resource-ref.js` import `ResourceRef`嚗UST NOT 摰儔蝡嗥鞈?頨思遢
- [x] 摰儔 runtime validation嚗esource.resourceId嚗enantId ?征?ole ?箏?瘜???
- [x] ?桀?皜祈岫嚗?瘜遣蝡?瘜?role ???esource 蝻?tenantId ???窒?典?銝 `ResourceRef` ?

**撽嚗?* `cd backend && npx vitest run src/runtime/provenance/evidence-ref.test.ts` ??

### Task 1.3嚗遣蝡?ContextRef 璅∪?嚗pen-set relationType嚗?
- [x] 撱箇? `backend/src/runtime/provenance/context-ref.ts`
- [x] 摰儔 `ContextRef`嚗ontextRefId?ource: ResourceRef?arget: ResourceRef?elationType?reatedAt嚗?- [x] 摰儔 `SUGGESTED_RELATION_TYPES` 撣豢嚗erived_from嚗roduced_by嚗upports嚗ontradicts嚗entions嚗elected_from嚗enerated_from嚗??銝???closed union嚗relationType: string`
- [x] 摰儔 runtime validation嚗ource嚗arget resource ?征?elationType ?征嚗?- [x] ?桀?皜祈岫嚗?瘜遣蝡??relationType 隞撱箇?嚗????Core嚗撩甈???

**撽嚗?* `cd backend && npx vitest run src/runtime/provenance/context-ref.test.ts` ??

---

## Phase 2嚗ersistence嚗ackend嚗?
### Task 2.1嚗遣蝡?decision-record-store

- [x] 撱箇? `backend/src/runtime/provenance/decision-record-store.ts`
- [x] 摰儔 `DecisionRecordStore` 隞嚗ecord?indByDecisionId?indByTaskId?indByStepId嚗?- [x] 撱箇? `PgDecisionRecordStore` 霈撖?`decision_records`
- [x] ?賢? MUST ??X8.7 authorization `DecisionStore`嚗PgDecisionStore` ???MUST NOT ??barrel export ?Ｙ???瘛瑟?
- [x] `record()` 撖怠?? open-string 甈?憟?Ｘ??嚗??啣? raw content 甈?嚗?豢??批???X8.7 `ContextRedactor`嚗?- [x] ?桀?皜祈岫嚗ock DB嚗?record?? decisionId嚗askId嚗tepId ?亥岷

**撽嚗?* `cd backend && npx vitest run src/runtime/provenance/decision-record-store.test.ts` ??

### Task 2.2嚗遣蝡?evidence-store ??context-ref-store

- [x] 撱箇? `backend/src/runtime/provenance/evidence-store.ts`嚗EvidenceStore` 隞 + `PgEvidenceStore` 霈撖?`decision_evidence_refs`嚗ecord?indByDecisionId?indByResource嚗?- [x] 撱箇? `backend/src/runtime/provenance/context-ref-store.ts`嚗ContextRefStore` 隞 + `PgContextRefStore` 霈撖?`context_refs`嚗ecord?indRelatedOneHop嚗?- [x] `findRelatedOneHop` ?芣 `source=resource OR target=resource` ??1-hop relation嚗UST NOT ???艘?風
- [x] `record()` 撖怠? `source.tenantId !== target.tenantId`嚗UST ?? X8.7 `authorize()`嚗? target ?瑁? read action嚗炎?伐?deny ?單?蝯神?伐?頝?tenant relation ?身 deny嚗?- [x] ?桀?皜祈岫嚗ock DB嚗?record?? decisionId ??evidence?? resource ??1-hop relation?imit ?芣?楊 tenant relation 撖怠鋡急??? tenant 撖怠?迂

**撽嚗?* `cd backend && npx vitest run src/runtime/provenance/evidence-store.test.ts src/runtime/provenance/context-ref-store.test.ts` ??

### Task 2.3嚗憓?migrations

- [x] ?啣? `014_create_decision_records.sql`
- [x] ?啣? `015_create_decision_evidence_refs.sql`
- [x] ?啣? `016_create_context_refs.sql`
- [x] ?湔 `backend/src/runtime/persistence/migration-runner.ts` ??`MIGRATION_FILES` 撣豢???嚗???014嚗?15嚗?16 銝????Ｘ??????hardcoded tuple嚗???甇交?堆?
- [x] ?郊?湔 `migration-runner.test.ts` ??migrationNames ?瑁?
- [x] 撱箇?敹? index嚗? task_id嚗tep_id嚗ecision_type ??decision嚗? decision_id嚗esource ??evidence嚗? source嚗arget ??context_ref嚗?- [x] ??additive嚗CREATE TABLE IF NOT EXISTS`嚗?銝??001??13

**撽嚗?* migration-runner ?臬??典??migration嚗cd backend && npm run test`嚗 migration-runner 皜祈岫嚗?

---

## Phase 3嚗ontextReferenceResolver ??甈??backend嚗?
### Task 3.1嚗遣蝡?AuthorizedContextReferenceResolver

- [x] 撱箇? `backend/src/runtime/provenance/context-reference-resolver.ts`
- [x] 摰儔 `ContextReferenceResolver` 隞嚗indRelated(resource, principal, scope, options)嚗?- [x] 撱箇? `AuthorizedContextReferenceResolver`嚗? `authorize(principal, scope, "read", resource)`嚗???1-hop `context_refs`嚗?瘥 target ?瑁? `authorize(..., "read", target)`嚗eny ?嚗imit ?芣
- [x] ??銝??fail-closed嚗???`[]`嚗?MUST NOT ?曇?
- [x] MUST NOT ??隞餅? multi-hop ?艘?風
- [x] ?桀?皜祈岫嚗llow ??楊 tenant deny??? target ??imit??甈仃??fail-closed

**撽嚗?* `cd backend && npx vitest run src/runtime/provenance/context-reference-resolver.test.ts` ??

---

## Phase 4嚗orrelation?edaction ??閬?backend嚗?
### Task 4.1嚗arrel export ??correlation 撽?

- [x] 撱箇? `backend/src/runtime/provenance/index.ts` barrel export
- [x] 蝣箄? `DecisionRecord` ?臬葆 requestId嚗hreadId嚗unId嚗askId嚗tepId嚗EvidenceRef.resource` ?臬???`tool_execution`嚗? `ResourceRef`嚗?- [x] 蝣箄? provenance 銝?銴?X3 Audit ??X8.6 ToolExecution ?脣?嚗摮?ref/correlation嚗?- [x] 蝣箄???raw prompt嚗oT嚗redential嚗nmasked PII嚗nrestricted tool output 甈?
- [x] ?桀?皜祈岫嚗orrelation 甈???? raw content 甈??? import 璆剖?璅∠?

**撽嚗?* `cd backend && npx vitest run src/runtime/provenance/*.test.ts` ??

### Task 4.2嚗??霅???

- [x] `cd backend && npm run lint` ??
- [x] `cd backend && npm run test` ??嚗?Ｘ? authorization嚗udit嚗ide-effect ?飛嚗?- [x] `cd backend && npm run build` ??
- [x] 蝣箄???`any` 瞈怎?蝖祉楊蝣潭平??decisionType嚗elationType嚗esourceType ?賢??桐??箔蜓閬?resolver
- [x] 蝣箄? `backend/src/runtime/provenance/` 銝?import 隞颱?璆剖?璅∠?
- [x] `openspec validate add-decision-provenance-context-references --strict` ??

**撽嚗?* Backend lint/test/build ?券??嚗penSpec strict validation 0 issues
