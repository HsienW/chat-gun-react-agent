import { afterEach, describe, expect, it, vi } from "vitest";

import {
  initOpik,
  resetOpikForTests,
  type OpikConfig,
  type OpikSdkConstructorOptions,
  type OpikSdkModule,
} from "./opik-setup.js";

const enabledConfig: OpikConfig = {
  enabled: true,
  apiKey: "test-api-key",
  workspace: "test-workspace",
  host: "https://opik.example/api",
  projectName: "test-project",
  redactEnabled: true,
};

describe("initOpik", () => {
  afterEach(() => {
    resetOpikForTests();
    vi.restoreAllMocks();
  });

  it("does not load the SDK when Opik is disabled", async () => {
    const loadSdk = vi.fn<() => Promise<OpikSdkModule>>();

    const result = await initOpik(
      { ...enabledConfig, enabled: false },
      { loadSdk }
    );

    expect(result.enabled).toBe(false);
    expect(result.reason).toBe("disabled");
    expect(result.client.isConfigured()).toBe(false);
    expect(loadSdk).not.toHaveBeenCalled();
  });

  it("warns and stays no-op when the API key is missing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const loadSdk = vi.fn<() => Promise<OpikSdkModule>>();

    const result = await initOpik(
      { ...enabledConfig, apiKey: undefined },
      { loadSdk }
    );

    expect(result.enabled).toBe(false);
    expect(result.reason).toBe("missing_api_key");
    expect(loadSdk).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "Opik enabled but OPIK_API_KEY not configured"
    );
  });

  it("fails closed when redaction is explicitly disabled", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const loadSdk = vi.fn<() => Promise<OpikSdkModule>>();

    const result = await initOpik(
      { ...enabledConfig, redactEnabled: false },
      { loadSdk }
    );

    expect(result.enabled).toBe(false);
    expect(result.reason).toBe("redaction_required");
    expect(result.client.isConfigured()).toBe(false);
    expect(loadSdk).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "Opik tracing disabled because redaction is required"
    );
  });

  it("warns and stays no-op when the dynamic import fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const loadSdk = vi.fn<() => Promise<OpikSdkModule>>(async () => {
      throw new Error("module unavailable");
    });

    const result = await initOpik(enabledConfig, { loadSdk });

    expect(result.enabled).toBe(false);
    expect(result.reason).toBe("sdk_unavailable");
    expect(warn).toHaveBeenCalledWith(
      "Opik SDK not available, tracing disabled"
    );
  });

  it("maps the project adapter to the installed SDK surface", async () => {
    const spanUpdate = vi.fn();
    const spanEnd = vi.fn();
    const traceUpdate = vi.fn();
    const traceEnd = vi.fn();
    const traceScore = vi.fn();
    const sdkSpan = {
      data: { id: "span-1" },
      update: spanUpdate,
      end: spanEnd,
      score: vi.fn(),
      span: vi.fn(),
    };
    const sdkTrace = {
      data: { id: "trace-1" },
      update: traceUpdate,
      end: traceEnd,
      score: traceScore,
      span: vi.fn(() => sdkSpan),
    };
    const sdkTraceFactory = vi.fn(() => sdkTrace);
    const sdkFlush = vi.fn(async () => undefined);
    const constructorOptions: OpikSdkConstructorOptions[] = [];
    class FakeOpik {
      constructor(options: OpikSdkConstructorOptions) {
        constructorOptions.push(options);
      }
      trace = sdkTraceFactory;
      flush = sdkFlush;
    }
    const loadSdk = vi.fn(async (): Promise<OpikSdkModule> => ({ Opik: FakeOpik }));

    const result = await initOpik(enabledConfig, { loadSdk });
    const trace = result.client.startTrace("agent.weather", { runId: "run-1" });
    const span = trace.startSpan("node.plan", { stepId: "plan" });
    span.end({ input: "safe" }, { output: "safe" });
    trace.logFeedback("quality", 0.9, "good");
    trace.end({ input: "safe" }, { output: "safe" });
    await result.client.flush();

    expect(result.enabled).toBe(true);
    expect(result.client.isConfigured()).toBe(true);
    expect(constructorOptions).toEqual([
      {
        apiKey: "test-api-key",
        apiUrl: "https://opik.example/api",
        projectName: "test-project",
        workspaceName: "test-workspace",
      },
    ]);
    expect(sdkTraceFactory).toHaveBeenCalledWith({
      name: "agent.weather",
      metadata: { runId: "run-1" },
    });
    expect(sdkTrace.span).toHaveBeenCalledWith({
      name: "node.plan",
      metadata: { stepId: "plan" },
    });
    expect(spanUpdate).toHaveBeenCalledWith({
      input: { input: "safe" },
      output: { output: "safe" },
    });
    expect(traceScore).toHaveBeenCalledWith({
      name: "quality",
      value: 0.9,
      reason: "good",
    });
    expect(traceUpdate).toHaveBeenCalledWith({
      input: { input: "safe" },
      output: { output: "safe" },
    });
    expect(spanEnd).toHaveBeenCalledOnce();
    expect(traceEnd).toHaveBeenCalledOnce();
    expect(sdkFlush).toHaveBeenCalledWith({ silent: true });
  });

  it("initializes only once for the same config", async () => {
    class FakeOpik {
      trace = vi.fn();
      flush = vi.fn(async () => undefined);
    }
    const loadSdk = vi.fn(async (): Promise<OpikSdkModule> => ({ Opik: FakeOpik }));

    const first = await initOpik(enabledConfig, { loadSdk });
    const second = await initOpik(enabledConfig, { loadSdk });

    expect(second).toBe(first);
    expect(loadSdk).toHaveBeenCalledOnce();
  });
});
