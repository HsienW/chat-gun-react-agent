# Second Stage — GitHub Issues (Copy-Paste Ready)

> Each section below is a self-contained GitHub Issue. Copy from `##` to the next `---` and paste directly.

## Labels & Milestones Reference

| Milestone | Issues |
|---|---|
| `Second Stage - Layer 0: Runtime Boundary` | X0 |
| `Second Stage - Layer 1: Task Runtime` | X1–X5 |
| `Second Stage - Layer 2: Platform Governance` | X6–X8, X8.5 |
| `Second Stage - Layer 3: Recommendation Framework` | X9–X10 |
| `Second Stage - Layer 4: Business Adapters (Optional)` | X11–X13 |

| Label | Apply to |
|---|---|
| `second-stage` | All issues |
| `layer-0` / `layer-1` / `layer-2` / `layer-3` / `layer-4` | Per layer |
| `backend` / `bff` / `frontend` | Per package |
| `optional` | X11–X13 only |

**Branch naming:** `feat/second-stage/<change-name>`

---

## X0 — verify-langgraph-server-runtime-boundary

**Labels:** `second-stage`, `layer-0`, `backend`
**Milestone:** Second Stage - Layer 0: Runtime Boundary
**Dependencies:** None

---

## Verify LangGraph Server Native Runtime Boundary

### Goal
Before building the custom Task Runtime, clarify the capability boundaries of LangGraph Agent Server's built-in Queue, Worker, Checkpointer, and Store. Produce a Decision Record that guides all subsequent Layer 1–2 work.

### Background
The project's `docker-compose.yml` already runs `langgraph-api` alongside PostgreSQL and Redis. LangGraph officially distinguishes:
- **Checkpointer**: thread-scoped short-term state (Graph state, HITL, fault recovery)
- **Store**: cross-thread long-term memory (user preferences, persistent memory)

This issue validates exactly what each covers in practice, so we don't reinvent what LangGraph already provides.

### Scope
- Run a complete LangGraph Server background run + interrupt/resume cycle
- Confirm PostgreSQL Checkpointer coverage (which states it manages, which it doesn't)
- Confirm LangGraph Server built-in Queue/Worker behavior
- Verify LangGraph Store cross-thread read/write
- Draw a responsibility boundary diagram
- Write `docs/decisions/langgraph-runtime-boundary.md`

### Decision Record Must Cover

| Capability | LangGraph Native | Custom Task Runtime | Rationale |
|---|---|---|---|
| Graph State persistence | Checkpointer (PG) | — | Native |
| HITL interrupt/resume | ✅ | — | Native |
| Business Task/Step state | — | ✅ Custom | LangGraph has no business semantics |
| Task Queue | Built-in | — | Native |
| Retry (step-level) | Partial (node retry) | ✅ Custom | Native retry granularity insufficient |
| Tool Idempotency | — | ✅ Custom | Native does not manage side effects |
| Audit | — | ✅ Custom | Native has no audit concept |
| Distributed Lock | — | ✅ Custom | Native has no concurrency control |
| Cross-task Memory | Store (PG) | — | Native |
| Cost Tracking | — | ✅ Custom | Native has no cost concept |

### Acceptance
- [ ] LangGraph Server successfully completes a full interrupt/resume cycle
- [ ] Responsibility boundary diagram documented in the decision record
- [ ] Every custom Task Runtime capability is justified as "fills a native gap" — not "reinvents the wheel"
- [ ] Decision record reviewed and approved

---

## X1 — add-agent-task-state-machine

**Labels:** `second-stage`, `layer-1`, `backend`, `bff`, `frontend`
**Milestone:** Second Stage - Layer 1: Task Runtime
**Dependencies:** X0

---

## Establishing the Agent Task/Step State Machine and PostgreSQL Persistence

### Goal
To establish a generic Agent Task Runtime core that is not bound to any business logic: Task/Step State Machine, PostgreSQL persistence, and a front-end Streaming Timeline.

### Background
Currently, the project's LangGraph Checkpointer is responsible for the Graph execution state, but lacks business-level Task/Step semantics. This results in:
- Inability to track the specific business progress of an Agent task
- Inability to know which Steps have been completed and what the next step should be after an interruption
- Audits cannot be associated with specific Tasks/Steps

### Scope
- `backend/`: Task/Step State Machine (generic design), Task Events
- `backend/`: PostgreSQL read/write layer (`agent_tasks`, `task_steps`, `task_events`)
- `bff/`: Task/Step API routes (queries, subscriptions)
- `frontend/`: Streaming Task Timeline component

#### Task State Machine

```text
created → running → waiting_confirmation → completed
                  ↘ partially_failed → compensating → failed
                  ↘ cancelled
```

#### Step State Machine

```text
pending → running → waiting_confirmation → succeeded
                                          ↘ retryable_failed
                                          ↘ terminal_failed
                                          ↘ compensating → compensated
                                          ↘ skipped
```

#### Generic Type System (do not hard-code any business Step name)

```typescript
interface AgentTask<TStep extends string = string> {
  taskId: string;
  taskType: string;
  status: TaskStatus;
  steps: AgentStep<TStep>[];
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

interface AgentStep<TStep extends string = string> {
  stepId: string;
  stepName: TStep;
  status: StepStatus;
  attempt: number;
  maxAttempts: number;
  input?: unknown;
  output?: unknown;
  error?: StepError;
  startedAt?: string;
  completedAt?: string;
}

interface TaskEvent {
  eventId: string;
  taskId: string;
  stepId?: string;
  eventType: "task_created" | "step_started" | "step_completed" | "step_failed"
    | "step_retrying" | "task_completed" | "task_failed" | "compensation_triggered"
    | "compensation_completed" | "waiting_confirmation" | "resumed";
  payload?: unknown;
  createdAt: string;
}
```

### Excludes
- ❌ Retry, Idempotency, Compensation (subsequent Issues)
- ❌ Any business Step name or business logic

### Acceptance
- [ ] Complete lifecycle test of Task from created → completed
- [ ] Step state transition covers all legal and illegal paths
- [ ] Correct PostgreSQL read/write
- [ ] Frontend Timeline renders in real-time based on Task/Step Event
- [ ] `npm run lint && npm run test && npm run build` all pass

### Related Files
- Docker: `docker-compose.yml` (PG + Redis already configured)
- LangGraph State: `backend/src/state.ts`
- Frontend Stream: `frontend/src/App.stream-activity.test.tsx`

---

## X2 — add-agent-retry-budget

**Labels:** `second-stage`, `layer-1`, `backend`, `bff`
**Milestone:** Second Stage - Layer 1: Task Runtime
**Dependencies:** X1

---

## Establish a Generic Retry Budget Framework

### Goal
To establish a generic Step-level Retry Policy framework that distinguishes retry strategies per error type and enforces upper-bound limits.

### Scope
- `backend/`: Error classification framework

| Error Type | Retry? | Strategy |
|---|---|---|
| Timeout | Yes | Exponential backoff + jitter |
| 429 (Rate Limit) | Yes | Respect Retry-After header |
| 5xx | Yes | Limited retries |
| Schema Invalid | Conditional | Single output repair attempt |
| Permission Denied | No | Escalate to HITL / terminate |
| Business Rejected | No | Return explainable result |
| User Cancelled | No | Execute necessary compensation |

- `backend/`: Retry Policy configuration

```typescript
interface RetryPolicy {
  maxAttempts: number;
  maxElapsedMs: number;
  retryableCodes: string[];
  backoffStrategy: "exponential" | "fixed" | "retry-after-header";
  jitter: boolean;
}
```

- `backend/`: Retry Budget Tracker (tracks attempts and elapsed time per Step; hard-stops on budget exhaustion)
- `bff/`: Cancel signal propagation (BFF cancel → Backend abort)

### Excludes
- ❌ Idempotency (X3)
- ❌ Compensation (X4)

### Acceptance
- [ ] Timeout retries correctly, respects maxAttempts
- [ ] 429 respects Retry-After header
- [ ] Non-retryable errors (Permission/Business/UserCancel) are never retried
- [ ] maxElapsedMs exceeded → hard stop
- [ ] Exponential backoff + jitter verified
- [ ] `npm run lint && npm run test && npm run build` all pass

### Dependencies
- Requires X1 Task/Step model

---

## X3 — add-agent-idempotency-audit

**Labels:** `second-stage`, `layer-1`, `backend`, `bff`
**Milestone:** Second Stage - Layer 1: Task Runtime
**Dependencies:** X1

---

## Establish a Generic Idempotency Framework and Persistent Audit

### Goal
1. Establish a generic idempotency key mechanism to prevent duplicate side-effect execution.
2. Upgrade the current console audit to PostgreSQL-persisted Audit.

### Background
The project's Tool Governance (`backend/src/platform/tool-governance.ts`) already provides `auditLogger` (console-only) and tool timeout/input/output limits. Missing:
- Idempotency protection (retries and resumes may re-execute side effects)
- Persistent Audit (cannot reconstruct operation history after the fact)

### Scope
- `backend/`: Idempotency framework

```typescript
interface IdempotencyKey {
  namespace: string;    // e.g. "task", "tool_execution"
  resourceKey: string;  // composite key defined by the caller
  version: string;      // policy version — prevents cross-version replay
}

interface IdempotencyRecord {
  key: string;
  status: "locked" | "completed" | "failed";
  result?: unknown;
  createdAt: string;
  expiresAt: string;
}
```

- `backend/`: Audit Events schema + PostgreSQL read/write layer

```typescript
interface AuditEvent {
  eventId: string;
  taskId: string;
  stepId?: string;
  toolExecutionId?: string;
  actorType: "system" | "user" | "agent";
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  decision: "allow" | "deny" | "pending_confirmation";
  reasonCode?: string;
  beforeStateRef?: string;
  afterStateRef?: string;
  createdAt: string;
}
```

- `backend/`: Redaction rules — MUST NOT persist: API Keys, full prompts, full conversations, raw credentials, unmasked PII. MUST persist: structured summaries, hashes, references, redacted payloads.
- `bff/`: Idempotency key propagation (request header → backend)

### Tables
- `idempotency_records`
- `audit_events`

### Excludes
- ❌ Compensation (X4)

### Acceptance
- [ ] Same idempotency key executed repeatedly → side effect runs only once
- [ ] Expired idempotency key allows re-execution
- [ ] Audit reconstructs the full operation sequence
- [ ] Redaction rules correctly block sensitive fields
- [ ] `npm run lint && npm run test && npm run build` all pass

### Dependencies
- Requires X1 Task/Step model
- Requires Docker PostgreSQL (already configured)

---

## X4 — add-agent-compensation-runtime

**Labels:** `second-stage`, `layer-1`, `backend`
**Milestone:** Second Stage - Layer 1: Task Runtime
**Dependencies:** X1, X3

---

## Establish a Generic Compensation / Saga Framework

### Goal
To establish a business-level Saga/Compensation framework supporting registrable compensation actions, irreversible markers, and compensation-failure escalation.

### Scope
- `backend/`: Compensation Action interface and registry

```typescript
interface CompensationAction {
  actionId: string;
  description: string;
  execute: () => Promise<CompensationResult>;
  isReversible: boolean;  // false = cannot roll back, requires manual intervention
}

interface CompensationPlan {
  taskId: string;
  completedSteps: string[];
  failurePoint: string;
  actions: CompensationAction[];
}
```

- `backend/`: Saga orchestrator — determines compensation scope by failure point
  - Step A success, Step B success, Step C failure → compensate B → compensate A
  - Only compensate completed steps; never touch unexecuted steps
- `backend/`: Compensation failure escalation (record, mark for manual handling, never silently succeed)
- `backend/`: Compensation events wired into Audit

### Compensation Strategy Examples

| Scenario | Compensation Action |
|---|---|
| Side effect succeeded, subsequent step failed | Keep completed side effect, retry only subsequent steps |
| Resource reserved, user cancelled | Release reserved resource |
| Status changed to complete, later action failed | Restore to pending |
| Communication already sent | Irreversible — mark invalid, send correction message |

### Acceptance
- [ ] Step C failure correctly compensates completed A and B in correct order
- [ ] `isReversible: false` actions never attempt automatic rollback
- [ ] Compensation failure correctly escalates and records — never silently swallowed
- [ ] `npm run lint && npm run test && npm run build` all pass

### Dependencies
- Requires X1 Task/Step model
- Requires X3 Idempotency/Audit (compensation events must enter Audit)

---

## X5 — add-distributed-step-lock

**Labels:** `second-stage`, `layer-1`, `backend`
**Milestone:** Second Stage - Layer 1: Task Runtime
**Dependencies:** X1, Redis (Docker)

---

## Add Distributed Lock for Step State Transitions

### Goal
Prevent two concurrent workers from simultaneously modifying the same Step state. This is the final piece of distributed state consistency.

### Background
X3 Idempotency prevents "same request re-executed", but cannot prevent:
- Two concurrent requests with the same taskId arriving at BFF
- LangGraph resume and external retry firing on the same Step simultaneously
- Compensation and normal flow operating on the same Task concurrently

Idempotency guards against duplicate creation via DB unique constraints, but **Step state transitions under concurrency** need distributed locking.

### Scope
- `backend/`: Redis-backed Distributed Lock

```typescript
interface StepLock {
  acquire(stepId: string, owner: string, ttlMs: number): Promise<boolean>;
  release(stepId: string, owner: string): Promise<void>;
  extend(stepId: string, owner: string, ttlMs: number): Promise<boolean>;
}
```

Implementation uses `SETNX + TTL` (single node) or Redlock (multi-node).

- `backend/`: Step Transition Guard (compare-and-swap defense)

```typescript
interface StepTransitionGuard {
  transition(
    stepId: string,
    from: StepStatus,
    to: StepStatus,
    owner: string
  ): Promise<TransitionResult>;
}
```

- `backend/`: Lock lifecycle management
  - Lock TTL auto-expiry (prevents permanent lock after worker crash)
  - Lock holder periodic renewal (prevents premature release of long-running Steps)
  - Owner identity verification on release (prevents releasing another worker's lock)

### Excludes
- ❌ Cross-Task global lock (Admission Control — Layer 2)
- ❌ DB row-level lock (Redis lock + DB CAS as dual defense; Redis is the primary guard)

### Acceptance
- [ ] Two concurrent workers attempting transition on the same Step → only one succeeds
- [ ] Lock holder crashes → TTL expires and other workers can acquire
- [ ] Release with mismatched owner identity → rejected
- [ ] DB CAS as last line of defense (state not corrupted even when Redis is unavailable)
- [ ] `npm run lint && npm run test && npm run build` all pass

### Dependencies
- Requires X1 Task/Step model
- Requires Docker Redis (already configured)

---

## X6 — add-redis-rate-limit

**Labels:** `second-stage`, `layer-2`, `bff`, `frontend`
**Milestone:** Second Stage - Layer 2: Platform Governance
**Dependencies:** None

---

## Upgrade Rate Limiting from In-Memory to Redis-Backed Multi-Dimensional Rate Limiting

### Goal
Replace the current BFF `InMemoryRateLimiter` (`bff/src/rate-limit.ts`) with a Redis-backed Token Bucket / Sliding Window implementation supporting multi-dimensional rate limiting.

### Background
The current BFF uses an in-memory rate limiter — two BFF instances count independently and cannot share quota.

### Scope
- `bff/`: Redis Rate Limiter (Token Bucket / Sliding Window)
- `bff/`: Multi-dimensional limiting dimensions:
  - `userId`, `tenantId`, `IP`, `agentId`, `toolName`, `modelName`
- `bff/`: Rate limit response (429 + Retry-After header)
- `bff/`: Configurable limits per dimension (independent window + max per dimension)
- `frontend/`: Rate limit UI hint (remaining time, retry suggestion)

### Excludes
- ❌ Backend Tool-layer rate limiting (Tool Governance responsibility)

### Acceptance
- [ ] Two BFF instances share the same Redis quota
- [ ] Over-limit requests correctly return 429 + Retry-After
- [ ] Different dimensions have independent counters (user A over limit does not affect user B)
- [ ] `npm run lint && npm run test && npm run build` all pass

### Dependencies
- Requires Docker Redis (already configured)

---

## X7 — add-context-budget-governance

**Labels:** `second-stage`, `layer-2`, `backend`
**Milestone:** Second Stage - Layer 2: Platform Governance
**Dependencies:** None

---

## Establish Context Budget and Compression Strategy Framework

### Goal
To establish a Token budget management and Context assembly framework that prevents long conversations from exceeding the model's context window.

### Background
The current `backend/src/state.ts` `buildConversationContext` simply takes the last 10 messages. Missing:
- Quantitative Token budget control
- Structured priority-based assembly (system rules > current task > historical summaries > raw outputs)
- Compression strategy when the budget is exceeded

### Scope
- `backend/`: Context Budget calculator (Token counting)
- `backend/`: Priority-based assembler

| Priority | Content |
|---|---|
| P0 | System / security rules |
| P1 | Current task and Task State |
| P2 | Related resources and rules (caller-injected) |
| P3 | Relevant historical summaries |
| P4 | Recent conversation |
| P5 | Low-value raw Tool output |

- `backend/`: Compression strategy framework

```text
Compress Tool Results → Compress conversation history → Drop low-relevance content → Keep current task and critical evidence
```

- `backend/`: Pluggable Context assembly (different Agents can customize priorities)

### Acceptance
- [ ] Inject an ultra-long conversation → Context does not exceed the configured Token budget
- [ ] Core rules (P0–P1) are always retained during degradation
- [ ] Existing Agents (Weather/Research) continue functioning after compression
- [ ] `npm run lint && npm run test && npm run build` all pass

---

## X8 — add-observability-metrics-tracing

**Labels:** `second-stage`, `layer-2`, `backend`, `bff`
**Milestone:** Second Stage - Layer 2: Platform Governance
**Dependencies:** X1, X3

---

## Establish Observability: Metrics, Distributed Tracing, Model Provider Fault Tolerance, and Cost Tracking

### Goal
To establish complete Agent Runtime observability: Metrics + OpenTelemetry Distributed Tracing + Model Provider fault tolerance + Cost Tracking.

### Background
The current `backend/src/platform/observability.ts` provides `auditLogger` and `recordMetric`, but:
- Outputs go to console — no persistence or queryability
- Metrics only, no distributed tracing
- X2 Retry Budget covers HTTP-layer Tool errors (timeout/5xx/429) but not Model Provider-layer failures

### Scope

#### Part A: Metrics + Cost Tracking
- `backend/`: Four-layer instrumentation (Task / Step / Tool / Token)
- `backend/`: Cost Tracking (Token cost, Model cost, Tool cost)
- `backend/`: Metrics collection and exposure (REST endpoint for Dashboard consumption)
- `bff/`: Metrics API route

#### Part B: OpenTelemetry Distributed Tracing
- `backend/`: OTel SDK initialization and Span management
- Span hierarchy with `taskId` / `stepId` / `toolCallId` on every span:

```text
BFF Span
  └─ Backend Span
       ├─ LangGraph Node Span
       │    ├─ Model Call Span
       │    └─ Tool Call Span
       └─ Retry Span (if any)
```

#### Part C: Model Provider Fault Tolerance

| Failure Scenario | Strategy |
|---|---|
| Model Provider 5xx | Fallback model routing (switch to backup provider) |
| Structured Output Parse Error | Repair loop (distinguishes parse error / validation error / refusal) |
| Structured Output Validation Error | Limited repair attempts, return partial + error hint |
| Refusal / Content Filter | No retry, return refusal signal to frontend |
| Provider Timeout | Backoff retry, fallback on exhaustion |

```typescript
interface ModelFallbackPolicy {
  primaryProvider: string;
  fallbackProviders: string[];
  maxTotalAttempts: number;
  repairStrategy: "none" | "retry_once" | "retry_with_hint";
}
```

### Key Metrics (generic, no business dependency)

**Runtime:**
- Task Success Rate, Task Completion Latency P95
- Retry Recovery Rate, Resume Success Rate
- Idempotency Hit Rate, Duplicate Side-effect Prevention Rate
- Tool Success Rate / Latency P95 / Timeout Rate
- Permission Denial Rate, Compensation Success Rate
- **Model Fallback Rate**, **Structured Output Repair Success Rate**

**Cost:**
- Tokens per Successful Task, Model Cost per Successful Task
- Tool Cost per Task, **Cost per Successful Task**

### Acceptance
- [ ] Instrumentation does not impact normal Agent flow
- [ ] Metrics endpoint consumable by Dashboard
- [ ] Cost calculation matches actual Token usage
- [ ] OTel trace spans the full chain: BFF → Backend → LangGraph → Tool → Model
- [ ] Model Provider down → correctly falls back to backup provider
- [ ] Structured output parse failure → correctly enters repair loop
- [ ] `npm run lint && npm run test && npm run build` all pass

### Dependencies
- Requires X1 Task/Step model (Task-dimension instrumentation)
- Requires X3 Audit (Metrics and Audit event data consistency)

---

## X8.5 — integrate-agent-inspect-dev-tracing (Optional Test)

**Labels:** `second-stage`, `layer-2`, `backend`, `optional`
**Milestone:** Second Stage - Layer 2: Platform Governance
**Dependencies:** X8 (OTel tracing should coexist)

---

## Integrate agent-inspect for Local-First Agent Execution Tree Debugging

### Goal
Integrate [agent-inspect](https://github.com/rajudandigam/agent-inspect) — a local-first TypeScript tool that turns agent runs, tool calls, LLM calls, failures, durations, and structured logs into readable execution trees. This complements X8 OTel Tracing with a development-time local debug view.

### Background
Received an invitation from the agent-inspect developer to test it with this project. agent-inspect is a lightweight, local-first debugging tool designed for agent development workflows.

### Relationship with X8 (OTel)

| Dimension | OTel (X8, self-built) | agent-inspect (external) |
|---|---|---|
| Purpose | Production Runtime governance | Development-time local debugging |
| Deployment | Distributed (BFF→Backend→Model) | local-first |
| Output | OTel Spans → Metrics Dashboard | Terminal execution tree (step-by-step trace) |
| Dependency | OTel SDK + Collector | `npm install agent-inspect` |

### Scope
- Install and wire up `agent-inspect` in the backend at key agent/tool/LLM call nodes
- Design for coexistence with X8 OTel: `NODE_ENV=development` → agent-inspect; production → OTel. Both can also run simultaneously on the same event data source.
- Run a complete Weather or Deep Research agent run and verify agent-inspect produces a full execution tree
- Collect feedback: complementary effect with X8 OTel, gaps, actual developer productivity improvement

### Excludes
- ❌ Does not replace X8 OTel Tracing
- ❌ No deep customization or forking of agent-inspect

### Acceptance
- [ ] agent-inspect successfully wired in and produces a complete execution tree for at least one full agent run
- [ ] Coexists with OTel without conflict (switchable by env, or both output simultaneously)
- [ ] Describable developer productivity improvement during debugging

### Dependencies
- Should be done after X8 OTel Tracing is in place (for coexistence testing)

---

## X9 — add-recommendation-domain-framework

**Labels:** `second-stage`, `layer-3`, `backend`
**Milestone:** Second Stage - Layer 3: Recommendation Framework
**Dependencies:** X1

---

## Establish a Generic Recommendation Domain Framework

### Goal
To establish a recommendation framework that is not bound to any specific business domain: DomainRouter, Constraint Engine, BusinessPolicyGate, and Clarification flow.

### Design Principles
- The framework itself imports zero business constants or domain schemas
- All business variation is injected through the `RecommendationDomainAdapter<TIntent, TProduct, TCard>` generic interface
- Vector recall finds similar candidates; **business rules decide whether to recommend**

### Scope
- `backend/`: DomainRouter

```typescript
interface DomainRouter {
  route(input: RecommendationInput): Promise<string>;
  registerAdapter(adapter: RecommendationDomainAdapter): void;
}
```

- `backend/`: `RecommendationDomainAdapter` generic interface

```typescript
interface RecommendationDomainAdapter<
  TIntent = unknown,
  TProduct = unknown,
  TCard = unknown
> {
  domain: string;
  extractIntent(input: RecommendationInput): Promise<TIntent>;
  buildRetrievalPolicy(intent: TIntent): RetrievalPolicy;
  validateCandidate(intent: TIntent, candidate: TProduct): CandidateDecision;
  buildCard(candidate: TProduct): TCard;
}
```

- `backend/`: Constraint Engine (Hard/Soft Constraint evaluation, source priority)

```typescript
interface Constraint {
  field: string;
  value: string;
  source: "user_text" | "vision" | "memory";
  confidence: number;
  mode: "hard" | "soft";
}

interface CandidateDecision {
  eligible: boolean;
  reason?: string;
  reasonCode?: string;
  adjustedScore?: number;
}
```

- `backend/`: BusinessPolicyGate (Hard Constraint violation → direct exclusion, not score penalty)
- `backend/`: Clarification flow framework (low confidence → HITL clarification)
- `backend/`: Generic Card model (layout implemented by Adapter)

### Constraint Priority
User explicit text > User current selection > High-confidence Vision > Historical preference Memory > Low-confidence model inference

### Excludes
- ❌ Any concrete business Adapter (Hair/Nail/Food) — optional subsequent Issues
- ❌ Vector retrieval implementation — the framework only defines `RetrievalPolicy`; actual recall is injected by Adapters

### Acceptance
- [ ] Framework imports zero business constants
- [ ] Constraint Engine correctly handles both Hard and Soft modes
- [ ] BusinessPolicyGate directly excludes Hard Constraint violations (not merely down-scoring)
- [ ] `npm run lint && npm run test && npm run build` all pass

### Dependencies
- Requires X1 Task/Step model (recommendation tasks inherit generic Task)

---

## X10 — add-mock-recommendation-adapter

**Labels:** `second-stage`, `layer-3`, `backend`
**Milestone:** Second Stage - Layer 3: Recommendation Framework
**Dependencies:** X9

---

## Build a Mock Adapter to Validate the Recommendation Framework

### Goal
Validate the entire recommendation framework (X9) with the simplest possible Mock Domain. Prove the framework is genuinely business-decoupled.

### Scope
- `backend/`: Mock Domain Adapter — only 3 properties: `category`, `color`, `price`
- `backend/`: Mock Product Catalog — 10–20 rows in PostgreSQL
- `backend/`: Mock Hard Negative Dataset — deliberately construct similar-but-business-conflicting cases

### Mock Domain Design
Construct a Hard Constraint conflict scenario:
- A1: category=X, color=red ✅
- A2: category=X, color=blue ✅
- A3: category=Y, color=red ❌

When the user specifies `category=X`, A3 shares the same color (vector-similar) but conflicts on the Hard Constraint `category`. It must be excluded:

```json
{
  "eligible": false,
  "reasonCode": "HARD_CONSTRAINT_CONFLICT",
  "field": "category",
  "expected": "X",
  "actual": "Y"
}
```

- `backend/`: Full-chain integration test (DomainRoute → Intent → Constraint → Gate → Card)

### Acceptance
- [ ] Hard Constraint conflict → correctly excluded (eligible=false)
- [ ] Full chain runs without any real business attributes
- [ ] Swapping in a different Mock Adapter → framework behavior is consistent
- [ ] Integration test covers: DomainRoute → Intent → Constraint → Gate → Card
- [ ] `npm run lint && npm run test && npm run build` all pass

### Dependencies
- Requires X9 Domain Framework
- Requires Docker PostgreSQL (already configured)

---

## X11 (Optional) — add-hair-recommendation-adapter

**Labels:** `second-stage`, `layer-4`, `backend`, `optional`
**Milestone:** Second Stage - Layer 4: Business Adapters (Optional)
**Dependencies:** X9, X10

---

## Hair Recommendation Adapter (Optional Demo)

### Goal
Implement `HairRecommendationAdapter` as a real-business demo of the recommendation framework.

### Scope
- `backend/`: HairRecommendationAdapter (implements `RecommendationDomainAdapter`)
- `backend/`: Hair product metadata

```typescript
interface HairProductMetadata {
  productId: string;
  merchantId: string;
  domain: "hair";
  hairLength: string[];
  curlType: string[];
  styleOrigin: string[];
  serviceType: string[];
  applicableFaceShape?: string[];
  price: number;
  cityCode: string;
  available: boolean;
  catalogVersion: string;
  embeddingVersion: string;
}
```

- `backend/`: Hair Intent schema
- `backend/`: Hard Negative tests (A1/A2/A3 Japanese/Korean style classic case)

### A1/A2/A3 Classic Case
User says "I want a long hair Japanese style":

| Product | Length | Style | Curl | Verdict |
|---|---|---|---|---|
| A1 Long Wave Japanese | ✅ Match | ✅ Japanese | Wave (unknown) | **Keep** |
| A2 Long Inward Japanese | ✅ Match | ✅ Japanese | Inward (unknown) | **Keep** |
| A3 Long Wave Korean | ✅ Match | ❌ **Korean conflict** | Wave (unknown) | **Exclude** |

### Excludes
- ❌ Real vector retrieval (keyword mock is acceptable)
- ❌ Real Vision/OCR (text input simulation is acceptable)

### Dependencies
- Requires X9 Domain Framework
- Requires X10 Mock Adapter (validate framework correctness before attaching a real Adapter)

---

## X12 (Optional) — add-nail-recommendation-adapter

**Labels:** `second-stage`, `layer-4`, `backend`, `optional`
**Milestone:** Second Stage - Layer 4: Business Adapters (Optional)
**Dependencies:** X9

---

## Nail Recommendation Adapter (Optional Demo)

### Goal
Implement a second Domain Adapter to prove the framework is reusable across different business attribute sets. Do not duplicate the Hair implementation logic.

### Scope
- `backend/`: NailRecommendationAdapter (implements `RecommendationDomainAdapter`)
- `backend/`: Nail product metadata

Core nail attributes:
- Nail shape (square / round / almond / stiletto)
- Color family
- Pattern (solid / gradient / French / art)
- Occasion (daily / wedding / party)
- Length
- Removal requirements

### Dependencies
- Requires X9 Domain Framework

---

## X13 (Optional) — add-food-recommendation-adapter

**Labels:** `second-stage`, `layer-4`, `backend`, `optional`
**Milestone:** Second Stage - Layer 4: Business Adapters (Optional)
**Dependencies:** X9

---

## Food Recommendation Adapter (Optional Demo)

### Goal
Implement a third Domain Adapter to validate framework generality with a completely different attribute set.

### Scope
- `backend/`: FoodRecommendationAdapter (implements `RecommendationDomainAdapter`)
- `backend/`: Food product metadata

Core food attributes:
- Cuisine type (Chinese / Japanese / Korean / Italian / Hotpot)
- Spiciness level
- Allergens
- Vegetarian / non-vegetarian
- Delivery range
- Operating hours

### Dependencies
- Requires X9 Domain Framework

---

## Dependency Graph

```text
Layer 0:
  X0 (LangGraph Boundary) ──→ Decision Record feeds all subsequent Issues

Layer 1:
  X1 (Task State Machine) ──┬── X2 (Retry Budget)
                             ├── X3 (Idempotency/Audit) ──┬── X4 (Compensation)
                             │                            │
                             ├── X5 (Distributed Lock)     │
                             │                            │
Layer 2:                     │                            │
  X6 (Redis Rate Limit)      │                            │
  X7 (Context Budget)        │                            │
                             │                            │
                             ├── X8 (Observability:        │
                             │    Metrics + OTel           │
                             │    + Model Fallback)        │
                             │    + X8.5 (agent-inspect)   │
                             │                            │
Layer 3:                     │                            │
                             ├── X9 (Domain Framework) ─── X10 (Mock Adapter)
                                                           │
Layer 4 (optional):                                        │
                                                           ├── X11 (Hair)
                                                           ├── X12 (Nail)
                                                           └── X13 (Food)
```

## Suggested Issue Opening Order

| Batch | Issues | Notes |
|---|---|---|
| Batch 0 | X0 | Do first — decision record guides all later work |
| Batch 1 | X1, X6, X7 | Parallel after X0 — no mutual dependencies |
| Batch 2 | X2, X3, X5 | After X1 — X2/X3/X5 can run in parallel but all need X1 |
| Batch 3 | X4, X8, X9 | After X1+X3 — X8/X9 need X1; X4 needs X1+X3 |
| Batch 3.5 (optional) | X8.5 | After X8 — coexistence test with OTel |
| Batch 4 | X10 | After X9 |
| Batch 5 (optional) | X11, X12, X13 | After X9+X10 |

## Integration Acceptance (Cross-Issue Fault Injection)

After all Layer 0–3 issues are complete:

1. LangGraph native boundary documented; custom capabilities justified as filling gaps (Layer 0)
2. Force-kill after side effect succeeds → restart → side effect not re-executed (Idempotency + Resume)
3. Same request submitted 10 times → side effect executes exactly once (Idempotency)
4. Two concurrent workers transition the same Step → only one succeeds (Distributed Lock)
5. Tool returns 429/Timeout/5xx → Retry Budget enforced (Retry)
6. Model Provider down → correctly falls back to backup provider (Model Fault Tolerance)
7. Structured output parse fails → correctly enters repair loop (Model Fault Tolerance)
8. Compensation fails → escalated to manual handling, not silently "succeeded" (Compensation)
9. Two BFF instances share Redis quota (Rate Limit)
10. Ultra-long conversation injected → Context does not exceed budget (Context Budget)
11. OTel trace spans BFF → Backend → LangGraph → Tool → Model (Tracing)
12. Audit reconstructs operation history without leaking Prompt/Key/PII (Audit + Redaction)
13. Swap Mock Adapter → framework behavior is consistent (Domain Adapter abstraction)
14. agent-inspect produces a complete agent run execution tree, coexists with OTel without conflict (dual-track observability)
