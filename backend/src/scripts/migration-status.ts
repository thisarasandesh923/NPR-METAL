import "dotenv/config";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { getMigrationDatabaseUrl } from "../db/config.js";

const { Pool } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "../../../database/migrations");

async function checkMigrationStatus(): Promise<void> {
  let migrationPool: pg.Pool | null = null;

  try {
    migrationPool = new Pool({
      connectionString: getMigrationDatabaseUrl(),
      max: 2,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000,
    });

    const entries = await readdir(migrationsDir, { withFileTypes: true });
    const localMigrations = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
      .map((entry) => entry.name.replace(/\.sql$/, ""))
      .sort();

    const tableCheck = await migrationPool.query<{ table_regclass: string | null }>(
      "SELECT to_regclass('public.pgmigrations')::text AS table_regclass"
    );

    const appliedMap = new Map<string, string>();
    if (tableCheck.rows[0]?.table_regclass) {
      const result = await migrationPool.query<{ name: string; run_on: Date }>(
        "SELECT name, run_on FROM public.pgmigrations ORDER BY id ASC"
      );
      for (const row of result.rows) {
        appliedMap.set(row.name, new Date(row.run_on).toISOString());
      }
    } else {
      console.log(
        "Migrations table (public.pgmigrations) does not exist yet. All local migrations are pending."
      );
    }

    console.log("Migration status:");
    for (const name of localMigrations) {
      const appliedAt = appliedMap.get(name);
      if (appliedAt) {
        console.log(`  [APPLIED] ${name} (${appliedAt})`);
      } else {
        console.log(`  [PENDING] ${name}`);
      }
    }
  } catch (error) {
    console.error(
      "Failed to check migration status:",
      error instanceof Error ? error.message : "Unknown error"
    );
    process.exitCode = 1;
  } finally {
    await migrationPool?.end();
  }
}

void checkMigrationStatus();