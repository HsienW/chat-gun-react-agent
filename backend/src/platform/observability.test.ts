import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CompositeAuditLogger,
  ConsoleAuditLogger,
  getAuditLogger,
  type AuditLogger,
} from "./observability.js";
import { closePool } from "../runtime/persistence/connection.js";
import { PgAuditLogger } from "../runtime/audit/pg-audit-logger.js";

const originalAuditBackend = process.env.AUDIT_BACKEND;
const originalDatabaseUrl = process.env.DATABASE_URL;

afterEach(async () => {
  process.env.AUDIT_BACKEND = originalAuditBackend;
  process.env.DATABASE_URL = originalDatabaseUrl;
  await closePool();
  vi.restoreAllMocks();
});

describe("audit logger selection", () => {
  it("uses console by default", () => {
    delete process.env.AUDIT_BACKEND;

    expect(getAuditLogger()).toBeInstanceOf(ConsoleAuditLogger);
  });

  it("falls back to console when PostgreSQL is not configured", () => {
    process.env.AUDIT_BACKEND = "pg";
    delete process.env.DATABASE_URL;

    expect(getAuditLogger()).toBeInstanceOf(ConsoleAuditLogger);
  });

  it("uses PostgreSQL when selected and configured", () => {
    process.env.AUDIT_BACKEND = "pg";
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/app";

    expect(getAuditLogger()).toBeInstanceOf(PgAuditLogger);
  });

  it("creates a composite logger when selected and configured", () => {
    process.env.AUDIT_BACKEND = "composite";
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/app";

    expect(getAuditLogger()).toBeInstanceOf(CompositeAuditLogger);
  });

  it("isolates composite backend failures and continues in order", async () => {
    const calls: string[] = [];
    const failing: AuditLogger = {
      record: async () => {
        calls.push("failing");
        throw new Error("backend failed");
      },
    };
    const succeeding: AuditLogger = {
      record: async () => {
        calls.push("succeeding");
      },
    };
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(
      new CompositeAuditLogger([failing, succeeding]).record("task.created", {
        taskId: "task-1",
      })
    ).resolves.toBeUndefined();

    expect(calls).toEqual(["failing", "succeeding"]);
  });
});
