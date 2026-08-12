export interface ExecutedToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ExecutedToolCallArtifact extends ExecutedToolCall {
  schemaVersion: "1.0";
  type: "executed_tool_call";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function createExecutedToolCallArtifact(
  invocation: ExecutedToolCall
): ExecutedToolCallArtifact {
  return {
    schemaVersion: "1.0",
    type: "executed_tool_call",
    name: invocation.name,
    arguments: invocation.arguments,
  };
}

export function parseExecutedToolCallArtifact(
  artifact: unknown,
  messageToolName: unknown
): ExecutedToolCall | undefined {
  if (!isRecord(artifact) || !isRecord(artifact.arguments)) return undefined;
  if (
    artifact.schemaVersion !== "1.0" ||
    artifact.type !== "executed_tool_call" ||
    typeof artifact.name !== "string" ||
    artifact.name !== messageToolName
  ) {
    return undefined;
  }
  return {
    name: artifact.name,
    arguments: artifact.arguments,
  };
}
