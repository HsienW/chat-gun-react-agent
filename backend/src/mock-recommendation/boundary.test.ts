import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import * as mockRecommendation from "./index.js";

const mockRecommendationDirectory = dirname(fileURLToPath(import.meta.url));
const recommendationDirectory = join(
  mockRecommendationDirectory,
  "..",
  "recommendation"
);

describe("mock recommendation public boundary", () => {
  it("exports the intentional mock adapter surface", () => {
    expect(mockRecommendation).toMatchObject({
      MOCK_CATALOG: expect.any(Array),
      MOCK_RECOMMENDATION_DOMAIN: "mock",
      MockCandidateRetriever: expect.any(Function),
      MockRecommendationAdapter: expect.any(Function),
      createMockRecommendationEngine: expect.any(Function),
      validateMockCardPayload: expect.any(Function),
      validateMockIntent: expect.any(Function),
      validateMockProduct: expect.any(Function),
    });
  });

  it("is never imported by the recommendation framework core", async () => {
    const fileNames = (await readdir(recommendationDirectory)).filter(
      (fileName) => fileName.endsWith(".ts") && !fileName.endsWith(".test.ts")
    );
    const sources = await Promise.all(
      fileNames.map((fileName) =>
        readFile(join(recommendationDirectory, fileName), "utf8")
      )
    );

    expect(sources).not.toEqual([]);
    for (const source of sources) {
      expect(source).not.toContain("mock-recommendation");
      expect(source).not.toContain("MOCK_RECOMMENDATION_DOMAIN");
    }
  });
});
