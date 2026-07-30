import { describe, expect, it } from "vitest";

import { runMigrations } from "./migration-runner.js";
import type { Queryable } from "./rows.js";

class FakeMigrationDb implements Queryable {
  readonly executedSql: string[] = [];
  private readonly appliedMigrations = new Set<string>();

  async query<TResult extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<{ rows: TResult[]; rowCount: number | null }> {
    this.executedSql.push(text);

    if (text.startsWith("SELECT migration_name")) {
      const migrationName = String(values[0]);
      const rows = this.appliedMigrations.has(migrationName)
        ? ([{ migration_name: migrationName }] as unknown as TResult[])
        : [];
      return { rows, rowCount: rows.length };
    }

    if (text.startsWith("INSERT INTO _migrations")) {
      this.appliedMigrations.add(String(values[0]));
      return { rows: [], rowCount: 1 };
    }

    if (text.startsWith("DELETE FROM _migrations")) {
      this.appliedMigrations.delete(String(values[0]));
      return { rows: [], rowCount: 1 };
    }

    return { rows: [], rowCount: null };
  }
}

describe("runMigrations", () => {
  it("returns no results when the database is not configured", async () => {
    await expect(runMigrations("up", null)).resolves.toEqual([]);
  });

  it("runs fixed up migrations once and tracks them", async () => {
    const db = new FakeMigrationDb();

    await expect(runMigrations("up", db)).resolves.toEqual([
      {
        migrationName: "001_create_agent_tasks.sql",
        direction: "up",
        executed: true,
      },
      {
        migrationName: "002_create_task_steps.sql",
        direction: "up",
        executed: true,
      },
      {
        migrationName: "003_create_task_events.sql",
        direction: "up",
        executed: true,
      },
    ]);

    await expect(runMigrations("up", db)).resolves.toEqual([
      {
        migrationName: "001_create_agent_tasks.sql",
        direction: "up",
        executed: false,
      },
      {
        migrationName: "002_create_task_steps.sql",
        direction: "up",
        executed: false,
      },
      {
        migrationName: "003_create_task_events.sql",
        direction: "up",
        executed: false,
      },
    ]);
  });

  it("runs down migrations in reverse order when applied", async () => {
    const db = new FakeMigrationDb();
    await runMigrations("up", db);

    await expect(runMigrations("down", db)).resolves.toEqual([
      {
        migrationName: "003_create_task_events.sql",
        direction: "down",
        executed: true,
      },
      {
        migrationName: "002_create_task_steps.sql",
        direction: "down",
        executed: true,
      },
      {
        migrationName: "001_create_agent_tasks.sql",
        direction: "down",
        executed: true,
      },
    ]);
  });
});
