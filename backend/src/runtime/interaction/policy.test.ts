import { describe, expect, it } from "vitest";

import {
  DEFAULT_INTERACTION_POLICY,
  InteractionPolicyConfigError,
  loadInteractionPolicy,
} from "./policy.js";

describe("loadInteractionPolicy", () => {
  it("preserves existing behavior when no policy is configured", () => {
    expect(loadInteractionPolicy(undefined)).toEqual({
      configured: false,
      policy: DEFAULT_INTERACTION_POLICY,
    });
    expect(DEFAULT_INTERACTION_POLICY).toEqual({
      strategy: "enqueue",
      clarificationReplyMode: "new_task",
      cancellationMode: "cancel_if_read_only",
      allowIntentRevision: false,
    });
  });

  it("loads every closed-enum policy field from configuration", () => {
    expect(
      loadInteractionPolicy(
        JSON.stringify({
          strategy: "supersede",
          clarificationReplyMode: "resume_same_task",
          cancellationMode: "compensate_if_needed",
          allowIntentRevision: true,
        })
      )
    ).toEqual({
      configured: true,
      policy: {
        strategy: "supersede",
        clarificationReplyMode: "resume_same_task",
        cancellationMode: "compensate_if_needed",
        allowIntentRevision: true,
      },
    });
  });

  it.each([
    "{}",
    JSON.stringify({
      strategy: "custom",
      clarificationReplyMode: "resume_same_task",
      cancellationMode: "cancel_if_read_only",
      allowIntentRevision: true,
    }),
    "not-json",
  ])("rejects invalid policy configuration: %s", (rawPolicy) => {
    expect(() => loadInteractionPolicy(rawPolicy)).toThrow(
      InteractionPolicyConfigError
    );
  });
});
