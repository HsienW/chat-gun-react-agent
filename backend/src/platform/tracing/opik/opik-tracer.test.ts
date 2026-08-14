import { describe, expect, it, vi } from "vitest";

import type {
  OpikClient,
  OpikMetadata,
  OpikPayload,
  OpikSpan,
  OpikTrace,
} from "./opik-setup.js";
import { createOpikTracer } from "./opik-tracer.js";

type RecordedSpan = {
  name: string;
  metadata: OpikMetadata;
  children: RecordedSpan[];
  input?: OpikPayload;
  output?: OpikPayload;
};

type RecordedTrace = RecordedSpan & {
  feedback: Array<{ name: string; value: number; reason?: string }>;
};

function createRecordingClient(): {
  client: OpikClient;
  traces: RecordedTrace[];
} {
  const traces: RecordedTrace[] = [];

  function spanPort(record: RecordedSpan): OpikSpan {
    return {
      id: `span-${record.name}`,
      startSpan(name, metadata = {}) {
        const child: RecordedSpan = { name, metadata, children: [] };
        record.children.push(child);
        return spanPort(child);
      },
      end(input, output) {
        record.input = input;
        record.output = output;
      },
      update(metadata) {
        record.metadata = { ...record.metadata, ...metadata };
      },
    };
  }

  const client: OpikClient = {
    startTrace(name, metadata = {}) {
      const record: RecordedTrace = {
        name,
        metadata,
        children: [],
        feedback: [],
      };
      traces.push(record);
      const root = spanPort(record);
      return {
        id: `trace-${traces.length}`,
        startSpan: root.startSpan,
        end: root.end,
        update: root.update,
        logFeedback(feedbackName, value, reason) {
          record.feedback.push({
            name: feedbackName,
            value,
            ...(reason ? { reason } : {}),
          });
        },
      };
    },
    isConfigured: () => true,
    flush: async () => undefined,
  };

  return { client, traces };
}

const enabledConfig = {
  enabled: true,
  apiKey: "test-api-key",
  workspace: "workspace",
  host: "https://opik.example/api",
  projectName: "test-project",
  redactEnabled: true,
};

describe("OpikTracer", () => {
  it("is a no-op when the feature flag is disabled", async () => {
    const startTrace = vi.fn();
    const tracer = createOpikTracer(
      { ...enabledConfig, enabled: false },
      {
        client: {
          startTrace,
          isConfigured: () => true,
          flush: async () => undefined,
        },
      }
    );

    await expect(
      tracer.traceAgentRun(
        "weather",
        { threadId: "thread-1", runId: "run-1" },
        async () => "ok"
      )
    ).resolves.toBe("ok");
    expect(startTrace).not.toHaveBeenCalled();
  });

  it("is a no-op when mandatory redaction is disabled", async () => {
    const startTrace = vi.fn();
    const tracer = createOpikTracer(
      { ...enabledConfig, redactEnabled: false },
      {
        client: {
          startTrace,
          isConfigured: () => true,
          flush: async () => undefined,
        },
      }
    );

    await tracer.traceAgentRun(
      "weather",
      { threadId: "thread-1", runId: "run-1" },
      async () => "ok"
    );

    expect(startTrace).not.toHaveBeenCalled();
  });

  it("records agent, node, llm, and tool hierarchy with inherited correlation IDs", async () => {
    const { client, traces } = createRecordingClient();
    const tracer = createOpikTracer(enabledConfig, { client });

    const result = await tracer.traceAgentRun(
      "weather",
      {
        threadId: "thread-1",
        runId: "run-1",
        taskId: "task-1",
      },
      () =>
        tracer.withNodeSpan("plan", { stepId: "step-1" }, async () => {
          await tracer.withLlmSpan(
            { stepId: "step-1", modelName: "qwen-plus", providerName: "qwen" },
            async () => ({ content: "safe", usage_metadata: { input_tokens: 3, output_tokens: 4 } }),
            { prompt: "private prompt" }
          );
          await tracer.withToolSpan(
            { stepId: "step-1", toolName: "current_weather", toolCallId: "tool-1" },
            async () => ({ status: "success", apiKey: "must-not-leak" }),
            { location: "Tokyo", authorization: "Bearer secret" }
          );
          return "done";
        })
    );

    expect(result).toBe("done");
    expect(traces).toHaveLength(1);
    const [trace] = traces;
    expect(trace.name).toBe("agent.weather");
    expect(trace.metadata).toMatchObject({
      threadId: "thread-1",
      runId: "run-1",
      taskId: "task-1",
    });
    const [node] = trace.children;
    expect(node.name).toBe("node.plan");
    expect(node.metadata).toMatchObject({
      threadId: "thread-1",
      runId: "run-1",
      taskId: "task-1",
      stepId: "step-1",
      nodeName: "plan",
    });
    expect(node.children.map((child) => child.name)).toEqual([
      "llm.call",
      "tool.execute",
    ]);
    expect(node.children[0].metadata).toMatchObject({
      modelName: "qwen-plus",
      providerName: "qwen",
      inputTokens: 3,
      outputTokens: 4,
    });
    expect(node.children[0].input).toMatchObject({
      prompt: expect.stringMatching(/^\[prompt:[a-f0-9]{64}\]$/),
    });
    expect(node.children[1].input).toEqual({
      location: "Tokyo",
      authorization: "[redacted]",
    });
    expect(JSON.stringify(trace)).not.toContain("private prompt");
    expect(JSON.stringify(trace)).not.toContain("must-not-leak");
  });

  it("records retry attempts as siblings of the failed tool span", async () => {
    const { client, traces } = createRecordingClient();
    const tracer = createOpikTracer(enabledConfig, { client });

    await tracer.traceAgentRun(
      "weather",
      { threadId: "thread-1", runId: "run-1", taskId: "task-1" },
      () =>
        tracer.withNodeSpan("tools", { stepId: "step-1" }, async () => {
          await tracer.withToolSpan(
            { stepId: "step-1", toolName: "current_weather", toolCallId: "tool-1" },
            async () => ({ status: "failed" })
          );
          await tracer.withRetrySpan(
            { attempt: 2, reason: "timeout", stepId: "step-1" },
            () =>
              tracer.withToolSpan(
                {
                  stepId: "step-1",
                  toolName: "current_weather",
                  toolCallId: "tool-2",
                },
                async () => ({ status: "success" })
              )
          );
        })
    );

    const node = traces[0].children[0];
    expect(node.children.map((child) => child.name)).toEqual([
      "tool.execute",
      "retry.attempt",
    ]);
    expect(node.children[1].metadata).toMatchObject({
      attempt: 2,
      reason: "timeout",
      stepId: "step-1",
    });
    expect(node.children[1].children[0].name).toBe("tool.execute");
  });

  it("isolates parallel agent traces", async () => {
    const { client, traces } = createRecordingClient();
    const tracer = createOpikTracer(enabledConfig, { client });

    await Promise.all([
      tracer.traceAgentRun(
        "weather",
        { threadId: "thread-a", runId: "run-a" },
        () => tracer.withNodeSpan("first", { stepId: "a" }, async () => "a")
      ),
      tracer.traceAgentRun(
        "research",
        { threadId: "thread-b", runId: "run-b" },
        () => tracer.withNodeSpan("second", { stepId: "b" }, async () => "b")
      ),
    ]);

    expect(traces).toHaveLength(2);
    expect(traces[0].children[0].metadata).toMatchObject({
      threadId: "thread-a",
      runId: "run-a",
    });
    expect(traces[1].children[0].metadata).toMatchObject({
      threadId: "thread-b",
      runId: "run-b",
    });
  });

  it("keeps parallel tool calls as isolated siblings within one node", async () => {
    const { client, traces } = createRecordingClient();
    const tracer = createOpikTracer(enabledConfig, { client });

    await tracer.traceAgentRun(
      "weather",
      { threadId: "thread-1", runId: "run-1" },
      () =>
        tracer.withNodeSpan("tools", { stepId: "step-1" }, async () => {
          await Promise.all([
            tracer.withToolSpan(
              { toolName: "first", toolCallId: "tool-a", stepId: "step-1" },
              async () => "a"
            ),
            tracer.withToolSpan(
              { toolName: "second", toolCallId: "tool-b", stepId: "step-1" },
              async () => "b"
            ),
          ]);
        })
    );

    const tools = traces[0].children[0].children;
    expect(tools.map((span) => span.name)).toEqual([
      "tool.execute",
      "tool.execute",
    ]);
    expect(tools.map((span) => span.metadata.toolCallId)).toEqual([
      "tool-a",
      "tool-b",
    ]);
  });

  it("keeps the root trace active while an async stream is consumed", async () => {
    const { client, traces } = createRecordingClient();
    const tracer = createOpikTracer(enabledConfig, { client });

    const stream = tracer.traceAgentStream(
      "weather",
      { threadId: "thread-stream", runId: "run-stream" },
      async function* () {
        yield await tracer.withNodeSpan(
          "streamed",
          { stepId: "stream-step" },
          async () => "chunk"
        );
      }
    );
    const chunks: string[] = [];
    for await (const chunk of stream) chunks.push(chunk);

    expect(chunks).toEqual(["chunk"]);
    expect(traces).toHaveLength(1);
    expect(traces[0].children[0]).toMatchObject({
      name: "node.streamed",
      metadata: {
        threadId: "thread-stream",
        runId: "run-stream",
        stepId: "stream-step",
      },
    });
  });

  it("does not let SDK failures replace the execution result", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const tracer = createOpikTracer(enabledConfig, {
      client: {
        startTrace() {
          throw new Error("SDK failed");
        },
        isConfigured: () => true,
        flush: async () => undefined,
      },
    });

    await expect(
      tracer.traceAgentRun(
        "weather",
        { threadId: "thread-1", runId: "run-1" },
        async () => 42
      )
    ).resolves.toBe(42);
    expect(warn).toHaveBeenCalled();
  });

  it("does not let span end failures replace the execution result", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const tracer = createOpikTracer(enabledConfig, {
      client: {
        startTrace() {
          return {
            id: "trace-1",
            startSpan() {
              return {
                id: "span-1",
                startSpan() {
                  return this;
                },
                update() {},
                end() {
                  throw new Error("span end failed");
                },
              };
            },
            update() {},
            end() {},
            logFeedback() {},
          };
        },
        isConfigured: () => true,
        flush: async () => undefined,
      },
    });

    await expect(
      tracer.traceAgentRun(
        "weather",
        { threadId: "thread-1", runId: "run-1" },
        () => tracer.withNodeSpan("plan", {}, async () => 42)
      )
    ).resolves.toBe(42);
    expect(warn).toHaveBeenCalled();
  });
});
