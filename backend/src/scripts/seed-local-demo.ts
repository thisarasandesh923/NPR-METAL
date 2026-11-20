import pg from "pg";
import { hashPassword } from "../modules/auth/password.js";

const { Client } = pg;

function getVerifiedLocalDemoUrl(): string {
  const demoUrl = process.env.LOCAL_DEMO_DATABASE_URL;
  if (!demoUrl) {
    throw new Error(
      "SAFETY ABORT: LOCAL_DEMO_DATABASE_URL is required (must be local Docker PostgreSQL)."
    );
  }
  if (demoUrl.toLowerCase().includes("supabase")) {
    throw new Error(
      "SAFETY ABORT: LOCAL_DEMO_DATABASE_URL references Supabase. Refusing to seed."
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(demoUrl);
  } catch {
    throw new Error("SAFETY ABORT: Invalid LOCAL_DEMO_DATABASE_URL.");
  }

  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    throw new Error(
      `SAFETY ABORT: Host "${parsed.hostname}" must be 127.0.0.1 or localhost.`
    );
  }
  if (parsed.port !== "55432" && parsed.port !== "55433") {
    throw new Error(
      `SAFETY ABORT: Port "${parsed.port}" must be isolated local port 55432 or 55433.`
    );
  }
  if (parsed.pathname !== "/npr_test_db" && parsed.pathname !== "/npr_local_demo") {
    throw new Error(
      `SAFETY ABORT: Database "${parsed.pathname}" must be /npr_test_db or /npr_local_demo.`
    );
  }
  return demoUrl;
}

function getDemoDates(): { today: string; yesterday: string; monthStart: string } {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const today = fmt.format(now);
  const y = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterday = fmt.format(y);
  return { today, yesterday, monthStart: `${today.slice(0, 7)}-01` };
}

async function main(): Promise<void> {
  const demoUrl = getVerifiedLocalDemoUrl();
  const demoPassword =
    process.env.LOCAL_DEMO_PASSWORD?.trim() || "LocalDemoPass!2026";
  const passwordHash = await hashPassword(demoPassword);
  const dates = getDemoDates();

  const client = new Client({ connectionString: demoUrl });
  await client.connect();

  try {
    const check = await client.query<{ db: string }>(
      "SELECT current_database() AS db"
    );
    console.log(`[LOCAL DEMO] Connected cleanly to ${check.rows[0]?.db}`);

    await client.query("BEGIN");

    // 1. Fictional Local Demo Users (LOCAL TEST USE ONLY)
    const ownerRes = await client.query<{ id: string }>(
      `INSERT INTO public.users (username, password_hash, full_name, role, is_active)
       VALUES ('demo_owner', $1, 'Rohan Wijeratne (Demo Owner)', 'OWNER', true)
       ON CONFLICT ((LOWER(username))) DO UPDATE SET is_active = true
       RETURNING id`,
      [passwordHash]
    );
    const ownerId = ownerRes.rows[0].id;

    const cashierRes = await client.query<{ id: string }>(
      `INSERT INTO public.users (username, password_hash, full_name, role, is_active)
       VALUES ('demo_cashier', $1, 'Nimal Jayawardena (Demo Cashier)', 'CASHIER', true)
       ON CONFLICT ((LOWER(username))) DO UPDATE SET is_active = true
       RETURNING id`,
      [passwordHash]
    );
    const cashierId = cashierRes.rows[0].id;

    // 2. Workshop Aggregates Catalog (11 Approved Products)
    const materialIds: Record<string, number> = {};
    for (const mat of [
      { code: "3/4", name: "3/4 Metal", price: "12000.00", isActive: true },
      { code: "DUST", name: "Dust", price: "8500.00", isActive: true },
      { code: "CHIP", name: "Chip", price: "0.00", isActive: false },
      { code: "6X9", name: "6×9 (Aggregate)", price: "10250.00", isActive: true },
      { code: "2X2", name: "2×2", price: "0.00", isActive: false },
      { code: "1_INCH", name: '1" (Inch)', price: "0.00", isActive: false },
      { code: "1_1/2", name: "1 1/2", price: "0.00", isActive: false },
      { code: "ABC", name: "ABC", price: "11000.00", isActive: true },
      { code: "SUBBASE", name: "SubBase", price: "0.00", isActive: false },
      { code: "MIX", name: "Mix (Dust & Chip)", price: "0.00", isActive: false },
      { code: "QUARRY_MUCK", name: "Quarry Muck", price: "0.00", isActive: false },
    ]) {
      const mRes = await client.query<{ id: number }>(
        `INSERT INTO public.materials (code, name, unit, current_unit_price, is_active)
         VALUES ($1, $2, 'm³', $3, $4)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [mat.code, mat.name, mat.price, mat.isActive]
      );
      materialIds[mat.code] = mRes.rows[0].id;
    }

    // 3. Fictional Workers & Compensation Rules
    const workerIds: Record<string, number> = {};
    for (const w of [
      { code: "WRK-001", name: "Kamal Perera (Demo)", desig: "Primary Crusher Operator", phone: "0770001001" },
      { code: "WRK-002", name: "Sunil Bandara (Demo)", desig: "Wheel Loader Operator", phone: "0770001002" },
      { code: "WRK-003", name: "Ruwan Silva (Demo)", desig: "Quarry Yard Helper", phone: "0770001003" },
    ]) {
      const wRes = await client.query<{ id: number }>(
        `INSERT INTO public.workers (worker_code, full_name, phone, designation, employment_status, created_by_user_id)
         VALUES ($1, $2, $3, $4, 'ACTIVE', $5)
         ON CONFLICT (worker_code) DO UPDATE SET full_name = EXCLUDED.full_name
         RETURNING id`,
        [w.code, w.name, w.phone, w.desig, ownerId]
      );
      workerIds[w.code] = Number(wRes.rows[0].id);
    }

    await client.query(
      `INSERT INTO public.worker_compensation_profiles
         (worker_id, pay_arrangement, base_rate, overtime_hourly_rate, effective_from, notes, updated_by_owner_id)
       VALUES
         ($1, 'HOURLY', 600.00, 900.00, $4::date, 'Configured hourly rate for demo auto-calc', $3),
         ($2, 'MANUAL', NULL, NULL, $4::date, 'Owner enters amount manually at payroll run', $3)
       ON CONFLICT (worker_id) DO NOTHING`,
      [workerIds["WRK-001"], workerIds["WRK-002"], ownerId, dates.monthStart]
    );

    // 4. Fictional Machines
    const machineIds: Record<string, number> = {};
    for (const m of [
      { code: "JAW-01", name: "Jaw Crusher 01", type: "CRUSHER" },
      { code: "CONE-01", name: "Cone Crusher 02", type: "CRUSHER" },
      { code: "LOD-01", name: "CAT Wheel Loader", type: "LOADER" },
    ]) {
      const mRes = await client.query<{ id: number }>(
        `INSERT INTO public.machines (machine_code, machine_name, machine_type, is_active, created_by_user_id)
         VALUES ($1, $2, $3, true, $4)
         ON CONFLICT (machine_code) DO UPDATE SET machine_name = EXCLUDED.machine_name
         RETURNING id`,
        [m.code, m.name, m.type, ownerId]
      );
      machineIds[m.code] = mRes.rows[0].id;
    }

    // 5. Sample Billing Invoices (only if none exist yet)
    const invCount = await client.query<{ cnt: number }>(
      "SELECT COUNT(*)::int AS cnt FROM public.invoices"
    );
    if (invCount.rows[0].cnt === 0) {
      const c1 = await client.query<{ id: number }>(
        `INSERT INTO public.customers (name, phone, location, notes)
         VALUES ('Wayamba Highway Contractors (Demo)', '0770002001', 'Kurunegala', 'Fictional local demo account')
         RETURNING id`
      );
      const inv1 = await client.query<{ id: number }>(
        `INSERT INTO public.invoices (
           customer_id, customer_name_snapshot, customer_phone_snapshot, customer_location_snapshot,
           has_transport, transport_fee, subtotal, grand_total, status, issued_by_user_id
         ) VALUES ($1, 'Wayamba Highway Contractors (Demo)', '0770002001', 'Kurunegala',
                   true, 4500.00, 0.00, 4500.00, 'DRAFT', $2)
         RETURNING id`,
        [c1.rows[0].id, cashierId]
      );
      await client.query(
        `INSERT INTO public.invoice_items (invoice_id, material_id, material_name_snapshot, quantity, unit_price, line_total)
         VALUES ($1, $2, '3/4"', 3.000, 12000.00, 36000.00)`,
        [inv1.rows[0].id, materialIds["3/4"]]
      );
      await client.query(
        `UPDATE public.invoices
         SET subtotal = 36000.00, grand_total = 40500.00, status = 'ISSUED', issued_at = NOW()
         WHERE id = $1`,
        [inv1.rows[0].id]
      );
      await client.query(
        `INSERT INTO public.payments (invoice_id, cashier_user_id, amount, payment_method, idempotency_key, notes)
         VALUES ($1, $2, 20000.00, 'CASH', 'demo-seed-pay-0001', 'Initial advance cash deposit')`,
        [inv1.rows[0].id, cashierId]
      );
    }

    // 6. Sample Operations (1 Approved yesterday + 1 Pending today for Approval Demo)
    const attCount = await client.query<{ cnt: number }>(
      "SELECT COUNT(*)::int AS cnt FROM public.worker_attendance"
    );
    if (attCount.rows[0].cnt === 0) {
      await client.query(
        `INSERT INTO public.worker_attendance
           (work_date, worker_id, start_time, end_time, crosses_midnight, break_minutes,
            hours_worked, overtime_hours, remarks, entered_by_user_id, approval_status,
            submitted_at, reviewed_by_owner_id, reviewed_at)
         VALUES
           ($1::date, $3, '08:00', '17:00', false, 60, 8.00, 1.00, 'Approved yesterday shift', $5, 'APPROVED', NOW(), $6, NOW()),
           ($2::date, $4, '08:00', '17:00', false, 60, 8.00, 0.00, 'Pending Owner review for today', $5, 'SUBMITTED', NOW(), NULL, NULL)`,
        [dates.yesterday, dates.today, workerIds["WRK-001"], workerIds["WRK-002"], cashierId, ownerId]
      );

      await client.query(
        `INSERT INTO public.machine_work_logs
           (work_date, machine_id, operator_worker_id, start_time, end_time, crosses_midnight,
            downtime_minutes, net_operating_hours, scheduled_hours, remarks,
            entered_by_user_id, approval_status, submitted_at, reviewed_by_owner_id, reviewed_at)
         VALUES
           ($1::date, $3, $4, '08:00', '17:00', false, 30, 8.50, 9.00, 'Normal crushing cycle', $5, 'APPROVED', NOW(), $6, NOW()),
           ($2::date, $3, $4, '08:00', '16:30', false, 15, 8.25, 8.50, 'Today primary run awaiting review', $5, 'SUBMITTED', NOW(), NULL, NULL)`,
        [dates.yesterday, dates.today, machineIds["JAW-01"], workerIds["WRK-001"], cashierId, ownerId]
      );

      await client.query(
        `INSERT INTO public.production_logs
           (production_date, material_id, machine_id, operator_worker_id, shift_label,
            quantity_produced, unit, remarks, entered_by_user_id, approval_status,
            submitted_at, reviewed_by_owner_id, reviewed_at)
         VALUES
           ($1::date, $3, $4, $5, 'Day Shift', 38.500, 'm³', 'Verified stockpile', $6, 'APPROVED', NOW(), $7, NOW()),
           ($2::date, $3, $4, $5, 'Day Shift', 24.250, 'm³', 'Awaiting Owner sign-off', $6, 'SUBMITTED', NOW(), NULL, NULL)`,
        [dates.yesterday, dates.today, materialIds["3/4"], machineIds["JAW-01"], workerIds["WRK-001"], cashierId, ownerId]
      );
    }

    // 7. Sample Fictional Operational Expense
    const expCount = await client.query<{ cnt: number }>(
      "SELECT COUNT(*)::int AS cnt FROM public.operational_expenses"
    );
    if (expCount.rows[0].cnt === 0) {
      await client.query(
        `INSERT INTO public.operational_expenses
           (expense_date, category, description, amount, recorded_by_owner_id, idempotency_key)
         VALUES ($1::date, 'FUEL', 'Demo generator diesel refill (50L)', 19500.00, $2, 'demo-seed-exp-0001')`,
        [dates.today, ownerId]
      );
    }

    await client.query("COMMIT");
    console.log("[LOCAL DEMO] Seeded fictional demo dataset successfully.");
    console.log("  Owner username:   demo_owner");
    console.log("  Cashier username: demo_cashier");
    console.log(`  Local Demo Pass:  ${demoPassword}`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

