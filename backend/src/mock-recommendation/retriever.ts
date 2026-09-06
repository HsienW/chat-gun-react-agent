import {
  validateRetrievalPolicy,
  type CandidateRetriever,
  type RetrievalPolicy,
} from "../recommendation/index.js";
import { validateMockProduct, type MockProduct } from "./types.js";

export class MockCandidateRetriever
  implements CandidateRetriever<MockProduct>
{
  private readonly catalog: readonly MockProduct[];

  constructor(catalog: readonly MockProduct[]) {
    this.catalog = catalog.map((product) => validateMockProduct(product));
  }

  async retrieve(policy: RetrievalPolicy): Promise<MockProduct[]> {
    const safePolicy = validateRetrievalPolicy(policy);
    const category = safePolicy.filters?.category;
    const matchingProducts =
      category === undefined
        ? this.catalog
        : this.catalog.filter((product) => product.category === category);
    return matchingProducts
      .slice(0, safePolicy.candidateLimit)
      .map((product) => ({ ...product }));
  }
}
