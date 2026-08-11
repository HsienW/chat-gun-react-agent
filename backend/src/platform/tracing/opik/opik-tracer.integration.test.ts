import { describe, expect, it } from "vitest";

import type {
  OpikClient,
  OpikMetadata,
  OpikPayload,
  OpikSpan,
  OpikTrace,
} from "./opik-setup.js";
import { createOpikTracer } from "./opik-tracer.js";

interface RecordedSpan {
  name: string;
  metadata: OpikMetadata;
  children: RecordedSpan[];
  input?: OpikPayload;
  output?: OpikPayload;
}

interface RecordedTrace extends RecordedSpan {
  feedback: Array<{ name: string; value: number; reason?: string }>;
}

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
    startTrace(name, metadata = {}): OpikTrace {
      const trace: RecordedTrace = {
        name,
        metadata,
        children: [],
        feedback: [],
      };
      traces.push(trace);
      const root = spanPort(trace);
      return {
        id: `trace-${traces.length}`,
        startSpan: root.startSpan,
        end: root.end,
        update: root.update,
        logFeedback(feedbackName, value, reason) {
          trace.feedback.push({
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

describe("OpikTracer integration", () => {
  it("records a redacted Weather Agent hierarchy with correlation and usage metadata", async () => {
    const { client, traces } = createRecordingClient();
    const tracer = createOpikTracer(
      {
        enabled: true,
        apiKey: "test-only-key",
        workspace: "test-workspace",
        host: "https://opik.example/api",
        projectName: "test-project",
        redactEnabled: true,
      },
      { client }
    );

    await tracer.traceAgentRun(
      "weather",
      {
        threadId: "thread-weather-1",
        runId: "run-weather-1",
        taskId: "task-weather-1",
        requestId: "request-weather-1",
      },
      () =>
        tracer.withNodeSpan(
          "targeted_tools",
          { stepId: "targeted_tools" },
          async () => {
            await tracer.withLlmSpan(
              {
                stepId: "targeted_tools",
                modelName: "qwen-test",
                providerName: "qwen",
              },
              async () => ({
                content: "Weather tool selected",
                usage_metadata: {
                  input_tokens: 12,
                  output_tokens: 5,
                  total_tokens: 17,
                },
              }),
              {
                prompt: "Weather for jane@example.com at +1 415 555 0100",
              }
            );
            return tracer.withToolSpan(
              {
                stepId: "targeted_tools",
                toolName: "current_weather",
                toolCallId: "tool-call-weather-1",
              },
              async () => ({ temperatureC: 23, apiKey: "must-not-export" }),
              { location: "Taipei", authorization: "Bearer private-token" }
            );
          },
          { messages: [{ role: "user", content: "private weather request" }] }
        )
    );

    expect(traces).toHaveLength(1);
    const [trace] = traces;
    expect(trace).toMatchObject({
      name: "agent.weather",
      metadata: {
        threadId: "thread-weather-1",
        runId: "run-weather-1",
        taskId: "task-weather-1",
        requestId: "request-weather-1",
        status: "completed",
      },
    });
    const [node] = trace.children;
    expect(node).toMatchObject({
      name: "node.targeted_tools",
      metadata: {
        threadId: "thread-weather-1",
        runId: "run-weather-1",
        taskId: "task-weather-1",
        stepId: "targeted_tools",
        nodeName: "targeted_tools",
        status: "completed",
      },
    });
    expect(node.children.map((child) => child.name)).toEqual([
      "llm.call",
      "tool.execute",
    ]);
    expect(node.children[0]).toMatchObject({
      metadata: {
        modelName: "qwen-test",
        providerName: "qwen",
        inputTokens: 12,
        outputTokens: 5,
        totalTokens: 17,
        status: "completed",
      },
      input: {
        prompt: expect.stringMatching(/^\[prompt:[a-f0-9]{64}\]$/),
      },
    });
    expect(node.children[1]).toMatchObject({
      metadata: {
        toolName: "current_weather",
        toolCallId: "tool-call-weather-1",
        durationMs: expect.any(Number),
        status: "completed",
      },
      input: {
        location: "Taipei",
        authorization: "[redacted]",
      },
      output: {
        temperatureC: 23,
        apiKey: "[redacted]",
      },
    });
    const exported = JSON.stringify(trace);
    expect(exported).not.toContain("private weather request");
    expect(exported).not.toContain("jane@example.com");
    expect(exported).not.toContain("415 555 0100");
    expect(exported).not.toContain("private-token");
    expect(exported).not.toContain("must-not-export");
  });
});
