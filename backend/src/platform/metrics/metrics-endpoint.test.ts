import { beforeEach, describe, expect, it } from "vitest";

import { createMetricsCollector, setMetricsCollector } from "./metrics-collector.js";
import { metricsApp } from "./metrics-endpoint.js";

describe("metrics endpoint", () => {
  beforeEach(() => {
    setMetricsCollector(createMetricsCollector());
  });

  it("returns the current MetricsSnapshot as JSON", async () => {
    const collector = createMetricsCollector();
    collector.record({
      kind: "task",
      taskId: "task-1",
      status: "completed",
      durationMs: 25,
      ts: 1,
    });
    setMetricsCollector(collector);

    const response = await metricsApp.request("/metrics");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toMatchObject({
      snapshotTs: expect.any(Number),
      metrics: {
        tasks: { total: 1, completed: 1 },
        rates: { taskSuccessRate: 1 },
      },
    });
  });

  it("returns a zero-value snapshot when no metrics have been recorded", async () => {
    const response = await metricsApp.request("/metrics");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      metrics: {
        tasks: { total: 0 },
        tools: { total: 0 },
        rates: { taskSuccessRate: 1, toolSuccessRate: 1 },
      },
    });
  });
});
