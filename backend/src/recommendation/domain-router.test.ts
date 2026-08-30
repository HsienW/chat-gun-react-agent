import { describe, expect, it, vi } from "vitest";

import type { RecommendationDomainAdapter } from "./domain-adapter.js";
import {
  DomainRouter,
  type DomainRoutingStrategy,
} from "./domain-router.js";
import type { RecommendationInput } from "./types.js";

type MockAdapter = RecommendationDomainAdapter<unknown, unknown, unknown>;

function createAdapter(domain: string): MockAdapter {
  return {
    domain,
    async extractIntent() {
      return {};
    },
    buildRetrievalPolicy() {
      return { domain, candidateLimit: 1 };
    },
    toCandidateFields() {
      return {};
    },
    buildCard() {
      return {};
    },
  };
}

const input = {
  rawText: "must not be used for keyword routing",
} as RecommendationInput;

describe("DomainRouter", () => {
  it("routes deterministically when exactly one adapter is registered", async () => {
    const strategy = vi.fn<DomainRoutingStrategy>();
    const router = new DomainRouter(strategy);
    router.registerAdapter(createAdapter("only-domain"));

    await expect(router.route(input)).resolves.toBe("only-domain");
    expect(strategy).not.toHaveBeenCalled();
  });

  it("delegates multi-domain routing to the injected strategy", async () => {
    const strategy = vi.fn<DomainRoutingStrategy>(async (_input, domains) => {
      expect(domains).toEqual(["first-domain", "second-domain"]);
      return "second-domain";
    });
    const router = new DomainRouter(strategy);
    router.registerAdapter(createAdapter("first-domain"));
    router.registerAdapter(createAdapter("second-domain"));

    await expect(router.route(input)).resolves.toBe("second-domain");
    expect(strategy).toHaveBeenCalledOnce();
  });

  it("fails closed when the strategy returns an unregistered domain", async () => {
    const router = new DomainRouter(async () => "unknown-domain");
    router.registerAdapter(createAdapter("first-domain"));
    router.registerAdapter(createAdapter("second-domain"));

    await expect(router.route(input)).rejects.toMatchObject({
      code: "DOMAIN_NOT_REGISTERED",
    });
  });

  it("fails closed when no adapter is registered", async () => {
    const router = new DomainRouter();

    await expect(router.route(input)).rejects.toMatchObject({
      code: "NO_ADAPTERS_REGISTERED",
    });
  });

  it("returns only explicitly registered adapters", () => {
    const router = new DomainRouter();
    const adapter = createAdapter("registered-domain");
    router.registerAdapter(adapter);

    expect(router.getAdapter("registered-domain")).toBe(adapter);
    expect(() => router.getAdapter("unknown-domain")).toThrowError(
      expect.objectContaining({ code: "DOMAIN_NOT_REGISTERED" })
    );
  });

  it("rejects a non-canonical adapter domain", () => {
    const router = new DomainRouter();

    expect(() => router.registerAdapter(createAdapter(" spaced-domain "))).toThrow(
      "Adapter domain must not contain surrounding whitespace"
    );
  });
});
