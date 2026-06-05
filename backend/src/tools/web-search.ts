import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { getEnv } from "../platform/env.js";

type BraveSearchResult = {
  title?: string;
  url?: string;
  description?: string;
  age?: string;
  profile?: {
    name?: string;
    url?: string;
  };
};

type BraveSearchResponse = {
  query?: {
    original?: string;
  };
  web?: {
    results?: BraveSearchResult[];
  };
  news?: {
    results?: BraveSearchResult[];
  };
};

async function fetchJson<T>(url: URL, headers: Record<string, string>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers,
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

function formatResults(results: BraveSearchResult[], sourceType: string): string {
  if (results.length === 0) {
    return `${sourceType}: no results`;
  }

  return results
    .map((result, index) => {
      return [
        `${index + 1}. ${result.title ?? "Untitled"}`,
        `URL: ${result.url ?? result.profile?.url ?? "N/A"}`,
        result.description ? `Snippet: ${result.description}` : undefined,
        result.age ? `Age: ${result.age}` : undefined,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

export const webSearchTool = tool(
  async ({ query, count, freshness }) => {
    const apiKey = getEnv("BRAVE_API_KEY");

    if (!apiKey) {
      return [
        "Error: BRAVE_API_KEY is not configured.",
        "Set BRAVE_API_KEY in backend/.env to enable real web search.",
        "This tool intentionally does not fabricate search results.",
      ].join("\n");
    }

    try {
      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.searchParams.set("q", query);
      url.searchParams.set("count", String(Math.min(Math.max(count ?? 5, 1), 10)));
      url.searchParams.set("safesearch", "moderate");
      url.searchParams.set("text_decorations", "false");

      if (freshness) {
        url.searchParams.set("freshness", freshness);
      }

      const data = await fetchJson<BraveSearchResponse>(url, {
        "x-subscription-token": apiKey,
        "User-Agent": "chat-gun-react-agent/0.1",
      });

      const webResults = data.web?.results ?? [];
      const newsResults = data.news?.results ?? [];

      return [
        `Search query: ${data.query?.original ?? query}`,
        "Provider: Brave Search API",
        "",
        "Web results:",
        formatResults(webResults, "Web results"),
        newsResults.length ? "\nNews results:" : "",
        newsResults.length ? formatResults(newsResults, "News results") : "",
      ]
        .filter((part) => part.length > 0)
        .join("\n");
    } catch (error) {
      return `Error: web_search failed - ${
        error instanceof Error ? error.message : String(error)
      }`;
    }
  },
  {
    name: "web_search",
    description:
      "Search the public web using Brave Search API. Use this for current events, factual lookup, sources, product/news/law/regulation changes, and research tasks that need internet evidence.",
    schema: z.object({
      query: z.string().min(1).describe("Search query."),
      count: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("Number of results, 1 to 10. Default is 5."),
      freshness: z
        .enum(["pd", "pw", "pm", "py"])
        .optional()
        .describe("Optional recency filter: pd day, pw week, pm month, py year."),
    }),
  }
);
