import "dotenv/config";
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";
import { getRuntimeDatabaseUrl } from "../db/config.js";
import { pool } from "../db/pool.js";
import { hashPassword, verifyPassword } from "../modules/auth/password.js";

export interface TargetUserRow {
  id: string;
  username: string;
  full_name: string;
  role: string;
  is_active: boolean;
}

export interface RedactedDatabaseSummary {
  host: string;
  port: number;
  database: string;
  databaseRole: string;
  projectIdentifier: string;
  isLocal: boolean;
}

export interface PasswordResetExecutionResult {
  updatedUserId: string;
  username: string;
  sessionsInvalidated: number;
}

/**
 * Parses and returns a safe, redacted summary of the target database connection,
 * strictly omitting passwords, secrets, or full connection URLs.
 */
export function getRedactedDatabaseSummary(rawUrl: string): RedactedDatabaseSummary {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid database URL format.");
  }

  const host = (parsed.searchParams.get("host") ?? parsed.hostname).trim();
  const port = parsed.port ? Number(parsed.port) : 5432;
  const database = (parsed.pathname || "/").replace(/^\//, "").trim() || "postgres";
  const user = (parsed.searchParams.get("user") ?? parsed.username).trim();

  let projectIdentifier = "N/A (Local / Direct)";
  if (user.includes(".")) {
    projectIdentifier = user.split(".").pop() || "unknown";
  } else if (host.includes(".pooler.supabase.com")) {
    projectIdentifier = host.split(".")[0];
  } else if (host.includes(".supabase.co")) {
    projectIdentifier = host.split(".")[0];
  }

  const isLocal =
    host === "127.0.0.1" ||
    host === "localhost" ||
    host === "::1" ||
    host.endsWith(".local");

  return {
    host,
    port,
    database,
    databaseRole: user || "default",
    projectIdentifier,
    isLocal,
  };
}

/**
 * Prompts the user for sensitive password input in an interactive TTY,
 * masking typed characters with asterisks (*), handling backspaces and Ctrl+C,
 * restoring raw terminal mode on cleanup, and preserving exact password input (no .trim()).
 *
 * Rejects non-interactive (non-TTY) environments fail-closed.
 */
export function promptMasked(query: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return Promise.reject(
      new Error(
        "Security Abort: Password input requires an interactive terminal (TTY). Non-interactive input is strictly rejected to prevent secret leakage."
      )
    );
  }

  return new Promise((resolve, reject) => {
    let password = "";
    const stdin = process.stdin;
    const stdout = process.stdout;
    const wasRaw = Boolean(stdin.isRaw);

    function cleanup(): void {
      stdin.removeListener("data", onData);
      try {
        stdin.setRawMode(wasRaw);
      } catch {
        // Ignore terminal mode restore errors
      }
      stdin.pause();
    }

    function onData(charBuffer: Buffer): void {
      const chunk = charBuffer.toString("utf8");

      for (let i = 0; i < chunk.length; i++) {
        const c = chunk[i];

        if (c === "\r" || c === "\n") {
          cleanup();
          stdout.write("\n");
          resolve(password); // Exact password preserved without trimming
          return;
        }

        if (c === "\u0008" || c === "\x7f") {
          // Backspace
          if (password.length > 0) {
            password = password.slice(0, -1);
            stdout.write("\b \b");
          }
          continue;
        }

        if (c === "\u0003") {
          // Ctrl+C
          cleanup();
          stdout.write("\nOperation aborted by user.\n");
          process.exit(1);
        }

        // Accept all valid printable characters including space
        if (c >= " ") {
          password += c;
          stdout.write("*");
        }
      }
    }

    try {
      stdin.setRawMode(true);
      stdin.resume();
      stdin.on("data", onData);
      stdout.write(query);
    } catch (err) {
      cleanup();
      reject(err);
    }
  });
}

/**
 * Prompts for standard non-sensitive input (e.g. username, confirmation text).
 */
export function promptPlain(query: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

/**
 * Programmatic execution of the password reset transaction:
 * 1. Hashes password using scrypt (N=32768, r=8, p=1).
 * 2. Pre-verifies hash in memory before DB write.
 * 3. Updates exactly 1 row in public.users (preserves id, username, role, is_active, full_name).
 * 4. Invalidates all active sessions for this account in public.user_sessions.
 * 5. Appends an audit log entry in public.audit_logs.
 *
 * Designed to run inside an existing database transaction client.
 */
export async function executePasswordReset(
  client: PoolClient,
  params: {
    userId: string;
    username: string;
    newPasswordPlain: string;
    resetBy?: string;
  }
): Promise<PasswordResetExecutionResult> {
  if (params.newPasswordPlain.length < 12) {
    throw new Error("Password must be at least 12 characters long.");
  }

  // 1. Hash with scrypt
  const newHash = await hashPassword(params.newPasswordPlain);

  // 2. Pre-verification check
  const verified = await verifyPassword(params.newPasswordPlain, newHash);
  if (!verified) {
    throw new Error(
      "Cryptographic integrity check failed: derived scrypt key failed in-memory verification."
    );
  }

  // 3. Update exactly 1 user row
  const updateRes = await client.query(
    `UPDATE public.users
     SET password_hash = $1,
         updated_at = NOW()
     WHERE id = $2::uuid AND username = $3`,
    [newHash, params.userId, params.username]
  );

  if (updateRes.rowCount !== 1) {
    throw new Error(
      `Integrity violation: expected exactly 1 user row to be updated, but affected ${updateRes.rowCount}. Transaction aborted.`
    );
  }

  // 4. Invalidate all active sessions for this account
  const deleteSessionsRes = await client.query(
    `DELETE FROM public.user_sessions
     WHERE user_id = $1::uuid`,
    [params.userId]
  );

  // 5. Append audit log with distinct parameters and explicit types
  await client.query(
    `INSERT INTO public.audit_logs (
       user_id,
       action,
       entity_type,
       entity_id,
       details,
       ip_address
     ) VALUES (
       $1::uuid,
       $2,
       $3,
       $4,
       $5::jsonb,
       $6
     )`,
    [
      params.userId,
      "PASSWORD_RESET",
      "USER",
      String(params.userId),
      JSON.stringify({
        reset_by: params.resetBy ?? "ADMIN_CLI",
        target_username: params.username,
        sessions_invalidated: deleteSessionsRes.rowCount ?? 0,
      }),
      "127.0.0.1",
    ]
  );

  return {
    updatedUserId: params.userId,
    username: params.username,
    sessionsInvalidated: deleteSessionsRes.rowCount ?? 0,
  };
}

/**
 * Main interactive CLI entrypoint.
 */
export async function runPasswordResetCli(): Promise<void> {
  console.log("\n=======================================================");
  console.log(" NPR Metal Crusher — Secure User Password Reset Tool");
  console.log("=======================================================\n");

  const targetUsername =
    process.argv[2]?.trim().toLowerCase() ||
    (await promptPlain("Enter target username to reset (e.g. cashier1): ")).toLowerCase();

  if (!targetUsername) {
    console.error("Error: Target username is required.");
    process.exit(1);
  }

  // 1. Display redacted database target summary
  const dbUrl = getRuntimeDatabaseUrl();
  const dbSummary = getRedactedDatabaseSummary(dbUrl);

  console.log(`\n-------------------------------------------------------`);
  console.log(` Target Database Summary (Redacted):`);
  console.log(`-------------------------------------------------------`);
  console.log(` - Host:               ${dbSummary.host} (Port: ${dbSummary.port})`);
  console.log(` - Database:           ${dbSummary.database}`);
  console.log(` - Database Role:      ${dbSummary.databaseRole}`);
  console.log(` - Project Identifier: ${dbSummary.projectIdentifier}`);
  console.log(` - Target Type:        ${dbSummary.isLocal ? "LOCAL (Test / Disposable)" : "REMOTE (Production / Staging)"}`);
  console.log(`-------------------------------------------------------`);

  const confirmTarget = await promptPlain(
    `\nType 'CONFIRM' to verify this is the intended database target: `
  );
  if (confirmTarget !== "CONFIRM") {
    console.log("Database target confirmation failed. Aborting without any database changes.");
    process.exit(0);
  }

  const client = await pool.connect();
  let inTransaction = false;

  try {
    // 2. Find target user record
    const userRes = await client.query<TargetUserRow>(
      `SELECT id, username, full_name, role, is_active
       FROM public.users
       WHERE LOWER(username) = $1`,
      [targetUsername]
    );

    const user = userRes.rows[0];
    if (!user) {
      console.error(`\nError: User "${targetUsername}" not found in database.`);
      process.exit(1);
    }

    console.log(`\nTarget Account Details:`);
    console.log(` - User ID:      ${user.id}`);
    console.log(` - Username:     ${user.username}`);
    console.log(` - Full Name:    ${user.full_name}`);
    console.log(` - Role:         ${user.role}`);
    console.log(` - Active:       ${user.is_active}`);
    console.log(`\nNOTE: User ID, Username, Full Name, and Role will NOT be altered.`);

    // 3. Read and confirm new password securely (exact characters, no trim)
    const newPassword = await promptMasked("\nEnter new password (min 12 characters): ");
    if (newPassword.length < 12) {
      console.error("\nError: Password must be at least 12 characters long.");
      process.exit(1);
    }

    const confirmPassword = await promptMasked("Confirm new password: ");
    if (newPassword !== confirmPassword) {
      console.error("\nError: Passwords do not match.");
      process.exit(1);
    }

    // 4. Final confirmation before transaction
    const finalConfirm = await promptPlain(
      `\nAre you sure you want to update the password for "${user.username}"? (yes/no): `
    );
    if (finalConfirm.toLowerCase() !== "yes") {
      console.log("Operation cancelled by user. No database changes were made.");
      process.exit(0);
    }

    // 5. Execute transactional update
    console.log("\nExecuting atomic database transaction...");
    await client.query("BEGIN");
    inTransaction = true;

    const result = await executePasswordReset(client, {
      userId: user.id,
      username: user.username,
      newPasswordPlain: newPassword,
      resetBy: "CLI_ADMIN",
    });

    await client.query("COMMIT");
    inTransaction = false;

    console.log(`\n=======================================================`);
    console.log(`✓ SUCCESS: Password for "${result.username}" has been securely updated.`);
    console.log(`✓ ${result.sessionsInvalidated} active session(s) invalidated.`);
    console.log(`✓ Audit log entry recorded.`);
    console.log(`✓ Target account must now authenticate with new credentials.`);
    console.log(`=======================================================\n`);
  } catch (err) {
    if (inTransaction) {
      await client.query("ROLLBACK").catch(() => {});
    }
    console.error(
      "\nPassword reset failed:",
      err instanceof Error ? err.message : err
    );
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

// Auto-run if executed directly via CLI
const currentFilePath = fileURLToPath(import.meta.url);
const invokedFilePath = process.argv[1] ? path.resolve(process.argv[1]) : "";

if (
  invokedFilePath === currentFilePath ||
  invokedFilePath.endsWith("reset-user-password.ts") ||
  invokedFilePath.endsWith("reset-user-password.js")
) {
  void runPasswordResetCli();
}
