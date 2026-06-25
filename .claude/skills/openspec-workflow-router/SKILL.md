---
name: openspec-workflow-router
description: MUST be considered at task start in this repository to detect OpenSpec change lifecycle work and route Claude Code/CCR coordination tasks without loading unnecessary context. Use for planning, proposal/design/tasks review, implementation handoff, result review coordination, readiness checks, archive decisions, and CCR/Codex/Qwen handoffs.
---

# OpenSpec Workflow Router

Use this skill as Claude Code/CCR's coordination routing layer for the repository OpenSpec multi-agent workflow.

## Task-Start Awareness

At the start of every task in this repository:

1. Decide whether the request belongs to the OpenSpec change lifecycle.
2. If it does, select exactly one stage from the route table below.
3. If another host owns the stage, produce the handoff prompt and required evidence list.
4. If it does not, keep the context policy below in force and continue with `CLAUDE.md`.

## Context Policy

- Prefer user-provided summaries, diffs, verification results, and named files.
- Read the minimum relevant OpenSpec artifacts and adjacent code/tests.
- Do not scan the whole repo by default.
- Ignore files and directories ignored by `.gitignore`, `node_modules/`, `dist/`, `build/`, `coverage/`, and lockfiles unless dependency changes are in scope.
- Expand context only for contract conflicts, security concerns, unclear architecture, or test failures that cannot be localized.
- Keep all user-facing output in Traditional Chinese.
- Preserve Claude/CCR's coordinator role from `CLAUDE.md`.

## Route Table

| User intent | Stage | Claude/CCR action |
| --- | --- | --- |
| Create or evaluate a new change plan | `plan-change` | Clarify capability boundary and draft proposal/design/tasks. |
| Review proposal / design / tasks before implementation | `review-plan` | Coordinate implementability and independent architecture review. |
| Implement an approved OpenSpec change | `apply-change` | Handoff to Codex with change name, artifacts, constraints, and verification expectations. |
| Review Codex implementation result | `review-result` | Handoff to Qwen for independent read-only review, then aggregate findings. |
| Fix issues from Qwen review | `fix-from-review` | Handoff confirmed findings to Codex and preserve severity/evidence. |
| Decide whether a change is ready to archive | `readiness-check` | Check tasks, requirements, validation, residual risk, and unresolved findings. |
| Archive the change and draft commit message | `archive-change` | Approve archive when ready; git commit/push remains human-owned. |

## How To Use

1. Identify the stage from the user request.
2. Read only the artifacts needed for that stage.
3. Follow `CLAUDE.md` for coordination, arbitration, and final acceptance.
4. If the stage is ambiguous, ask one concise Traditional Chinese question.
