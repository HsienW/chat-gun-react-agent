import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createBffErrorEnvelope } from "./errors.js";

describe("createBffErrorEnvelope", () => {
  it("uses structured abort reason code before error names or messages", () => {
    const error = new DOMException("The operation was aborted", "AbortError");
    const envelope = createBffErrorEnvelope(error, {
      stage: "langgraph_upstream_proxy",
      provider: "LangGraph",
      message: "LangGraph upstream timeout",
      abortReason: {
        code: "bff_timeout",
        stage: "langgraph_upstream_proxy",
        requestId: "req-1",
      },
    });

    assert.equal(envelope.error.code, "bff_timeout");
    assert.equal(envelope.error.details?.requestId, "req-1");
  });

  it("maps structured network cause codes to a stable network error code", () => {
    const cause = Object.assign(new Error("connection refused"), {
      code: "ECONNREFUSED",
    });
    const error = new Error("fetch failed", { cause });
    const envelope = createBffErrorEnvelope(error, {
      stage: "langgraph_upstream_proxy",
      provider: "LangGraph",
      message: "LangGraph upstream error",
    });

    assert.equal(envelope.error.code, "upstream_network_error");
    assert.equal(envelope.error.cause?.code, "ECONNREFUSED");
  });

  it("does not use timeout-like message text as the public error code source", () => {
    const error = new Error("fetch failed connect network timeout");
    const envelope = createBffErrorEnvelope(error, {
      stage: "langgraph_upstream_proxy",
      provider: "LangGraph",
      message: "LangGraph upstream error",
    });

    assert.equal(envelope.error.code, "upstream_error");
  });
});
