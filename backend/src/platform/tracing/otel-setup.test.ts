import { afterEach, describe, expect, it, vi } from "vitest";

import {
  initTracing,
  resetTracingForTests,
  type TracingProvider,
} from "./otel-setup.js";

function createFakeProvider(): TracingProvider {
  return {
    register: vi.fn(),
    forceFlush: vi.fn(async () => undefined),
    shutdown: vi.fn(async () => undefined),
  };
}

describe("initTracing", () => {
  afterEach(async () => {
    await resetTracingForTests();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("does not initialize a provider when tracing is disabled", () => {
    const createProvider = vi.fn(() => createFakeProvider());

    const result = initTracing(
      {
        enabled: false,
        serviceName: "test-service",
        exporterProtocol: "http",
        sampleRate: 1,
      },
      { createProvider }
    );

    expect(result).toEqual({ enabled: false, exporter: "none" });
    expect(createProvider).not.toHaveBeenCalled();
  });

  it("configures the OTLP HTTP exporter when an endpoint is provided", () => {
    const provider = createFakeProvider();
    const createProvider = vi.fn(() => provider);

    const result = initTracing(
      {
        enabled: true,
        serviceName: "backend",
        exporterEndpoint: "http://jaeger:4318/v1/traces",
        exporterProtocol: "http",
        sampleRate: 0.25,
      },
      { createProvider }
    );

    expect(result).toEqual({ enabled: true, exporter: "otlp-http" });
    expect(createProvider).toHaveBeenCalledWith({
      exporter: "otlp-http",
      exporterEndpoint: "http://jaeger:4318/v1/traces",
      sampleRate: 0.25,
    });
    expect(provider.register).toHaveBeenCalledTimes(1);
  });

  it("uses the console exporter when enabled without an endpoint", () => {
    const provider = createFakeProvider();
    const createProvider = vi.fn(() => provider);

    const result = initTracing(
      {
        enabled: true,
        serviceName: "local-backend",
        exporterProtocol: "http",
        sampleRate: 1,
      },
      { createProvider }
    );

    expect(result).toEqual({ enabled: true, exporter: "console" });
    expect(createProvider).toHaveBeenCalledWith({
      exporter: "console",
      exporterEndpoint: undefined,
      sampleRate: 1,
    });
  });

  it("does not enable console span export in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const createProvider = vi.fn(() => createFakeProvider());

    const result = initTracing(
      {
        enabled: true,
        serviceName: "production-backend",
        exporterProtocol: "http",
        sampleRate: 1,
      },
      { createProvider }
    );

    expect(result).toEqual({ enabled: false, exporter: "none" });
    expect(createProvider).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalled();
  });

  it("configures the OTLP gRPC exporter when requested", () => {
    const provider = createFakeProvider();
    const createProvider = vi.fn(() => provider);

    const result = initTracing(
      {
        enabled: true,
        serviceName: "backend",
        exporterEndpoint: "http://jaeger:4317",
        exporterProtocol: "grpc",
        sampleRate: 1,
      },
      { createProvider }
    );

    expect(result).toEqual({ enabled: true, exporter: "otlp-grpc" });
    expect(createProvider).toHaveBeenCalledWith({
      exporter: "otlp-grpc",
      exporterEndpoint: "http://jaeger:4317",
      sampleRate: 1,
    });
  });

  it("degrades to disabled when provider initialization fails", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = initTracing(
      {
        enabled: true,
        serviceName: "backend",
        exporterProtocol: "http",
        sampleRate: 1,
      },
      {
        createProvider: () => {
          throw new Error("setup failed");
        },
      }
    );

    expect(result).toEqual({ enabled: false, exporter: "none" });
    expect(warning).toHaveBeenCalled();
  });
});
