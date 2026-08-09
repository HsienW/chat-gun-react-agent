import { Hono } from "hono";

import { getMetricsCollector } from "./metrics-collector.js";

export const metricsApp = new Hono().get("/metrics", (context) =>
  context.json(getMetricsCollector().snapshot())
);
