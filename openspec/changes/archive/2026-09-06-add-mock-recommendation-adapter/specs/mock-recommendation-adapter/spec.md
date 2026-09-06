# Specs：add-mock-recommendation-adapter

## ADDED Requirements

### Requirement: Mock Adapter MUST 實現 RecommendationDomainAdapter 且僅含三屬性

`MockRecommendationAdapter` MUST 實現 X9 `RecommendationDomainAdapter<TIntent, TProduct, TCard>`，以封閉 `domain` 常數 `mock` 註冊，業務變異僅限 `category`／`color`／`price` 三屬性，MUST NOT 引入任何真實業務（Hair／Nail／Food）常數或 schema。

#### Scenario: 單一註冊後確定性 route 至 mock

GIVEN `MockRecommendationAdapter` 註冊於 `DomainRouter`
WHEN 呼叫 `route(input)`
THEN MUST 確定性回傳 `mock`
AND MUST NOT 依輸入文字內容猜測

#### Scenario: 不含任何真實業務常數

GIVEN Mock Adapter 被建立
WHEN 檢視其 import 與常數
THEN MUST NOT 出現 Hair／Nail／Food 或任何真實產品 schema
AND 業務差異 MUST 僅經 `category`／`color`／`price` 三欄位表達

---

### Requirement: Mock intent MUST 由結構化 signals 推導，MUST NOT 以自然語言關鍵字判定

`extractIntent` MUST 只由 `RecommendationInput.signals`（已結構化 `Constraint[]`）推導 `MockIntent`（`category?`／`color?`／`price?` 與 `confidence`）。MUST NOT 以 `rawText` 自然語言關鍵字、句型或輸入白名單作為主要 intent 判定。

#### Scenario: 由 signals 推導 intent 欄位

GIVEN `signals` 含一個 hard constraint（`field=category, value=X, source=user_text`）
WHEN `extractIntent` 執行
THEN `MockIntent.category` MUST 為 `X`
AND `confidence` MUST 為 [0,1] 內 finite number

#### Scenario: rawText 不參與 intent 判定

GIVEN `rawText` 含與 `signals` 矛盾的自然語言文字
WHEN `extractIntent` 執行
THEN intent MUST 只由 `signals` 決定
AND MUST NOT 依 `rawText` 關鍵字覆寫或補充 intent

#### Scenario: 未知欄位不臆測

GIVEN `signals` 含 `category` 以外的未知欄位（如 `style`）
WHEN `extractIntent` 執行
THEN MUST NOT 將未知欄位臆測為業務屬性
AND 未知欄位 MUST 不影響已知欄位的推導

---

### Requirement: Mock catalog MUST 提供 10–20 筆種子資料並含 A1/A2/A3 hard-negative set

Mock catalog MUST 提供 10–20 筆 `MockProduct` 種子資料，包含 hard-negative 三例（A1/A2/A3），每個 product MUST 承載 X8.7 scope 投影（`tenantId`／`ownerScopeId`）。

#### Scenario: 種子資料規模與 hard-negative 集合

GIVEN Mock catalog 被建立
WHEN 檢視其種子資料
THEN `MockProduct` 筆數 MUST 介於 10–20
AND MUST 含 A1（category=X, color=red）、A2（category=X, color=blue）、A3（category=Y, color=red）

#### Scenario: 每個 product 承載 scope 投影

GIVEN 任一 `MockProduct`
WHEN 檢視其欄位
THEN MUST 含非空 `tenantId` 與 `ownerScopeId`
AND 值 MUST 為字串

---

### Requirement: Hard constraint 違反 MUST 直接排除候選，MUST NOT 降分代替排除

當 user 的 hard constraint 與候選值不符（如 hard `category=X` 而候選 `category=Y`），候選 MUST 被直接排除（`eligible=false`），`reasonCode` MUST 標記 hard-violation（X9 `HARD_CONSTRAINT_VIOLATION`），MUST NOT 以調整分數代替排除。

#### Scenario: A3 被 hard constraint 直接排除

GIVEN hard constraint `field=category, value=X`
AND 候選 A3 `category=Y, color=red`
WHEN 經 `ConstraintEngine.evaluateCandidate` 與 `BusinessPolicyGate.apply`
THEN `eligible` MUST 為 false
AND `reasonCode` MUST 為 `HARD_CONSTRAINT_VIOLATION`
AND MUST NOT 以 `adjustedScore` 取代排除

#### Scenario: A1/A2 保留 eligible

GIVEN hard constraint `field=category, value=X`
AND 候選 A1 `category=X, color=red` 與 A2 `category=X, color=blue`
WHEN 經評估
THEN `eligible` MUST 為 true
AND 兩者皆進入 card 產出

#### Scenario: color 差異不構成 hard 排除

GIVEN hard constraint 僅 `field=category, value=X`
AND 候選 `category=X, color=blue`（color 與 user 期待不同）
WHEN 經評估
THEN `eligible` MUST 為 true
AND 不得因 color 不同而排除

---

### Requirement: 未解決 hard conflict MUST fail-closed 排除並觸發澄清

當輸入 signals 對同一 `field` 存在「同 source、同 confidence、value 衝突」的 hard constraint 時，框架 MUST fail-closed 排除（`reasonCode=HARD_CONSTRAINT_CONFLICT`）並觸發澄清，MUST NOT 靜默選一。

#### Scenario: hard conflict 排除並觸發澄清

GIVEN signals 含兩個 hard constraint 於 `category`：`value=X` 與 `value=Y`（同 source、同 confidence）
WHEN 經評估與澄清評估
THEN `eligible` MUST 為 false
AND `reasonCode` MUST 為 `HARD_CONSTRAINT_CONFLICT`
AND `clarificationRequested` MUST 為 true

---

### Requirement: 全鏈整合 MUST 經 DomainRoute → Intent → Constraint → Gate → Card，且不需真實業務屬性

Mock 整合測試 MUST 證明框架以注入的 Adapter 完成 routing → intent → constraint → gate → card 全鏈，且全程不需任何真實業務屬性。

#### Scenario: 全鏈以 Mock 完成

GIVEN 組合 `RecommendationEngine`（DomainRouter + MockRecommendationAdapter + MockCandidateRetriever + ConstraintEngine + BusinessPolicyGate + ClarificationFlow + ProvenanceWriter test double）
WHEN 呼叫 `recommend(input)`
THEN MUST 依序執行 route → extractIntent → buildRetrievalPolicy → retrieve → evaluateCandidate → gate.apply → buildCard
AND 回傳的 `cards` 僅含 eligible 候選的 card

#### Scenario: 換 Adapter 框架行為一致

GIVEN 兩個不同 `domain` 的 Mock 變體注入同一框架
WHEN 分別執行 recommend
THEN 框架 Core 型別、常數與評估語意 MUST 不需修改
AND 兩者的 hard 排除／soft 調整語意 MUST 一致

---

### Requirement: buildCard 的 candidateRef MUST 承接 X8.7 scope 並通過 tenant/owner 驗證

`buildCard` 產出的 `RecommendationCard.candidateRef` MUST 為 X8.7 `ResourceRef`，其 `tenantId`／`ownerScopeId` MUST 與推薦 scope 一致；不一致時 framework MUST fail-closed 拒絕。

#### Scenario: candidateRef 匹配 scope

GIVEN `RecommendationInput.scope` 為 tenant T、scope S
AND 候選 `MockProduct.tenantId=T, ownerScopeId=S`
WHEN `buildCard` 產出 card
THEN `candidateRef.tenantId` MUST 為 T
AND `candidateRef.ownerScopeId` MUST 為 S

#### Scenario: candidateRef 不匹配 scope 被拒絕

GIVEN 候選 `MockProduct.tenantId` 與 `RecommendationInput.scope.tenantId` 不一致
WHEN 經 `RecommendationEngine.recommend`
THEN MUST 回傳錯誤
AND MUST NOT 產出 card

---

### Requirement: 框架 Core MUST 保持零業務 import 與零變更

X10 MUST NOT 修改 X9 框架 Core 或使其 import 任何 Mock 業務常數。Mock 為注入方，框架為被注入方。

#### Scenario: Core 零 Mock import

GIVEN X10 實作完成
WHEN 檢視 X9 框架 Core 的 import 與常數
THEN MUST NOT import 任何 `mock-recommendation` 或 Mock 業務常數
AND MUST NOT 新增 mock domain 名稱至 Core 型別或常數
