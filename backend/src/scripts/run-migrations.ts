import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runner } from "node-pg-migrate";
import pg from "pg";
import { getMigrationDatabaseUrl } from "../db/config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "../../../database/migrations");

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has("--dry-run");
  const migrationUrl = getMigrationDatabaseUrl();

  if (dryRun) {
    console.log("Running forward-only migrations in DRY-RUN mode...");
  }

  // Pre-flight check: Ensure restricted npr_app_user exists prior to migrations that reference it in RLS policies (e.g. Migrations 011, 015)
  if (!dryRun) {
    const preClient = new pg.Client({ connectionString: migrationUrl });
    try {
      await preClient.connect();
      await preClient.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'npr_app_user') THEN
            CREATE ROLE npr_app_user WITH
              NOLOGIN
              NOSUPERUSER
              NOCREATEDB
              NOCREATEROLE
              NOREPLICATION
              NOINHERIT
              NOBYPASSRLS;
          END IF;
        END
        $$;
      `);
    } catch {
      // Continue gracefully if user lacks CREATEROLE or role already exists
    } finally {
      await preClient.end().catch(() => {});
    }
  }

  await runner({
    databaseUrl: migrationUrl,
    dir: migrationsDir,
    migrationsTable: "pgmigrations",
    schema: "public",
    direction: "up",
    checkOrder: true,
    singleTransaction: true,
    dryRun,
    verbose: true,
  });

  console.log(dryRun ? "Dry-run complete!" : "Migrations complete!");
}

main().catch((error: unknown) => {
  console.error(
    "Migration execution failed:",
    error instanceof Error ? error.message : "Unknown error"
  );
  process.exitCode = 1;
});
