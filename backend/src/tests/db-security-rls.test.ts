import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POLICY_SCRIPT_PATH = path.resolve(
  __dirname,
  "../../../database/scripts/apply_runtime_role_policies.sql"
);

function getVerifiedLocalTestUrl(): string {
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) {
    throw new Error(
      "SAFETY ABORT: TEST_DATABASE_URL is not set. This suite refuses to run without an explicit local test URL."
    );
  }
  if (testUrl.toLowerCase().includes("supabase")) {
    throw new Error("SAFETY ABORT: TEST_DATABASE_URL references Supabase.");
  }
  const parsed = new URL(testUrl);
  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    throw new Error(`SAFETY ABORT: Host "${parsed.hostname}" must be local.`);
  }
  if (parsed.port !== "55432" || parsed.pathname !== "/npr_test_db") {
    throw new Error("SAFETY ABORT: Target must be 127.0.0.1:55432/npr_test_db.");
  }
  return testUrl;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const TEST_URL = getVerifiedLocalTestUrl();
const adminPool = new Pool({ connectionString: TEST_URL, max: 4 });
let appUserPool: pg.Pool | null = null;

let ownerId = "";
let cashierId = "";
let custId = "";
let matId = 0;

describe("Phase 2B3B / 2C — PostgreSQL 17 Supabase Security Hardening, RLS & Restricted Role Tests", () => {
  before(async () => {
    const idCheck = await adminPool.query<{ db: string; ver: string }>(
      "SELECT current_database() AS db, version() AS ver"
    );
    assert.equal(idCheck.rows[0]?.db, "npr_test_db");
    console.log(`Security test DB: ${idCheck.rows[0].ver}`);

    const suffix = randomUUID().slice(0, 8);
    ownerId = (
      await adminPool.query<{ id: string }>(
        `INSERT INTO users (username, password_hash, full_name, role)
         VALUES ($1, 'hash', 'Sec Owner', 'OWNER') RETURNING id`,
        [`sec_owner_${suffix}`]
      )
    ).rows[0].id;
    cashierId = (
      await adminPool.query<{ id: string }>(
        `INSERT INTO users (username, password_hash, full_name, role)
         VALUES ($1, 'hash', 'Sec Cashier', 'CASHIER') RETURNING id`,
        [`sec_cashier_${suffix}`]
      )
    ).rows[0].id;
    custId = (
      await adminPool.query<{ id: string }>(
        `INSERT INTO customers (name, phone, location)
         VALUES ('Private Customer Co', '0771112223', 'Colombo 03') RETURNING id`
      )
    ).rows[0].id;
    matId = (
      await adminPool.query<{ id: number }>(
        `INSERT INTO materials (code, name, unit, current_unit_price)
         VALUES ($1, 'Sec Test Material', 'm³', 9500.00) RETURNING id`,
        [`SEC_${suffix}`]
      )
    ).rows[0].id;

    const appUrl = new URL(TEST_URL);
    appUrl.username = "npr_app_user";
    appUrl.password = process.env.TEST_APP_USER_PASSWORD ?? "test_only_app_password_2b2";
    appUserPool = new Pool({ connectionString: appUrl.toString(), max: 4 });
  });

  after(async () => {
    await appUserPool?.end();
    await adminPool.end();
  });

  it("1, 2 & 3. Blocks anon and authenticated roles from all private tables, views, sequences, and pgmigrations", async () => {
    for (const roleName of ["anon", "authenticated"]) {
      const roleCheck = await adminPool.query(
        "SELECT 1 FROM pg_roles WHERE rolname = $1",
        [roleName]
      );
      assert.equal(roleCheck.rows.length, 1, `Test environment requires ${roleName} role`);

      const client = await adminPool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`SET LOCAL ROLE ${roleName}`);

        const restrictedObjects = [
          "users",
          "user_sessions",
          "customers",
          "materials",
          "material_price_history",
          "invoices",
          "invoice_items",
          "payments",
          "payment_adjustments",
          "credit_notes",
          "idempotency_records",
          "audit_logs",
          "pgmigrations",
          "invoice_ledger_view",
          "daily_cash_reconciliation_view",
          "cashier_shift_reconciliation_view",
          "customer_balances_view",
        ];

        for (const obj of restrictedObjects) {
          await assert.rejects(
            async () => {
              await client.query(`SAVEPOINT sp_${obj}`);
              try {
                await client.query(`SELECT * FROM public.${obj} LIMIT 1`);
              } catch (err) {
                await client.query(`ROLLBACK TO SAVEPOINT sp_${obj}`);
                throw err;
              }
            },
            /permission denied/i,
            `${roleName} must be denied SELECT on ${obj}`
          );
        }

        // Sequence access denied
        await assert.rejects(
          async () => {
            await client.query("SAVEPOINT sp_seq");
            try {
              await client.query("SELECT nextval('public.invoice_number_seq')");
            } catch (err) {
              await client.query("ROLLBACK TO SAVEPOINT sp_seq");
              throw err;
            }
          },
          /permission denied/i
        );

        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
    }
  });

  it("4. Denies function EXECUTE privileges on application functions and validates minimal SECURITY DEFINER", async () => {
    const funcs = [
      "set_updated_at",
      "forbid_append_only_mutation",
      "enforce_price_history_owner",
      "enforce_invoice_before_insert",
      "enforce_invoice_before_update",
      "forbid_invoice_delete",
      "verify_invoice_finalized_on_commit",
      "enforce_invoice_item_immutability",
      "enforce_payment_insert_bounds",
      "enforce_payment_adjustment_bounds",
      "enforce_credit_note_bounds",
      "verify_credit_note_resolution_on_commit",
    ];

    for (const fn of funcs) {
      const priv = await adminPool.query<{
        anon_exec: boolean;
        auth_exec: boolean;
        pub_exec: boolean;
      }>(
        `SELECT
           has_function_privilege('anon', $1 || '()', 'EXECUTE') AS anon_exec,
           has_function_privilege('authenticated', $1 || '()', 'EXECUTE') AS auth_exec,
           has_function_privilege('public', $1 || '()', 'EXECUTE') AS pub_exec`,
        [`public.${fn}`]
      );
      assert.equal(priv.rows[0].anon_exec, false, `anon must not execute ${fn}`);
      assert.equal(priv.rows[0].auth_exec, false, `authenticated must not execute ${fn}`);
      assert.equal(priv.rows[0].pub_exec, false, `PUBLIC must not execute ${fn}`);

      const appExec = await adminPool.query<{ exec: boolean }>(
        "SELECT has_function_privilege('npr_app_user', $1 || '()', 'EXECUTE') AS exec",
        [`public.${fn}`]
      );
      assert.equal(appExec.rows[0].exec, false, `npr_app_user must not directly execute ${fn}`);
    }

    // Strictly ONLY enforce_payment_adjustment_bounds uses SECURITY DEFINER, with locked search_path
    const secDefRes = await adminPool.query<{
      proname: string;
      prosecdef: boolean;
      proconfig: string[] | null;
      owner_name: string;
    }>(
      `SELECT p.proname, p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) AS owner_name
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = ANY($1::text[])
       ORDER BY p.proname`,
      [funcs]
    );
    assert.equal(secDefRes.rows.length, funcs.length);
    for (const row of secDefRes.rows) {
      assert.notEqual(row.owner_name, "npr_app_user", `${row.proname} must not be owned by npr_app_user`);
      if (row.proname === "enforce_payment_adjustment_bounds") {
        assert.equal(row.prosecdef, true, "enforce_payment_adjustment_bounds must be SECURITY DEFINER");
        assert.ok(
          row.proconfig?.some((c) => c === "search_path=pg_catalog, pg_temp"),
          `Expected search_path=pg_catalog, pg_temp on enforce_payment_adjustment_bounds, got ${JSON.stringify(row.proconfig)}`
        );
      } else {
        assert.equal(row.prosecdef, false, `${row.proname} must remain SECURITY INVOKER`);
      }
    }
  });

  it("11. Confirms RLS is enabled on all 13 tables, security_invoker=true on all 4 views, and npr_app_user least-privilege attributes & ownership", async () => {
    const rlsRes = await adminPool.query<{ relname: string; relrowsecurity: boolean }>(
      `SELECT c.relname, c.relrowsecurity
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
       ORDER BY c.relname`
    );
    assert.ok(rlsRes.rows.length >= 13);
    for (const row of rlsRes.rows) {
      assert.equal(row.relrowsecurity, true, `RLS must be enabled on table ${row.relname}`);
    }

    const viewRes = await adminPool.query<{ relname: string; reloptions: string[] | null }>(
      `SELECT c.relname, c.reloptions
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'v'`
    );
    assert.equal(viewRes.rows.length, 4);
    for (const row of viewRes.rows) {
      assert.ok(
        row.reloptions?.includes("security_invoker=true"),
        `View ${row.relname} must have security_invoker=true`
      );
    }

    const roleFlags = await adminPool.query<{
      oid: number;
      rolcanlogin: boolean;
      rolsuper: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolreplication: boolean;
      rolbypassrls: boolean;
    }>(
      `SELECT oid, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
       FROM pg_roles WHERE rolname = 'npr_app_user'`
    );
    assert.equal(roleFlags.rows.length, 1);
    const rf = roleFlags.rows[0];
    assert.equal(rf.rolcanlogin, true);
    assert.equal(rf.rolsuper, false);
    assert.equal(rf.rolcreatedb, false);
    assert.equal(rf.rolcreaterole, false);
    assert.equal(rf.rolreplication, false);
    assert.equal(rf.rolbypassrls, false);

    // Zero role memberships & zero owned objects in public
    const memCount = await adminPool.query<{ cnt: number }>(
      "SELECT COUNT(*)::int AS cnt FROM pg_auth_members WHERE member = $1",
      [rf.oid]
    );
    assert.equal(memCount.rows[0].cnt, 0, "npr_app_user must hold zero role memberships");

    const ownedCount = await adminPool.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relowner = $1`,
      [rf.oid]
    );
    assert.equal(ownedCount.rows[0].cnt, 0, "npr_app_user must own zero relations in public");

    // Verify no schema CREATE grant and no excess table/sequence privileges
    const createPriv = await adminPool.query<{ has_create: boolean }>(
      "SELECT has_schema_privilege('npr_app_user', 'public', 'CREATE') AS has_create"
    );
    assert.equal(createPriv.rows[0].has_create, false, "npr_app_user must NOT have CREATE on schema public");

    const dangerousGrants = await adminPool.query<{ table_name: string; privilege_type: string }>(
      `SELECT table_name, privilege_type
       FROM information_schema.role_table_grants
       WHERE grantee = 'npr_app_user' AND table_schema = 'public'
         AND privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER')`
    );
    assert.equal(dangerousGrants.rows.length, 0);

    const deleteGrants = await adminPool.query<{ table_name: string }>(
      `SELECT DISTINCT table_name
       FROM information_schema.role_table_grants
       WHERE grantee = 'npr_app_user' AND table_schema = 'public' AND privilege_type = 'DELETE'
       ORDER BY table_name`
    );
    assert.deepEqual(
      deleteGrants.rows.map((r) => r.table_name),
      ["idempotency_records", "user_sessions"],
      "DELETE must only be granted on user_sessions and idempotency_records"
    );

    const matSeqPriv = await adminPool.query<{ u: boolean }>(
      "SELECT has_sequence_privilege('npr_app_user', 'public.materials_id_seq', 'USAGE') AS u"
    );
    assert.equal(matSeqPriv.rows[0].u, false, "npr_app_user must not have USAGE on materials_id_seq");
  });

  it("5, 6, 7, 8, 9 & 10. npr_app_user executes full backend workflows under NOBYPASSRLS while DDL, trigger bypass, and forbidden mutations remain blocked", async () => {
    assert.ok(appUserPool);

    // Repeated execution of provisioning policy helper is safe & idempotent
    const policySql = await readFile(POLICY_SCRIPT_PATH, "utf8");
    await adminPool.query(policySql);

    // DDL, trigger disable, and replication-role trigger bypass MUST fail
    await assert.rejects(
      () => appUserPool!.query("ALTER TABLE invoices DISABLE TRIGGER ALL"),
      /must be owner of table invoices|permission denied/i
    );
    await assert.rejects(
      () => appUserPool!.query("ALTER TABLE invoices ADD COLUMN evil_col TEXT"),
      /must be owner of table invoices|permission denied/i
    );
    await assert.rejects(
      () => appUserPool!.query("SET session_replication_role = 'replica'"),
      /permission denied to set parameter "session_replication_role"/i
    );

    // Sequence tampering blocked
    await assert.rejects(
      () => appUserPool!.query("SELECT setval('public.invoice_number_seq', 1)"),
      /permission denied for sequence invoice_number_seq/i
    );
    await assert.rejects(
      () => appUserPool!.query("SELECT nextval('public.materials_id_seq')"),
      /permission denied for sequence materials_id_seq/i
    );

    // Session create, sliding expires_at update, and revocation (including active session delete) succeed;
    // mutating user_id / token_hash fails
    const sHash = sha256(randomUUID());
    await appUserPool!.query(
      "INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 hour')",
      [sHash, cashierId]
    );
    await appUserPool!.query(
      "UPDATE user_sessions SET expires_at = NOW() + INTERVAL '2 hours' WHERE token_hash = $1",
      [sHash]
    );
    await assert.rejects(
      () => appUserPool!.query("UPDATE user_sessions SET user_id = $1 WHERE token_hash = $2", [ownerId, sHash]),
      /permission denied for table user_sessions/i
    );
    await assert.rejects(
      () => appUserPool!.query("UPDATE user_sessions SET token_hash = $1 WHERE token_hash = $2", [sha256("tamper"), sHash]),
      /permission denied for table user_sessions/i
    );
    const rev = await appUserPool!.query("DELETE FROM user_sessions WHERE token_hash = $1", [sHash]);
    assert.equal(rev.rowCount, 1);

    // Materials price read & owner update blocked for INSERT
    const matRead = await appUserPool!.query<{ current_unit_price: string }>(
      "SELECT current_unit_price FROM materials WHERE id = $1",
      [matId]
    );
    assert.equal(matRead.rows[0].current_unit_price, "9500.00");
    await assert.rejects(
      () =>
        appUserPool!.query(
          "INSERT INTO materials (code, name, unit, current_unit_price) VALUES ('UNAUTH', 'Unauth', 'm³', 100.00)"
        ),
      /permission denied for table materials/i
    );

    // Invoice creation, finalization & append-only payment under RLS
    // Direct ISSUED insert rejected by RLS
    await assert.rejects(
      () =>
        appUserPool!.query(
          `INSERT INTO invoices (
             customer_id, customer_name_snapshot, customer_phone_snapshot, customer_location_snapshot,
             has_transport, transport_fee, subtotal, grand_total, status, issued_by_user_id, issued_at
           ) VALUES ($1, 'Bypass Co', '0771112223', 'Colombo', false, 0.00, 0.00, 0.00, 'ISSUED', $2, NOW())`,
          [custId, cashierId]
        ),
      /violates row-level security policy|DRAFT status/i
    );

    const c = await appUserPool!.connect();
    let invId = "";
    let payId = "";
    try {
      await c.query("BEGIN");
      const draft = await c.query<{ id: string }>(
        `INSERT INTO invoices (
           customer_id, customer_name_snapshot, customer_phone_snapshot, customer_location_snapshot,
           has_transport, transport_fee, subtotal, grand_total, issued_by_user_id
         ) VALUES ($1, 'Private Customer Co', '0771112223', 'Colombo 03', false, 0.00, 0.00, 0.00, $2) RETURNING id`,
        [custId, cashierId]
      );
      invId = draft.rows[0].id;
      await c.query(
        `INSERT INTO invoice_items (invoice_id, material_id, material_name_snapshot, quantity, unit_price, line_total)
         VALUES ($1, $2, 'Sec Test Material', 2.000, 9500.00, 19000.00)`,
        [invId, matId]
      );
      await c.query(
        "UPDATE invoices SET subtotal = 19000.00, grand_total = 19000.00, status = 'ISSUED' WHERE id = $1",
        [invId]
      );
      const p = await c.query<{ id: string }>(
        "INSERT INTO payments (invoice_id, cashier_user_id, amount, idempotency_key) VALUES ($1, $2, 10000.00, $3) RETURNING id",
        [invId, cashierId, randomUUID()]
      );
      payId = p.rows[0].id;
      await c.query("COMMIT");
    } finally {
      c.release();
    }

    // All 4 reporting views with security_invoker=true succeed for npr_app_user
    const ledger = await appUserPool!.query<{ balance_due: string }>(
      "SELECT balance_due FROM invoice_ledger_view WHERE invoice_id = $1",
      [invId]
    );
    assert.equal(ledger.rows[0].balance_due, "9000.00");

    const dailyView = await appUserPool!.query(
      "SELECT business_date, gross_recorded_receipts FROM daily_cash_reconciliation_view LIMIT 1"
    );
    assert.ok(dailyView.rows.length >= 1);

    const shiftView = await appUserPool!.query(
      "SELECT user_id, gross_recorded_receipts FROM cashier_shift_reconciliation_view WHERE user_id = $1",
      [cashierId]
    );
    assert.ok(shiftView.rows.length >= 1);

    const custView = await appUserPool!.query(
      "SELECT outstanding_balance FROM customer_balances_view WHERE customer_id = $1",
      [custId]
    );
    assert.equal(custView.rows.length, 1);

    // pgmigrations history completely inaccessible
    for (const badMigSql of [
      "SELECT * FROM public.pgmigrations",
      "INSERT INTO public.pgmigrations (name, run_on) VALUES ('999_fake', NOW())",
      "UPDATE public.pgmigrations SET name = 'tamper'",
      "DELETE FROM public.pgmigrations",
      "TRUNCATE public.pgmigrations",
    ]) {
      await assert.rejects(
        () => appUserPool!.query(badMigSql),
        /permission denied/i,
        `npr_app_user must be denied: ${badMigSql}`
      );
    }

    // Forbidden UPDATE/DELETE across protected financial & identity tables
    for (const forbiddenStmt of [
      { sql: "UPDATE payments SET amount = 1.00 WHERE id = $1", params: [payId] },
      { sql: "DELETE FROM payments WHERE id = $1", params: [payId] },
      { sql: "DELETE FROM invoices WHERE id = $1", params: [invId] },
      { sql: "UPDATE invoices SET customer_name_snapshot = 'Tamper' WHERE id = $1", params: [invId] },
      { sql: "DELETE FROM invoice_items WHERE invoice_id = $1", params: [invId] },
      { sql: "UPDATE invoice_items SET quantity = 99 WHERE invoice_id = $1", params: [invId] },
      { sql: "UPDATE users SET role = 'OWNER' WHERE id = $1", params: [cashierId] },
      { sql: "DELETE FROM users WHERE id = $1", params: [cashierId] },
      { sql: "DELETE FROM customers WHERE id = $1", params: [custId] },
      { sql: "DELETE FROM credit_notes", params: [] },
      { sql: "DELETE FROM payment_adjustments", params: [] },
      { sql: "DELETE FROM material_price_history", params: [] },
      { sql: "DELETE FROM audit_logs", params: [] },
    ]) {
      await assert.rejects(
        () => appUserPool!.query(forbiddenStmt.sql, forbiddenStmt.params),
        /permission denied|append-only|immutable|cannot be deleted/i,
        `Expected rejection for: ${forbiddenStmt.sql}`
      );
    }

    // Active unexpired idempotency record DELETE blocked by RLS
    const activeKey = randomUUID();
    await appUserPool!.query(
      `INSERT INTO idempotency_records (idempotency_key, operation_type, request_hash, actor_user_id, response_status, response_payload)
       VALUES ($1, 'RECORD_PAYMENT', $2, $3, 201, '{}'::jsonb)`,
      [activeKey, sha256({ k: activeKey }), cashierId]
    );
    const delActive = await appUserPool!.query(
      "DELETE FROM idempotency_records WHERE idempotency_key = $1",
      [activeKey]
    );
    assert.equal(delActive.rowCount, 0, "RLS policy must prevent deleting active unexpired idempotency keys");

    // Owner checks enforced by BOTH RLS policy AND triggers on payment_adjustments & credit_notes
    await assert.rejects(
      () =>
        appUserPool!.query(
          `INSERT INTO payment_adjustments
             (payment_id, authorized_by_owner_id, performed_by_user_id, adjustment_type, adjustment_amount, idempotency_key, reason)
           VALUES ($1, $2, $3, 'ENTRY_REVERSAL', 1000.00, $4, 'Cashier should be rejected by RLS and trigger')`,
          [payId, cashierId, cashierId, randomUUID()]
        ),
      /violates row-level security policy|Only active OWNER/i
    );

    // Authorized owner adjustment succeeds
    await appUserPool!.query(
      `INSERT INTO payment_adjustments
         (payment_id, authorized_by_owner_id, performed_by_user_id, adjustment_type, adjustment_amount, idempotency_key, reason)
       VALUES ($1, $2, $3, 'ENTRY_REVERSAL', 1000.00, $4, 'Owner authorized entry adjustment under RLS')`,
      [payId, ownerId, ownerId, randomUUID()]
    );

    // Authorized owner full credit note + invoice cancellation works under npr_app_user
    await assert.rejects(
      () =>
        appUserPool!.query(
          `INSERT INTO credit_notes (invoice_id, authorized_by_owner_id, credit_amount, excess_cash_resolution, idempotency_key, reason)
           VALUES ($1, $2, 19000.00, 'PENDING_CUSTOMER_REFUND', $3, 'Cashier credit note blocked')`,
          [invId, cashierId, randomUUID()]
        ),
      /violates row-level security policy|Only active OWNER/i
    );

    const cancelClient = await appUserPool!.connect();
    try {
      await cancelClient.query("BEGIN");
      await cancelClient.query(
        `INSERT INTO credit_notes (invoice_id, authorized_by_owner_id, credit_amount, excess_cash_resolution, idempotency_key, reason)
         VALUES ($1, $2, 19000.00, 'PENDING_CUSTOMER_REFUND', $3, 'Owner approved cancellation credit note')`,
        [invId, ownerId, randomUUID()]
      );
      await cancelClient.query(
        "UPDATE invoices SET status = 'CANCELLED' WHERE id = $1",
        [invId]
      );
      await cancelClient.query("COMMIT");
    } finally {
      cancelClient.release();
    }
  });

  it("12 & 19. Future objects do not expose to anon/authenticated and unrelated private schemas deny npr_app_user", async () => {
    const probeSuffix = randomUUID().slice(0, 6);
    const tbl = `future_probe_${probeSuffix}`;
    const vw = `future_probe_view_${probeSuffix}`;
    const extSchema = `auth_sim_${probeSuffix}`;

    await adminPool.query(`CREATE TABLE public.${tbl} (id INT PRIMARY KEY, secret TEXT)`);
    await adminPool.query(`CREATE VIEW public.${vw} AS SELECT id, secret FROM public.${tbl}`);
    await adminPool.query(`CREATE SCHEMA ${extSchema}`);
    await adminPool.query(`REVOKE ALL ON SCHEMA ${extSchema} FROM PUBLIC`);
    await adminPool.query(`CREATE TABLE ${extSchema}.internal_secrets (id INT PRIMARY KEY)`);

    try {
      // Unrelated private schema denied for npr_app_user
      const schemaPriv = await adminPool.query<{ can_use: boolean }>(
        "SELECT has_schema_privilege('npr_app_user', $1, 'USAGE') AS can_use",
        [extSchema]
      );
      assert.equal(schemaPriv.rows[0].can_use, false);
      await assert.rejects(
        () => appUserPool!.query(`SELECT * FROM ${extSchema}.internal_secrets`),
        /permission denied for schema/i
      );

      for (const roleName of ["anon", "authenticated"]) {
        const client = await adminPool.connect();
        try {
          await client.query("BEGIN");
          await client.query(`SET LOCAL ROLE ${roleName}`);
          await assert.rejects(
            async () => {
              await client.query("SAVEPOINT sp_ftbl");
              try {
                await client.query(`SELECT * FROM public.${tbl}`);
              } catch (err) {
                await client.query("ROLLBACK TO SAVEPOINT sp_ftbl");
                throw err;
              }
            },
            /permission denied/i,
            `${roleName} must not have access to future table ${tbl}`
          );
          await assert.rejects(
            async () => {
              await client.query("SAVEPOINT sp_fvw");
              try {
                await client.query(`SELECT * FROM public.${vw}`);
              } catch (err) {
                await client.query("ROLLBACK TO SAVEPOINT sp_fvw");
                throw err;
              }
            },
            /permission denied/i,
            `${roleName} must not have access to future view ${vw}`
          );
          await client.query("ROLLBACK");
        } finally {
          client.release();
        }
      }
    } finally {
      await adminPool.query(`DROP SCHEMA IF EXISTS ${extSchema} CASCADE`);
      await adminPool.query(`DROP VIEW IF EXISTS public.${vw}`);
      await adminPool.query(`DROP TABLE IF EXISTS public.${tbl}`);
    }
  });
});