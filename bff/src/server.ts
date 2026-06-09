import fs from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

import { loadConfig, type BffConfig } from "./config.js";
import { createBffErrorEnvelope } from "./errors.js";
import { InMemoryRateLimiter } from "./rate-limit.js";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const ALLOWED_PROXY_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

const FORWARDED_REQUEST_HEADERS = new Set([
  "accept",
  "accept-language",
  "authorization",
  "content-type",
  "user-agent",
  "x-api-key",
  "x-tenant-id",
  "x-user-id",
]);

type RequestContext = {
  requestId: string;
  startedAt: number;
  clientIp: string;
  userId: string;
  tenantId: string;
};

type AuthResult =
  | { ok: true; principal: string }
  | { ok: false; status: number; message: string };

function getHeader(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

function getClientIp(req: IncomingMessage): string {
  const forwardedFor = getHeader(req, "x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0]?.trim() || "unknown";
  return req.socket.remoteAddress ?? "unknown";
}

function getRequestId(req: IncomingMessage): string {
  return getHeader(req, "x-request-id") ?? crypto.randomUUID();
}

function getOrigin(req: IncomingMessage): string | undefined {
  return getHeader(req, "origin");
}

function isOriginAllowed(origin: string | undefined, config: BffConfig): boolean {
  if (!origin) return true;
  if (config.allowedOrigins.length === 0) return true;
  return config.allowedOrigins.includes("*") || config.allowedOrigins.includes(origin);
}

function applyCors(req: IncomingMessage, res: ServerResponse, config: BffConfig): void {
  const origin = getOrigin(req);
  if (!origin || !isOriginAllowed(origin, config)) return;

  res.setHeader("access-control-allow-origin", origin);
  res.setHeader("vary", "origin");
  res.setHeader("access-control-allow-credentials", "true");
  res.setHeader(
    "access-control-allow-headers",
    "authorization, content-type, x-api-key, x-request-id, x-tenant-id, x-user-id"
  );
  res.setHeader(
    "access-control-allow-methods",
    "GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS"
  );
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: Record<string, unknown>,
  requestId?: string
): void {
  const payload = Buffer.from(JSON.stringify(body));
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("content-length", String(payload.byteLength));
  if (requestId) res.setHeader("x-request-id", requestId);
  res.end(payload);
}

function extractBearerToken(authorization: string | undefined): string | undefined {
  if (!authorization) return undefined;
  const [scheme, token] = authorization.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer") return undefined;
  return token;
}

function authenticate(req: IncomingMessage, config: BffConfig): AuthResult {
  if (!config.requireAuth) {
    return { ok: true, principal: getHeader(req, "x-user-id") ?? "anonymous" };
  }

  const token =
    getHeader(req, "x-api-key") ?? extractBearerToken(getHeader(req, "authorization"));
  if (!token || !config.apiKeys.has(token)) {
    return { ok: false, status: 401, message: "Missing or invalid API key" };
  }

  return { ok: true, principal: getHeader(req, "x-user-id") ?? "api-key-user" };
}

async function readRequestBody(
  req: IncomingMessage,
  maxBytes: number
): Promise<Buffer | undefined> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;

  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > maxBytes) {
      const error = new Error("Request body too large");
      error.name = "PayloadTooLargeError";
      throw error;
    }
    chunks.push(buffer);
  }

  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

function copyRequestHeaders(req: IncomingMessage, ctx: RequestContext): Headers {
  const headers = new Headers();

  for (const [name, value] of Object.entries(req.headers)) {
    const lowerName = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lowerName)) continue;
    if (!FORWARDED_REQUEST_HEADERS.has(lowerName)) continue;
    if (value === undefined) continue;

    headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }

  headers.set("x-request-id", ctx.requestId);
  headers.set("x-bff-user-id", ctx.userId);
  headers.set("x-bff-tenant-id", ctx.tenantId);
  headers.set("x-forwarded-for", ctx.clientIp);
  headers.set("x-forwarded-host", getHeader(req, "host") ?? "unknown");
  headers.set("x-forwarded-proto", "http");

  return headers;
}

function copyResponseHeaders(upstream: Response, res: ServerResponse): void {
  upstream.headers.forEach((value, name) => {
    if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
      res.setHeader(name, value);
    }
  });
}

async function pipeWebResponseBody(
  body: ReadableStream<Uint8Array>,
  res: ServerResponse
): Promise<void> {
  const reader = body.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && !res.write(value)) {
        await new Promise<void>((resolve) => res.once("drain", resolve));
      }
    }
    res.end();
  } finally {
    reader.releaseLock();
  }
}

function buildUpstreamUrl(reqUrl: URL, baseUrl: URL): URL {
  const upstream = new URL(baseUrl);
  const strippedPath = reqUrl.pathname.replace(/^\/api\/langgraph\/?/, "/");
  upstream.pathname = path.posix.join(upstream.pathname, strippedPath);
  upstream.search = reqUrl.search;
  return upstream;
}

function buildUpstreamBaseUrls(config: BffConfig): URL[] {
  const urls = [new URL(config.langGraphApiUrl)];

  if (config.langGraphApiUrl.hostname === "127.0.0.1") {
    const fallbackBase = new URL(config.langGraphApiUrl);
    fallbackBase.hostname = "localhost";
    urls.push(fallbackBase);
  }

  return urls;
}

function buildUpstreamUrls(reqUrl: URL, config: BffConfig): URL[] {
  return buildUpstreamBaseUrls(config).map((baseUrl) =>
    buildUpstreamUrl(reqUrl, baseUrl)
  );
}

function logAudit(
  ctx: RequestContext,
  req: IncomingMessage,
  statusCode: number,
  extra: Record<string, unknown> = {}
): void {
  const durationMs = Date.now() - ctx.startedAt;
  console.info(
    JSON.stringify({
      event: "bff_request",
      requestId: ctx.requestId,
      method: req.method,
      path: req.url,
      statusCode,
      durationMs,
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      clientIp: ctx.clientIp,
      ...extra,
    })
  );
}

function getContentType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

async function checkLangGraphReady(config: BffConfig): Promise<{
  ok: boolean;
  status?: number;
  checkedUrls?: string[];
  error?: string;
}> {
  const readyUrls = buildUpstreamBaseUrls(config).map((baseUrl) => new URL("/ok", baseUrl));
  let lastError: unknown;
  let lastStatus: number | undefined;

  for (const readyUrl of readyUrls) {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 3_000);

    try {
      const response = await fetch(readyUrl, {
        method: "GET",
        signal: abortController.signal,
      });

      if (response.ok) {
        return {
          ok: true,
          status: response.status,
          checkedUrls: readyUrls.map((url) => url.toString()),
        };
      }

      lastStatus = response.status;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    ok: false,
    status: lastStatus,
    checkedUrls: readyUrls.map((url) => url.toString()),
    error: lastError instanceof Error ? lastError.message : String(lastError),
  };
}

async function serveFrontend(
  reqUrl: URL,
  res: ServerResponse,
  config: BffConfig
): Promise<boolean> {
  if (!reqUrl.pathname.startsWith("/app")) return false;

  const relativePath = decodeURIComponent(
    reqUrl.pathname.replace(/^\/app\/?/, "") || "index.html"
  );
  const requestedPath = path.resolve(config.frontendDist, relativePath);
  const distRoot = path.resolve(config.frontendDist);
  const safePath = requestedPath.startsWith(distRoot)
    ? requestedPath
    : path.join(distRoot, "index.html");

  try {
    const file = await fs.readFile(safePath);
    res.statusCode = 200;
    res.setHeader("content-type", getContentType(safePath));
    res.end(file);
    return true;
  } catch {
    const indexPath = path.join(distRoot, "index.html");
    try {
      const file = await fs.readFile(indexPath);
      res.statusCode = 200;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(file);
      return true;
    } catch {
      return false;
    }
  }
}

async function proxyLangGraph(
  req: IncomingMessage,
  res: ServerResponse,
  reqUrl: URL,
  ctx: RequestContext,
  config: BffConfig
): Promise<void> {
  if (!ALLOWED_PROXY_METHODS.has(req.method ?? "")) {
    sendJson(res, 405, { error: "Method not allowed" }, ctx.requestId);
    return;
  }

  const auth = authenticate(req, config);
  if (!auth.ok) {
    sendJson(res, auth.status, { error: auth.message }, ctx.requestId);
    return;
  }

  const upstreamUrls = buildUpstreamUrls(reqUrl, config);
  let attemptedUpstreamUrl = upstreamUrls[0];
  let lastUpstreamError: unknown;

  try {
    const body = await readRequestBody(req, config.maxBodyBytes);
    let upstreamResponse: Response | undefined;

    for (const upstreamUrl of upstreamUrls) {
      attemptedUpstreamUrl = upstreamUrl;
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), config.upstreamTimeoutMs);

      try {
        upstreamResponse = await fetch(upstreamUrl, {
          method: req.method,
          headers: copyRequestHeaders(req, ctx),
          body,
          signal: abortController.signal,
        });
        break;
      } catch (error) {
        lastUpstreamError = error;
      } finally {
        clearTimeout(timeout);
      }
    }

    if (!upstreamResponse) {
      throw lastUpstreamError ?? new Error("LangGraph upstream fetch failed");
    }

    res.statusCode = upstreamResponse.status;
    res.statusMessage = upstreamResponse.statusText;
    res.setHeader("x-request-id", ctx.requestId);
    copyResponseHeaders(upstreamResponse, res);

    const responseBody = upstreamResponse.body;
    if (req.method === "HEAD" || !responseBody) {
      res.end();
      return;
    }

    await pipeWebResponseBody(responseBody, res);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "bff_upstream_error",
        requestId: ctx.requestId,
        upstreamUrl: attemptedUpstreamUrl?.toString(),
        attemptedUpstreamUrls: upstreamUrls.map((url) => url.toString()),
        errorName: error instanceof Error ? error.name : undefined,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorCause:
          error instanceof Error && error.cause instanceof Error
            ? {
                name: error.cause.name,
                message: error.cause.message,
              }
            : undefined,
      })
    );

    if (error instanceof Error && error.name === "PayloadTooLargeError") {
      sendJson(res, 413, { error: "Request body too large" }, ctx.requestId);
      return;
    }

    const isAbort = error instanceof Error && error.name === "AbortError";
    const envelope = createBffErrorEnvelope(error, {
      stage: "langgraph_upstream_proxy",
      provider: "LangGraph",
      message: isAbort ? "LangGraph upstream timeout" : "LangGraph upstream error",
      details: {
        upstreamUrl: attemptedUpstreamUrl?.toString(),
        attemptedUpstreamUrls: upstreamUrls.map((url) => url.toString()),
        method: req.method,
        path: req.url,
        requestId: ctx.requestId,
      },
    });

    sendJson(
      res,
      isAbort ? 504 : 502,
      envelope,
      ctx.requestId
    );
  }
}

export function createServer(config = loadConfig()): http.Server {
  const rateLimiter = new InMemoryRateLimiter(
    config.rateLimitWindowMs,
    config.rateLimitMaxRequests
  );

  return http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url ?? "/", `http://${getHeader(req, "host") ?? "localhost"}`);
    const ctx: RequestContext = {
      requestId: getRequestId(req),
      startedAt: Date.now(),
      clientIp: getClientIp(req),
      userId: getHeader(req, "x-user-id") ?? "anonymous",
      tenantId: getHeader(req, "x-tenant-id") ?? "default",
    };

    res.on("finish", () => logAudit(ctx, req, res.statusCode));
    applyCors(req, res, config);
    res.setHeader("x-request-id", ctx.requestId);

    if (!isOriginAllowed(getOrigin(req), config)) {
      sendJson(res, 403, { error: "Origin not allowed" }, ctx.requestId);
      return;
    }

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (reqUrl.pathname === "/api/health" || reqUrl.pathname === "/api/bff/health") {
      sendJson(
        res,
        200,
        {
          status: "ok",
          langGraphApiUrl: config.langGraphApiUrl.origin,
        },
        ctx.requestId
      );
      return;
    }

    if (reqUrl.pathname === "/api/ready" || reqUrl.pathname === "/api/bff/ready") {
      const upstream = await checkLangGraphReady(config);
      sendJson(
        res,
        upstream.ok ? 200 : 503,
        {
          status: upstream.ok ? "ready" : "not_ready",
          langGraphApiUrl: config.langGraphApiUrl.origin,
          upstream,
        },
        ctx.requestId
      );
      return;
    }

    const rateLimit = rateLimiter.check(`${ctx.tenantId}:${ctx.userId}:${ctx.clientIp}`);
    res.setHeader("x-ratelimit-limit", String(config.rateLimitMaxRequests));
    res.setHeader("x-ratelimit-remaining", String(rateLimit.remaining));
    res.setHeader("x-ratelimit-reset", String(Math.ceil(rateLimit.resetAt / 1000)));

    if (!rateLimit.allowed) {
      sendJson(res, 429, { error: "Rate limit exceeded" }, ctx.requestId);
      return;
    }

    if (reqUrl.pathname.startsWith("/api/langgraph")) {
      await proxyLangGraph(req, res, reqUrl, ctx, config);
      return;
    }

    if (await serveFrontend(reqUrl, res, config)) {
      return;
    }

    sendJson(res, 404, { error: "Not found" }, ctx.requestId);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const config = loadConfig();
  const server = createServer(config);

  server.listen(config.port, () => {
    console.info(
      JSON.stringify({
        event: "bff_started",
        port: config.port,
        langGraphApiUrl: config.langGraphApiUrl.toString(),
        frontendDist: config.frontendDist,
      })
    );
  });
}
