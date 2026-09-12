import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { PostgresStore } from "@langchain/langgraph-checkpoint-postgres/store";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SPIKE_DATABASE_URL_ENV = "T0_POSTGRES_URI";
const SPIKE_SCHEMA = "t0_memory_spike";
const POLL_INTERVAL_MS = 25;
const EXPIRY_TIMEOUT_MS = 5_000;
const PROCESS_RESTART_FIXTURE_PATH = fileURLToPath(
  new URL("./process-restart-child.mjs", import.meta.url),
);

interface SchemaObject {
  kind: string;
  name: string;
}

interface MigrationVersion {
  version: number;
}

interface AuthorizedResource {
  tenantId: string;
  ownerScopeId: string;
}

const databaseUrl = process.env[SPIKE_DATABASE_URL_ENV];

function requireDatabaseUrl(): string {
  if (!databaseUrl) {
    throw new Error(`${SPIKE_DATABASE_URL_ENV} is required for the live PostgreSQL spike`);
  }
  return databaseUrl;
}

async function readSchemaState(pool: Pool): Promise<{
  objects: SchemaObject[];
  migrations: number[];
}> {
  const objects = await pool.query<SchemaObject>(
    `SELECT c.relkind AS kind, c.relname AS name
       FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1
        AND c.relkind IN ('r', 'i')
      ORDER BY c.relkind, c.relname`,
    [SPIKE_SCHEMA],
  );
  const migrations = await pool.query<MigrationVersion>(
    `SELECT v AS version FROM "${SPIKE_SCHEMA}".store_migrations ORDER BY v`,
  );

  return {
    objects: objects.rows,
    migrations: migrations.rows.map(({ version }) => version),
  };
}

async function waitUntilExpired(
  store: PostgresStore,
  namespace: string[],
  key: string,
): Promise<void> {
  const deadline = Date.now() + EXPIRY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if ((await store.get(namespace, key)) === null) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`Store item ${key} did not expire before the spike deadline`);
}

async function recallThroughGovernanceBoundary(
  store: PostgresStore,
  namespace: string[],
  key: string,
  authorize: (resource: AuthorizedResource) => boolean,
): Promise<Record<string, unknown> | null> {
  const item = await store.get(namespace, key);
  if (item === null) {
    return null;
  }

  const tenantId = typeof item.value.tenantId === "string" ? item.value.tenantId : "";
  const ownerScopeId =
    typeof item.value.ownerScopeId === "string" ? item.value.ownerScopeId : "";
  const expiresAt = typeof item.value.expiresAt === "string" ? item.value.expiresAt : undefined;

  if (!authorize({ tenantId, ownerScopeId })) {
    return null;
  }
  if (expiresAt !== undefined && Date.parse(expiresAt) <= Date.now()) {
    return null;
  }
  return item.value;
}

describe("LangGraph persistence dependency matrix", () => {
  it("exports PostgresStore from the approved store subpath", () => {
    expect(PostgresStore.name).toBe("PostgresStore");
  });
});

describe.skipIf(databaseUrl === undefined)("PostgresStore 1.0.5 live compatibility", () => {
  let store: PostgresStore | undefined;
  let pool: Pool | undefined;

  function requireStore(): PostgresStore {
    if (!store) {
      throw new Error("PostgresStore spike fixture is not initialized");
    }
    return store;
  }

  function requirePool(): Pool {
    if (!pool) {
      throw new Error("PostgreSQL spike pool is not initialized");
    }
    return pool;
  }

  beforeAll(async () => {
    const connectionString = requireDatabaseUrl();
    store = PostgresStore.fromConnString(connectionString, {
      schema: SPIKE_SCHEMA,
      ensureTables: false,
    });
    pool = new Pool({ connectionString });
    await store.setup();
  });

  afterAll(async () => {
    await store?.stop();
    await pool?.end();
  });

  it("keeps schema state and sentinel data stable across repeated setup", async () => {
    const activeStore = requireStore();
    const activePool = requirePool();
    const namespace = ["setup", "tenant-a", "scope-a"];
    const key = "setup-sentinel";

    await activeStore.put(namespace, key, { marker: "before-second-setup" });
    const firstState = await readSchemaState(activePool);

    const secondStore = PostgresStore.fromConnString(requireDatabaseUrl(), {
      schema: SPIKE_SCHEMA,
      ensureTables: false,
    });
    try {
      await secondStore.setup();
      expect(await readSchemaState(activePool)).toEqual(firstState);
      expect((await secondStore.get(namespace, key))?.value).toEqual({
        marker: "before-second-setup",
      });
    } finally {
      await secondStore.stop();
      await activeStore.delete(namespace, key);
    }
  });

  it("supports put, get, filtered search, overwrite, and delete", async () => {
    const activeStore = requireStore();
    const namespace = ["crud", "tenant-a", "scope-a"];
    const key = "crud-record";

    await activeStore.put(namespace, key, { kind: "preference", revision: "r1" });
    expect((await activeStore.get(namespace, key))?.value).toEqual({
      kind: "preference",
      revision: "r1",
    });
    expect(await activeStore.search(namespace, { filter: { kind: "preference" } })).toHaveLength(1);

    await activeStore.put(namespace, key, { kind: "preference", revision: "r2" });
    expect((await activeStore.get(namespace, key))?.value.revision).toBe("r2");

    await activeStore.delete(namespace, key);
    expect(await activeStore.get(namespace, key)).toBeNull();
  });

  it("shares durable data across independent thread clients", async () => {
    const namespace = ["cross-thread", "tenant-a", "principal-a", "scope-a"];
    const key = "shared-preference";
    const threadAStore = PostgresStore.fromConnString(requireDatabaseUrl(), {
      schema: SPIKE_SCHEMA,
    });
    const threadBStore = PostgresStore.fromConnString(requireDatabaseUrl(), {
      schema: SPIKE_SCHEMA,
    });

    try {
      await threadAStore.put(namespace, key, { preference: "compact" });
      expect((await threadBStore.get(namespace, key))?.value).toEqual({ preference: "compact" });
      await threadBStore.delete(namespace, key);
    } finally {
      await threadAStore.stop();
      await threadBStore.stop();
    }
  });

  it("keeps data readable after the writer process exits", () => {
    const key = "process-restart-record";
    const childOptions = {
      cwd: process.cwd(),
      encoding: "utf8" as const,
      env: { ...process.env, [SPIKE_DATABASE_URL_ENV]: requireDatabaseUrl() },
    };

    const writer = spawnSync(
      process.execPath,
      [PROCESS_RESTART_FIXTURE_PATH, "write", key, SPIKE_SCHEMA],
      childOptions,
    );
    expect(writer.status, writer.stderr).toBe(0);

    const reader = spawnSync(
      process.execPath,
      [PROCESS_RESTART_FIXTURE_PATH, "read", key, SPIKE_SCHEMA],
      childOptions,
    );
    expect(reader.status, reader.stderr).toBe(0);
    expect(JSON.parse(reader.stdout)).toEqual({ durable: true });
  });

  it("enforces native TTL and supports governance expiry filtering", async () => {
    const activeStore = requireStore();
    const nativeNamespace = ["ttl", "tenant-a", "scope-a"];
    await activeStore.put(nativeNamespace, "native-expiry", { marker: "native" }, false, {
      ttl: 0.001,
    });
    await waitUntilExpired(activeStore, nativeNamespace, "native-expiry");
    expect(await activeStore.sweepExpiredItems()).toBeGreaterThanOrEqual(1);

    const governanceNamespace = ["ttl", "shared-route"];
    await activeStore.put(governanceNamespace, "governance-expiry", {
      tenantId: "tenant-a",
      ownerScopeId: "scope-a",
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    });
    const recalled = await recallThroughGovernanceBoundary(
      activeStore,
      governanceNamespace,
      "governance-expiry",
      () => true,
    );
    expect(recalled).toBeNull();
    await activeStore.delete(governanceNamespace, "governance-expiry");
  });

  it("keeps tenant and scope authorization outside the physical namespace", async () => {
    const activeStore = requireStore();
    const sharedNamespace = ["authorization", "shared-route"];
    const key = "tenant-owned-record";
    await activeStore.put(sharedNamespace, key, {
      tenantId: "tenant-a",
      ownerScopeId: "scope-a",
      preference: "compact",
    });

    const allowed = await recallThroughGovernanceBoundary(
      activeStore,
      sharedNamespace,
      key,
      ({ tenantId, ownerScopeId }) => tenantId === "tenant-a" && ownerScopeId === "scope-a",
    );
    const denied = await recallThroughGovernanceBoundary(
      activeStore,
      sharedNamespace,
      key,
      ({ tenantId, ownerScopeId }) => tenantId === "tenant-b" && ownerScopeId === "scope-b",
    );

    expect(allowed).not.toBeNull();
    expect(denied).toBeNull();
    await activeStore.delete(sharedNamespace, key);
  });

  it("supports one-winner atomic compare-and-swap with a guarded update", async () => {
    const activeStore = requireStore();
    const activePool = requirePool();
    const namespace = ["cas", "tenant-a", "scope-a"];
    const namespacePath = namespace.join(":");
    const key = "cas-record";
    await activeStore.put(namespace, key, { revision: "r1", preference: "initial" });

    const guardedUpdate = (nextRevision: string) =>
      activePool.query(
        `UPDATE "${SPIKE_SCHEMA}".store
            SET value = jsonb_set(value, '{revision}', to_jsonb($3::text)),
                updated_at = CURRENT_TIMESTAMP
          WHERE namespace_path = $1
            AND key = $2
            AND value->>'revision' = 'r1'
          RETURNING value`,
        [namespacePath, key, nextRevision],
      );

    const updates = await Promise.all([guardedUpdate("r2-writer-a"), guardedUpdate("r2-writer-b")]);
    expect(updates.map(({ rowCount }) => rowCount).sort()).toEqual([0, 1]);
    expect((await activeStore.get(namespace, key))?.value.revision).toMatch(/^r2-writer-[ab]$/);
    await activeStore.delete(namespace, key);
  });
});
