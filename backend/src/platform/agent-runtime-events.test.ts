import { describe, expect, it, vi } from "vitest";

import { createRuntimeEvent } from "./agent-runtime-events.js";

describe("createRuntimeEvent", () => {
  it("supports the unknown runtime event variant with deterministic timestamp source", () => {
    vi.spyOn(Date, "now").mockReturnValue(12345);

    expect(
      createRuntimeEvent({
        type: "agent.unknown",
        originalType: "agent.future.event",
        rawPayload: { safe: true },
      })
    ).toEqual({
      type: "agent.unknown",
      originalType: "agent.future.event",
      rawPayload: { safe: true },
      ts: 12345,
    });
  });
});
