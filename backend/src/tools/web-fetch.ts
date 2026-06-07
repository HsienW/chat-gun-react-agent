import { tool } from "@langchain/core/tools";
import { z } from "zod";

const MAX_CONTENT_CHARS = 12_000;

function assertHttpUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs are allowed");
  }

  return url;
}

function htmlToReadableText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function limitContent(content: string): string {
  if (content.length <= MAX_CONTENT_CHARS) {
    return content;
  }

  return `${content.slice(0, MAX_CONTENT_CHARS)}\n\n[Truncated to ${MAX_CONTENT_CHARS} characters]`;
}

export const webFetchTool = tool(
  async ({ url }) => {
    try {
      const parsedUrl = assertHttpUrl(url);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12_000);

      try {
        const response = await fetch(parsedUrl, {
          signal: controller.signal,
          headers: {
            Accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.8",
            "User-Agent": "chat-gun-react-agent/0.1",
          },
        });

        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`);
        }

        const contentType = response.headers.get("content-type") ?? "";
        const rawContent = await response.text();
        const readableContent = contentType.includes("text/html")
          ? htmlToReadableText(rawContent)
          : rawContent.trim();

        return [
          `Fetched URL: ${parsedUrl.toString()}`,
          `Content-Type: ${contentType || "unknown"}`,
          "",
          limitContent(readableContent),
        ].join("\n");
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      return `Error: web_fetch failed - ${
        error instanceof Error ? error.message : String(error)
      }`;
    }
  },
  {
    name: "web_fetch",
    description:
      "Fetch and extract readable text from a public HTTP/HTTPS URL. Use this after web_search to inspect source pages before answering.",
    schema: z.object({
      url: z.string().url().describe("The public HTTP or HTTPS URL to fetch."),
    }),
  }
);
