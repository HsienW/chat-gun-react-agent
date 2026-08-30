import type { RecommendationDomainAdapter } from "./domain-adapter.js";
import type { RecommendationInput } from "./types.js";

export const DOMAIN_ROUTING_ERROR_CODES = [
  "INVALID_DOMAIN",
  "DOMAIN_ALREADY_REGISTERED",
  "NO_ADAPTERS_REGISTERED",
  "ROUTING_STRATEGY_REQUIRED",
  "DOMAIN_NOT_REGISTERED",
] as const;

export type DomainRoutingErrorCode =
  (typeof DOMAIN_ROUTING_ERROR_CODES)[number];

export type DomainRoutingStrategy = (
  input: RecommendationInput,
  domains: readonly string[]
) => Promise<string>;

export class DomainRoutingError extends Error {
  constructor(
    public readonly code: DomainRoutingErrorCode,
    message: string
  ) {
    super(message);
    this.name = "DomainRoutingError";
  }
}

export class DomainRouter<
  TIntent = unknown,
  TProduct = unknown,
  TCard = unknown,
> {
  private readonly adapters = new Map<
    string,
    RecommendationDomainAdapter<TIntent, TProduct, TCard>
  >();

  constructor(private readonly strategy?: DomainRoutingStrategy) {}

  registerAdapter(
    adapter: RecommendationDomainAdapter<TIntent, TProduct, TCard>
  ): void {
    const domain = adapter.domain.trim();
    if (domain.length === 0) {
      throw new DomainRoutingError("INVALID_DOMAIN", "Adapter domain is required");
    }
    if (domain !== adapter.domain) {
      throw new DomainRoutingError(
        "INVALID_DOMAIN",
        "Adapter domain must not contain surrounding whitespace"
      );
    }
    if (this.adapters.has(domain)) {
      throw new DomainRoutingError(
        "DOMAIN_ALREADY_REGISTERED",
        `Domain is already registered: ${domain}`
      );
    }
    this.adapters.set(domain, adapter);
  }

  async route(input: RecommendationInput): Promise<string> {
    const domains = [...this.adapters.keys()];
    if (domains.length === 0) {
      throw new DomainRoutingError(
        "NO_ADAPTERS_REGISTERED",
        "No recommendation domain adapters are registered"
      );
    }
    if (domains.length === 1) return domains[0]!;
    if (!this.strategy) {
      throw new DomainRoutingError(
        "ROUTING_STRATEGY_REQUIRED",
        "A routing strategy is required when multiple domains are registered"
      );
    }

    const routedDomain = await this.strategy(input, domains);
    if (!this.adapters.has(routedDomain)) {
      throw new DomainRoutingError(
        "DOMAIN_NOT_REGISTERED",
        `Routing strategy returned an unregistered domain: ${routedDomain}`
      );
    }
    return routedDomain;
  }

  getAdapter(
    domain: string
  ): RecommendationDomainAdapter<TIntent, TProduct, TCard> {
    const adapter = this.adapters.get(domain);
    if (!adapter) {
      throw new DomainRoutingError(
        "DOMAIN_NOT_REGISTERED",
        `Recommendation domain is not registered: ${domain}`
      );
    }
    return adapter;
  }
}
