import { describe, expect, it } from "vitest";

import { createAuditEvent } from "./audit-events.js";

describe("createAuditEvent", () => {
  it("adds a unique event id and ISO timestamp", () => {
    const event = createAuditEvent({
      actorType: "system",
      actorId: "backend",
      action: "tool.invoke.start",
      resourceType: "tool",
      resourceId: "current_weather",
      decision: "neutral",
    });

    expect(event.eventId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(new Date(event.createdAt).toISOString()).toBe(event.createdAt);
  });
});
