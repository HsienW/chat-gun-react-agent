import type { StructuredToolInterface } from "@langchain/core/tools";

import { applyToolGovernance, auditToolLoad } from "../platform/tool-governance.js";
import { calculatorTool } from "./calculator.js";
import { loadMcpTools } from "./mcp-loader.js";
import { weatherForecastTool, weatherTool } from "./weather.js";
import { webFetchTool } from "./web-fetch.js";
import { webSearchTool } from "./web-search.js";

const baseTools = [calculatorTool, webSearchTool, webFetchTool, weatherTool, weatherForecastTool];

export interface LoadAgentToolsOptions {
  includeMcp?: boolean;
}

async function loadOptionalMcpTools(
  includeMcp: boolean
): Promise<StructuredToolInterface[]> {
  if (!includeMcp || process.env.MCP_LOAD_ON_START !== "true") {
    return [];
  }

  return loadMcpTools().catch((error) => {
    console.warn("MCP tools failed to load; continuing with local tools.", error);
    return [];
  });
}

export async function loadAgentTools(
  source: string,
  options: LoadAgentToolsOptions = {}
): Promise<StructuredToolInterface[]> {
  const mcpTools = await loadOptionalMcpTools(options.includeMcp ?? false);
  const tools = applyToolGovernance([...baseTools, ...mcpTools]);
  await auditToolLoad(source, tools);
  return tools;
}
