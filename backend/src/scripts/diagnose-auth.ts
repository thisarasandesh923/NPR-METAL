import { pool } from "../db/pool.js";

interface UserRow {
  id: string;
  username: string;
  full_name: string;
  role: string;
  is_active: boolean;
  password_hash: string;
}

interface AuditLogRow {
  id: string;
  user_id: string | null;
  action: string;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string;
  created_at: Date;
}

async function diagnoseAuth(): Promise<void> {
  const client = await pool.connect();
  try {
    console.log("=== NPR METAL CRUSHER — AUTHENTICATION DIAGNOSTIC ===");

    // 1. Inspect existing user accounts safely (NO sensitive hashes printed)
    const userRes = await client.query<UserRow>(
      `SELECT id, username, full_name, role, is_active, password_hash
       FROM public.users
       ORDER BY role DESC, username ASC`
    );

    console.log(`\nFound ${userRes.rows.length} user accounts in database:`);
    for (const u of userRes.rows) {
      const parts = u.password_hash.split("$");
      const isValidFormat =
        parts.length === 4 &&
        parts[0] === "scrypt" &&
        parts[1] === "N=32768,r=8,p=1" &&
        parts[2].length >= 20 &&
        parts[3].length >= 80;

      console.log(`- Username: "${u.username}" (ID: ${u.id})`);
      console.log(`  Full Name: "${u.full_name}"`);
      console.log(`  Role: "${u.role}"`);
      console.log(`  Is Active: ${u.is_active}`);
      console.log(`  Hash Format Valid: ${isValidFormat} (parts: ${parts.length}, prefix: ${parts[0]}${parts[1] ? "$" + parts[1] : ""})`);
      console.log(`  Hash Total Length: ${u.password_hash.length} chars`);
    }

    // 2. Inspect latest 10 login audit log entries
    const auditRes = await client.query<AuditLogRow>(
      `SELECT id, user_id, action, entity_id, details, ip_address, created_at
       FROM public.audit_logs
       WHERE entity_type = 'AUTH_LOGIN'
       ORDER BY created_at DESC
       LIMIT 15`
    );

    console.log(`\nRecent Login Audit Log Entries (${auditRes.rows.length}):`);
    for (const a of auditRes.rows) {
      console.log(
        `[${new Date(a.created_at).toISOString()}] Action: ${a.action} | UserID: ${a.user_id ?? "null"} | IP: ${a.ip_address} | Reason/Details: ${JSON.stringify(a.details)}`
      );
    }

    // 3. Inspect materials summary
    const matRes = await client.query<{ count: string; active_count: string }>(
      `SELECT COUNT(*)::text as count, COUNT(*) FILTER (WHERE is_active = true)::text as active_count FROM public.materials`
    );
    console.log(`\nMaterials in database: Total = ${matRes.rows[0]?.count}, Active = ${matRes.rows[0]?.active_count}`);

  } catch (err) {
    console.error("Diagnostic error:", err);
  } finally {
    client.release();
    await pool.end();
  }
}

void diagnoseAuth();
