import { describe, expect, it } from "vitest";

import { estimateContentTokens } from "./im-context-pack.js";

describe("estimateContentTokens", () => {
  it("estimates English content from UTF-8 bytes", () => {
    expect(estimateContentTokens("Hello World")).toBe(3);
  });

  it("estimates Traditional Chinese content from UTF-8 bytes", () => {
    expect(estimateContentTokens("繁體中文測試")).toBe(5);
  });

  it("returns zero for empty content", () => {
    expect(estimateContentTokens("")).toBe(0);
  });
});
