import { tool } from "@langchain/core/tools";
import { z } from "zod";

function normalizeExpression(expression: string): string {
  return expression
    .replace(/\bpi\b/g, "Math.PI")
    .replace(/\be\b/g, "Math.E")
    .replace(/\bsqrt\s*\(/g, "Math.sqrt(")
    .replace(/\bsin\s*\(/g, "Math.sin(")
    .replace(/\bcos\s*\(/g, "Math.cos(")
    .replace(/\btan\s*\(/g, "Math.tan(")
    .replace(/\basin\s*\(/g, "Math.asin(")
    .replace(/\bacos\s*\(/g, "Math.acos(")
    .replace(/\batan\s*\(/g, "Math.atan(")
    .replace(/\blog10\s*\(/g, "Math.log10(")
    .replace(/\blog\s*\(/g, "Math.log(")
    .replace(/\bexp\s*\(/g, "Math.exp(")
    .replace(/\bceil\s*\(/g, "Math.ceil(")
    .replace(/\bfloor\s*\(/g, "Math.floor(")
    .replace(/\bround\s*\(/g, "Math.round(")
    .replace(/\babs\s*\(/g, "Math.abs(");
}

export const calculatorTool = tool(
  async ({ expression }) => {
    try {
      if (!/^[\d\s+\-*/().,A-Za-z_*]+$/.test(expression)) {
        return "Error: expression 包含不允許的字元。";
      }

      const normalized = normalizeExpression(expression);
      const result = Function(`"use strict"; return (${normalized});`)();

      if (typeof result === "number") {
        if (!Number.isFinite(result)) {
          return "Error: calculation result 不是有限數字。";
        }
        return Number.isInteger(result) ? String(result) : result.toPrecision(10);
      }
      return String(result);
    } catch (error) {
      return `Error: 無法計算 expression - ${
        error instanceof Error ? error.message : String(error)
      }`;
    }
  },
  {
    name: "calculator_tool",
    description:
      "計算 mathematical expression。支援 arithmetic、sqrt、sin、cos、tan、log、pi、e 與 parentheses。",
    schema: z.object({
      expression: z
        .string()
        .describe('字串形式的 mathematical expression，例如 "2 + 3 * 4"。'),
    }),
  }
);
