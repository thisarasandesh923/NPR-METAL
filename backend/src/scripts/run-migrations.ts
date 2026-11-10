import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runner } from "node-pg-migrate";
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
