import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POLICY_SCRIPT_PATH = path.resolve(
  __dirname,
  "../../../database/scripts/apply_runtime_role_policies.sql"
);

/**
 * STRICT FAIL-CLOSED SAFETY GUARD
 * Ensures this test-only provisioning script can ONLY target the isolated local
 * disposable test PostgreSQL database (127.0.0.1:55432 / npr_test_db).
 * Never loads backend/.env, never reads DATABASE_URL / MIGRATION_DATABASE_URL,
 * and rejects query overrides (?host=, ?port=, ?dbname=) or Supabase targets.
 */
function getVerifiedLocalTestUrl(): string {
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) {
    throw new Error(
      "SAFETY ABORT: TEST_DATABASE_URL is not set. This test-only script refuses to run without an explicit local test URL."
    );
  }

  if (testUrl.toLowerCase().includes("supabase")) {
    throw new Error(
      "SAFETY ABORT: TEST_DATABASE_URL references Supabase. Refusing to connect."
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(testUrl);
  } catch {
    throw new Error("SAFETY ABORT: TEST_DATABASE_URL is not a valid URL.");
  }

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

  for (const forbiddenParam of ["host", "port", "dbname", "user"]) {
    if (parsed.searchParams.has(forbiddenParam)) {
      throw new Error(
        `SAFETY ABORT: Query override "${forbiddenParam}" is not permitted on TEST_DATABASE_URL.`
      );
    }
  }

  return testUrl;
}

async function provisionLocalTestRuntimeRole(): Promise<void> {
  const testUrl = getVerifiedLocalTestUrl();
  const testRolePassword =
    process.env.TEST_APP_USER_PASSWORD ?? "test_only_app_password_2b2";

  if (!testRolePassword || testRolePassword.length < 12) {
    throw new Error(
      "TEST_APP_USER_PASSWORD must be at least 12 characters long."
    );
  }

  const client = new Client({ connectionString: testUrl });
  await client.connect();

  try {
    const idRes = await client.query<{
      db: string;
      usr: string;
      port: number;
      ver: string;
    }>(
      "SELECT current_database() AS db, current_user AS usr, inet_server_port() AS port, version() AS ver"
    );
    const id = idRes.rows[0];
    if (id?.db !== "npr_test_db") {
      throw new Error(
        `SAFETY ABORT: Connected database "${id?.db}" does not match expected "npr_test_db".`
      );
    }
    console.log(
      `Verified local disposable target: db=${id.db}, user=${id.usr}, ver=${id.ver.split(",")[0]}`
    );

    // Stage 1: Create or sanitize role as NOLOGIN first (mirrors secure staged DBA procedure)
    await client.query(`
      DO $stage1$
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
        ELSE
          ALTER ROLE npr_app_user WITH
            NOLOGIN
            NOSUPERUSER
            NOCREATEDB
            NOCREATEROLE
            NOREPLICATION
            NOINHERIT
            NOBYPASSRLS;
        END IF;
      END
      $stage1$
    `);

    // Stage 2: Apply transactional least-privilege grants & RLS policies while NOLOGIN
    const policySql = await readFile(POLICY_SCRIPT_PATH, "utf8");
    await client.query(policySql);

    // Stage 3: Set SCRAM-SHA-256 test password via transaction-local config & enable LOGIN
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL password_encryption = 'scram-sha-256'");
      await client.query("SELECT set_config('npr.test_role_pwd', $1, true)", [
        testRolePassword,
      ]);
      await client.query(`
        DO $stage3$
        DECLARE
          v_pwd TEXT := current_setting('npr.test_role_pwd');
        BEGIN
          EXECUTE format(
            'ALTER ROLE npr_app_user WITH LOGIN PASSWORD %L VALID UNTIL ''infinity''',
            v_pwd
          );
        END
        $stage3$
      `);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    }

    const verifyRes = await client.query<{
      rolcanlogin: boolean;
      rolsuper: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolbypassrls: boolean;
      rolinherit: boolean;
      policy_count: number;
    }>(
      `SELECT
         r.rolcanlogin,
         r.rolsuper,
         r.rolcreatedb,
         r.rolcreaterole,
         r.rolbypassrls,
         r.rolinherit,
         (SELECT COUNT(*)::int FROM pg_policies WHERE schemaname = 'public' AND 'npr_app_user' = ANY(roles)) AS policy_count
       FROM pg_roles r
       WHERE r.rolname = 'npr_app_user'`
    );

    const state = verifyRes.rows[0];
    console.log(
      `Local test role provisioned successfully: canlogin=${state.rolcanlogin}, super=${state.rolsuper}, createdb=${state.rolcreatedb}, createrole=${state.rolcreaterole}, bypassrls=${state.rolbypassrls}, inherit=${state.rolinherit}, rls_policies=${state.policy_count}`
    );
  } finally {
    await client.end();
  }
}

provisionLocalTestRuntimeRole().catch((error: unknown) => {
  console.error(
    "Local test role provisioning failed:",
    error instanceof Error ? error.message : "Unknown error"
  );
  process.exitCode = 1;
});