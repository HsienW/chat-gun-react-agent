import { getOpikTracer, type AgentRunMetadata, type OpikTracer } from "./opik-tracer.js";

const TRACED_STREAM_METHODS = new Set<PropertyKey>([
  "stream",
  "streamEvents",
  "streamLog",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readNonEmptyString(
  record: Record<string, unknown>,
  keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function readAgentRunMetadata(config: unknown): AgentRunMetadata | undefined {
  if (!isRecord(config)) return undefined;
  const configurable = isRecord(config.configurable) ? config.configurable : {};
  const threadId = readNonEmptyString(configurable, ["thread_id", "threadId"]);
  const runId =
    readNonEmptyString(config, ["runId", "run_id"]) ??
    readNonEmptyString(configurable, ["run_id", "runId"]);
  if (!threadId || !runId) return undefined;

  const taskId = readNonEmptyString(configurable, ["task_id", "taskId"]);
  const requestId = readNonEmptyString(configurable, ["request_id", "requestId"]);
  return {
    threadId,
    runId,
    ...(taskId ? { taskId } : {}),
    ...(requestId ? { requestId } : {}),
  };
}

function readStepId(config: unknown): string | undefined {
  if (!isRecord(config)) return undefined;
  const configurable = isRecord(config.configurable) ? config.configurable : {};
  return (
    readNonEmptyString(config, ["step_id", "stepId"]) ??
    readNonEmptyString(configurable, ["step_id", "stepId"])
  );
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return Boolean(
    value &&
      typeof value === "object" &&
      Symbol.asyncIterator in value &&
      typeof value[Symbol.asyncIterator] === "function"
  );
}

function isCallable(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === "function";
}

async function invokeMethod(
  method: (...args: unknown[]) => unknown,
  target: object,
  input: unknown,
  config: unknown
): Promise<unknown> {
  return await Promise.resolve(Reflect.apply(method, target, [input, config]));
}

async function invokeStreamMethod(
  method: (...args: unknown[]) => unknown,
  target: object,
  input: unknown,
  config: unknown
): Promise<AsyncIterable<unknown>> {
  const output = await invokeMethod(method, target, input, config);
  if (!isAsyncIterable(output)) {
    throw new TypeError("Instrumented graph stream method did not return an AsyncIterable");
  }
  return output;
}

export function instrumentGraphWithOpik<TGraph extends object>(
  graph: TGraph,
  agentName: string,
  tracer: OpikTracer = getOpikTracer()
): TGraph {
  return new Proxy(graph, {
    get(target, property, receiver) {
      const member = Reflect.get(target, property, receiver);
      if (!isCallable(member)) return member;

      if (property === "invoke") {
        return async (input: unknown, config?: unknown) => {
          const metadata = readAgentRunMetadata(config);
          const execution = () => invokeMethod(member, target, input, config);
          return metadata && !tracer.getActiveTraceId()
            ? tracer.traceAgentRun(agentName, metadata, execution)
            : execution();
        };
      }

      if (TRACED_STREAM_METHODS.has(property)) {
        return async (input: unknown, config?: unknown) => {
          const metadata = readAgentRunMetadata(config);
          const execution = () => invokeStreamMethod(member, target, input, config);
          return metadata && !tracer.getActiveTraceId()
            ? tracer.traceAgentStream(agentName, metadata, execution)
            : execution();
        };
      }

      return member.bind(target);
    },
  });
}

export function withOpikNode<TArguments extends unknown[], TResult>(
  nodeName: string,
  node: (...args: TArguments) => Promise<TResult>,
  tracer: OpikTracer = getOpikTracer()
): (...args: TArguments) => Promise<TResult> {
  return (...args) => {
    const stepId = readStepId(args[1]);
    return tracer.withNodeSpan(
      nodeName,
      stepId ? { stepId } : {},
      () => node(...args),
      args[0]
    );
  };
}

export const opikGraphTestInternals = {
  readAgentRunMetadata,
  readStepId,
};
