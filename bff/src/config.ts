import path from "node:path";
import { fileURLToPath } from "node:url";

import "dotenv/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultFrontendDist = path.resolve(dirname, "../../frontend/dist");

function readNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function readCsv(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function readOptionalString(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

export type BffConfig = {
  port: number;
  langGraphApiUrl: URL;
  metricsBackendUrl: URL;
  frontendDist: string;
  allowedOrigins: string[];
  requireAuth: boolean;
  apiKeys: Set<string>;
  maxBodyBytes: number;
  upstreamTimeoutMs: number;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  redisRateLimitUri?: string;
  rateLimitUserMaxRequests: number;
  rateLimitUserWindowMs: number;
  rateLimitIpMaxRequests: number;
  rateLimitIpWindowMs: number;
  imageUploadMaxFiles: number;
  imageUploadMaxBytes: number;
  imageUploadMaxPixels: number;
  imageUploadAllowedExtensions: Set<string>;
  imageUploadAllowedMimeTypes: Set<string>;
  imageUploadS3BucketUrl: string;
};

export function loadConfig(): BffConfig {
  const langGraphApiUrl = new URL(
    process.env.BFF_LANGGRAPH_API_URL ??
      process.env.LANGGRAPH_API_URL ??
      "http://localhost:2024"
  );

  return {
    port: readNumber("BFF_PORT", 8787),
    langGraphApiUrl,
    metricsBackendUrl: new URL(
      readOptionalString("AGENT_METRICS_BACKEND_URL") ?? langGraphApiUrl
    ),
    frontendDist:
      process.env.BFF_FRONTEND_DIST ??
      process.env.FRONTEND_DIST ??
      defaultFrontendDist,
    allowedOrigins: readCsv("BFF_ALLOWED_ORIGINS"),
    requireAuth: readBoolean("BFF_REQUIRE_AUTH", false),
    apiKeys: new Set(readCsv("BFF_API_KEYS")),
    maxBodyBytes: readNumber("BFF_MAX_BODY_BYTES", 50 * 1024 * 1024),
    upstreamTimeoutMs: readNumber("BFF_UPSTREAM_TIMEOUT_MS", 120_000),
    rateLimitWindowMs: readNumber("BFF_RATE_LIMIT_WINDOW_MS", 60_000),
    rateLimitMaxRequests: readNumber("BFF_RATE_LIMIT_MAX_REQUESTS", 120),
    redisRateLimitUri: readOptionalString("BFF_RATE_LIMIT_REDIS_URI"),
    rateLimitUserMaxRequests: readNumber(
      "BFF_RATE_LIMIT_USER_MAX_REQUESTS",
      30
    ),
    rateLimitUserWindowMs: readNumber("BFF_RATE_LIMIT_USER_WINDOW_MS", 60_000),
    rateLimitIpMaxRequests: readNumber("BFF_RATE_LIMIT_IP_MAX_REQUESTS", 20),
    rateLimitIpWindowMs: readNumber("BFF_RATE_LIMIT_IP_WINDOW_MS", 60_000),
    imageUploadMaxFiles: readNumber("BFF_IMAGE_UPLOAD_MAX_FILES", 6),
    imageUploadMaxBytes: readNumber("BFF_IMAGE_UPLOAD_MAX_BYTES", 5 * 1024 * 1024),
    imageUploadMaxPixels: readNumber("BFF_IMAGE_UPLOAD_MAX_PIXELS", 24_000_000),
    imageUploadAllowedExtensions: new Set(
      readCsv("BFF_IMAGE_UPLOAD_ALLOWED_EXTENSIONS").length
        ? readCsv("BFF_IMAGE_UPLOAD_ALLOWED_EXTENSIONS").map((value) => value.toLowerCase())
        : [".png", ".jpg", ".jpeg", ".webp"]
    ),
    imageUploadAllowedMimeTypes: new Set(
      readCsv("BFF_IMAGE_UPLOAD_ALLOWED_MIME_TYPES").length
        ? readCsv("BFF_IMAGE_UPLOAD_ALLOWED_MIME_TYPES").map((value) => value.toLowerCase())
        : ["image/png", "image/jpeg", "image/webp"]
    ),
    imageUploadS3BucketUrl: process.env.BFF_IMAGE_UPLOAD_S3_BUCKET_URL ?? "",
  };
}
