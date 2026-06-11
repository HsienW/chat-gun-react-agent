export type ImageUploadStatus = 'queued' | 'processing' | 'completed' | 'failed';

import { FRONTEND_ERROR_MESSAGES } from './error-messages';

export type ProcessedImageAttachment = {
  id: string;
  fileName: string;
  extension: string;
  mimeType: string;
  originalBytes: number;
  processedBytes: number;
  width: number;
  height: number;
  dataUrl: string;
};

export type ImageUploadItem = {
  id: string;
  file: File;
  status: ImageUploadStatus;
  error?: string;
  attachment?: ProcessedImageAttachment;
};

export type ImageUploadConfig = {
  maxFiles: number;
  maxBytes: number;
  maxConcurrent: number;
  maxPixels: number;
  allowedExtensions: Set<string>;
  allowedMimeTypes: Set<string>;
  s3BucketUrl: string;
};

const DEFAULT_MAX_FILES = 6;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_CONCURRENT = 2;
const DEFAULT_MAX_PIXELS = 24_000_000;

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function readCsv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function getImageUploadConfig(): ImageUploadConfig {
  const configuredExtensions = readCsv(import.meta.env.VITE_IMAGE_UPLOAD_ALLOWED_EXTENSIONS);
  const configuredMimeTypes = readCsv(import.meta.env.VITE_IMAGE_UPLOAD_ALLOWED_MIME_TYPES);

  return {
    maxFiles: readPositiveInt(import.meta.env.VITE_IMAGE_UPLOAD_MAX_FILES, DEFAULT_MAX_FILES),
    maxBytes: readPositiveInt(import.meta.env.VITE_IMAGE_UPLOAD_MAX_BYTES, DEFAULT_MAX_BYTES),
    maxConcurrent: readPositiveInt(
      import.meta.env.VITE_IMAGE_UPLOAD_MAX_CONCURRENT,
      DEFAULT_MAX_CONCURRENT
    ),
    maxPixels: readPositiveInt(import.meta.env.VITE_IMAGE_UPLOAD_MAX_PIXELS, DEFAULT_MAX_PIXELS),
    allowedExtensions: new Set(
      configuredExtensions.length ? configuredExtensions : ['.png', '.jpg', '.jpeg', '.webp']
    ),
    allowedMimeTypes: new Set(
      configuredMimeTypes.length
        ? configuredMimeTypes
        : ['image/png', 'image/jpeg', 'image/webp']
    ),
    s3BucketUrl: import.meta.env.VITE_IMAGE_UPLOAD_S3_BUCKET_URL ?? '',
  };
}

export function getFileExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : '';
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export function validateImageFile(file: File, config = getImageUploadConfig()): string | undefined {
  const extension = getFileExtension(file.name);

  if (!config.allowedExtensions.has(extension)) {
    return FRONTEND_ERROR_MESSAGES.imageUpload.unsupportedExtension(extension);
  }

  if (!config.allowedMimeTypes.has(file.type.toLowerCase())) {
    return FRONTEND_ERROR_MESSAGES.imageUpload.unsupportedMimeType(file.type);
  }

  if (file.size <= 0) {
    return FRONTEND_ERROR_MESSAGES.imageUpload.emptyFile;
  }

  if (file.size > config.maxBytes) {
    return FRONTEND_ERROR_MESSAGES.imageUpload.imageTooLarge(
      formatBytes(file.size),
      formatBytes(config.maxBytes)
    );
  }

  return undefined;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(reader.error ?? new Error(FRONTEND_ERROR_MESSAGES.imageUpload.readFailed));
    reader.readAsDataURL(blob);
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error(FRONTEND_ERROR_MESSAGES.imageUpload.encodeFailed));
        }
      },
      mimeType,
      0.92
    );
  });
}

async function loadBitmapWithOrientation(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return createImageBitmap(file);
  }
}

export async function preprocessImageFile(
  file: File,
  config = getImageUploadConfig()
): Promise<ProcessedImageAttachment> {
  const validationError = validateImageFile(file, config);
  if (validationError) {
    throw new Error(validationError);
  }

  const bitmap = await loadBitmapWithOrientation(file);

  try {
    const pixels = bitmap.width * bitmap.height;
    if (pixels > config.maxPixels) {
      throw new Error(
        FRONTEND_ERROR_MESSAGES.imageUpload.dimensionsTooLarge(bitmap.width, bitmap.height)
      );
    }

    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', {
      alpha: file.type.toLowerCase() === 'image/png' || file.type.toLowerCase() === 'image/webp',
    });

    if (!context) {
      throw new Error(FRONTEND_ERROR_MESSAGES.imageUpload.contextUnavailable);
    }

    context.drawImage(bitmap, 0, 0);
    const processedBlob = await canvasToBlob(canvas, file.type);

    if (processedBlob.size > config.maxBytes) {
      throw new Error(
        FRONTEND_ERROR_MESSAGES.imageUpload.processedImageTooLarge(
          formatBytes(processedBlob.size),
          formatBytes(config.maxBytes)
        )
      );
    }

    const dataUrl = await blobToDataUrl(processedBlob);

    return {
      id: crypto.randomUUID(),
      fileName: file.name,
      extension: getFileExtension(file.name),
      mimeType: file.type.toLowerCase(),
      originalBytes: file.size,
      processedBytes: processedBlob.size,
      width: canvas.width,
      height: canvas.height,
      dataUrl,
    };
  } finally {
    bitmap.close();
  }
}

export async function processImageUploadQueue(
  items: ImageUploadItem[],
  onUpdate: (items: ImageUploadItem[]) => void,
  config = getImageUploadConfig()
): Promise<ImageUploadItem[]> {
  let nextIndex = 0;
  const output = [...items];
  const workerCount = Math.min(config.maxConcurrent, output.length);

  const updateItem = (id: string, patch: Partial<ImageUploadItem>) => {
    const index = output.findIndex((item) => item.id === id);
    if (index < 0) return;
    output[index] = { ...output[index], ...patch };
    onUpdate([...output]);
  };

  const runWorker = async () => {
    while (nextIndex < output.length) {
      const item = output[nextIndex];
      nextIndex += 1;

      updateItem(item.id, { status: 'processing', error: undefined });

      try {
        const attachment = await preprocessImageFile(item.file, config);
        updateItem(item.id, { status: 'completed', attachment });
      } catch (error) {
        updateItem(item.id, {
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, runWorker));
  return output;
}
