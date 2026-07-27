import { Pool, type PoolConfig } from "pg";

import { getEnv } from "../../platform/env.js";

const DATABASE_URL_ENV = "DATABASE_URL";
const PGSSLMODE_ENV = "PGSSLMODE";
const PGPOOL_MAX_ENV = "PGPOOL_MAX";
const DEFAULT_POOL_SIZE = 10;

export type DatabaseConnectionState =
  | { configured: false; reason: "database_url_missing" }
  | {
      configured: true;
      connectionString: string;
      max: number;
      ssl: PoolConfig["ssl"];
    };

let pool: Pool | null = null;

function getPoolSize(): number {
  const rawPoolSize = getEnv(PGPOOL_MAX_ENV);
  const parsedPoolSize = Number.parseInt(rawPoolSize, 10);

  return Number.isInteger(parsedPoolSize) && parsedPoolSize > 0
    ? parsedPoolSize
    : DEFAULT_POOL_SIZE;
}

function getSslModeFromConnectionString(connectionString: string): string | undefined {
  try {
    return new URL(connectionString).searchParams.get("sslmode") ?? undefined;
  } catch {
    return undefined;
  }
}

function resolveSslConfig(connectionString: string): PoolConfig["ssl"] {
  const sslMode =
    getSslModeFromConnectionString(connectionString) || getEnv(PGSSLMODE_ENV, "disable");

  return sslMode === "require" ? true : false;
}

export function getDatabaseConnectionState(): DatabaseConnectionState {
  const connectionString = getEnv(DATABASE_URL_ENV);

  if (!connectionString) {
    return { configured: false, reason: "database_url_missing" };
  }

  return {
    configured: true,
    connectionString,
    max: getPoolSize(),
    ssl: resolveSslConfig(connectionString),
  };
}

export function getPool(): Pool | null {
  if (pool) {
    return pool;
  }

  const connectionState = getDatabaseConnectionState();
  if (!connectionState.configured) {
    return null;
  }

  pool = new Pool({
    connectionString: connectionState.connectionString,
    max: connectionState.max,
    ssl: connectionState.ssl,
  });

  return pool;
}

export async function closePool(): Promise<void> {
  if (!pool) {
    return;
  }

  await pool.end();
  pool = null;
}
