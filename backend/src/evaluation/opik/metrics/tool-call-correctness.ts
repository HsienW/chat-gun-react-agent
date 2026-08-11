import type {
  ActualToolCall,
  AgentRunResult,
  EvaluationItem,
  EvaluationMetric,
  ExpectedToolCall,
  MetricScore,
} from "../types.js";

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => valuesEqual(value, right[index]))
    );
  }
  if (
    left &&
    right &&
    typeof left === "object" &&
    typeof right === "object" &&
    !Array.isArray(left) &&
    !Array.isArray(right)
  ) {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const keys = Object.keys(leftRecord);
    return (
      keys.length === Object.keys(rightRecord).length &&
      keys.every(
        (key) => key in rightRecord && valuesEqual(leftRecord[key], rightRecord[key])
      )
    );
  }
  return false;
}

function scoreCall(expected: ExpectedToolCall, actual: ActualToolCall): {
  value: number;
  differences: string[];
} {
  if (expected.name !== actual.name) {
    return {
      value: 0,
      differences: [`tool name expected ${expected.name}, received ${actual.name}`],
    };
  }
  const expectedArguments = Object.entries(expected.arguments);
  if (expectedArguments.length === 0) return { value: 1, differences: [] };
  const differences: string[] = [];
  let matchingArguments = 0;
  for (const [key, expectedValue] of expectedArguments) {
    if (key in actual.arguments && valuesEqual(expectedValue, actual.arguments[key])) {
      matchingArguments += 1;
    } else {
      differences.push(`argument ${key} does not match`);
    }
  }
  return {
    value: 0.5 + 0.5 * (matchingArguments / expectedArguments.length),
    differences,
  };
}

export class ToolCallCorrectnessMetric implements EvaluationMetric {
  readonly name = "tool_call_correctness";
  readonly deterministic = true;

  evaluate(item: EvaluationItem, result: AgentRunResult): MetricScore {
    const expectedCalls = item.expectedOutput?.toolCalls ?? [];
    if (expectedCalls.length > 0 && result.toolCalls.length === 0) {
      return {
        name: this.name,
        value: 0,
        reason: "No tool calls executed",
        status: "COMPLETED",
        deterministic: true,
      };
    }
    if (expectedCalls.length === 0 && result.toolCalls.length === 0) {
      return {
        name: this.name,
        value: 1,
        reason: "Tool call matches expected",
        status: "COMPLETED",
        deterministic: true,
      };
    }

    const remaining = [...result.toolCalls];
    const differences: string[] = [];
    let total = 0;
    for (const expected of expectedCalls) {
      let bestIndex = -1;
      let best = { value: 0, differences: ["no matching tool call"] };
      remaining.forEach((actual, index) => {
        const candidate = scoreCall(expected, actual);
        if (candidate.value > best.value) {
          best = candidate;
          bestIndex = index;
        }
      });
      total += best.value;
      differences.push(...best.differences);
      if (bestIndex >= 0) remaining.splice(bestIndex, 1);
    }
    const denominator = Math.max(expectedCalls.length, result.toolCalls.length, 1);
    const value = Math.max(0, Math.min(1, total / denominator));
    return {
      name: this.name,
      value,
      reason:
        value === 1
          ? "Tool call matches expected"
          : differences.join("; ") || "Unexpected additional tool calls executed",
      status: "COMPLETED",
      deterministic: true,
    };
  }
}
