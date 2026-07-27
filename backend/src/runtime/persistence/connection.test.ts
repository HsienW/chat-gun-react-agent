import { afterEach, describe, expect, it } from "vitest";

import { closePool, getDatabaseConnectionState, getPool } from "./connection.js";

const originalDatabaseUrl = process.env.DATABASE_URL;
const originalPgSslMode = process.env.PGSSLMODE;
const originalPgPoolMax = process.env.PGPOOL_MAX;

afterEach(async () => {
  await closePool();
  process.env.DATABASE_URL = originalDatabaseUrl;
  process.env.PGSSLMODE = originalPgSslMode;
  process.env.PGPOOL_MAX = originalPgPoolMax;
});

describe("database connection configuration", () => {
  it("returns a not-configured state without DATABASE_URL", async () => {
    delete process.env.DATABASE_URL;

    expect(getDatabaseConnectionState()).toEqual({
      configured: false,
      reason: "database_url_missing",
    });
    expect(getPool()).toBeNull();
  });

  it("uses PGSSLMODE=require and a bounded pool size when configured", () => {
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/app";
    process.env.PGSSLMODE = "require";
    process.env.PGPOOL_MAX = "4";

    expect(getDatabaseConnectionState()).toEqual({
      configured: true,
      connectionString: "postgres://user:pass@localhost:5432/app",
      max: 4,
      ssl: true,
    });
  });

  it("lets DATABASE_URL sslmode override PGSSLMODE", () => {
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/app?sslmode=disable";
    process.env.PGSSLMODE = "require";

    expect(getDatabaseConnectionState()).toEqual({
      configured: true,
      connectionString: "postgres://user:pass@localhost:5432/app?sslmode=disable",
      max: 10,
      ssl: false,
    });
  });
});
