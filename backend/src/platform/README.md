# Platform Extension Points

此目錄保留大廠模式需要的擴充點。

## BFF / API Gateway

目前 frontend 可透過 `VITE_LANGGRAPH_API_URL` 指向 LangGraph Agent Server。Production 建議改指向 BFF / API Gateway，再由 BFF 轉發到 Agent Runtime。

BFF 建議承擔：

- Authentication 與 authorization。
- Tenant / user context 注入。
- Request validation。
- Rate limiting。
- Audit log。
- Feature flags 與 gray release。
- 對外統一 API contract。

## LLM Gateway

`llm-gateway.ts` 目前接 Gemini。後續可替換為公司內部 LLM Gateway。

LLM Gateway 建議承擔：

- Model routing。
- Cost control。
- Prompt / response logging。
- Safety policy。
- Fallback model。
- Token quota。

## Tool Governance

`tool-governance.ts` 目前提供 policy 與 audit hook。後續可擴充：

- Tool permission。
- Tool audit。
- Rate limit。
- Circuit breaker。
- Gray release。
- Sensitive operation confirmation。

## Observability

`observability.ts` 目前使用 console。Production 建議接：

- Trace。
- Metrics。
- Audit events。
- Alerting。
- LangSmith 或公司內部 observability platform。
