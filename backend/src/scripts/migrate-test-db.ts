import path from "node:path";
import { fileURLToPath } from "node:url";
import { runner } from "node-pg-migrate";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "../../../database/migrations");

function getVerifiedLocalTestUrl(): string {
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) {
    throw new Error(
      "SAFETY ABORT: TEST_DATABASE_URL is not set. This test migration script refuses to run without an explicit local test URL."
    );
  }

  if (testUrl.toLowerCase().includes("supabase")) {
    throw new Error(
      "SAFETY ABORT: TEST_DATABASE_URL references Supabase. Refusing to connect."
    );
  }

  const parsed = new URL(testUrl);
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(`SAFETY ABORT: Unsupported protocol "${parsed.protocol}".`);
  }

  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    throw new Error(
      `SAFETY ABORT: Host "${parsed.hostname}" is not local (must be 127.0.0.1 or localhost).`
    );
  }

  if (parsed.port !== "55432") {
    throw new Error(
      `SAFETY ABORT: Port "${parsed.port}" is not the isolated test port 55432.`
    );
  }

  if (parsed.pathname !== "/npr_test_db") {
    throw new Error(
      `SAFETY ABORT: Database "${parsed.pathname}" is not /npr_test_db.`
    );
  }

  return testUrl;
}

async function main(): Promise<void> {
  const testUrl = getVerifiedLocalTestUrl();

  console.log(`Applying migrations 001-015 to isolated test database: ${testUrl.replace(/:[^:@]+@/, ":***@")}`);

  // Ensure npr_app_user role exists prior to running migrations with RLS policies granting to it
  const { Client } = await import("pg");
  const initClient = new Client({ connectionString: testUrl });
  await initClient.connect();
  try {
    await initClient.query(`
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
  } finally {
    await initClient.end();
  }

  await runner({
    databaseUrl: testUrl,
    dir: migrationsDir,
    migrationsTable: "pgmigrations",
    schema: "public",
    direction: "up",
    checkOrder: true,
    singleTransaction: true,
    verbose: true,
  });

  console.log("Isolated test database migrations 001-015 successfully applied!");
}

main().catch((error: unknown) => {
  console.error(
    "Test migration execution failed:",
    error instanceof Error ? error.message : "Unknown error"
  );
  process.exitCode = 1;
});
