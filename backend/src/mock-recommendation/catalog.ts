import type { MockProduct } from "./types.js";

export const MOCK_CATALOG_TENANT_ID = "demo-tenant";
export const MOCK_CATALOG_OWNER_SCOPE_ID = "demo-scope";

export const MOCK_CATALOG: readonly MockProduct[] = [
  { productId: "A1", category: "X", color: "red", price: 10, tenantId: MOCK_CATALOG_TENANT_ID, ownerScopeId: MOCK_CATALOG_OWNER_SCOPE_ID },
  { productId: "A2", category: "X", color: "blue", price: 12, tenantId: MOCK_CATALOG_TENANT_ID, ownerScopeId: MOCK_CATALOG_OWNER_SCOPE_ID },
  { productId: "A3", category: "Y", color: "red", price: 14, tenantId: MOCK_CATALOG_TENANT_ID, ownerScopeId: MOCK_CATALOG_OWNER_SCOPE_ID },
  { productId: "A4", category: "Y", color: "blue", price: 16, tenantId: MOCK_CATALOG_TENANT_ID, ownerScopeId: MOCK_CATALOG_OWNER_SCOPE_ID },
  { productId: "A5", category: "Z", color: "green", price: 18, tenantId: MOCK_CATALOG_TENANT_ID, ownerScopeId: MOCK_CATALOG_OWNER_SCOPE_ID },
  { productId: "A6", category: "X", color: "green", price: 20, tenantId: MOCK_CATALOG_TENANT_ID, ownerScopeId: MOCK_CATALOG_OWNER_SCOPE_ID },
  { productId: "A7", category: "Y", color: "yellow", price: 22, tenantId: MOCK_CATALOG_TENANT_ID, ownerScopeId: MOCK_CATALOG_OWNER_SCOPE_ID },
  { productId: "A8", category: "Z", color: "red", price: 24, tenantId: MOCK_CATALOG_TENANT_ID, ownerScopeId: MOCK_CATALOG_OWNER_SCOPE_ID },
  { productId: "A9", category: "X", color: "yellow", price: 26, tenantId: MOCK_CATALOG_TENANT_ID, ownerScopeId: MOCK_CATALOG_OWNER_SCOPE_ID },
  { productId: "A10", category: "Y", color: "green", price: 28, tenantId: MOCK_CATALOG_TENANT_ID, ownerScopeId: MOCK_CATALOG_OWNER_SCOPE_ID },
  { productId: "A11", category: "Z", color: "blue", price: 30, tenantId: MOCK_CATALOG_TENANT_ID, ownerScopeId: MOCK_CATALOG_OWNER_SCOPE_ID },
  { productId: "A12", category: "X", color: "red", price: 32, tenantId: MOCK_CATALOG_TENANT_ID, ownerScopeId: MOCK_CATALOG_OWNER_SCOPE_ID },
] as const;
