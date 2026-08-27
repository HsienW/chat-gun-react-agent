import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { evaluateCcrToolUse } from "./ccr-role-write-guard.mjs";

async function createWorkspaceWithState({
  changeId = "example-change",
  currentPhase = "PLAN_DRAFT",
  currentOwner = "CCR",
} = {}) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "ccr-write-guard-"));
  const runtimeDirectory = path.join(workspaceRoot, ".agent-runtime", changeId);
  await mkdir(runtimeDirectory, { recursive: true });
  await writeFile(
    path.join(runtimeDirectory, "current-state.json"),
    JSON.stringify({ changeId, currentPhase, currentOwner, terminalStatus: "NON_TERMINAL" }),
    "utf8",
  );
  return { changeId, workspaceRoot };
}

test("拒絕 CCR 修改 application code，即使只改一行", async () => {
  const { workspaceRoot } = await createWorkspaceWithState({
    currentPhase: "READY_FOR_READINESS_CHECK",
  });

  const result = await evaluateCcrToolUse(
    {
      tool_name: "Edit",
      tool_input: {
        file_path: path.join(workspaceRoot, "backend", "src", "index.ts"),
        old_string: "before",
        new_string: "after",
      },
    },
    { workspaceRoot },
  );

  assert.equal(result.decision, "deny");
  assert.match(result.reason, /Handoff/);
});

test("拒絕 CCR 在非 PLAN_DRAFT 階段修改 OpenSpec delta", async () => {
  const { changeId, workspaceRoot } = await createWorkspaceWithState({
    currentPhase: "READY_FOR_READINESS_CHECK",
  });

  const result = await evaluateCcrToolUse(
    {
      tool_name: "Write",
      tool_input: {
        file_path: path.join(workspaceRoot, "openspec", "changes", changeId, "design.md"),
        content: "small edit",
      },
    },
    { workspaceRoot },
  );

  assert.equal(result.decision, "deny");
  assert.match(result.reason, /PLAN_DRAFT/);
});

test("拒絕 CCR 在 owner 不符時修改 OpenSpec delta", async () => {
  const { changeId, workspaceRoot } = await createWorkspaceWithState({
    currentOwner: "Qwen",
  });

  const result = await evaluateCcrToolUse(
    {
      tool_name: "Write",
      tool_input: {
        file_path: path.join(workspaceRoot, "openspec", "changes", changeId, "tasks.md"),
        content: "- [ ] task",
      },
    },
    { workspaceRoot },
  );

  assert.equal(result.decision, "deny");
  assert.match(result.reason, /currentOwner/);
});

test("缺少 CurrentState 時 fail-closed，不猜測寫入權", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "ccr-write-guard-"));

  const result = await evaluateCcrToolUse(
    {
      tool_name: "Write",
      tool_input: {
        file_path: path.join(workspaceRoot, "openspec", "changes", "missing-state", "proposal.md"),
        content: "proposal",
      },
    },
    { workspaceRoot },
  );

  assert.equal(result.decision, "deny");
  assert.match(result.reason, /CurrentState/);
});

test("允許 CCR 在 PLAN_DRAFT 且持有 owner 時寫入該 Change artifacts", async () => {
  const { changeId, workspaceRoot } = await createWorkspaceWithState();

  const result = await evaluateCcrToolUse(
    {
      tool_name: "Write",
      tool_input: {
        file_path: path.join(workspaceRoot, "openspec", "changes", changeId, "proposal.md"),
        content: "proposal",
      },
    },
    { workspaceRoot },
  );

  assert.equal(result.decision, "allow");
});

test("允許 CCR 初始化合法的 PLAN_DRAFT CurrentState", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "ccr-write-guard-"));
  const changeId = "new-change";

  const result = await evaluateCcrToolUse(
    {
      tool_name: "Write",
      tool_input: {
        file_path: path.join(
          workspaceRoot,
          ".agent-runtime",
          changeId,
          "current-state.json",
        ),
        content: JSON.stringify({
          schemaVersion: "1.0.0",
          changeId,
          runId: "run-001",
          currentPhase: "PLAN_DRAFT",
          currentOwner: "CCR",
          attempt: 1,
          latestArtifactRefs: {},
          latestHandoff: {},
          gateStatus: {
            proposalApproved: false,
            reviewPassed: false,
            implementationVerified: false,
            readinessConfirmed: false,
          },
          blockers: [],
          nextActions: [],
          updatedAt: "2026-08-28T00:00:00.000Z",
          terminalStatus: "NON_TERMINAL",
        }),
      },
    },
    { workspaceRoot },
  );

  assert.equal(result.decision, "allow");
});

test("拒絕將已存在但損壞的 CurrentState 當成首次初始化", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "ccr-write-guard-"));
  const changeId = "broken-state";
  const runtimeDirectory = path.join(workspaceRoot, ".agent-runtime", changeId);
  await mkdir(runtimeDirectory, { recursive: true });
  await writeFile(path.join(runtimeDirectory, "current-state.json"), "{broken", "utf8");

  const result = await evaluateCcrToolUse(
    {
      tool_name: "Write",
      tool_input: {
        file_path: path.join(runtimeDirectory, "current-state.json"),
        content: JSON.stringify({
          schemaVersion: "1.0.0",
          changeId,
          runId: "run-001",
          currentPhase: "PLAN_DRAFT",
          currentOwner: "CCR",
          attempt: 1,
          latestArtifactRefs: {},
          latestHandoff: {},
          gateStatus: {},
          blockers: [],
          nextActions: [],
          updatedAt: "2026-08-28T00:00:00.000Z",
          terminalStatus: "NON_TERMINAL",
        }),
      },
    },
    { workspaceRoot },
  );

  assert.equal(result.decision, "deny");
  assert.match(result.reason, /無效|損壞/);
});

test("拒絕 CCR 使用 Bash、MultiEdit 或 MCP 寫入繞過檔案守門", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "ccr-write-guard-"));

  const bashResult = await evaluateCcrToolUse(
    { tool_name: "Bash", tool_input: { command: "echo bypass > backend/src/index.ts" } },
    { workspaceRoot },
  );
  const mcpResult = await evaluateCcrToolUse(
    {
      tool_name: "mcp__filesystem__write_file",
      tool_input: { path: "backend/src/index.ts", content: "bypass" },
    },
    { workspaceRoot },
  );
  const multiEditResult = await evaluateCcrToolUse(
    {
      tool_name: "MultiEdit",
      tool_input: {
        file_path: path.join(workspaceRoot, "backend", "src", "index.ts"),
        edits: [{ old_string: "before", new_string: "after" }],
      },
    },
    { workspaceRoot },
  );

  assert.equal(bashResult.decision, "deny");
  assert.equal(mcpResult.decision, "deny");
  assert.equal(multiEditResult.decision, "deny");
});

test("共享 Claude hook 在 guard 執行失敗時轉為 exit code 2", async () => {
  const workspaceRoot = path.resolve(import.meta.dirname, "..", "..");
  const settings = JSON.parse(
    await readFile(path.join(workspaceRoot, ".claude", "settings.json"), "utf8"),
  );
  const command = settings.hooks.PreToolUse[0].hooks[0].command;

  assert.match(command, /ccr-role-write-guard\.mjs/);
  assert.match(command, /LASTEXITCODE/);
  assert.match(command, /exit 2/);
});

test("保留 Qwen 主工作階段 auto-edit 設定", async () => {
  const workspaceRoot = path.resolve(import.meta.dirname, "..", "..");
  const qwenSettings = JSON.parse(
    await readFile(path.join(workspaceRoot, ".qwen", "settings.json"), "utf8"),
  );

  assert.equal(qwenSettings.tools.approvalMode, "auto-edit");
});
