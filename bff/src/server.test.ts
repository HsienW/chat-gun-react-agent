import assert from "node:assert/strict";
import http, { type Server } from "node:http";
import net from "node:net";
import { once } from "node:events";
import { describe, it } from "vitest";

import { createServer } from "./server.js";
import type { ServerDependencies } from "./server.js";
import type { BffConfig } from "./config.js";
import type { RedisEvalClient } from "./redis-rate-limit.js";

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
    redisRateLimitUri: undefined,
    rateLimitUserMaxRequests: 30,
    rateLimitUserWindowMs: 60_000,
    rateLimitIpMaxRequests: 20,
    rateLimitIpWindowMs: 60_000,
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
  run: (started: StartedServer) => Promise<T>,
  dependencies?: ServerDependencies
): Promise<T> {
  const started = await startServer(createServer(config, dependencies));
  try {
    return await run(started);
  } finally {
    await started.close();
  }
}

describe("BFF LangGraph stream proxy", () => {
  it("forwards x-idempotency-key unchanged when present", async () => {
    let forwardedIdempotencyKey: string | undefined;

    await withServer(
      (req, res) => {
        const header = req.headers["x-idempotency-key"];
        forwardedIdempotencyKey = Array.isArray(header) ? header[0] : header;
        res.end("ok");
      },
      async (upstream) => {
        await withBff(createTestConfig(upstream.url), async (bff) => {
          const response = await fetch(`${bff.url}/api/langgraph/runs`, {
            headers: {
              "x-idempotency-key":
                "tool_execution:task-abc:step-1:current_weather:1:v1",
            },
          });

          assert.equal(response.status, 200);
          assert.equal(
            forwardedIdempotencyKey,
            "tool_execution:task-abc:step-1:current_weather:1:v1"
          );
        });
      }
    );
  });

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

  it("passes LangGraph interrupt and unknown SSE events through unchanged", async () => {
    const interruptFrame = [
      "event: interrupt",
      'data: {"__interrupt__":[{"value":{"type":"weather_clarification"}}]}',
      "",
      "",
    ].join("\n");
    const unknownFrame = [
      "event: langgraph_future_event",
      'data: {"payload":{"status":"waiting"}}',
      "",
      "",
    ].join("\n");

    await withServer(
      (_req, res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(interruptFrame);
        res.end(unknownFrame);
      },
      async (upstream) => {
        await withBff(createTestConfig(upstream.url), async (bff) => {
          const response = await fetch(`${bff.url}/api/langgraph/runs/stream`);
          const text = await response.text();

          assert.equal(response.status, 200);
          assert.equal(text, `${interruptFrame}${unknownFrame}`);
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

  it("aborts upstream when the client disconnects before response headers", async () => {
    let markUpstreamStarted: (() => void) | undefined;
    let markUpstreamClosed: (() => void) | undefined;
    const upstreamStarted = new Promise<void>((resolve) => {
      markUpstreamStarted = resolve;
    });
    const upstreamClosed = new Promise<void>((resolve) => {
      markUpstreamClosed = resolve;
    });

    await withServer(
      (req, _res) => {
        markUpstreamStarted?.();
        req.on("close", () => markUpstreamClosed?.());
      },
      async (upstream) => {
        await withBff(
          createTestConfig(upstream.url, { upstreamTimeoutMs: 500 }),
          async (bff) => {
            const controller = new AbortController();
            const clientRequest = fetch(`${bff.url}/api/langgraph/runs/stream`, {
              signal: controller.signal,
            }).catch((error: unknown) => error);
            await upstreamStarted;

            controller.abort();
            const closedPromptly = await Promise.race([
              upstreamClosed.then(() => true),
              new Promise<boolean>((resolve) =>
                setTimeout(() => resolve(false), 100)
              ),
            ]);
            await clientRequest;

            assert.equal(closedPromptly, true);
          }
        );
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

describe("BFF Redis rate limiting", () => {
  it("reports the limiting dimension headers on an allowed request", async () => {
    const redisClient: RedisEvalClient = {
      eval: async (_script, _numberOfKeys, key) =>
        String(key).includes("rate_limit:user:alice")
          ? [1, 2, 0]
          : [1, 12, 0],
    };

    await withBff(
      createTestConfig("http://127.0.0.1:1", {
        redisRateLimitUri: "redis://localhost:6379",
        rateLimitUserMaxRequests: 3,
      }),
      async (bff) => {
        const response = await fetch(`${bff.url}/not-found`, {
          headers: { "x-user-id": "alice" },
        });

        assert.equal(response.status, 404);
        assert.equal(response.headers.get("x-ratelimit-limit"), "3");
        assert.equal(response.headers.get("x-ratelimit-remaining"), "2");
        assert(
          Number(response.headers.get("x-ratelimit-reset")) >
            Math.floor(Date.now() / 1_000)
        );
      },
      { redisClient }
    );
  });

  it("returns the standard 429 contract when the user dimension is denied", async () => {
    const redisClient: RedisEvalClient = {
      eval: async (_script, _numberOfKeys, key, _maxRequests, _windowMs, now) => {
        return String(key).includes("rate_limit:user:alice")
          ? [0, 0, Number(now) + 45_000]
          : [1, 19, 0];
      },
    };

    await withBff(
      createTestConfig("http://127.0.0.1:1", {
        redisRateLimitUri: "redis://localhost:6379",
      }),
      async (bff) => {
        const response = await fetch(`${bff.url}/not-found`, {
          headers: { "x-user-id": "alice" },
        });
        const body = await response.json();

        assert.equal(response.status, 429);
        assert.equal(response.headers.get("retry-after"), "45");
        assert.equal(response.headers.get("x-ratelimit-remaining"), "0");
        assert(Number(response.headers.get("x-ratelimit-reset")) > 0);
        assert.deepEqual(body, { error: "Rate limit exceeded", retryAfter: 45 });
      },
      { redisClient }
    );
  });

  it("uses the socket peer for the IP dimension instead of spoofed forwarding headers", async () => {
    const checkedKeys: string[] = [];
    const redisClient: RedisEvalClient = {
      eval: async (_script, _numberOfKeys, key, _maxRequests, _windowMs, now) => {
        checkedKeys.push(String(key));
        return String(key).includes("rate_limit:ip:127.0.0.1")
          ? [0, 0, Number(now) + 300]
          : [1, 29, 0];
      },
    };

    await withBff(
      createTestConfig("http://127.0.0.1:1", {
        redisRateLimitUri: "redis://localhost:6379",
      }),
      async (bff) => {
        const response = await fetch(`${bff.url}/not-found`, {
          headers: {
            "x-user-id": "bob",
            "x-forwarded-for": "203.0.113.99",
          },
        });
        const body = await response.json();

        assert.equal(response.status, 429);
        assert.equal(response.headers.get("retry-after"), "1");
        assert.deepEqual(body, { error: "Rate limit exceeded", retryAfter: 1 });
        assert(checkedKeys.includes("rate_limit:user:bob"));
        assert(checkedKeys.includes("rate_limit:ip:127.0.0.1"));
        assert.equal(checkedKeys.some((key) => key.includes("203.0.113.99")), false);
      },
      { redisClient }
    );
  });

  it("keeps the legacy composite-key limiter when Redis is not configured", async () => {
    await withBff(
      createTestConfig("http://127.0.0.1:1", {
        rateLimitMaxRequests: 1,
      }),
      async (bff) => {
        const headers = {
          "x-user-id": "alice",
          "x-tenant-id": "tenant-a",
        };
        const firstResponse = await fetch(`${bff.url}/not-found`, { headers });
        const secondResponse = await fetch(`${bff.url}/not-found`, { headers });
        const body = await secondResponse.json();

        assert.equal(firstResponse.status, 404);
        assert.equal(secondResponse.status, 429);
        assert(Number(secondResponse.headers.get("retry-after")) >= 1);
        assert.equal(typeof body.retryAfter, "number");
      }
    );
  });

  it("closes the Redis client when the server closes", async () => {
    let closeCalls = 0;
    const redisClient: RedisEvalClient = {
      eval: async () => [1, 29, 0],
    };

    await withBff(
      createTestConfig("http://127.0.0.1:1", {
        redisRateLimitUri: "redis://localhost:6379",
      }),
      async () => undefined,
      {
        redisClient,
        closeRedis: async () => {
          closeCalls += 1;
        },
      }
    );

    assert.equal(closeCalls, 1);
  });
});
