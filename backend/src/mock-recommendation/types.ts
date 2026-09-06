export interface MockProduct {
  productId: string;
  category: string;
  color: string;
  price: number;
  tenantId: string;
  ownerScopeId: string;
}

export interface MockIntent {
  category?: string;
  color?: string;
  price?: string;
  confidence: number;
}

export interface MockCardPayload {
  title: string;
  category: string;
  color: string;
  price: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} is required`);
  }
  return value;
}

function requireFiniteNumber(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${fieldName} must be a finite number`);
  }
  return value;
}

function optionalString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) return undefined;
  return requireString(value, fieldName);
}

export function validateMockProduct(value: unknown): MockProduct {
  if (!isRecord(value)) {
    throw new Error("mock product must be an object");
  }
  return {
    productId: requireString(value.productId, "productId"),
    category: requireString(value.category, "category"),
    color: requireString(value.color, "color"),
    price: requireFiniteNumber(value.price, "price"),
    tenantId: requireString(value.tenantId, "tenantId"),
    ownerScopeId: requireString(value.ownerScopeId, "ownerScopeId"),
  };
}

export function validateMockIntent(value: unknown): MockIntent {
  if (!isRecord(value)) {
    throw new Error("mock intent must be an object");
  }
  const confidence = requireFiniteNumber(value.confidence, "confidence");
  if (confidence < 0 || confidence > 1) {
    throw new Error("confidence must be between 0 and 1");
  }
  const category = optionalString(value.category, "category");
  const color = optionalString(value.color, "color");
  const price = optionalString(value.price, "price");
  return {
    ...(category === undefined ? {} : { category }),
    ...(color === undefined ? {} : { color }),
    ...(price === undefined ? {} : { price }),
    confidence,
  };
}

export function validateMockCardPayload(value: unknown): MockCardPayload {
  if (!isRecord(value)) {
    throw new Error("mock card payload must be an object");
  }
  return {
    title: requireString(value.title, "title"),
    category: requireString(value.category, "category"),
    color: requireString(value.color, "color"),
    price: requireFiniteNumber(value.price, "price"),
  };
}
