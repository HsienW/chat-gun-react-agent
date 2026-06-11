export type UploadSecurityConfig = {
  maxFiles: number;
  maxBytes: number;
  maxPixels: number;
  allowedExtensions: Set<string>;
  allowedMimeTypes: Set<string>;
  s3BucketUrl: string;
};

type ImageBlock = {
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

function getMagicBytes(base64: string): Buffer {
  return Buffer.from(base64.slice(0, 32), "base64");
}

function hasExpectedMagicBytes(mimeType: string, bytes: Buffer): boolean {
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

function collectImageBlocks(value: unknown): ImageBlock[] {
  if (!value || typeof value !== "object") return [];

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectImageBlocks(item));
  }

  const record = value as Record<string, unknown>;
  const blocks: ImageBlock[] = [];

  if (record.type === "image_url") {
    blocks.push(record as ImageBlock);
  }

  for (const child of Object.values(record)) {
    if (child && typeof child === "object") {
      blocks.push(...collectImageBlocks(child));
    }
  }

  return blocks;
}

export function validateUploadPayload(
  body: Buffer | undefined,
  config: UploadSecurityConfig
): string | undefined {
  if (!body || body.byteLength === 0) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    return undefined;
  }

  const imageBlocks = collectImageBlocks(parsed);
  if (imageBlocks.length === 0) return undefined;

  if (imageBlocks.length > config.maxFiles) {
    return `Too many image attachments: ${imageBlocks.length}. Max: ${config.maxFiles}.`;
  }

  for (const [index, block] of imageBlocks.entries()) {
    const rawUrl =
      typeof block.image_url === "string" ? block.image_url : block.image_url?.url;

    if (!rawUrl) {
      return `Image attachment ${index + 1} is missing image_url.url.`;
    }

    const dataUrl = parseDataUrl(rawUrl);
    if (!dataUrl) {
      return `Image attachment ${index + 1} must be a base64 data URL.`;
    }

    const fileName = block.fileName;
    if (!fileName) {
      return `Image attachment ${index + 1} is missing fileName.`;
    }

    const extension = getFileExtension(fileName);
    const expectedMime = MIME_BY_EXTENSION.get(extension);

    if (!config.allowedExtensions.has(extension) || !expectedMime) {
      return `Unsupported image extension for ${fileName}.`;
    }

    if (!config.allowedMimeTypes.has(dataUrl.mimeType) || dataUrl.mimeType !== expectedMime) {
      return `Image MIME type does not match extension for ${fileName}.`;
    }

    if (block.mimeType && block.mimeType.toLowerCase() !== dataUrl.mimeType) {
      return `Image metadata MIME type does not match payload for ${fileName}.`;
    }

    const sizeBytes = estimateBase64Bytes(dataUrl.base64);
    if (sizeBytes <= 0 || sizeBytes > config.maxBytes) {
      return `Image ${fileName} exceeds the allowed size.`;
    }

    if (typeof block.sizeBytes === "number" && block.sizeBytes !== sizeBytes) {
      return `Image size metadata does not match payload for ${fileName}.`;
    }

    if (
      typeof block.width === "number" &&
      typeof block.height === "number" &&
      block.width * block.height > config.maxPixels
    ) {
      return `Image dimensions are too large for ${fileName}.`;
    }

    if (!hasExpectedMagicBytes(dataUrl.mimeType, getMagicBytes(dataUrl.base64))) {
      return `Image magic bytes do not match MIME type for ${fileName}.`;
    }
  }

  return undefined;
}
