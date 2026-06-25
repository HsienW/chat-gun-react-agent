---
name: openspec-workflow-router
description: Route OpenSpec change lifecycle work to token-efficient stage prompts for this repository. Use when the user asks Codex to plan, review, implement, fix, readiness-check, or archive an OpenSpec change, especially with CCR/Qwen/Codex handoffs.
---

# OpenSpec Workflow Router

Use this skill as a routing layer. Do not load every reference. Pick one stage, then read only its reference file.

## Context Policy

- Prefer user-provided summaries, diffs, verification results, and named files.
- Read the minimum relevant OpenSpec artifacts and adjacent code/tests.
- Do not scan the whole repo by default.
- Ignore `.gitignore` content, `node_modules/`, `dist/`, `build/`, `coverage/`, and lockfiles unless dependency changes are in scope.
- Expand context only for contract conflicts, security concerns, unclear architecture, or test failures that cannot be localized.
- Keep all user-facing output in Traditional Chinese.

## Route Table

| User intent | Stage | Read |
| --- | --- | --- |
| Create or evaluate a new change plan | `plan-change` | `references/01-plan-change.md` |
| Review proposal / design / tasks before implementation | `review-plan` | `references/02-review-plan.md` |
| Implement an approved OpenSpec change | `apply-change` | `references/03-apply-change.md` |
| Review Codex implementation result | `review-result` | `references/04-review-result.md` |
| Fix issues from Qwen review | `fix-from-review` | `references/05-fix-from-review.md` |
| Decide whether a change is ready to archive | `readiness-check` | `references/06-readiness-check.md` |
| Archive the change and draft commit message | `archive-change` | `references/07-archive-change.md` |

## How To Use

1. Identify the stage from the user request.
2. Read exactly one matching reference first.
3. Follow that reference's prompt or workflow.
4. If the reference asks for project rules, read only the relevant sections/files.
5. If the user asks for a prompt, output the prompt. If the user asks to execute, perform the stage.

If the stage is ambiguous, ask one concise Traditional Chinese question instead of loading multiple references.
