# recommendation-domain-framework Specification

## Purpose
本 capability 定義與業務領域解耦的 Recommendation 框架（X9 / Layer 3）：DomainRouter（註冊制 routing）、RecommendationDomainAdapter 泛型注入邊界、ConstraintEngine（hard/soft 與 5 階 source 優先權衝突解析）、BusinessPolicyGate、ClarificationFlow、RecommendationCard，並消費 X8.9 Decision Provenance 記錄重大推薦決策。框架不實作向量檢索、不建自有持久化表、不硬編碼業務領域。
## Requirements
### Requirement: 框架 MUST 與業務領域解耦，import 零業務常數

Recommendation 框架 Core MUST NOT import 或硬編碼任何具體業務 Domain（Hair／Nail／Food）、產品 schema 或業務常數。所有業務變異 MUST 經 `RecommendationDomainAdapter<TIntent, TProduct, TCard>` 泛型介面注入。

#### Scenario: 框架不含任何業務 domain 名稱或產品 schema

GIVEN 推薦框架 Core 被建立
WHEN 檢視其 import 與常數
THEN MUST NOT 出現任何具體業務 domain 名稱、產品欄位 schema 或業務白名單
AND 業務差異 MUST 只經由 `RecommendationDomainAdapter` 注入

#### Scenario: 新增 Domain 不需修改 Core

GIVEN 未來新增一個業務 Domain（如 Hair）
WHEN 以 `RecommendationDomainAdapter` 實作該 Domain
THEN Core 型別、常數或 schema MUST NOT 需要修改
AND 新 Domain 可直接註冊使用

---

### Requirement: DomainRouter MUST 以註冊制 routing，MUST NOT 硬編碼 domain 判定

`DomainRouter` MUST 依已註冊 Adapter 的 `domain` 為 route 目標。routing 決策 MUST 由注入的 `DomainRoutingStrategy` 提供（多 Domain 時），MUST NOT 以硬編碼自然語言關鍵字、句型或輸入白名單作為主要判定。route 結果未知或未註冊時 MUST fail-closed。

#### Scenario: 單一註冊 Adapter 確定性 route

GIVEN 僅一個 Adapter 註冊於 domain `mock`
WHEN 呼叫 `route(input)`
THEN MUST 確定性回傳 `mock`
AND MUST NOT 依輸入文字內容猜測

#### Scenario: 多 Domain 委派注入策略

GIVEN 多個 Adapter 註冊
AND 已注入 `DomainRoutingStrategy`
WHEN 呼叫 `route(input)`
THEN MUST 委派給注入的策略回傳 domain
AND 策略 MUST 為 config／capability 注入，非 Core 硬編碼

#### Scenario: 未註冊 domain fail-closed

GIVEN `DomainRoutingStrategy` 回傳未註冊的 domain
WHEN 呼叫 `route(input)`
THEN MUST 回傳錯誤
AND MUST NOT 猜測或回退到任一已註冊 domain

---

### Requirement: Constraint Engine MUST 依 source 優先權解析衝突並區分 hard/soft

`ConstraintEngine` MUST 依固定優先權（`user_text` > `selection` > `vision` > `memory` > `model_inference`）解析同一 `field` 的多 source constraint 衝突。`evaluateCandidate` MUST 區分 hard（違反 → `eligible=false`）與 soft（違反 → 調整 `adjustedScore`）模式。

#### Scenario: 高優先權 source 覆寫低優先權

GIVEN 同一 `field` 同時有 `user_text`（value=A）與 `memory`（value=B）兩個 constraint
WHEN `resolve` 執行
THEN 勝出值 MUST 為 `user_text` 的 A
AND 衝突解析 MUST 可追溯（記錄勝出 source）

#### Scenario: 同 source 同 confidence 衝突保留並標記，不靜默選一

GIVEN 同一 `field` 有兩個 `source` 與 `confidence` 皆相同但 `value` 衝突的 constraint
WHEN `resolve` 執行
THEN MUST 將兩者保留於 `ConstraintResolution.conflicts` 並標記衝突
AND MUST NOT 靜默選擇其一
AND hard 衝突於 `evaluateCandidate` MUST fail-closed 排除（`HARD_CONSTRAINT_CONFLICT`）

#### Scenario: hard 違反排除候選

GIVEN 一個 hard constraint（`field=category, value=X`）
AND 候選 `category=Y`
WHEN `evaluateCandidate` 執行
THEN `eligible` MUST 為 false
AND `reasonCode` MUST 標記 hard-violation

#### Scenario: soft 違反僅調整分數

GIVEN 一個 soft constraint（`field=color, value=red`）
AND 候選 `color=blue`
WHEN `evaluateCandidate` 執行
THEN `eligible` MUST 仍為 true
AND `adjustedScore` MUST 被調整而非排除

#### Scenario: confidence 越界被拒絕

GIVEN 建立 `Constraint` 時 `confidence` 超出 [0,1] 或非 finite
WHEN 執行 runtime validation
THEN MUST 回傳錯誤
AND MUST NOT 參與解析或評估

---

### Requirement: BusinessPolicyGate MUST 直接排除 Hard constraint 違反，MUST NOT 降分代替排除

`BusinessPolicyGate` MUST 將 hard constraint 違反視為直接排除（`eligible=false`），MUST NOT 以分數懲罰代替排除。soft 違反 MUST 僅調整分數。

#### Scenario: hard 違反直接排除非降分

GIVEN 候選違反 hard constraint
WHEN 經 `BusinessPolicyGate.apply`
THEN `eligible` MUST 為 false
AND MUST NOT 以調整 `adjustedScore` 取代排除

#### Scenario: 已排除候選不被翻轉

GIVEN `CandidateDecision.eligible` 為 false
WHEN 經 `BusinessPolicyGate.apply`
THEN `eligible` MUST 保持 false
AND MUST NOT 被翻轉為 true

---

### Requirement: 重大推薦決策 MUST 經 X8.9 持久化，MUST NOT 建重複 provenance 表

routing／clarification／candidate-policy 等重大決策 MUST 經 X8.9 `DecisionRecordStore` + `EvidenceStore` 持久化，含 `policyVersion` 與證據引用。X9 MUST NOT 建立 Recommendation-only 的 Decision/Evidence/Context 表或 business-local DecisionRecord schema。

#### Scenario: 重大決策寫入 X8.9 DecisionRecord

GIVEN 一次 routing／clarification／candidate-policy 決策
WHEN 該決策被記錄
THEN MUST 呼叫 X8.9 `createDecisionRecord` 與 `DecisionRecordStore.record()`
AND MUST 記錄 `decisionType`／`outcome`／`reasonCode` 與可用的 `policyVersion`

#### Scenario: 證據經 X8.9 EvidenceRef 引用

GIVEN 一個 candidate 決策具 input 與 candidate/product 證據
WHEN 建立證據
THEN MUST 以 X8.9 `EvidenceRef`（重用 X8.7 `ResourceRef`）記錄
AND 證據 `role` MUST 標記 input／supporting／contradicting／policy

#### Scenario: 不建立重複表或 business-local schema

GIVEN X9 實作完成
WHEN 檢視 persistence 層
THEN MUST NOT 新增任何 Recommendation-only 表或 migration
AND MUST NOT 定義 business-local `DecisionRecord` schema（僅使用 X8.9）

#### Scenario: 只存 reference 不複製 raw payload

GIVEN 建立 candidate 證據時候選含 raw 內容
WHEN 持久化
THEN MUST 只存 `ResourceRef`／version／hash
AND MUST NOT 複製 raw prompt／chain-of-thought／credential／unmasked PII

---

### Requirement: Clarification flow MUST 低信心進入 HITL，MUST NOT 建平行機制

低信心意圖或 hard-constraint 缺失時，ClarificationFlow MUST 產出澄清請求並進入既有 `waiting_confirmation`（HITL）流程。X9 MUST NOT 建立平行排程、佇列或 HITL 狀態儲存。

#### Scenario: 低信心觸發澄清

GIVEN 意圖信心低於可配置門檻
WHEN 評估澄清需求
THEN `shouldClarify` MUST 回傳 true
AND 產出 `ClarificationRequest`

#### Scenario: 高信心不觸發澄清

GIVEN 意圖信心高於門檻且 hard constraint 齊備
WHEN 評估澄清需求
THEN `shouldClarify` MUST 回傳 false
AND 不產出澄清請求

#### Scenario: 澄清請求進入既有 HITL 契約

GIVEN 產出 `ClarificationRequest`
WHEN 進入等待流程
THEN MUST 複用既有 `waiting_confirmation`（X1／X8.8）契約
AND MUST NOT 建立平行 HITL 排程或狀態儲存

---

### Requirement: Generic Card MUST 為業務中立的 envelope，layout 由 Adapter 注入

`RecommendationCard` MUST 只提供業務中立的 envelope（`cardId`／`domain`／`candidateRef: ResourceRef`／`payload`／`createdAt`），rendering layout 由 Adapter 實作。

#### Scenario: Card 為通用 envelope

GIVEN 一個 eligible candidate
WHEN `buildCard` 建立 card
THEN card MUST 僅含 envelope 欄位
AND `candidateRef` MUST 為 X8.7 `ResourceRef`
AND layout 內容 MUST 放在泛型 `payload`，由 Adapter 決定

---

### Requirement: recall MUST 由注入提供，框架只定義 RetrievalPolicy

框架 MUST NOT 實作向量檢索或語意召回。框架只定義 `RetrievalPolicy`；實際候選召回 MUST 由注入的 `CandidateRetriever<TProduct>` 提供。

#### Scenario: 框架不實作召回

GIVEN 推薦框架執行
WHEN 需要候選召回
THEN MUST 委派給注入的 `CandidateRetriever.retrieve(policy)`
AND 框架 MUST NOT 內建向量檢索或語意推論

#### Scenario: RetrievalPolicy 由 intent 推導

GIVEN Adapter 已擷取 intent
WHEN `buildRetrievalPolicy(intent)` 被呼叫
THEN MUST 回傳含 `domain`／`candidateLimit`／可選 `filters` 的 policy
AND 實際召回以該 policy 為參數，不與框架耦合

---

### Requirement: Runtime 輸入 MUST 承接 X8.7 trusted identity，MUST NOT 信任任意 client identity

`RecommendationInput` MUST 承接 X8.7 `PrincipalContext` 與 `RuntimeScope`，MUST NOT 自行解析身份或信任任意 client identity header。

#### Scenario: 輸入承接 trusted identity

GIVEN 一個 `RecommendationInput`
WHEN 建立輸入
THEN `principal` MUST 為 X8.7 `PrincipalContext`
AND `scope` MUST 為 X8.7 `RuntimeScope`
AND 框架 MUST NOT 從 raw 輸入推導 tenant／principal

