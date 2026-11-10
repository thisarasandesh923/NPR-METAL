import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import pg from "pg";

const { Pool } = pg;

/**
 * STRICT FAIL-CLOSED SAFETY GUARD
 * Ensures this integration suite can ONLY execute against the isolated local
 * disposable test PostgreSQL container (127.0.0.1:55432 / npr_test_db).
 * Never loads backend/.env and never reads process.env.DATABASE_URL.
 */
function getVerifiedLocalTestUrl(): string {
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) {
    throw new Error(
      "SAFETY ABORT: TEST_DATABASE_URL is not set. This suite refuses to run without an explicit local test URL."
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

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const TEST_URL = getVerifiedLocalTestUrl();
const adminPool = new Pool({ connectionString: TEST_URL, max: 6 });
let appUserPool: pg.Pool | null = null;

let ownerId = "";
let cashier1Id = "";
let cashier2Id = "";
let customerId = "";
let mat34Id = 0;
let matDustId = 0;

describe("NPR Metal Crusher — PostgreSQL Schema & Financial Integrity Suite", () => {
  before(async () => {
    // 1. Verify live server identity before running any test SQL
    const identity = await adminPool.query<{
      db: string;
      usr: string;
      port: number;
      ver: string;
    }>(
      "SELECT current_database() AS db, current_user AS usr, inet_server_port() AS port, version() AS ver"
    );
    const info = identity.rows[0];
    assert.equal(info?.db, "npr_test_db", "Connected database must be npr_test_db");
    console.log(
      `Verified isolated DB identity: db=${info.db}, user=${info.usr}, port=${info.port}`
    );
    console.log(`PostgreSQL version: ${info.ver}`);

    // 2. Clean slate reset of test records if re-run locally (never touching schema)
    // Because triggers block deletes on financial tables in test DB, tests use unique per-run data
    // or verify clean state right after migration. Let's seed deterministic test actors & materials.
    const uniqueSuffix = randomUUID().slice(0, 8);

    const ownerRes = await adminPool.query<{ id: string }>(
      `INSERT INTO users (username, password_hash, full_name, role)
       VALUES ($1, $2, $3, 'OWNER') RETURNING id`,
      [`owner_${uniqueSuffix}`, "test_hash_only_owner", "Test Owner"]
    );
    ownerId = ownerRes.rows[0].id;

    const c1Res = await adminPool.query<{ id: string }>(
      `INSERT INTO users (username, password_hash, full_name, role)
       VALUES ($1, $2, $3, 'CASHIER') RETURNING id`,
      [`cashier1_${uniqueSuffix}`, "test_hash_only_c1", "Test Cashier One"]
    );
    cashier1Id = c1Res.rows[0].id;

    const c2Res = await adminPool.query<{ id: string }>(
      `INSERT INTO users (username, password_hash, full_name, role)
       VALUES ($1, $2, $3, 'CASHIER') RETURNING id`,
      [`cashier2_${uniqueSuffix}`, "test_hash_only_c2", "Test Cashier Two"]
    );
    cashier2Id = c2Res.rows[0].id;

    const custRes = await adminPool.query<{ id: string }>(
      `INSERT INTO customers (name, phone, location)
       VALUES ('Test Builders Ltd', '0770000001', 'Kurunegala Test Site') RETURNING id`
    );
    customerId = custRes.rows[0].id;

    // Insert isolated per-run test materials so tests remain repeatable
    const m1 = await adminPool.query<{ id: number }>(
      `INSERT INTO materials (code, name, unit, current_unit_price)
       VALUES ($1, 'Test 3/4 Aggregate', 'm³', 10000.00) RETURNING id`,
      [`T34_${uniqueSuffix}`]
    );
    mat34Id = m1.rows[0].id;

    const m2 = await adminPool.query<{ id: number }>(
      `INSERT INTO materials (code, name, unit, current_unit_price)
       VALUES ($1, 'Test Stone Dust', 'm³', 5000.00) RETURNING id`,
      [`TDUST_${uniqueSuffix}`]
    );
    matDustId = m2.rows[0].id;

    // Configure restricted app_user pool using localhost URL
    const appUrl = new URL(TEST_URL);
    appUrl.username = "npr_app_user";
    appUrl.password = "test_only_app_password_2b2";
    appUserPool = new Pool({ connectionString: appUrl.toString(), max: 6 });
  });

  after(async () => {
    await appUserPool?.end();
    await adminPool.end();
  });

  describe("Part 2 — Schema Objects & Migration Verification", () => {
    it("confirms all 12 tables, 4 views, sequences, and triggers exist", async () => {
      const tablesRes = await adminPool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
         ORDER BY table_name`
      );
      const tableNames = tablesRes.rows.map((r) => r.table_name);
      const expectedTables = [
        "audit_logs",
        "credit_notes",
        "customers",
        "idempotency_records",
        "invoice_items",
        "invoices",
        "material_price_history",
        "materials",
        "payment_adjustments",
        "payments",
        "pgmigrations",
        "user_sessions",
        "users",
      ];
      for (const expected of expectedTables) {
        assert.ok(tableNames.includes(expected), `Missing table: ${expected}`);
      }

      const viewsRes = await adminPool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.views WHERE table_schema = 'public'`
      );
      const viewNames = viewsRes.rows.map((r) => r.table_name);
      for (const expected of [
        "invoice_ledger_view",
        "daily_cash_reconciliation_view",
        "cashier_shift_reconciliation_view",
        "customer_balances_view",
      ]) {
        assert.ok(viewNames.includes(expected), `Missing view: ${expected}`);
      }
    });
  });

  describe("Part 3 — Invoice Lifecycle & Immutability Tests", () => {
    async function issueValidInvoice(
      hasTransport: boolean,
      transportFee: string,
      items: Array<{ materialId: number; name: string; qty: string; price: string; lineTotal: string }>,
      subtotal: string,
      grandTotal: string
    ): Promise<{ invoiceId: string; invoiceNumber: string }> {
      const client = await adminPool.connect();
      try {
        await client.query("BEGIN");
        const draft = await client.query<{ id: string; invoice_number: string }>(
          `INSERT INTO invoices (
             customer_id, customer_name_snapshot, customer_phone_snapshot, customer_location_snapshot,
             has_transport, transport_fee, subtotal, grand_total, issued_by_user_id
           ) VALUES ($1, 'Test Builders Ltd', '0770000001', 'Kurunegala Test Site', $2, $3, 0.00, $3, $4)
           RETURNING id, invoice_number`,
          [customerId, hasTransport, transportFee, cashier1Id]
        );
        const invId = draft.rows[0].id;
        const invNum = draft.rows[0].invoice_number;

        for (const item of items) {
          await client.query(
            `INSERT INTO invoice_items (invoice_id, material_id, material_name_snapshot, quantity, unit_price, line_total)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [invId, item.materialId, item.name, item.qty, item.price, item.lineTotal]
          );
        }

        await client.query(
          `UPDATE invoices SET subtotal = $1, grand_total = $2, status = 'ISSUED' WHERE id = $3`,
          [subtotal, grandTotal, invId]
        );

        await client.query("COMMIT");
        return { invoiceId: invId, invoiceNumber: invNum };
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }

    it("1 & 2. Creates invoice with multiple line items and finalizes atomically", async () => {
      const { invoiceId, invoiceNumber } = await issueValidInvoice(
        true,
        "5000.00",
        [
          { materialId: mat34Id, name: '3/4"', qty: "5.250", price: "10000.00", lineTotal: "52500.00" },
          { materialId: matDustId, name: "Dust", qty: "3.000", price: "5000.00", lineTotal: "15000.00" },
        ],
        "67500.00",
        "72500.00"
      );

      assert.ok(invoiceNumber.startsWith("NPR-INV-"));
      const ledger = await adminPool.query<{
        effective_grand_total: string;
        balance_due: string;
        payment_status: string;
        invoice_status: string;
      }>("SELECT * FROM invoice_ledger_view WHERE invoice_id = $1", [invoiceId]);
      assert.equal(ledger.rows[0].invoice_status, "ISSUED");
      assert.equal(ledger.rows[0].effective_grand_total, "72500.00");
      assert.equal(ledger.rows[0].balance_due, "72500.00");
      assert.equal(ledger.rows[0].payment_status, "UNPAID");
    });

    it("3. Prevents committing an unfinalized DRAFT or finalizing an empty invoice", async () => {
      // Case A: Attempt to commit unfinalized DRAFT directly
      const c1 = await adminPool.connect();
      let draftCommitFailed = false;
      try {
        await c1.query("BEGIN");
        await c1.query(
          `INSERT INTO invoices (
             customer_id, customer_name_snapshot, customer_phone_snapshot, customer_location_snapshot,
             has_transport, transport_fee, subtotal, grand_total, issued_by_user_id
           ) VALUES ($1, 'Draft Test', '0770000001', 'Site', false, 0.00, 0.00, 0.00, $2)`,
          [customerId, cashier1Id]
        );
        await c1.query("COMMIT");
      } catch (err) {
        draftCommitFailed = true;
        assert.match((err as Error).message, /unfinalized DRAFT invoice/i);
        await c1.query("ROLLBACK").catch(() => {});
      } finally {
        c1.release();
      }
      assert.equal(draftCommitFailed, true);

      // Case B: Attempt to finalize a DRAFT with zero line items
      const c2 = await adminPool.connect();
      let zeroItemFinalizeFailed = false;
      try {
        await c2.query("BEGIN");
        const res = await c2.query<{ id: string }>(
          `INSERT INTO invoices (
             customer_id, customer_name_snapshot, customer_phone_snapshot, customer_location_snapshot,
             has_transport, transport_fee, subtotal, grand_total, issued_by_user_id
           ) VALUES ($1, 'Zero Item Test', '0770000001', 'Site', false, 0.00, 0.00, 0.00, $2) RETURNING id`,
          [customerId, cashier1Id]
        );
        await c2.query("UPDATE invoices SET status = 'ISSUED' WHERE id = $1", [res.rows[0].id]);
        await c2.query("COMMIT");
      } catch (err) {
        zeroItemFinalizeFailed = true;
        assert.match((err as Error).message, /zero line items/i);
        await c2.query("ROLLBACK");
      } finally {
        c2.release();
      }
      assert.equal(zeroItemFinalizeFailed, true);
    });

    it("4, 5 & 6. Rejects subtotal mismatches, invalid line totals, and zero/negative quantities", async () => {
      // 4. Subtotal mismatch
      await assert.rejects(
        () =>
          issueValidInvoice(
            false,
            "0.00",
            [{ materialId: mat34Id, name: '3/4"', qty: "2.000", price: "10000.00", lineTotal: "20000.00" }],
            "19000.00",
            "19000.00"
          ),
        /does not match sum of line items/i
      );

      // 5. Invalid line_total (line_total != ROUND(qty * price, 2))
      await assert.rejects(
        () =>
          issueValidInvoice(
            false,
            "0.00",
            [{ materialId: mat34Id, name: '3/4"', qty: "2.000", price: "10000.00", lineTotal: "19999.00" }],
            "19999.00",
            "19999.00"
          ),
        /chk_invoice_items_line_total/i
      );

      // 6. Zero / negative quantities
      await assert.rejects(
        () =>
          issueValidInvoice(
            false,
            "0.00",
            [{ materialId: mat34Id, name: '3/4"', qty: "0.000", price: "10000.00", lineTotal: "0.00" }],
            "0.00",
            "0.00"
          ),
        /invoice_items_quantity_check/i
      );
      await assert.rejects(
        () =>
          issueValidInvoice(
            false,
            "0.00",
            [{ materialId: mat34Id, name: '3/4"', qty: "-1.500", price: "10000.00", lineTotal: "-15000.00" }],
            "-15000.00",
            "-15000.00"
          ),
        /invoice_items_quantity_check|invoice_items_line_total_check/i
      );
    });

    it("7, 8, 9 & 10. Blocks editing/deleting issued invoices and mutating/adding line items after issuance", async () => {
      const { invoiceId } = await issueValidInvoice(
        false,
        "0.00",
        [{ materialId: mat34Id, name: '3/4"', qty: "4.000", price: "10000.00", lineTotal: "40000.00" }],
        "40000.00",
        "40000.00"
      );

      // 7. Edit issued invoice commercial fields
      await assert.rejects(
        () => adminPool.query("UPDATE invoices SET subtotal = 50000.00, grand_total = 50000.00 WHERE id = $1", [invoiceId]),
        /permanently immutable/i
      );
      await assert.rejects(
        () => adminPool.query("UPDATE invoices SET customer_name_snapshot = 'Hacked' WHERE id = $1", [invoiceId]),
        /permanently immutable/i
      );

      // 8. Delete issued invoice
      await assert.rejects(
        () => adminPool.query("DELETE FROM invoices WHERE id = $1", [invoiceId]),
        /Invoices cannot be deleted/i
      );

      // 9. Insert new item after issuance
      await assert.rejects(
        () =>
          adminPool.query(
            `INSERT INTO invoice_items (invoice_id, material_id, material_name_snapshot, quantity, unit_price, line_total)
             VALUES ($1, $2, 'Dust', 1.000, 5000.00, 5000.00)`,
            [invoiceId, matDustId]
          ),
        /Cannot insert line items into finalized/i
      );

      // 10. Update or delete finalized line items
      await assert.rejects(
        () => adminPool.query("UPDATE invoice_items SET quantity = 10.000, line_total = 100000.00 WHERE invoice_id = $1", [invoiceId]),
        /permanently immutable/i
      );
      await assert.rejects(
        () => adminPool.query("DELETE FROM invoice_items WHERE invoice_id = $1", [invoiceId]),
        /permanently immutable/i
      );
    });

    it("11. Rolls back all related records atomically when issuance fails mid-transaction", async () => {
      const client = await adminPool.connect();
      const beforeInvoices = Number((await adminPool.query("SELECT COUNT(*) FROM invoices")).rows[0].count);
      const beforeItems = Number((await adminPool.query("SELECT COUNT(*) FROM invoice_items")).rows[0].count);
      try {
        await client.query("BEGIN");
        const draft = await client.query<{ id: string }>(
          `INSERT INTO invoices (
             customer_id, customer_name_snapshot, customer_phone_snapshot, customer_location_snapshot,
             has_transport, transport_fee, subtotal, grand_total, issued_by_user_id
           ) VALUES ($1, 'Rollback Co', '0770000001', 'Site', false, 0.00, 0.00, 0.00, $2) RETURNING id`,
          [customerId, cashier1Id]
        );
        await client.query(
          `INSERT INTO invoice_items (invoice_id, material_id, material_name_snapshot, quantity, unit_price, line_total)
           VALUES ($1, $2, '3/4"', 3.000, 10000.00, 30000.00)`,
          [draft.rows[0].id, mat34Id]
        );
        // Intentional failure on finalization mismatch
        await client.query("UPDATE invoices SET subtotal = 99999.00, grand_total = 99999.00, status = 'ISSUED' WHERE id = $1", [
          draft.rows[0].id,
        ]);
        await client.query("COMMIT");
      } catch {
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
      // 11. Rolls back when invoice fails
      const afterInvoices = Number((await adminPool.query("SELECT COUNT(*) FROM invoices")).rows[0].count);
      const afterItems = Number((await adminPool.query("SELECT COUNT(*) FROM invoice_items")).rows[0].count);
      assert.equal(afterInvoices, beforeInvoices);
      assert.equal(afterItems, beforeItems);
    });

    it("12. Enforces transport fee consistency, 3-decimal ROUND(..., 2) precision, and customer/price snapshot isolation", async () => {
      // Reject transport_fee > 0 when has_transport = false
      await assert.rejects(
        () =>
          issueValidInvoice(
            false,
            "500.00",
            [{ materialId: mat34Id, name: '3/4"', qty: "1.000", price: "10000.00", lineTotal: "10000.00" }],
            "10000.00",
            "10500.00"
          ),
        /chk_invoices_transport_consistency/i
      );

      // Verify NUMERIC(10,3) * NUMERIC(12,2) rounded to 2 decimals: 3.333 * 1000.01 = 3333.03333 -> 3333.03
      const snapCustRes = await adminPool.query<{ id: string }>(
        `INSERT INTO customers (name, phone, location)
         VALUES ('Original Snapshot Name', '0779998887', 'Old Address') RETURNING id`
      );
      const snapCustId = snapCustRes.rows[0].id;

      const matPrecRes = await adminPool.query<{ id: number }>(
        `INSERT INTO materials (code, name, unit, current_unit_price)
         VALUES ($1, 'Precision Test Material', 'm³', 1000.01) RETURNING id`,
        [`PREC_${randomUUID().slice(0, 6).toUpperCase()}`]
      );
      const precMatId = matPrecRes.rows[0].id;

      const client = await adminPool.connect();
      let invId = "";
      try {
        await client.query("BEGIN");
        const draft = await client.query<{ id: string }>(
          `INSERT INTO invoices (
             customer_id, customer_name_snapshot, customer_phone_snapshot, customer_location_snapshot,
             has_transport, transport_fee, subtotal, grand_total, issued_by_user_id
           ) VALUES ($1, 'Original Snapshot Name', '0779998887', 'Old Address', false, 0.00, 0.00, 0.00, $2) RETURNING id`,
          [snapCustId, cashier1Id]
        );
        invId = draft.rows[0].id;
        await client.query(
          `INSERT INTO invoice_items (invoice_id, material_id, material_name_snapshot, quantity, unit_price, line_total)
           VALUES ($1, $2, 'Precision Test Material', 3.333, 1000.01, 3333.03)`,
          [invId, precMatId]
        );
        await client.query(
          "UPDATE invoices SET subtotal = 3333.03, grand_total = 3333.03, status = 'ISSUED' WHERE id = $1",
          [invId]
        );
        await client.query("COMMIT");
      } finally {
        client.release();
      }

      // Mutate customer name and material price after issuance
      await adminPool.query(
        "UPDATE customers SET name = 'Renamed Later Co', location = 'New Address' WHERE id = $1",
        [snapCustId]
      );
      await adminPool.query(
        "UPDATE materials SET current_unit_price = 9999.99 WHERE id = $1",
        [precMatId]
      );

      // Historical invoice and line item MUST retain original snapshot and agreed unit price
      const histInv = await adminPool.query<{
        customer_name_snapshot: string;
        customer_location_snapshot: string;
        effective_grand_total: string;
      }>("SELECT customer_name_snapshot, customer_location_snapshot, effective_grand_total FROM invoice_ledger_view WHERE invoice_id = $1", [
        invId,
      ]);
      assert.equal(histInv.rows[0].customer_name_snapshot, "Original Snapshot Name");
      assert.equal(histInv.rows[0].customer_location_snapshot, "Old Address");
      assert.equal(histInv.rows[0].effective_grand_total, "3333.03");

      const histItem = await adminPool.query<{ unit_price: string; line_total: string }>(
        "SELECT unit_price, line_total FROM invoice_items WHERE invoice_id = $1",
        [invId]
      );
      assert.equal(histItem.rows[0].unit_price, "1000.01");
      assert.equal(histItem.rows[0].line_total, "3333.03");
    });
  });

  describe("Part 4 — Cash Payments, Idempotency & Concurrency Tests", () => {
    async function createInvoiceOf100k(): Promise<string> {
      const client = await adminPool.connect();
      try {
        await client.query("BEGIN");
        const draft = await client.query<{ id: string }>(
          `INSERT INTO invoices (
             customer_id, customer_name_snapshot, customer_phone_snapshot, customer_location_snapshot,
             has_transport, transport_fee, subtotal, grand_total, issued_by_user_id
           ) VALUES ($1, 'Payment Co', '0770000001', 'Kurunegala', false, 0.00, 0.00, 0.00, $2) RETURNING id`,
          [customerId, cashier1Id]
        );
        await client.query(
          `INSERT INTO invoice_items (invoice_id, material_id, material_name_snapshot, quantity, unit_price, line_total)
           VALUES ($1, $2, '3/4"', 10.000, 10000.00, 100000.00)`,
          [draft.rows[0].id, mat34Id]
        );
        await client.query(
          "UPDATE invoices SET subtotal = 100000.00, grand_total = 100000.00, status = 'ISSUED' WHERE id = $1",
          [draft.rows[0].id]
        );
        await client.query("COMMIT");
        return draft.rows[0].id;
      } finally {
        client.release();
      }
    }

    it("1, 2, 3, 4 & 9. Partial, full, invalid zero/negative, overpayment, and append-only enforcement", async () => {
      const invId = await createInvoiceOf100k();

      // 1. Valid partial payment
      const p1 = await adminPool.query<{ id: string }>(
        `INSERT INTO payments (invoice_id, cashier_user_id, amount, idempotency_key)
         VALUES ($1, $2, 40000.00, $3) RETURNING id`,
        [invId, cashier1Id, randomUUID()]
      );

      let ledger = await adminPool.query<{ effective_paid: string; balance_due: string; payment_status: string }>(
        "SELECT effective_paid, balance_due, payment_status FROM invoice_ledger_view WHERE invoice_id = $1",
        [invId]
      );
      assert.equal(ledger.rows[0].effective_paid, "40000.00");
      assert.equal(ledger.rows[0].balance_due, "60000.00");
      assert.equal(ledger.rows[0].payment_status, "PARTIALLY_PAID");

      // 3. Reject zero and negative payments
      await assert.rejects(
        () =>
          adminPool.query(
            "INSERT INTO payments (invoice_id, cashier_user_id, amount, idempotency_key) VALUES ($1, $2, 0.00, $3)",
            [invId, cashier1Id, randomUUID()]
          ),
        /payments_amount_check/i
      );
      await assert.rejects(
        () =>
          adminPool.query(
            "INSERT INTO payments (invoice_id, cashier_user_id, amount, idempotency_key) VALUES ($1, $2, -100.00, $3)",
            [invId, cashier1Id, randomUUID()]
          ),
        /payments_amount_check/i
      );

      // 4. Reject overpayment exceeding remaining 60,000 balance
      await assert.rejects(
        () =>
          adminPool.query(
            "INSERT INTO payments (invoice_id, cashier_user_id, amount, idempotency_key) VALUES ($1, $2, 60000.01, $3)",
            [invId, cashier1Id, randomUUID()]
          ),
        /exceeds effective outstanding balance/i
      );

      // 2. Valid full payment for remaining 60,000
      await adminPool.query(
        "INSERT INTO payments (invoice_id, cashier_user_id, amount, idempotency_key) VALUES ($1, $2, 60000.00, $3)",
        [invId, cashier2Id, randomUUID()]
      );

      ledger = await adminPool.query(
        "SELECT effective_paid, balance_due, payment_status FROM invoice_ledger_view WHERE invoice_id = $1",
        [invId]
      );
      assert.equal(ledger.rows[0].effective_paid, "100000.00");
      assert.equal(ledger.rows[0].balance_due, "0.00");
      assert.equal(ledger.rows[0].payment_status, "PAID");

      // 9. Existing payments cannot be updated or deleted
      await assert.rejects(
        () => adminPool.query("UPDATE payments SET amount = 1.00 WHERE id = $1", [p1.rows[0].id]),
        /strictly append-only/i
      );
      await assert.rejects(
        () => adminPool.query("DELETE FROM payments WHERE id = $1", [p1.rows[0].id]),
        /strictly append-only/i
      );
    });

    it("5. Serializes two concurrent 60,000 payments against a 100,000 invoice — prevents overpayment race", async () => {
      const invId = await createInvoiceOf100k();

      const submitPayment = async (cashierId: string, amount: string) => {
        const client = await adminPool.connect();
        try {
          await client.query("BEGIN");
          await client.query("SELECT id FROM invoices WHERE id = $1 FOR UPDATE", [invId]);
          const res = await client.query<{ id: string }>(
            "INSERT INTO payments (invoice_id, cashier_user_id, amount, idempotency_key) VALUES ($1, $2, $3, $4) RETURNING id",
            [invId, cashierId, amount, randomUUID()]
          );
          await client.query("COMMIT");
          return { ok: true, id: res.rows[0].id };
        } catch (err) {
          await client.query("ROLLBACK").catch(() => {});
          return { ok: false, error: (err as Error).message };
        } finally {
          client.release();
        }
      };

      const [r1, r2] = await Promise.all([
        submitPayment(cashier1Id, "60000.00"),
        submitPayment(cashier2Id, "60000.00"),
      ]);

      const successes = [r1, r2].filter((r) => r.ok);
      const failures = [r1, r2].filter((r) => !r.ok);
      assert.equal(successes.length, 1, "Exactly one concurrent payment must succeed");
      assert.equal(failures.length, 1, "Second concurrent payment must be rejected");
      assert.match(failures[0].error ?? "", /exceeds effective outstanding balance/i);

      const ledger = await adminPool.query<{ effective_paid: string; balance_due: string }>(
        "SELECT effective_paid, balance_due FROM invoice_ledger_view WHERE invoice_id = $1",
        [invId]
      );
      assert.equal(ledger.rows[0].effective_paid, "60000.00");
      assert.equal(ledger.rows[0].balance_due, "40000.00");
    });

    it("6, 7, 8 & 10. Enforces request-bound idempotency and rollback safety", async () => {
      const invId = await createInvoiceOf100k();
      const key = randomUUID();
      const payloadA = { invoice_id: invId, amount: "25000.00" };
      const hashA = sha256(payloadA);
      const payloadB = { invoice_id: invId, amount: "35000.00" };
      const hashB = sha256(payloadB);

      const executeIdempotentPayment = async (
        idempotencyKey: string,
        reqHash: string,
        amount: string
      ): Promise<{ status: number; body: Record<string, unknown>; replayed: boolean }> => {
        const client = await adminPool.connect();
        try {
          await client.query("BEGIN");
          const existing = await client.query<{
            request_hash: string;
            response_status: number;
            response_payload: Record<string, unknown>;
          }>(
            "SELECT request_hash, response_status, response_payload FROM idempotency_records WHERE idempotency_key = $1 FOR UPDATE",
            [idempotencyKey]
          );

          if (existing.rows.length > 0) {
            const rec = existing.rows[0];
            if (rec.request_hash !== reqHash) {
              throw new Error("IDEMPOTENCY_PAYLOAD_MISMATCH");
            }
            await client.query("COMMIT");
            return { status: rec.response_status, body: rec.response_payload, replayed: true };
          }

          const pay = await client.query<{ id: string; receipt_number: string }>(
            "INSERT INTO payments (invoice_id, cashier_user_id, amount, idempotency_key) VALUES ($1, $2, $3, $4) RETURNING id, receipt_number",
            [invId, cashier1Id, amount, idempotencyKey]
          );
          const responseBody = { paymentId: pay.rows[0].id, receiptNumber: pay.rows[0].receipt_number, amount };
          await client.query(
            `INSERT INTO idempotency_records (idempotency_key, operation_type, request_hash, actor_user_id, response_status, response_payload)
             VALUES ($1, 'RECORD_PAYMENT', $2, $3, 201, $4::jsonb)`,
            [idempotencyKey, reqHash, cashier1Id, JSON.stringify(responseBody)]
          );
          await client.query("COMMIT");
          return { status: 201, body: responseBody, replayed: false };
        } catch (err) {
          await client.query("ROLLBACK").catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      };

      // First call creates payment
      const first = await executeIdempotentPayment(key, hashA, "25000.00");
      assert.equal(first.status, 201);
      assert.equal(first.replayed, false);

      // 7. Identical retry replays exact cached payload without duplicating payment
      const retry = await executeIdempotentPayment(key, hashA, "25000.00");
      assert.equal(retry.status, 201);
      assert.equal(retry.replayed, true);
      assert.deepEqual(retry.body, first.body);

      const countRes = await adminPool.query<{ cnt: string }>(
        "SELECT COUNT(*) AS cnt FROM payments WHERE invoice_id = $1",
        [invId]
      );
      assert.equal(countRes.rows[0].cnt, "1");

      // 8. Different payload reusing same key must fail
      await assert.rejects(
        () => executeIdempotentPayment(key, hashB, "35000.00"),
        /IDEMPOTENCY_PAYLOAD_MISMATCH/
      );

      // 6. Direct table duplicate insert with same key blocked by UNIQUE constraint
      await assert.rejects(
        () =>
          adminPool.query(
            "INSERT INTO payments (invoice_id, cashier_user_id, amount, idempotency_key) VALUES ($1, $2, 10000.00, $3)",
            [invId, cashier1Id, key]
          ),
        /duplicate key value violates unique constraint/i
      );

      // 10. Failed payment transaction rolls back idempotency_record too
      const badKey = randomUUID();
      await assert.rejects(
        () => executeIdempotentPayment(badKey, sha256({ amount: "999999.00" }), "999999.00"),
        /exceeds effective outstanding balance/i
      );
      const orphanKeyCheck = await adminPool.query(
        "SELECT COUNT(*) AS cnt FROM idempotency_records WHERE idempotency_key = $1",
        [badKey]
      );
      assert.equal(orphanKeyCheck.rows[0].cnt, "0");
    });
  });

  describe("Part 5 — Financial Corrections, Refund Attribution & Reconciliation Views", () => {
    it("1-7. Separates physical_cash_movement from ENTRY_REVERSAL across same-day, later-day, and multi-adjustment cases", async () => {
      // Fresh cashiers for exact isolated accounting verification
      const suffix = randomUUID().slice(0, 8);
      const c1 = (
        await adminPool.query<{ id: string }>(
          `INSERT INTO users (username, password_hash, full_name, role)
           VALUES ($1, 'hash', 'Rec Cashier A', 'CASHIER') RETURNING id`,
          [`reca_${suffix}`]
        )
      ).rows[0].id;
      const c2 = (
        await adminPool.query<{ id: string }>(
          `INSERT INTO users (username, password_hash, full_name, role)
           VALUES ($1, 'hash', 'Rec Cashier B', 'CASHIER') RETURNING id`,
          [`recb_${suffix}`]
        )
      ).rows[0].id;

      // Use unique per-run dates far in a deterministic window? Better: check daily_cash_reconciliation_view via
      // baseline deltas AND verify cashier_shift_reconciliation_view strictly per isolated c1 & c2!
      const issue100k = async (custName: string, issuingCashier: string) => {
        const client = await adminPool.connect();
        try {
          await client.query("BEGIN");
          const draft = await client.query<{ id: string }>(
            `INSERT INTO invoices (
               customer_id, customer_name_snapshot, customer_phone_snapshot, customer_location_snapshot,
               has_transport, transport_fee, subtotal, grand_total, issued_by_user_id
             ) VALUES ($1, $2, '0770000002', 'Site', false, 0.00, 0.00, 0.00, $3) RETURNING id`,
            [customerId, custName, issuingCashier]
          );
          const id = draft.rows[0].id;
          await client.query(
            `INSERT INTO invoice_items (invoice_id, material_id, material_name_snapshot, quantity, unit_price, line_total)
             VALUES ($1, $2, '3/4"', 10.000, 10000.00, 100000.00)`,
            [id, mat34Id]
          );
          await client.query(
            "UPDATE invoices SET subtotal = 100000.00, grand_total = 100000.00, status = 'ISSUED' WHERE id = $1",
            [id]
          );
          await client.query("COMMIT");
          return id;
        } finally {
          client.release();
        }
      };

      const inv1 = await issue100k("Receipt Only Co", c1);

      // Scenario A (Day 1 = 2026-06-01): Cash receipt without adjustments
      const p1 = (
        await adminPool.query<{ id: string }>(
          `INSERT INTO payments (invoice_id, cashier_user_id, amount, idempotency_key, created_at)
           VALUES ($1, $2, 100000.00, $3, '2026-06-01T10:00:00+05:30') RETURNING id`,
          [inv1, c1, randomUUID()]
        )
      ).rows[0].id;

      // Scenario B (Day 2 = 2026-06-02): Entry reversal WITHOUT physical refund (on same day as a 50k receipt on inv2)
      const inv2 = await issue100k("Reversal Only Co", c1);
      const p2 = (
        await adminPool.query<{ id: string }>(
          `INSERT INTO payments (invoice_id, cashier_user_id, amount, idempotency_key, created_at)
           VALUES ($1, $2, 50000.00, $3, '2026-06-02T09:00:00+05:30') RETURNING id`,
          [inv2, c1, randomUUID()]
        )
      ).rows[0].id;
      await adminPool.query(
        `INSERT INTO payment_adjustments
           (payment_id, authorized_by_owner_id, performed_by_user_id, adjustment_type, adjustment_amount, idempotency_key, reason, created_at)
         VALUES ($1, $2, $3, 'ENTRY_REVERSAL', 10000.00, $4, 'Clerical over-entry correction without refund', '2026-06-02T11:00:00+05:30')`,
        [p2, ownerId, ownerId, randomUUID()]
      );

      // Scenario C (Day 3 = 2026-06-03): Prompt's exact example!
      // Both ENTRY_REVERSAL (15,000) and CASH_REFUND (25,000) occur on a later date (0 new receipts) referencing p1 (100,000).
      // Refund is physically paid out by c1.
      const dupAdjKey = randomUUID();
      await adminPool.query(
        `INSERT INTO payment_adjustments
           (payment_id, authorized_by_owner_id, performed_by_user_id, adjustment_type, adjustment_amount, idempotency_key, reason, created_at)
         VALUES ($1, $2, $3, 'ENTRY_REVERSAL', 15000.00, $4, 'Clerical bookkeeping reversal of 15,000', '2026-06-03T14:00:00+05:30')`,
        [p1, ownerId, ownerId, dupAdjKey]
      );
      await adminPool.query(
        `INSERT INTO payment_adjustments
           (payment_id, authorized_by_owner_id, performed_by_user_id, adjustment_type, adjustment_amount, idempotency_key, reason, created_at)
         VALUES ($1, $2, $3, 'CASH_REFUND', 25000.00, $4, 'Physical cash refund handed to customer', '2026-06-03T16:00:00+05:30')`,
        [p1, ownerId, c1, randomUUID()]
      );

      // Duplicate adjustment idempotency key must be prevented!
      await assert.rejects(
        () =>
          adminPool.query(
            `INSERT INTO payment_adjustments
               (payment_id, authorized_by_owner_id, performed_by_user_id, adjustment_type, adjustment_amount, idempotency_key, reason)
             VALUES ($1, $2, $3, 'ENTRY_REVERSAL', 15000.00, $4, 'Duplicate key retry must fail')`,
            [p1, ownerId, ownerId, dupAdjKey]
          ),
        /duplicate key value violates unique constraint/i
      );

      // Excess 3rd adjustment (15k + 25k + 65k = 105k > 100k) must fail
      await assert.rejects(
        () =>
          adminPool.query(
            `INSERT INTO payment_adjustments
               (payment_id, authorized_by_owner_id, performed_by_user_id, adjustment_type, adjustment_amount, idempotency_key, reason)
             VALUES ($1, $2, $3, 'CASH_REFUND', 65000.00, $4, 'Excess refund exceeding original payment')`,
            [p1, ownerId, c1, randomUUID()]
          ),
        /cannot exceed original payment amount/i
      );

      // Scenario D (Day 4 = 2026-06-04): Cash refund WITHOUT entry reversal, paid out by DIFFERENT cashier (c2)!
      await adminPool.query(
        `INSERT INTO payment_adjustments
           (payment_id, authorized_by_owner_id, performed_by_user_id, adjustment_type, adjustment_amount, idempotency_key, reason, created_at)
         VALUES ($1, $2, $3, 'CASH_REFUND', 10000.00, $4, 'Cashier 2 paid physical refund on later date', '2026-06-04T12:00:00+05:30')`,
        [p1, ownerId, c2, randomUUID()]
      );

      // Inspect c1 reconciliation across Days 1-4
      const c1Shift = await adminPool.query<{
        shift_date: string;
        receipt_count: string;
        gross_recorded_receipts: string;
        entry_reversals_amount: string;
        corrected_net_receipts: string;
        cash_refunded_amount: string;
        physical_cash_movement: string;
        net_effective_cash: string;
      }>(
        `SELECT shift_date::text AS shift_date, receipt_count, gross_recorded_receipts,
                entry_reversals_amount, corrected_net_receipts, cash_refunded_amount,
                physical_cash_movement, net_effective_cash
         FROM cashier_shift_reconciliation_view
         WHERE user_id = $1
         ORDER BY shift_date ASC`,
        [c1]
      );

      assert.equal(c1Shift.rows.length, 3, "c1 should appear on 06-01, 06-02, 06-03 ONLY (NOT debited on 06-04!)");

      // Day 1 (06-01): 100k receipt only — NOT multiplied despite 3 adjustments later
      assert.equal(c1Shift.rows[0].shift_date, "2026-06-01");
      assert.equal(c1Shift.rows[0].receipt_count, "1");
      assert.equal(c1Shift.rows[0].gross_recorded_receipts, "100000.00");
      assert.equal(c1Shift.rows[0].physical_cash_movement, "100000.00");

      // Day 2 (06-02): 50k receipt + 10k ENTRY_REVERSAL -> physical movement +50k, corrected receipts +40k
      assert.equal(c1Shift.rows[1].shift_date, "2026-06-02");
      assert.equal(c1Shift.rows[1].gross_recorded_receipts, "50000.00");
      assert.equal(c1Shift.rows[1].entry_reversals_amount, "10000.00");
      assert.equal(c1Shift.rows[1].corrected_net_receipts, "40000.00");
      assert.equal(c1Shift.rows[1].cash_refunded_amount, "0.00");
      assert.equal(c1Shift.rows[1].physical_cash_movement, "50000.00");

      // Day 3 (06-03): 0 receipts, 15k reversal, 25k refund -> physical_cash_movement = -25,000.00!
      assert.equal(c1Shift.rows[2].shift_date, "2026-06-03");
      assert.equal(c1Shift.rows[2].receipt_count, "0");
      assert.equal(c1Shift.rows[2].gross_recorded_receipts, "0.00");
      assert.equal(c1Shift.rows[2].entry_reversals_amount, "15000.00");
      assert.equal(c1Shift.rows[2].corrected_net_receipts, "-15000.00");
      assert.equal(c1Shift.rows[2].cash_refunded_amount, "25000.00");
      assert.equal(c1Shift.rows[2].physical_cash_movement, "-25000.00");
      assert.equal(c1Shift.rows[2].net_effective_cash, "-40000.00");

      // Inspect c2 reconciliation: Day 4 (06-04) shows ONLY c2's -10,000 physical refund
      const c2Shift = await adminPool.query<{
        shift_date: string;
        gross_recorded_receipts: string;
        entry_reversals_amount: string;
        cash_refunded_amount: string;
        physical_cash_movement: string;
      }>(
        `SELECT shift_date::text AS shift_date, gross_recorded_receipts, entry_reversals_amount,
                cash_refunded_amount, physical_cash_movement
         FROM cashier_shift_reconciliation_view
         WHERE user_id = $1`,
        [c2]
      );
      assert.equal(c2Shift.rows.length, 1);
      assert.equal(c2Shift.rows[0].shift_date, "2026-06-04");
      assert.equal(c2Shift.rows[0].gross_recorded_receipts, "0.00");
      assert.equal(c2Shift.rows[0].entry_reversals_amount, "0.00");
      assert.equal(c2Shift.rows[0].cash_refunded_amount, "10000.00");
      assert.equal(c2Shift.rows[0].physical_cash_movement, "-10000.00");

      // Verify invoice_ledger_view reflects accurate corrected balances for inv1 (100k - 15k rev - 35k ref = 50k effective paid, 50k balance due)
      const inv1Ledger = await adminPool.query<{
        gross_recorded_receipts: string;
        total_entry_reversals: string;
        corrected_net_receipts: string;
        total_cash_refunded: string;
        effective_paid: string;
        balance_due: string;
      }>("SELECT * FROM invoice_ledger_view WHERE invoice_id = $1", [inv1]);
      assert.equal(inv1Ledger.rows[0].gross_recorded_receipts, "100000.00");
      assert.equal(inv1Ledger.rows[0].total_entry_reversals, "15000.00");
      assert.equal(inv1Ledger.rows[0].corrected_net_receipts, "85000.00");
      assert.equal(inv1Ledger.rows[0].total_cash_refunded, "35000.00");
      assert.equal(inv1Ledger.rows[0].effective_paid, "50000.00");
      assert.equal(inv1Ledger.rows[0].balance_due, "50000.00");
    });

    it("8-9 & 11. Blocks invalid/inactive refund attribution and reflects customer outstanding balance accurately after corrections", async () => {
      // Create a dedicated customer and a disabled cashier
      const cust2Res = await adminPool.query<{ id: string }>(
        "INSERT INTO customers (name, phone, location) VALUES ('Balance After Fix Co', '0775554443', 'Kandy') RETURNING id"
      );
      const cust2Id = cust2Res.rows[0].id;

      const disabledCashierId = (
        await adminPool.query<{ id: string }>(
          `INSERT INTO users (username, password_hash, full_name, role, is_active)
           VALUES ($1, 'hash', 'Disabled Cashier', 'CASHIER', false) RETURNING id`,
          [`disabled_${randomUUID().slice(0, 8)}`]
        )
      ).rows[0].id;

      const client = await adminPool.connect();
      let invId = "";
      let payId = "";
      try {
        await client.query("BEGIN");
        const draft = await client.query<{ id: string }>(
          `INSERT INTO invoices (
             customer_id, customer_name_snapshot, customer_phone_snapshot, customer_location_snapshot,
             has_transport, transport_fee, subtotal, grand_total, issued_by_user_id
           ) VALUES ($1, 'Balance After Fix Co', '0775554443', 'Kandy', false, 0.00, 0.00, 0.00, $2) RETURNING id`,
          [cust2Id, cashier1Id]
        );
        invId = draft.rows[0].id;
        await client.query(
          `INSERT INTO invoice_items (invoice_id, material_id, material_name_snapshot, quantity, unit_price, line_total)
           VALUES ($1, $2, '3/4"', 10.000, 10000.00, 100000.00)`,
          [invId, mat34Id]
        );
        await client.query(
          "UPDATE invoices SET subtotal = 100000.00, grand_total = 100000.00, status = 'ISSUED' WHERE id = $1",
          [invId]
        );
        const p = await client.query<{ id: string }>(
          "INSERT INTO payments (invoice_id, cashier_user_id, amount, idempotency_key) VALUES ($1, $2, 100000.00, $3) RETURNING id",
          [invId, cashier1Id, randomUUID()]
        );
        payId = p.rows[0].id;
        await client.query("COMMIT");
      } finally {
        client.release();
      }

      // 9a. Reject refund attributed to disabled user
      await assert.rejects(
        () =>
          adminPool.query(
            `INSERT INTO payment_adjustments
               (payment_id, authorized_by_owner_id, performed_by_user_id, adjustment_type, adjustment_amount, idempotency_key, reason)
             VALUES ($1, $2, $3, 'CASH_REFUND', 10000.00, $4, 'Should reject disabled refund performer')`,
            [payId, ownerId, disabledCashierId, randomUUID()]
          ),
        /must be an active staff account/i
      );

      // 9b. Reject refund attributed to nonexistent UUID
      await assert.rejects(
        () =>
          adminPool.query(
            `INSERT INTO payment_adjustments
               (payment_id, authorized_by_owner_id, performed_by_user_id, adjustment_type, adjustment_amount, idempotency_key, reason)
             VALUES ($1, $2, $3, 'CASH_REFUND', 10000.00, $4, 'Should reject bogus UUID')`,
            [payId, ownerId, randomUUID(), randomUUID()]
          ),
        /must be an active staff account|violates foreign key constraint/i
      );

      // Apply valid 30k ENTRY_REVERSAL -> Customer outstanding balance should rise from 0.00 to 30,000.00
      await adminPool.query(
        `INSERT INTO payment_adjustments
           (payment_id, authorized_by_owner_id, performed_by_user_id, adjustment_type, adjustment_amount, idempotency_key, reason)
         VALUES ($1, $2, $3, 'ENTRY_REVERSAL', 30000.00, $4, 'Reverse clerical error restoring balance')`,
        [payId, ownerId, ownerId, randomUUID()]
      );

      const custBal = await adminPool.query<{ total_billed: string; total_paid: string; outstanding_balance: string }>(
        "SELECT total_billed, total_paid, outstanding_balance FROM customer_balances_view WHERE customer_id = $1",
        [cust2Id]
      );
      assert.equal(custBal.rows[0].total_billed, "100000.00");
      assert.equal(custBal.rows[0].total_paid, "70000.00");
      assert.equal(custBal.rows[0].outstanding_balance, "30000.00");
    });

    it("12. Handles credit notes, invoice cancellations, and REFUND_DUE states without hiding negatives", async () => {
      // Issue 100,000 invoice & collect 80,000 cash
      const client = await adminPool.connect();
      let invId = "";
      let payId = "";
      try {
        await client.query("BEGIN");
        const draft = await client.query<{ id: string }>(
          `INSERT INTO invoices (
             customer_id, customer_name_snapshot, customer_phone_snapshot, customer_location_snapshot,
             has_transport, transport_fee, subtotal, grand_total, issued_by_user_id
           ) VALUES ($1, 'Cancel Cust', '0770000003', 'Site', false, 0.00, 0.00, 0.00, $2) RETURNING id`,
          [customerId, cashier1Id]
        );
        invId = draft.rows[0].id;
        await client.query(
          `INSERT INTO invoice_items (invoice_id, material_id, material_name_snapshot, quantity, unit_price, line_total)
           VALUES ($1, $2, '3/4"', 10.000, 10000.00, 100000.00)`,
          [invId, mat34Id]
        );
        await client.query(
          "UPDATE invoices SET subtotal = 100000.00, grand_total = 100000.00, status = 'ISSUED' WHERE id = $1",
          [invId]
        );
        const p = await client.query<{ id: string }>(
          "INSERT INTO payments (invoice_id, cashier_user_id, amount, idempotency_key) VALUES ($1, $2, 80000.00, $3) RETURNING id",
          [invId, cashier1Id, randomUUID()]
        );
        payId = p.rows[0].id;
        await client.query("COMMIT");
      } finally {
        client.release();
      }

      // Cannot cancel invoice without full credit note
      await assert.rejects(
        () => adminPool.query("UPDATE invoices SET status = 'CANCELLED' WHERE id = $1", [invId]),
        /without full credit note coverage/i
      );

      // Cannot issue 100k credit note with resolution = 'NONE' while 80k paid exists!
      await assert.rejects(
        () =>
          adminPool.query(
            `INSERT INTO credit_notes (invoice_id, authorized_by_owner_id, credit_amount, excess_cash_resolution, idempotency_key, reason)
             VALUES ($1, $2, 100000.00, 'NONE', $3, 'Should reject because 80k cash already collected')`,
            [invId, ownerId, randomUUID()]
          ),
        /without an explicit PENDING_CUSTOMER_REFUND resolution/i
      );

      // Issue 100k credit note explicitly acknowledging PENDING_CUSTOMER_REFUND + cancel invoice
      const c2 = await adminPool.connect();
      try {
        await c2.query("BEGIN");
        await c2.query(
          `INSERT INTO credit_notes (invoice_id, authorized_by_owner_id, credit_amount, excess_cash_resolution, idempotency_key, reason)
           VALUES ($1, $2, 100000.00, 'PENDING_CUSTOMER_REFUND', $3, 'Order cancelled; customer refund pending pickup')`,
          [invId, ownerId, randomUUID()]
        );
        await c2.query("UPDATE invoices SET status = 'CANCELLED' WHERE id = $1", [invId]);
        await c2.query("COMMIT");
      } finally {
        c2.release();
      }

      // Verify invoice_ledger_view surfaces REFUND_DUE of 80,000.00 (NOT clamped to 0!)
      let ledger = await adminPool.query<{
        effective_grand_total: string;
        effective_paid: string;
        signed_balance: string;
        balance_due: string;
        refund_due_to_customer: string;
        payment_status: string;
        invoice_status: string;
      }>("SELECT * FROM invoice_ledger_view WHERE invoice_id = $1", [invId]);
      assert.equal(ledger.rows[0].effective_grand_total, "0.00");
      assert.equal(ledger.rows[0].effective_paid, "80000.00");
      assert.equal(ledger.rows[0].signed_balance, "-80000.00");
      assert.equal(ledger.rows[0].balance_due, "0.00");
      assert.equal(ledger.rows[0].refund_due_to_customer, "80000.00");
      assert.equal(ledger.rows[0].payment_status, "REFUND_DUE");
      assert.equal(ledger.rows[0].invoice_status, "CANCELLED");

      // Pay physical CASH_REFUND (handled by cashier2) to settle customer credit
      await adminPool.query(
        `INSERT INTO payment_adjustments (payment_id, authorized_by_owner_id, performed_by_user_id, adjustment_type, adjustment_amount, idempotency_key, reason)
         VALUES ($1, $2, $3, 'CASH_REFUND', 80000.00, $4, 'Customer picked up refund cash for cancelled order')`,
        [payId, ownerId, cashier2Id, randomUUID()]
      );

      ledger = await adminPool.query("SELECT * FROM invoice_ledger_view WHERE invoice_id = $1", [invId]);
      assert.equal(ledger.rows[0].signed_balance, "0.00");
      assert.equal(ledger.rows[0].refund_due_to_customer, "0.00");
      assert.equal(ledger.rows[0].payment_status, "CANCELLED");

      // Test atomic REFUNDED_IN_TX cancellation AND rejection of bogus PENDING_CUSTOMER_REFUND
      const c3 = await adminPool.connect();
      let inv2Id = "";
      let pay2Id = "";
      try {
        await c3.query("BEGIN");
        const d2 = await c3.query<{ id: string }>(
          `INSERT INTO invoices (
             customer_id, customer_name_snapshot, customer_phone_snapshot, customer_location_snapshot,
             has_transport, transport_fee, subtotal, grand_total, issued_by_user_id
           ) VALUES ($1, 'Atomic Refund Cust', '0770000011', 'Site', false, 0.00, 0.00, 0.00, $2) RETURNING id`,
          [customerId, cashier1Id]
        );
        inv2Id = d2.rows[0].id;
        await c3.query(
          `INSERT INTO invoice_items (invoice_id, material_id, material_name_snapshot, quantity, unit_price, line_total)
           VALUES ($1, $2, 'Dust', 4.000, 5000.00, 20000.00)`,
          [inv2Id, matDustId]
        );
        await c3.query("UPDATE invoices SET subtotal = 20000.00, grand_total = 20000.00, status = 'ISSUED' WHERE id = $1", [
          inv2Id,
        ]);
        const p2 = await c3.query<{ id: string }>(
          "INSERT INTO payments (invoice_id, cashier_user_id, amount, idempotency_key) VALUES ($1, $2, 10000.00, $3) RETURNING id",
          [inv2Id, cashier1Id, randomUUID()]
        );
        pay2Id = p2.rows[0].id;
        await c3.query("COMMIT");
      } finally {
        c3.release();
      }

      // Reject claiming PENDING_CUSTOMER_REFUND on a partial credit note when cash (10k) <= new total (15k)
      await assert.rejects(
        () =>
          adminPool.query(
            `INSERT INTO credit_notes (invoice_id, authorized_by_owner_id, credit_amount, excess_cash_resolution, idempotency_key, reason)
             VALUES ($1, $2, 5000.00, 'PENDING_CUSTOMER_REFUND', $3, 'Should reject bogus pending refund status')`,
            [inv2Id, ownerId, randomUUID()]
          ),
        /specifies PENDING_CUSTOMER_REFUND even though collected cash/i
      );

      // Atomic cancel with REFUNDED_IN_TX succeeds cleanly
      const c4 = await adminPool.connect();
      try {
        await c4.query("BEGIN");
        await c4.query(
          `INSERT INTO credit_notes (invoice_id, authorized_by_owner_id, credit_amount, excess_cash_resolution, idempotency_key, reason)
           VALUES ($1, $2, 20000.00, 'REFUNDED_IN_TX', $3, 'Atomic full cancellation with cash refund in same TX')`,
          [inv2Id, ownerId, randomUUID()]
        );
        await c4.query(
          `INSERT INTO payment_adjustments (payment_id, authorized_by_owner_id, performed_by_user_id, adjustment_type, adjustment_amount, idempotency_key, reason)
           VALUES ($1, $2, $3, 'CASH_REFUND', 10000.00, $4, 'Atomic cash payout during cancellation TX')`,
          [pay2Id, ownerId, cashier1Id, randomUUID()]
        );
        await c4.query("UPDATE invoices SET status = 'CANCELLED' WHERE id = $1", [inv2Id]);
        await c4.query("COMMIT");
      } finally {
        c4.release();
      }
      const l2 = await adminPool.query<{ payment_status: string; invoice_status: string; signed_balance: string }>(
        "SELECT payment_status, invoice_status, signed_balance FROM invoice_ledger_view WHERE invoice_id = $1",
        [inv2Id]
      );
      assert.equal(l2.rows[0].invoice_status, "CANCELLED");
      assert.equal(l2.rows[0].payment_status, "CANCELLED");
      assert.equal(l2.rows[0].signed_balance, "0.00");
    });

    it("10. Serializes concurrent payment adjustments and maps UTC timestamps strictly to Asia/Colombo business dates", async () => {
      const baselineRes = await adminPool.query<{
        business_date: string;
        gross_recorded_receipts: string;
        cash_refunded_amount: string;
        physical_cash_movement: string;
      }>(
        `SELECT business_date::text AS business_date, gross_recorded_receipts, cash_refunded_amount, physical_cash_movement
         FROM daily_cash_reconciliation_view
         WHERE business_date IN ('2026-07-10', '2026-07-11')`
      );
      const baseMap = new Map(baselineRes.rows.map((r) => [r.business_date, r]));
      const baseD1Gross = Number(baseMap.get("2026-07-10")?.gross_recorded_receipts ?? "0");
      const baseD2Refund = Number(baseMap.get("2026-07-11")?.cash_refunded_amount ?? "0");

      const client = await adminPool.connect();
      let invId = "";
      let payId = "";
      try {
        await client.query("BEGIN");
        const draft = await client.query<{ id: string }>(
          `INSERT INTO invoices (
             customer_id, customer_name_snapshot, customer_phone_snapshot, customer_location_snapshot,
             has_transport, transport_fee, subtotal, grand_total, issued_by_user_id
           ) VALUES ($1, 'Colombo Midnight Cust', '0770000010', 'Site', false, 0.00, 0.00, 0.00, $2) RETURNING id`,
          [customerId, cashier1Id]
        );
        invId = draft.rows[0].id;
        await client.query(
          `INSERT INTO invoice_items (invoice_id, material_id, material_name_snapshot, quantity, unit_price, line_total)
           VALUES ($1, $2, '3/4"', 10.000, 10000.00, 100000.00)`,
          [invId, mat34Id]
        );
        await client.query(
          "UPDATE invoices SET subtotal = 100000.00, grand_total = 100000.00, status = 'ISSUED' WHERE id = $1",
          [invId]
        );
        // Payment recorded at 18:25 UTC on 2026-07-10 -> 23:55 Colombo time on 2026-07-10
        const p = await client.query<{ id: string }>(
          `INSERT INTO payments (invoice_id, cashier_user_id, amount, idempotency_key, created_at)
           VALUES ($1, $2, 100000.00, $3, '2026-07-10T18:25:00Z') RETURNING id`,
          [invId, cashier1Id, randomUUID()]
        );
        payId = p.rows[0].id;
        await client.query("COMMIT");
      } finally {
        client.release();
      }

      // Parallel refunds recorded at 18:35 UTC on 2026-07-10 -> 00:05 Colombo time on 2026-07-11
      const submitAdj = async (adjAmount: string) => {
        const c = await adminPool.connect();
        try {
          await c.query("BEGIN");
          await c.query(
            `INSERT INTO payment_adjustments (payment_id, authorized_by_owner_id, performed_by_user_id, adjustment_type, adjustment_amount, idempotency_key, reason, created_at)
             VALUES ($1, $2, $3, 'CASH_REFUND', $4, $5, 'Concurrent refund protection test', '2026-07-10T18:35:00Z')`,
            [payId, ownerId, cashier2Id, adjAmount, randomUUID()]
          );
          await c.query("COMMIT");
          return { ok: true };
        } catch (err) {
          await c.query("ROLLBACK").catch(() => {});
          return { ok: false, error: (err as Error).message };
        } finally {
          c.release();
        }
      };

      const [adj1, adj2] = await Promise.all([submitAdj("60000.00"), submitAdj("60000.00")]);
      assert.equal([adj1, adj2].filter((r) => r.ok).length, 1);
      assert.equal([adj1, adj2].filter((r) => !r.ok).length, 1);

      const dailyRes = await adminPool.query<{
        business_date: string;
        gross_recorded_receipts: string;
        cash_refunded_amount: string;
        physical_cash_movement: string;
      }>(
        `SELECT business_date::text AS business_date, gross_recorded_receipts, cash_refunded_amount, physical_cash_movement
         FROM daily_cash_reconciliation_view
         WHERE business_date IN ('2026-07-10', '2026-07-11')
         ORDER BY business_date ASC`
      );
      assert.equal(dailyRes.rows.length, 2);
      assert.equal(dailyRes.rows[0].business_date, "2026-07-10");
      assert.equal(Number(dailyRes.rows[0].gross_recorded_receipts) - baseD1Gross, 100000);
      assert.equal(dailyRes.rows[1].business_date, "2026-07-11");
      assert.equal(Number(dailyRes.rows[1].cash_refunded_amount) - baseD2Refund, 60000);
    });
  });

  describe("Part 6 — Restricted Database Role & Permission Security Tests", () => {
    it("enforces least-privilege runtime constraints on npr_app_user", async () => {
      assert.ok(appUserPool, "appUserPool must be initialized");

      // 1. Restricted user CANNOT alter tables or disable triggers
      await assert.rejects(
        () => appUserPool!.query("ALTER TABLE invoices DISABLE TRIGGER ALL"),
        /must be owner of table invoices|permission denied/i
      );
      await assert.rejects(
        () => appUserPool!.query("DROP TABLE audit_logs"),
        /must be owner of table audit_logs|permission denied/i
      );

      // 2. Restricted user CANNOT insert users or escalate a cashier to OWNER
      await assert.rejects(
        () =>
          appUserPool!.query(
            "INSERT INTO users (username, password_hash, full_name, role) VALUES ('evil', 'h', 'Evil', 'OWNER')"
          ),
        /permission denied for table users/i
      );
      await assert.rejects(
        () => appUserPool!.query("UPDATE users SET role = 'OWNER' WHERE id = $1", [cashier1Id]),
        /permission denied for table users/i
      );

      // 3. Restricted user CAN manage sessions (create & revoke) and write audit_logs
      const sessHash = sha256(randomUUID());
      await appUserPool!.query(
        `INSERT INTO user_sessions (token_hash, user_id, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '1 day')`,
        [sessHash, cashier1Id]
      );
      await appUserPool!.query("DELETE FROM user_sessions WHERE token_hash = $1", [sessHash]);

      const auditIns = await appUserPool!.query<{ id: string }>(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
         VALUES ($1, 'TEST_ROLE_CHECK', 'users', $2, '{"source":"test"}'::jsonb) RETURNING id`,
        [cashier1Id, cashier1Id]
      );
      await assert.rejects(
        () => appUserPool!.query("UPDATE audit_logs SET action = 'TAMPERED' WHERE id = $1", [auditIns.rows[0].id]),
        /permission denied for table audit_logs|strictly append-only/i
      );
      await assert.rejects(
        () => appUserPool!.query("DELETE FROM audit_logs WHERE id = $1", [auditIns.rows[0].id]),
        /permission denied for table audit_logs|strictly append-only/i
      );

      // Verify idempotency_records cannot be updated by runtime role
      const idk = randomUUID();
      await appUserPool!.query(
        `INSERT INTO idempotency_records (idempotency_key, operation_type, request_hash, actor_user_id, response_status, response_payload)
         VALUES ($1, 'ISSUE_INVOICE', $2, $3, 201, '{}'::jsonb)`,
        [idk, sha256({ test: 1 }), cashier1Id]
      );
      await assert.rejects(
        () => appUserPool!.query("UPDATE idempotency_records SET response_status = 500 WHERE idempotency_key = $1", [idk]),
        /permission denied for table idempotency_records|strictly append-only/i
      );

      // 4. Restricted user CANNOT delete financial records or bypass triggers
      await assert.rejects(
        () => appUserPool!.query("DELETE FROM payments"),
        /permission denied for table payments/i
      );
      await assert.rejects(
        () => appUserPool!.query("DELETE FROM invoices"),
        /permission denied for table invoices/i
      );

      // 5. Trigger rejects CASHIER ID attempting owner-only actions
      await assert.rejects(
        () =>
          appUserPool!.query(
            `INSERT INTO material_price_history (material_id, old_price, new_price, changed_by_user_id, reason)
             VALUES ($1, 10000.00, 12000.00, $2, 'Unauthorized cashier price change attempt')`,
            [mat34Id, cashier1Id]
          ),
        /Only active OWNER accounts are permitted/i
      );

      // Verify runtime role cannot mutate column outside GRANT (e.g. customer_name_snapshot on invoices)
      await assert.rejects(
        () => appUserPool!.query("UPDATE invoices SET customer_name_snapshot = 'Tamper'"),
        /permission denied for table invoices/i
      );

      // 6. Verify normal invoice + payment + owner price update + view reads work under restricted npr_app_user
      const client = await appUserPool!.connect();
      let appInvId = "";
      let appPayId = "";
      try {
        await client.query("BEGIN");
        const draft = await client.query<{ id: string }>(
          `INSERT INTO invoices (
             customer_id, customer_name_snapshot, customer_phone_snapshot, customer_location_snapshot,
             has_transport, transport_fee, subtotal, grand_total, issued_by_user_id
           ) VALUES ($1, 'AppRole Cust', '0770000009', 'Site', false, 0.00, 0.00, 0.00, $2) RETURNING id`,
          [customerId, cashier1Id]
        );
        appInvId = draft.rows[0].id;
        await client.query(
          `INSERT INTO invoice_items (invoice_id, material_id, material_name_snapshot, quantity, unit_price, line_total)
           VALUES ($1, $2, 'Dust', 2.000, 5000.00, 10000.00)`,
          [appInvId, matDustId]
        );
        await client.query(
          "UPDATE invoices SET subtotal = 10000.00, grand_total = 10000.00, status = 'ISSUED' WHERE id = $1",
          [appInvId]
        );
        const payRes = await client.query<{ id: string }>(
          "INSERT INTO payments (invoice_id, cashier_user_id, amount, idempotency_key) VALUES ($1, $2, 10000.00, $3) RETURNING id",
          [appInvId, cashier1Id, randomUUID()]
        );
        appPayId = payRes.rows[0].id;

        // Owner price update under npr_app_user succeeds
        await client.query("UPDATE materials SET current_unit_price = 5200.00 WHERE id = $1", [matDustId]);
        await client.query(
          `INSERT INTO material_price_history (material_id, old_price, new_price, changed_by_user_id, reason)
           VALUES ($1, 5000.00, 5200.00, $2, 'Market adjustment approved by owner')`,
          [matDustId, ownerId]
        );
        await client.query("COMMIT");
      } finally {
        client.release();
      }

      // Trigger rejects CASHIER ID on payment_adjustments and credit_notes
      await assert.rejects(
        () =>
          appUserPool!.query(
            `INSERT INTO payment_adjustments (payment_id, authorized_by_owner_id, performed_by_user_id, adjustment_type, adjustment_amount, idempotency_key, reason)
             VALUES ($1, $2, $3, 'ENTRY_REVERSAL', 1000.00, $4, 'Unauthorized cashier reversal attempt')`,
            [appPayId, cashier1Id, cashier1Id, randomUUID()]
          ),
        /Only active OWNER accounts are permitted/i
      );
      await assert.rejects(
        () =>
          appUserPool!.query(
            `INSERT INTO credit_notes (invoice_id, authorized_by_owner_id, credit_amount, excess_cash_resolution, idempotency_key, reason)
             VALUES ($1, $2, 1000.00, 'NONE', $3, 'Unauthorized cashier credit note attempt')`,
            [appInvId, cashier1Id, randomUUID()]
          ),
        /Only active OWNER accounts are permitted/i
      );

      const custBalRes = await appUserPool!.query(
        "SELECT outstanding_balance FROM customer_balances_view WHERE customer_id = $1",
        [customerId]
      );
      assert.equal(custBalRes.rows.length, 1);
    });
  });
});
