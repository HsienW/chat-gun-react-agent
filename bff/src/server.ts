import fs from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

import { loadConfig, type BffConfig } from "./config.js";
import { BFF_ERROR_MESSAGES } from "./error-messages.js";
import {
  createBffAbortError,
  createBffErrorEnvelope,
  isBffAbortReason,
  type BffAbortReason,
} from "./errors.js";
import { InMemoryRateLimiter } from "./rate-limit.js";
import { validateUploadPayload } from "./upload-security.js";

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

type StreamPipeResult = {
  completed: boolean;
  clientDisconnected: boolean;
};

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
  maxBytes: number,
  ctx: RequestContext
): Promise<Buffer | undefined> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  let closedBeforeComplete = false;
  const disconnectReason: BffAbortReason = {
    code: "client_disconnected",
    stage: "request_body",
    requestId: ctx.requestId,
  };
  const onClose = () => {
    if (!req.complete) closedBeforeComplete = true;
  };

  req.on("close", onClose);
  try {
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
  } catch (error) {
    if (closedBeforeComplete || !req.complete) {
      throw createBffAbortError(disconnectReason, error);
    }
    throw error;
  } finally {
    req.off("close", onClose);
  }

  if (closedBeforeComplete || !req.complete) {
    throw createBffAbortError(disconnectReason);
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
  res: ServerResponse,
  options: {
    abortController: AbortController;
    disconnectReason: BffAbortReason;
  }
): Promise<StreamPipeResult> {
  const reader = body.getReader();
  let completed = false;
  let clientDisconnected = false;

  const onClose = () => {
    if (completed || res.writableEnded) return;
    clientDisconnected = true;
    if (!options.abortController.signal.aborted) {
      options.abortController.abort(options.disconnectReason);
    }
    void reader.cancel(options.disconnectReason).catch(() => undefined);
  };

  res.on("close", onClose);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (clientDisconnected || res.destroyed) break;
      if (value && !res.write(value)) {
        await new Promise<void>((resolve) => {
          const onDrain = () => {
            res.off("close", onClosed);
            resolve();
          };
          const onClosed = () => {
            res.off("drain", onDrain);
            resolve();
          };
          res.once("drain", onDrain);
          res.once("close", onClosed);
        });
      }
    }
    completed = !clientDisconnected;
    if (completed && !res.writableEnded) res.end();
    return { completed, clientDisconnected };
  } catch (error) {
    if (clientDisconnected) {
      throw createBffAbortError(options.disconnectReason, error);
    }
    const abortReason = getAbortReason(options.abortController.signal);
    if (abortReason) {
      throw createBffAbortError(abortReason, error);
    }
    throw error;
  } finally {
    res.off("close", onClose);
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

function abortWithReason(
  abortController: AbortController,
  reason: BffAbortReason
): void {
  if (!abortController.signal.aborted) {
    abortController.abort(reason);
  }
}

function getAbortReason(signal: AbortSignal): BffAbortReason | undefined {
  return isBffAbortReason(signal.reason) ? signal.reason : undefined;
}

function getResponseContentType(res: ServerResponse): string {
  const value = res.getHeader("content-type");
  if (Array.isArray(value)) return value.join(",");
  return value ? String(value) : "";
}

function isSseResponse(res: ServerResponse): boolean {
  return getResponseContentType(res).toLowerCase().includes("text/event-stream");
}

function statusForBffErrorCode(code: string): number {
  if (code === "bff_timeout") return 504;
  return 502;
}

function diagnosticStatusForBffErrorCode(code: string): number {
  if (code === "client_disconnected" || code === "client_cancelled") return 499;
  return statusForBffErrorCode(code);
}

function safeStreamErrorMessage(code: string): string {
  if (code === "bff_timeout") return "LangGraph stream timed out";
  if (code === "client_disconnected") return "Client disconnected from stream";
  return "LangGraph stream ended with an error";
}

function writeSseErrorFrame(
  res: ServerResponse,
  envelope: ReturnType<typeof createBffErrorEnvelope>
): void {
  if (res.destroyed || res.writableEnded) return;
  const { rawMessage: _rawMessage, ...safeError } = envelope.error;
  const safeEnvelope = { error: safeError };

  res.write(`event: error\n`);
  res.write(`data: ${JSON.stringify(safeEnvelope)}\n\n`);
  res.end();
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
  let observedUpstreamStatus: number | undefined;

  try {
    const body = await readRequestBody(req, config.maxBodyBytes, ctx);
    const uploadValidationError = validateUploadPayload(body, {
      maxFiles: config.imageUploadMaxFiles,
      maxBytes: config.imageUploadMaxBytes,
      maxPixels: config.imageUploadMaxPixels,
      allowedExtensions: config.imageUploadAllowedExtensions,
      allowedMimeTypes: config.imageUploadAllowedMimeTypes,
      s3BucketUrl: config.imageUploadS3BucketUrl,
    });

    if (uploadValidationError) {
      const error = new Error(uploadValidationError);
      const envelope = createBffErrorEnvelope(error, {
        stage: "upload_preflight",
        provider: "bff",
        message: BFF_ERROR_MESSAGES.upload.rejectedByBff,
        details: {
          method: req.method,
          path: req.url,
          requestId: ctx.requestId,
        },
      });
      sendJson(res, 400, envelope, ctx.requestId);
      return;
    }

    let upstreamResponse: Response | undefined;
    let activeAbortController: AbortController | undefined;
    let activeTimeout: NodeJS.Timeout | undefined;
    let lastAbortReason: BffAbortReason | undefined;

    for (const upstreamUrl of upstreamUrls) {
      attemptedUpstreamUrl = upstreamUrl;
      const abortController = new AbortController();
      let timeoutReason: BffAbortReason = {
        code: "bff_timeout",
        stage: "langgraph_upstream_proxy",
        requestId: ctx.requestId,
      };
      const timeout = setTimeout(
        () => abortWithReason(abortController, timeoutReason),
        config.upstreamTimeoutMs
      );

      try {
        upstreamResponse = await fetch(upstreamUrl, {
          method: req.method,
          headers: copyRequestHeaders(req, ctx),
          body,
          signal: abortController.signal,
        });
        activeAbortController = abortController;
        activeTimeout = timeout;
        break;
      } catch (error) {
        lastAbortReason = getAbortReason(abortController.signal);
        lastUpstreamError = error;
        clearTimeout(timeout);
      } finally {
        if (!upstreamResponse) clearTimeout(timeout);
      }
    }

    if (!upstreamResponse) {
      if (lastAbortReason) {
        throw createBffAbortError(
          lastAbortReason,
          lastUpstreamError ?? new Error("LangGraph upstream fetch failed")
        );
      }
      throw lastUpstreamError ?? new Error("LangGraph upstream fetch failed");
    }

    res.statusCode = upstreamResponse.status;
    res.statusMessage = upstreamResponse.statusText;
    observedUpstreamStatus = upstreamResponse.status;
    res.setHeader("x-request-id", ctx.requestId);
    copyResponseHeaders(upstreamResponse, res);

    const responseBody = upstreamResponse.body;
    if (req.method === "HEAD" || !responseBody) {
      if (activeTimeout) clearTimeout(activeTimeout);
      res.end();
      return;
    }

    if (!activeAbortController) {
      throw new Error("LangGraph upstream response missing abort controller");
    }

    const streamAbortController = activeAbortController;
    const streamTimeoutReason: BffAbortReason = {
      code: "bff_timeout",
      stage: "langgraph_stream_proxy",
      requestId: ctx.requestId,
    };

    try {
      if (!streamAbortController.signal.aborted) {
        const timeoutReason = streamTimeoutReason;
        if (activeTimeout) {
          clearTimeout(activeTimeout);
          activeTimeout = setTimeout(
            () => abortWithReason(streamAbortController, timeoutReason),
            config.upstreamTimeoutMs
          );
        }
      }
      await pipeWebResponseBody(responseBody, res, {
        abortController: streamAbortController,
        disconnectReason: {
          code: "client_disconnected",
          stage: "langgraph_stream_proxy",
          requestId: ctx.requestId,
        },
      });
    } finally {
      if (activeTimeout) clearTimeout(activeTimeout);
    }
  } catch (error) {
    let abortReason =
      error instanceof Error && isBffAbortReason(error.cause)
        ? error.cause
        : undefined;
    if (!abortReason && res.headersSent) {
      abortReason = {
        code: "upstream_stream_error",
        stage: "langgraph_stream_proxy",
        requestId: ctx.requestId,
      };
    }
    console.error(
      JSON.stringify({
        event: "bff_upstream_error",
        requestId: ctx.requestId,
        method: req.method,
        path: req.url,
        statusCode: res.headersSent
          ? res.statusCode
          : diagnosticStatusForBffErrorCode(abortReason?.code ?? "upstream_error"),
        durationMs: Date.now() - ctx.startedAt,
        upstreamStatus: observedUpstreamStatus,
        upstreamUrl: attemptedUpstreamUrl?.toString(),
        attemptedUpstreamUrls: upstreamUrls.map((url) => url.toString()),
        errorCode: abortReason?.code,
        abortReasonCode: abortReason?.code,
        clientDisconnected: abortReason?.code === "client_disconnected",
        streamStarted: res.headersSent,
        headersSent: res.headersSent,
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
    const stage = res.headersSent
      ? "langgraph_stream_proxy"
      : "langgraph_upstream_proxy";
    const envelope = createBffErrorEnvelope(error, {
      stage,
      provider: "LangGraph",
      message: abortReason
        ? safeStreamErrorMessage(abortReason.code)
        : isAbort
          ? "LangGraph stream aborted"
          : res.headersSent
            ? "LangGraph stream ended with an error"
            : "LangGraph upstream error",
      abortReason,
      details: {
        upstreamUrl: attemptedUpstreamUrl?.toString(),
        attemptedUpstreamUrls: upstreamUrls.map((url) => url.toString()),
        method: req.method,
        path: req.url,
        requestId: ctx.requestId,
      },
    });

    if (res.headersSent) {
      if (envelope.error.code === "client_disconnected") return;
      if (isSseResponse(res)) {
        writeSseErrorFrame(res, envelope);
        return;
      }
      if (!res.destroyed && !res.writableEnded) res.destroy();
      return;
    }

    sendJson(res, statusForBffErrorCode(envelope.error.code), envelope, ctx.requestId);
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
