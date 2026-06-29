import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  captureQwenReviewResult,
  extractJsonObjectFromOutput,
  validateReviewResult,
} from "./qwen-capture-adapter.mjs";

function validReviewResult(overrides = {}) {
  return {
    schemaVersion: "1.0.0",
    artifactId: "rr-test-001",
    changeId: "add-agent-artifact-shared-state-handoff",
    runId: "run-2026-06-29-001",
    producer: "Qwen",
    stage: "review-result",
    kind: "review_result",
    status: "success",
    createdAt: "2026-06-29T12:00:00.000Z",
    summary: "No confirmed findings.",
    inputRefs: [],
    outputRefs: [],
    verification: {
      executed: [],
      passed: [],
      failed: [],
      notExecuted: ["lint", "test", "build"],
    },
    payload: {
      verdict: "APPROVE",
      findings: {
        blocker: [],
        major: [],
        minor: [],
      },
      crossLayerContractCheck: {},
      residualRisks: [],
      positiveNotes: [],
    },
    risks: [],
    ...overrides,
  };
}

test("extractJsonObjectFromOutput extracts fenced JSON from Qwen markdown", () => {
  const result = validReviewResult();
  const output = [
    "# Review Result",
    "```json",
    JSON.stringify(result, null, 2),
    "```",
  ].join("\n");

  assert.deepEqual(extractJsonObjectFromOutput(output), result);
});

test("extractJsonObjectFromOutput extracts raw JSON stdout", () => {
  const result = validReviewResult();

  assert.deepEqual(extractJsonObjectFromOutput(JSON.stringify(result)), result);
});

test("extractJsonObjectFromOutput tolerates a leading UTF-8 BOM", () => {
  const result = validReviewResult();

  assert.deepEqual(extractJsonObjectFromOutput(`\uFEFF${JSON.stringify(result)}`), result);
});

test("validateReviewResult rejects wrong change, run, stage, and kind", () => {
  const base = validReviewResult();

  assert.throws(
    () =>
      validateReviewResult(
        { ...base, changeId: "other-change" },
        {
          expectedChangeId: base.changeId,
          expectedRunId: base.runId,
          expectedStage: base.stage,
          expectedKind: base.kind,
        },
      ),
    /changeId/,
  );

  assert.throws(
    () =>
      validateReviewResult(
        { ...base, runId: "other-run" },
        {
          expectedChangeId: base.changeId,
          expectedRunId: base.runId,
          expectedStage: base.stage,
          expectedKind: base.kind,
        },
      ),
    /runId/,
  );

  assert.throws(
    () =>
      validateReviewResult(
        { ...base, stage: "review-plan" },
        {
          expectedChangeId: base.changeId,
          expectedRunId: base.runId,
          expectedStage: base.stage,
          expectedKind: base.kind,
        },
      ),
    /stage/,
  );

  assert.throws(
    () =>
      validateReviewResult(
        { ...base, kind: "implementation_result" },
        {
          expectedChangeId: base.changeId,
          expectedRunId: base.runId,
          expectedStage: base.stage,
          expectedKind: base.kind,
        },
      ),
    /kind/,
  );
});

test("captureQwenReviewResult rejects non-zero process exit before writing artifact", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "qwen-capture-"));
  const changeId = "change-a";
  const runId = "run-a";
  const runtimeDir = path.join(workspaceRoot, ".agent-runtime", changeId);
  const statePath = path.join(runtimeDir, "current-state.json");
  const artifactPath = path.join(runtimeDir, "artifacts", "review-result.json");

  try {
    await mkdir(runtimeDir, { recursive: true });
    await writeFile(
      statePath,
      JSON.stringify({
        schemaVersion: "1.0.0",
        changeId,
        runId,
        currentPhase: "REVIEWING",
        currentOwner: "Qwen",
        latestArtifactRefs: {},
      }),
    );

    await assert.rejects(
      () =>
        captureQwenReviewResult({
          workspaceRoot,
          changeId,
          runId,
          stage: "review-result",
          processResult: {
            exitCode: 2,
            stdout: JSON.stringify(validReviewResult({ changeId, runId })),
            stderr: "qwen failed",
          },
        }),
      /Qwen CLI exited with code 2/,
    );

    await assert.rejects(() => access(artifactPath), /ENOENT/);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("captureQwenReviewResult writes review-result atomically and updates current-state", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "qwen-capture-"));
  const changeId = "change-a";
  const runId = "run-a";
  const currentStatePath = path.join(workspaceRoot, ".agent-runtime", changeId, "current-state.json");
  const currentState = {
    schemaVersion: "1.0.0",
    changeId,
    runId,
    currentPhase: "REVIEWING",
    currentOwner: "Qwen",
    attempt: 1,
    latestArtifactRefs: {},
    latestHandoff: {
      handoffId: "hdo-a",
      stage: "review-result",
      from: "Codex",
      to: "Qwen",
      status: "PENDING",
    },
    gateStatus: {
      proposalApproved: true,
      reviewPassed: false,
      implementationVerified: true,
      readinessConfirmed: false,
    },
    blockers: [],
    nextActions: [],
    updatedAt: "2026-06-29T12:00:00.000Z",
    terminalStatus: "NON_TERMINAL",
  };

  await mkdir(path.dirname(currentStatePath), { recursive: true });
  await writeFile(currentStatePath, JSON.stringify(currentState, null, 2), {
    encoding: "utf8",
  });

  try {
    const result = validReviewResult({
      artifactId: "rr-a",
      changeId,
      runId,
    });

    const captured = await captureQwenReviewResult({
      workspaceRoot,
      changeId,
      runId,
      stage: "review-result",
      processResult: {
        exitCode: 0,
        stdout: JSON.stringify(result),
        stderr: "",
      },
      now: () => new Date("2026-06-29T13:00:00.000Z"),
    });

    assert.equal(
      captured.artifactPath,
      path.join(workspaceRoot, ".agent-runtime", changeId, "artifacts", "review-result.json"),
    );

    const writtenArtifact = JSON.parse(await readFile(captured.artifactPath, "utf8"));
    assert.deepEqual(writtenArtifact, result);

    const updatedState = JSON.parse(await readFile(currentStatePath, "utf8"));
    assert.deepEqual(updatedState.latestArtifactRefs.reviewResult, {
      artifactId: "rr-a",
      changeId,
      runId,
      kind: "review_result",
      relativePath: ".agent-runtime/change-a/artifacts/review-result.json",
    });
    assert.equal(updatedState.updatedAt, "2026-06-29T13:00:00.000Z");
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("captureQwenReviewResult captures stdout from a live child process", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "qwen-capture-"));
  const changeId = "change-live";
  const runId = "run-live";
  const currentStatePath = path.join(workspaceRoot, ".agent-runtime", changeId, "current-state.json");
  const result = validReviewResult({
    artifactId: "rr-live",
    changeId,
    runId,
  });

  await mkdir(path.dirname(currentStatePath), { recursive: true });
  await writeFile(
    currentStatePath,
    JSON.stringify(
      {
        schemaVersion: "1.0.0",
        changeId,
        runId,
        currentPhase: "REVIEWING",
        currentOwner: "Qwen",
        attempt: 1,
        latestArtifactRefs: {},
        latestHandoff: {
          handoffId: "hdo-live",
          stage: "review-result",
          from: "Codex",
          to: "Qwen",
          status: "PENDING",
        },
        gateStatus: {
          proposalApproved: true,
          reviewPassed: false,
          implementationVerified: true,
          readinessConfirmed: false,
        },
        blockers: [],
        nextActions: [],
        updatedAt: "2026-06-29T12:00:00.000Z",
        terminalStatus: "NON_TERMINAL",
      },
      null,
      2,
    ),
    "utf8",
  );

  try {
    const captured = await captureQwenReviewResult({
      workspaceRoot,
      changeId,
      runId,
      stage: "review-result",
      command: process.execPath,
      commandArgs: ["-e", `console.log(${JSON.stringify(JSON.stringify(result))})`],
      now: () => new Date("2026-06-29T13:00:00.000Z"),
    });

    const writtenArtifact = JSON.parse(await readFile(captured.artifactPath, "utf8"));
    assert.equal(writtenArtifact.artifactId, "rr-live");
    assert.equal(writtenArtifact.producer, "Qwen");
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("captureQwenReviewResult rejects path traversal change ids", async () => {
  await assert.rejects(
    () =>
      captureQwenReviewResult({
        workspaceRoot: process.cwd(),
        changeId: "../escape",
        runId: "run-a",
        stage: "review-result",
        processResult: {
          exitCode: 0,
          stdout: JSON.stringify(validReviewResult({ changeId: "../escape", runId: "run-a" })),
          stderr: "",
        },
      }),
    /Invalid changeId/,
  );
});
