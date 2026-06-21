import assert from "node:assert/strict";
import http, { type Server } from "node:http";
import net from "node:net";
import { once } from "node:events";
import { describe, it } from "node:test";

import { createServer } from "./server.js";
import type { BffConfig } from "./config.js";

type StartedServer = {
  server: Server;
  url: string;
  close: () => Promise<void>;
};

function createTestConfig(langGraphApiUrl: string, overrides: Partial<BffConfig> = {}): BffConfig {
  return {
    port: 0,
    langGraphApiUrl: new URL(langGraphApiUrl),
    frontendDist: ".",
    allowedOrigins: [],
    requireAuth: false,
    apiKeys: new Set(),
    maxBodyBytes: 1024 * 1024,
    upstreamTimeoutMs: 1_000,
    rateLimitWindowMs: 60_000,
    rateLimitMaxRequests: 1_000,
    imageUploadMaxFiles: 6,
    imageUploadMaxBytes: 5 * 1024 * 1024,
    imageUploadMaxPixels: 24_000_000,
    imageUploadAllowedExtensions: new Set([".png", ".jpg", ".jpeg", ".webp"]),
    imageUploadAllowedMimeTypes: new Set(["image/png", "image/jpeg", "image/webp"]),
    imageUploadS3BucketUrl: "",
    ...overrides,
  };
}

async function startServer(server: Server): Promise<StartedServer> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");

  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.close();
      await once(server, "close");
    },
  };
}

async function withServer<T>(
  handler: http.RequestListener,
  run: (started: StartedServer) => Promise<T>
): Promise<T> {
  const started = await startServer(http.createServer(handler));
  try {
    return await run(started);
  } finally {
    await started.close();
  }
}

async function withBff<T>(
  config: BffConfig,
  run: (started: StartedServer) => Promise<T>
): Promise<T> {
  const started = await startServer(createServer(config));
  try {
    return await run(started);
  } finally {
    await started.close();
  }
}

describe("BFF LangGraph stream proxy", () => {
  it("proxies upstream stream chunks in order", async () => {
    await withServer(
      (_req, res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write("data: one\n\n");
        res.end("data: two\n\n");
      },
      async (upstream) => {
        await withBff(createTestConfig(upstream.url), async (bff) => {
          const response = await fetch(`${bff.url}/api/langgraph/runs/stream`);
          const text = await response.text();

          assert.equal(response.status, 200);
          assert.equal(text, "data: one\n\ndata: two\n\n");
        });
      }
    );
  });

  it("returns bff_timeout when upstream exceeds BFF_UPSTREAM_TIMEOUT_MS", async () => {
    await withServer(
      (_req, _res) => {
        // Keep the upstream request open until the BFF timeout aborts it.
      },
      async (upstream) => {
        await withBff(
          createTestConfig(upstream.url, { upstreamTimeoutMs: 25 }),
          async (bff) => {
            const response = await fetch(`${bff.url}/api/langgraph/runs/stream`);
            const body = await response.json();

            assert.equal(response.status, 504);
            assert.equal(body.error.code, "bff_timeout");
            assert.equal(body.error.details.requestId, response.headers.get("x-request-id"));
          }
        );
      }
    );
  });

  it("maps request body close before complete to client_disconnected", async () => {
    let upstreamCalled = false;
    let resolveLog: (value: Record<string, unknown>) => void;
    const logged = new Promise<Record<string, unknown>>((resolve) => {
      resolveLog = resolve;
    });
    const originalError = console.error;

    console.error = (message?: unknown, ...args: unknown[]) => {
      if (typeof message === "string") {
        try {
          const parsed = JSON.parse(message) as Record<string, unknown>;
          if (
            parsed.event === "bff_upstream_error" &&
            parsed.errorCode === "client_disconnected"
          ) {
            resolveLog(parsed);
          }
        } catch {
          // Keep non-JSON console.error behavior unchanged below.
        }
      }
      originalError(message, ...args);
    };

    try {
      await withServer(
        (_req, res) => {
          upstreamCalled = true;
          res.end("unexpected");
        },
        async (upstream) => {
          await withBff(createTestConfig(upstream.url), async (bff) => {
            const port = new URL(bff.url).port;
            const socket = net.createConnection(Number(port), "127.0.0.1");
            await once(socket, "connect");
            socket.write(
              [
                "POST /api/langgraph/runs/stream HTTP/1.1",
                "Host: 127.0.0.1",
                "Content-Length: 100",
                "Content-Type: application/json",
                "",
                "{\"partial\":",
              ].join("\r\n")
            );
            socket.destroy();

            const log = await Promise.race([
              logged,
              new Promise<never>((_resolve, reject) =>
                setTimeout(
                  () => reject(new Error("Timed out waiting for disconnect log")),
                  1_000
                )
              ),
            ]);

            assert.equal(log.errorCode, "client_disconnected");
            assert.equal(upstreamCalled, false);
          });
        }
      );
    } finally {
      console.error = originalError;
    }
  });

  it("writes a trailing SSE error frame when upstream stream fails after headers", async () => {
    await withServer(
      (_req, res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.flushHeaders();
        res.write("data: before\n\n");
        setImmediate(() => res.destroy(new Error("upstream stream failed")));
      },
      async (upstream) => {
        await withBff(createTestConfig(upstream.url), async (bff) => {
          const response = await fetch(`${bff.url}/api/langgraph/runs/stream`);
          const text = await response.text();

          assert.equal(response.status, 200);
          assert.match(text, /data: before/);
          assert.match(text, /event: error/);
          assert.match(text, /"code":"upstream_stream_error"/);
          assert.doesNotMatch(text, /"rawMessage"/);
        });
      }
    );
  });

  it("writes bff_timeout when an SSE stream exceeds the upstream timeout after headers", async () => {
    await withServer(
      (_req, res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.flushHeaders();
        res.write("data: before\n\n");
      },
      async (upstream) => {
        await withBff(
          createTestConfig(upstream.url, { upstreamTimeoutMs: 25 }),
          async (bff) => {
            const response = await fetch(`${bff.url}/api/langgraph/runs/stream`);
            const text = await response.text();

            assert.equal(response.status, 200);
            assert.match(text, /data: before/);
            assert.match(text, /event: error/);
            assert.match(text, /"code":"bff_timeout"/);
          }
        );
      }
    );
  });

  it("does not inject JSON when a non-SSE stream fails after headers", async () => {
    await withServer(
      (_req, res) => {
        res.writeHead(200, { "content-type": "application/octet-stream" });
        res.flushHeaders();
        res.write("partial");
        setImmediate(() => res.destroy(new Error("upstream stream failed")));
      },
      async (upstream) => {
        await withBff(createTestConfig(upstream.url), async (bff) => {
          const response = await fetch(`${bff.url}/api/langgraph/runs/stream`);
          assert.equal(response.status, 200);

          try {
            const text = await response.text();
            assert.equal(text.includes('"error"'), false);
          } catch (error) {
            assert(error instanceof Error);
          }
        });
      }
    );
  });

  it("aborts upstream when the downstream stream closes", async () => {
    let upstreamClosed = false;

    await withServer(
      (req, res) => {
        req.on("close", () => {
          upstreamClosed = true;
        });
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write("data: first\n\n");
      },
      async (upstream) => {
        await withBff(createTestConfig(upstream.url), async (bff) => {
          const controller = new AbortController();
          const response = await fetch(`${bff.url}/api/langgraph/runs/stream`, {
            signal: controller.signal,
          });
          const reader = response.body?.getReader();
          assert(reader);
          await reader.read();
          controller.abort();

          await new Promise((resolve) => setTimeout(resolve, 50));
          assert.equal(upstreamClosed, true);
        });
      }
    );
  });
});
