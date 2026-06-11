import { BaseMessage } from "@langchain/core/messages";

import { BACKEND_ERROR_MESSAGES } from "./error-messages.js";
import { getEnv } from "./env.js";

export type BackendUploadSecurityConfig = {
  maxFiles: number;
  maxBytes: number;
  maxPixels: number;
  allowedExtensions: Set<string>;
  allowedMimeTypes: Set<string>;
  s3BucketUrl: string;
};

export type ImageAttachmentBlock = {
  type?: string;
  image_url?: string | { url?: string };
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
};

const MIME_BY_EXTENSION = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
]);

function readPositiveInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function readCsv(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function getUploadSecurityConfig(): BackendUploadSecurityConfig {
  const configuredExtensions = readCsv("BACKEND_IMAGE_UPLOAD_ALLOWED_EXTENSIONS");
  const configuredMimeTypes = readCsv("BACKEND_IMAGE_UPLOAD_ALLOWED_MIME_TYPES");

  return {
    maxFiles: readPositiveInt("BACKEND_IMAGE_UPLOAD_MAX_FILES", 6),
    maxBytes: readPositiveInt("BACKEND_IMAGE_UPLOAD_MAX_BYTES", 5 * 1024 * 1024),
    maxPixels: readPositiveInt("BACKEND_IMAGE_UPLOAD_MAX_PIXELS", 24_000_000),
    allowedExtensions: new Set(
      configuredExtensions.length ? configuredExtensions : [".png", ".jpg", ".jpeg", ".webp"]
    ),
    allowedMimeTypes: new Set(
      configuredMimeTypes.length ? configuredMimeTypes : ["image/png", "image/jpeg", "image/webp"]
    ),
    s3BucketUrl: getEnv("BACKEND_IMAGE_UPLOAD_S3_BUCKET_URL", ""),
  };
}

export function getImageUrl(block: ImageAttachmentBlock): string | undefined {
  return typeof block.image_url === "string" ? block.image_url : block.image_url?.url;
}

function getFileExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : "";
}

function parseDataUrl(value: string): { mimeType: string; base64: string } | undefined {
  const match = value.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return undefined;
  return {
    mimeType: match[1].toLowerCase(),
    base64: match[2],
  };
}

function estimateBase64Bytes(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function hasExpectedMagicBytes(mimeType: string, base64: string): boolean {
  const bytes = Buffer.from(base64.slice(0, 32), "base64");

  if (mimeType === "image/png") {
    return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }

  if (mimeType === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }

  if (mimeType === "image/webp") {
    return (
      bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
      bytes.subarray(8, 12).toString("ascii") === "WEBP"
    );
  }

  return false;
}

export function extractImageAttachmentBlocksFromContent(content: unknown): ImageAttachmentBlock[] {
  if (!Array.isArray(content)) {
    return [];
  }

  return content.filter((block): block is ImageAttachmentBlock => {
    return Boolean(block && typeof block === "object" && (block as ImageAttachmentBlock).type === "image_url");
  });
}

export function extractImageAttachmentBlocks(messages: BaseMessage[]): ImageAttachmentBlock[] {
  return messages.flatMap((message) => extractImageAttachmentBlocksFromContent(message.content));
}

export function validateImageAttachments(
  messages: BaseMessage[],
  config = getUploadSecurityConfig()
): string | undefined {
  const imageBlocks = extractImageAttachmentBlocks(messages);
  if (imageBlocks.length === 0) return undefined;

  if (imageBlocks.length > config.maxFiles) {
    return BACKEND_ERROR_MESSAGES.upload.tooManyImages(imageBlocks.length, config.maxFiles);
  }

  for (const [index, block] of imageBlocks.entries()) {
    const rawUrl = getImageUrl(block);
    if (!rawUrl) {
      return BACKEND_ERROR_MESSAGES.upload.missingImageUrl(index + 1);
    }

    const dataUrl = parseDataUrl(rawUrl);
    if (!dataUrl) {
      return BACKEND_ERROR_MESSAGES.upload.dataUrlRequired(index + 1);
    }

    const fileName = block.fileName;
    if (!fileName) {
      return BACKEND_ERROR_MESSAGES.upload.missingFileName(index + 1);
    }

    const extension = getFileExtension(fileName);
    const expectedMime = MIME_BY_EXTENSION.get(extension);
    if (!config.allowedExtensions.has(extension) || !expectedMime) {
      return BACKEND_ERROR_MESSAGES.upload.unsupportedExtension(fileName);
    }

    if (!config.allowedMimeTypes.has(dataUrl.mimeType) || dataUrl.mimeType !== expectedMime) {
      return BACKEND_ERROR_MESSAGES.upload.mimeMismatch(fileName);
    }

    if (block.mimeType && block.mimeType.toLowerCase() !== dataUrl.mimeType) {
      return BACKEND_ERROR_MESSAGES.upload.metadataMimeMismatch(fileName);
    }

    const sizeBytes = estimateBase64Bytes(dataUrl.base64);
    if (sizeBytes <= 0 || sizeBytes > config.maxBytes) {
      return BACKEND_ERROR_MESSAGES.upload.sizeExceeded(fileName);
    }

    if (typeof block.sizeBytes === "number" && block.sizeBytes !== sizeBytes) {
      return BACKEND_ERROR_MESSAGES.upload.sizeMetadataMismatch(fileName);
    }

    if (
      typeof block.width === "number" &&
      typeof block.height === "number" &&
      block.width * block.height > config.maxPixels
    ) {
      return BACKEND_ERROR_MESSAGES.upload.dimensionsTooLarge(fileName);
    }

    if (!hasExpectedMagicBytes(dataUrl.mimeType, dataUrl.base64)) {
      return BACKEND_ERROR_MESSAGES.upload.magicBytesMismatch(fileName);
    }
  }

  return undefined;
}

export function summarizeImageAttachments(messages: BaseMessage[]): string {
  const imageBlocks = extractImageAttachmentBlocks(messages);
  if (imageBlocks.length === 0) return "";

  return imageBlocks
    .map((block, index) => {
      const parts = [
        `Image ${index + 1}`,
        block.fileName ? `file=${block.fileName}` : undefined,
        block.mimeType ? `mime=${block.mimeType}` : undefined,
        typeof block.sizeBytes === "number" ? `bytes=${block.sizeBytes}` : undefined,
        typeof block.width === "number" && typeof block.height === "number"
          ? `dimensions=${block.width}x${block.height}`
          : undefined,
      ].filter(Boolean);
      return parts.join(", ");
    })
    .join("\n");
}
