#!/usr/bin/env node

import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";

const DEFAULT_STAGE = "review-result";
const EXPECTED_KIND = "review_result";
const EXPECTED_PRODUCER = "Qwen";
const SUPPORTED_SCHEMA_VERSION = "1.0.0";

export function extractJsonObjectFromOutput(output) {
  if (typeof output !== "string" || output.trim().length === 0) {
    throw new Error("Qwen stdout is empty; no review_result JSON found.");
  }

  const fencedJson = output.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedJson) {
    return parseJsonObject(fencedJson[1].trim());
  }

  const trimmed = output.trim();
  try {
    return parseJsonObject(trimmed);
  } catch {
    const objectText = findFirstJsonObjectText(trimmed);
    if (!objectText) {
      throw new Error("Qwen stdout does not contain a JSON object.");
    }

    return parseJsonObject(objectText);
  }
}

export function validateReviewResult(
  value,
  { expectedChangeId, expectedRunId, expectedStage = DEFAULT_STAGE, expectedKind = EXPECTED_KIND },
) {
  if (!isPlainObject(value)) {
    throw new Error("review_result must be a JSON object.");
  }

  requireStringField(value, "schemaVersion");
  requireStringField(value, "artifactId");
  requireStringField(value, "changeId");
  requireStringField(value, "runId");
  requireStringField(value, "producer");
  requireStringField(value, "stage");
  requireStringField(value, "kind");
  requireStringField(value, "status");
  requireStringField(value, "createdAt");
  requireStringField(value, "summary");

  if (value.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new Error(`Unsupported schemaVersion: ${value.schemaVersion}`);
  }

  if (value.changeId !== expectedChangeId) {
    throw new Error(`Unexpected changeId: ${value.changeId}`);
  }

  if (value.runId !== expectedRunId) {
    throw new Error(`Unexpected runId: ${value.runId}`);
  }

  if (value.stage !== expectedStage) {
    throw new Error(`Unexpected stage: ${value.stage}`);
  }

  if (value.kind !== expectedKind) {
    throw new Error(`Unexpected kind: ${value.kind}`);
  }

  if (value.producer !== EXPECTED_PRODUCER) {
    throw new Error(`Unexpected producer: ${value.producer}`);
  }

  if (!["success", "failure", "partial"].includes(value.status)) {
    throw new Error(`Unexpected status: ${value.status}`);
  }

  requireArrayField(value, "inputRefs");
  requireArrayField(value, "outputRefs");
  requireArrayField(value, "risks");

  validateVerification(value.verification);
  validateReviewPayload(value.payload);

  return value;
}

export async function captureQwenReviewResult({
  workspaceRoot = process.cwd(),
  changeId,
  runId,
  stage = DEFAULT_STAGE,
  command,
  commandArgs = [],
  processResult,
  now = () => new Date(),
}) {
  validatePathSegment("changeId", changeId);
  requireNonEmptyString("runId", runId);
  requireNonEmptyString("stage", stage);

  const root = path.resolve(workspaceRoot);
  const runtimeDir = path.join(root, ".agent-runtime", changeId);
  const artifactsDir = path.join(runtimeDir, "artifacts");
  const currentStatePath = path.join(runtimeDir, "current-state.json");
  const artifactPath = path.join(artifactsDir, "review-result.json");
  const artifactTempPath = `${artifactPath}.${process.pid}.${Date.now()}.tmp`;
  const currentStateTempPath = `${currentStatePath}.${process.pid}.${Date.now()}.tmp`;

  ensureInside(root, runtimeDir);
  ensureInside(root, artifactsDir);
  ensureInside(root, currentStatePath);
  ensureInside(root, artifactPath);

  const result = processResult ?? (await runCommand(command, commandArgs, { cwd: root }));

  if (result.exitCode !== 0) {
    const stderr = result.stderr.trim();
    throw new Error(
      `Qwen CLI exited with code ${result.exitCode}${stderr ? `: ${stderr}` : ""}`,
    );
  }

  const parsed = extractJsonObjectFromOutput(result.stdout);
  const reviewResult = validateReviewResult(parsed, {
    expectedChangeId: changeId,
    expectedRunId: runId,
    expectedStage: stage,
    expectedKind: EXPECTED_KIND,
  });

  const currentState = await readCurrentState(currentStatePath, { expectedChangeId: changeId, expectedRunId: runId });
  const updatedState = withReviewResultReference(currentState, reviewResult, {
    changeId,
    runId,
    relativePath: toPosixPath(path.relative(root, artifactPath)),
    now,
  });

  await mkdir(artifactsDir, { recursive: true });
  await writeJsonAtomic(artifactPath, artifactTempPath, reviewResult);
  await writeJsonAtomic(currentStatePath, currentStateTempPath, updatedState);

  return {
    artifactPath,
    currentStatePath,
    artifactReference: updatedState.latestArtifactRefs.reviewResult,
  };
}

function withReviewResultReference(currentState, reviewResult, { changeId, runId, relativePath, now }) {
  return {
    ...currentState,
    latestArtifactRefs: {
      ...currentState.latestArtifactRefs,
      reviewResult: {
        artifactId: reviewResult.artifactId,
        changeId,
        runId,
        kind: EXPECTED_KIND,
        relativePath,
      },
    },
    updatedAt: now().toISOString(),
  };
}

async function readCurrentState(currentStatePath, { expectedChangeId, expectedRunId }) {
  let raw;

  try {
    raw = await readFile(currentStatePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`current-state.json not found: ${currentStatePath}`);
    }
    throw error;
  }

  const currentState = parseJsonObject(raw);

  if (currentState.changeId !== expectedChangeId) {
    throw new Error(`current-state.json changeId mismatch: ${currentState.changeId}`);
  }

  if (currentState.runId !== expectedRunId) {
    throw new Error(`current-state.json runId mismatch: ${currentState.runId}`);
  }

  if (!isPlainObject(currentState.latestArtifactRefs)) {
    throw new Error("current-state.json latestArtifactRefs must be an object.");
  }

  return currentState;
}

async function writeJsonAtomic(finalPath, tempPath, value) {
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });

  try {
    await rename(tempPath, finalPath);
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    throw error;
  }
}

function runCommand(command, commandArgs, { cwd }) {
  requireNonEmptyString("command", command);

  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({
        exitCode: exitCode ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

function parseJsonObject(text) {
  let parsed;

  try {
    parsed = JSON.parse(stripByteOrderMark(text));
  } catch (error) {
    throw new Error(`Invalid JSON: ${error.message}`);
  }

  if (!isPlainObject(parsed)) {
    throw new Error("Parsed JSON must be an object.");
  }

  return parsed;
}

function stripByteOrderMark(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function findFirstJsonObjectText(text) {
  const start = text.indexOf("{");
  if (start === -1) {
    return undefined;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return undefined;
}

function validateVerification(value) {
  if (!isPlainObject(value)) {
    throw new Error("verification must be an object.");
  }

  requireArrayField(value, "executed");
  requireArrayField(value, "passed");
  requireArrayField(value, "failed");
  requireArrayField(value, "notExecuted");
}

function validateReviewPayload(value) {
  if (!isPlainObject(value)) {
    throw new Error("payload must be an object.");
  }

  if (!["APPROVE", "REQUEST_CHANGES", "COMMENT_ONLY", "INCOMPLETE"].includes(value.verdict)) {
    throw new Error(`Unexpected payload.verdict: ${value.verdict}`);
  }

  if (!isPlainObject(value.findings)) {
    throw new Error("payload.findings must be an object.");
  }

  requireArrayField(value.findings, "blocker");
  requireArrayField(value.findings, "major");
  requireArrayField(value.findings, "minor");
  requireArrayField(value, "residualRisks");
  requireArrayField(value, "positiveNotes");

  if (!isPlainObject(value.crossLayerContractCheck)) {
    throw new Error("payload.crossLayerContractCheck must be an object.");
  }
}

function requireStringField(value, fieldName) {
  if (typeof value[fieldName] !== "string" || value[fieldName].length === 0) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
}

function requireArrayField(value, fieldName) {
  if (!Array.isArray(value[fieldName])) {
    throw new Error(`${fieldName} must be an array.`);
  }
}

function requireNonEmptyString(name, value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be a non-empty string.`);
  }
}

function validatePathSegment(name, value) {
  requireNonEmptyString(name, value);

  if (value.includes("..") || value.includes("/") || value.includes("\\") || path.isAbsolute(value)) {
    throw new Error(`Invalid ${name}: ${value}`);
  }
}

function ensureInside(root, targetPath) {
  const relativePath = path.relative(root, path.resolve(targetPath));

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Resolved path escapes workspace root: ${targetPath}`);
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toPosixPath(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function parseArgs(argv) {
  const separatorIndex = argv.indexOf("--");
  const adapterArgs = separatorIndex === -1 ? argv : argv.slice(0, separatorIndex);
  const commandParts = separatorIndex === -1 ? [] : argv.slice(separatorIndex + 1);
  const parsed = {
    workspaceRoot: process.cwd(),
    stage: DEFAULT_STAGE,
    command: commandParts[0],
    commandArgs: commandParts.slice(1),
  };

  for (let index = 0; index < adapterArgs.length; index += 1) {
    const arg = adapterArgs[index];
    const value = adapterArgs[index + 1];

    if (arg === "--workspace-root") {
      parsed.workspaceRoot = value;
      index += 1;
    } else if (arg === "--change-id") {
      parsed.changeId = value;
      index += 1;
    } else if (arg === "--run-id") {
      parsed.runId = value;
      index += 1;
    } else if (arg === "--stage") {
      parsed.stage = value;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function usage() {
  return [
    "Usage:",
    "  node tools/qwen-capture-adapter.mjs --change-id <change-id> --run-id <run-id> [--stage review-result] -- qwen <args...>",
    "",
    "The adapter captures stdout from the command, extracts a review_result JSON object, validates",
    "changeId/runId/stage/kind/producer, then atomically writes:",
    "  .agent-runtime/<change-id>/artifacts/review-result.json",
  ].join("\n");
}

async function assertCurrentStateExists(workspaceRoot, changeId) {
  const currentStatePath = path.join(path.resolve(workspaceRoot), ".agent-runtime", changeId, "current-state.json");
  await access(currentStatePath, fsConstants.R_OK);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = parseArgs(process.argv.slice(2));

    if (args.help) {
      console.log(usage());
      process.exit(0);
    }

    requireNonEmptyString("changeId", args.changeId);
    requireNonEmptyString("runId", args.runId);
    requireNonEmptyString("command", args.command);
    validatePathSegment("changeId", args.changeId);
    await assertCurrentStateExists(args.workspaceRoot, args.changeId);

    const result = await captureQwenReviewResult(args);
    console.log(
      JSON.stringify(
        {
          ok: true,
          artifactPath: result.artifactPath,
          artifactReference: result.artifactReference,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
