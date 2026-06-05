import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";

import { getBooleanEnv, getEnv } from "../platform/env.js";
import {
  applyToolGovernance,
  auditToolLoad,
} from "../platform/tool-governance.js";

type StdioMcpServerConfig = {
  transport: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string | undefined>;
};

type McpJsonSchema = {
  type?: string | string[];
  description?: string;
  properties?: Record<string, McpJsonSchema>;
  required?: string[];
  items?: McpJsonSchema;
  enum?: unknown[];
  minItems?: number;
};

const activeClients: Client[] = [];

function getNpxCommand(): string {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

function getMcpServerConfigs(): Record<string, StdioMcpServerConfig> {
  const configs: Record<string, StdioMcpServerConfig> = {};

  if (getBooleanEnv("MCP_FILESYSTEM_ENABLED", true)) {
    configs.filesystem = {
      transport: "stdio",
      command: getNpxCommand(),
      args: [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        getEnv("MCP_FILESYSTEM_PATH", "/tmp"),
      ],
    };
  }

  if (getBooleanEnv("MCP_BRAVE_SEARCH_ENABLED", false)) {
    configs.brave_search = {
      transport: "stdio",
      command: getNpxCommand(),
      args: ["-y", "@modelcontextprotocol/server-brave-search"],
      env: {
        BRAVE_API_KEY: getEnv("BRAVE_API_KEY"),
      },
    };
  }

  return configs;
}

function toProcessEnv(
  env: Record<string, string | undefined> | undefined
): Record<string, string> | undefined {
  if (!env) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => {
      return typeof entry[1] === "string" && entry[1].length > 0;
    })
  );
}

function stringifyMcpResult(result: unknown): string {
  if (!result || typeof result !== "object") {
    return String(result ?? "");
  }

  const record = result as {
    content?: unknown;
    structuredContent?: unknown;
    toolResult?: unknown;
    isError?: boolean;
  };

  if (record.structuredContent !== undefined) {
    if (
      record.structuredContent &&
      typeof record.structuredContent === "object" &&
      "content" in record.structuredContent &&
      typeof record.structuredContent.content === "string"
    ) {
      return record.structuredContent.content;
    }

    return JSON.stringify(record.structuredContent, null, 2);
  }

  if (record.toolResult !== undefined) {
    return typeof record.toolResult === "string"
      ? record.toolResult
      : JSON.stringify(record.toolResult, null, 2);
  }

  if (Array.isArray(record.content)) {
    return record.content
      .map((block) => {
        if (!block || typeof block !== "object") {
          return String(block ?? "");
        }

        const contentBlock = block as {
          type?: string;
          text?: string;
          resource?: { text?: string; uri?: string; blob?: string };
          mimeType?: string;
        };

        if (contentBlock.type === "text") {
          return contentBlock.text ?? "";
        }

        if (contentBlock.type === "resource") {
          return (
            contentBlock.resource?.text ??
            contentBlock.resource?.uri ??
            contentBlock.resource?.blob ??
            JSON.stringify(contentBlock)
          );
        }

        return JSON.stringify(contentBlock);
      })
      .filter((text) => text.length > 0)
      .join("\n");
  }

  return JSON.stringify(result, null, 2);
}

function getSchemaType(schema: McpJsonSchema): string {
  return Array.isArray(schema.type)
    ? schema.type.find((type) => type !== "null") ?? "object"
    : schema.type ?? "object";
}

function applySchemaDescription<T extends z.ZodTypeAny>(
  schema: T,
  description: string | undefined
): T {
  return description ? (schema.describe(description) as T) : schema;
}

function jsonSchemaToZod(schema: McpJsonSchema | undefined): z.ZodTypeAny {
  if (!schema) {
    return z.unknown();
  }

  if (schema.enum?.length) {
    const stringValues = schema.enum.filter(
      (value): value is string => typeof value === "string"
    );

    if (stringValues.length === schema.enum.length) {
      return applySchemaDescription(
        z.enum(stringValues as [string, ...string[]]),
        schema.description
      );
    }
  }

  switch (getSchemaType(schema)) {
    case "string":
      return applySchemaDescription(z.string(), schema.description);
    case "number":
      return applySchemaDescription(z.number(), schema.description);
    case "integer":
      return applySchemaDescription(z.number().int(), schema.description);
    case "boolean":
      return applySchemaDescription(z.boolean(), schema.description);
    case "array": {
      let arraySchema = z.array(jsonSchemaToZod(schema.items));
      if (schema.minItems !== undefined) {
        arraySchema = arraySchema.min(schema.minItems);
      }
      return applySchemaDescription(arraySchema, schema.description);
    }
    case "object": {
      const required = new Set(schema.required ?? []);
      const shape = Object.fromEntries(
        Object.entries(schema.properties ?? {}).map(([key, propertySchema]) => {
          const zodProperty = jsonSchemaToZod(propertySchema);
          return [
            key,
            required.has(key) ? zodProperty : zodProperty.optional(),
          ];
        })
      );
      return applySchemaDescription(z.object(shape), schema.description);
    }
    default:
      return applySchemaDescription(z.unknown(), schema.description);
  }
}

async function loadStdioServerTools(
  serverName: string,
  config: StdioMcpServerConfig
): Promise<StructuredToolInterface[]> {
  const client = new Client({
    name: `chat-gun-react-agent-${serverName}`,
    version: "0.1.0",
  });
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: toProcessEnv(config.env),
    stderr: "pipe",
  });

  await client.connect(transport);
  activeClients.push(client);

  const { tools: mcpTools } = await client.listTools();

  return mcpTools.map((mcpTool) => {
    const schema = jsonSchemaToZod(mcpTool.inputSchema as McpJsonSchema);

    return tool(
      async (input: unknown) => {
        const result = await client.callTool({
          name: mcpTool.name,
          arguments:
            input && typeof input === "object"
              ? (input as Record<string, unknown>)
              : {},
        });
        return stringifyMcpResult(result);
      },
      {
        name: mcpTool.name,
        description:
          mcpTool.description ?? `MCP tool from ${serverName}: ${mcpTool.name}`,
        schema,
      }
    );
  });
}

export async function loadMcpTools(): Promise<StructuredToolInterface[]> {
  const configs = getMcpServerConfigs();
  const serverNames = Object.keys(configs);

  if (serverNames.length === 0) {
    return [];
  }

  const tools = (
    await Promise.all(
      serverNames.map((serverName) =>
        loadStdioServerTools(serverName, configs[serverName])
      )
    )
  ).flat();
  const governedTools = applyToolGovernance(tools);
  await auditToolLoad("mcp", governedTools);
  return governedTools;
}
