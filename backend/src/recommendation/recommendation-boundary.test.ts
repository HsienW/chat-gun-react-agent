import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import * as recommendation from "./index.js";

const recommendationDirectory = dirname(fileURLToPath(import.meta.url));
const ALLOWED_PARENT_IMPORTS = [
  "../runtime/authorization/index.js",
  "../runtime/provenance/index.js",
] as const;

function extractModuleSpecifiers(source: string): string[] {
  return [
    ...source.matchAll(
      /(?:\bfrom\s+|\bimport\s*\()\s*["']([^"']+)["']/g
    ),
  ].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
}

describe("recommendation public boundary", () => {
  it("exports the framework runtime surface", () => {
    expect(recommendation).toMatchObject({
      BusinessPolicyGate: expect.any(Function),
      ClarificationFlow: expect.any(Function),
      ConstraintEngine: expect.any(Function),
      DomainRouter: expect.any(Function),
      ProvenanceWriter: expect.any(Function),
      RecommendationEngine: expect.any(Function),
      createRecommendationCard: expect.any(Function),
      validateConstraint: expect.any(Function),
      validateRecommendationInput: expect.any(Function),
    });
  });

  it("imports no concrete business domain or product module", async () => {
    const fileNames = (await readdir(recommendationDirectory)).filter(
      (fileName) => fileName.endsWith(".ts") && !fileName.endsWith(".test.ts")
    );
    const sources = await Promise.all(
      fileNames.map(async (fileName) => ({
        fileName,
        source: await readFile(join(recommendationDirectory, fileName), "utf8"),
      }))
    );

    for (const { fileName, source } of sources) {
      const disallowedImports = extractModuleSpecifiers(source).filter(
        (specifier) =>
          specifier.startsWith("../") &&
          !ALLOWED_PARENT_IMPORTS.some((allowed) => allowed === specifier)
      );
      expect(disallowedImports, fileName).toEqual([]);
      expect(source, fileName).not.toMatch(/\b(?:hair|nail|food)\b/i);
    }
  });
});
