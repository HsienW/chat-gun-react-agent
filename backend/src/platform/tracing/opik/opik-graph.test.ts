import { describe, expect, it, vi } from "vitest";

import type {
  AgentRunMetadata,
  LlmSpanMetadata,
  NodeSpanMetadata,
  OpikTracer,
  ToolSpanMetadata,
  RetrySpanMetadata,
} from "./opik-tracer.js";
import { instrumentGraphWithOpik, withOpikNode } from "./opik-graph.js";

class RecordingTracer implements OpikTracer {
  readonly agentRunCalls: Array<{
    agentName: string;
    metadata: AgentRunMetadata;
  }> = [];

  readonly agentStreamCalls: Array<{
    agentName: string;
    metadata: AgentRunMetadata;
  }> = [];

  async traceAgentRun<T>(
    agentName: string,
    metadata: AgentRunMetadata,
    execution: () => Promise<T>
  ): Promise<T> {
    this.agentRunCalls.push({ agentName, metadata });
    return execution();
  }

  traceAgentStream<T>(
    agentName: string,
    metadata: AgentRunMetadata,
    execution: () => AsyncIterable<T> | Promise<AsyncIterable<T>>
  ): AsyncIterable<T> {
    this.agentStreamCalls.push({ agentName, metadata });
    return {
      async *[Symbol.asyncIterator]() {
        const iterable = await execution();
        for await (const chunk of iterable) yield chunk;
      },
    };
  }

  withNodeSpan<T>(
    _nodeName: string,
    _metadata: NodeSpanMetadata,
    execution: () => Promise<T>
  ): Promise<T> {
    return execution();
  }

  withLlmSpan<T>(
    _metadata: LlmSpanMetadata,
    execution: () => Promise<T>
  ): Promise<T> {
    return execution();
  }

  withToolSpan<T>(
    _metadata: ToolSpanMetadata,
    execution: () => Promise<T>
  ): Promise<T> {
    return execution();
  }

  withRetrySpan<T>(
    _metadata: RetrySpanMetadata,
    execution: () => Promise<T>
  ): Promise<T> {
    return execution();
  }

  getActiveTraceId(): string | undefined {
    return undefined;
  }

  logFeedback(): void {}

  async flush(): Promise<void> {}
}

describe("instrumentGraphWithOpik", () => {
  it("preserves an existing node step identifier", async () => {
    const tracer = new RecordingTracer();
    const withNodeSpan = vi.spyOn(tracer, "withNodeSpan");
    const node = withOpikNode(
      "call_model",
      async (_state: unknown, _config: unknown) => "ok",
      tracer
    );

    await node({}, { configurable: { step_id: "step-existing" } });

    expect(withNodeSpan).toHaveBeenCalledWith(
      "call_model",
      { stepId: "step-existing" },
      expect.any(Function),
      {}
    );
  });

  it("wraps graph invoke with existing correlation identifiers", async () => {
    const tracer = new RecordingTracer();
    const graph = {
      invoke: vi.fn(async (input: unknown, _config?: unknown) => ({
        input,
        completed: true,
      })),
    };
    const instrumented = instrumentGraphWithOpik(graph, "weather", tracer);

    await expect(
      instrumented.invoke(
        { message: "hello" },
        {
          runId: "run-1",
          configurable: {
            thread_id: "thread-1",
            task_id: "task-1",
          },
        }
      )
    ).resolves.toEqual({ input: { message: "hello" }, completed: true });
    expect(tracer.agentRunCalls).toEqual([
      {
        agentName: "weather",
        metadata: {
        threadId: "thread-1",
        runId: "run-1",
        taskId: "task-1",
        },
      },
    ]);
  });

  it("keeps stream consumption inside a traced async scope", async () => {
    const tracer = new RecordingTracer();
    const graph = {
      async stream(_input?: unknown, _config?: unknown) {
        return {
          async *[Symbol.asyncIterator]() {
            yield "first";
            yield "second";
          },
        };
      },
    };
    const instrumented = instrumentGraphWithOpik(graph, "weather", tracer);

    const stream = await instrumented.stream(
      {},
      { configurable: { thread_id: "thread-1", run_id: "run-1" } }
    );
    const chunks: string[] = [];
    for await (const chunk of stream) chunks.push(chunk);

    expect(chunks).toEqual(["first", "second"]);
    expect(tracer.agentStreamCalls).toEqual([
      {
        agentName: "weather",
        metadata: { threadId: "thread-1", runId: "run-1" },
      },
    ]);
  });
});
