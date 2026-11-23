import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import type { PoolClient } from "pg";
import {
  executePasswordReset,
  getRedactedDatabaseSummary,
  promptMasked,
} from "../scripts/reset-user-password.js";
import { verifyPassword } from "../modules/auth/password.js";

const { Pool } = pg;

describe("Harden User Password Reset Tool — Unit & Transaction Tests", () => {
  // ---------------------------------------------------------------------------
  // 1. Redacted Database Target Summary Tests
  // ---------------------------------------------------------------------------
  describe("getRedactedDatabaseSummary()", () => {
    it("extracts host, port, database, role and project identifier without leaking passwords", () => {
      const sensitiveSupabaseUrl =
        "postgresql://npr_app_user.xyzprojectref:SuperSecretPass123!@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=verify-full";

      const summary = getRedactedDatabaseSummary(sensitiveSupabaseUrl);

      // Verify NO password or connection string is present
      assert.equal((summary as any).password, undefined);
      assert.doesNotMatch(JSON.stringify(summary), /SuperSecretPass123!/);

      // Verify accurate redacted fields
      assert.equal(summary.host, "aws-0-ap-south-1.pooler.supabase.com");
      assert.equal(summary.port, 5432);
      assert.equal(summary.database, "postgres");
      assert.equal(summary.databaseRole, "npr_app_user.xyzprojectref");
      assert.equal(summary.projectIdentifier, "xyzprojectref");
      assert.equal(summary.isLocal, false);
    });

    it("correctly identifies local disposable database targets", () => {
      const localUrl = "postgresql://postgres:localpass@127.0.0.1:55432/npr_test_db";

      const summary = getRedactedDatabaseSummary(localUrl);

      assert.doesNotMatch(JSON.stringify(summary), /localpass/);
      assert.equal(summary.host, "127.0.0.1");
      assert.equal(summary.port, 55432);
      assert.equal(summary.database, "npr_test_db");
      assert.equal(summary.databaseRole, "postgres");
      assert.equal(summary.isLocal, true);
    });

    it("throws a clear error on malformed database connection string", () => {
      assert.throws(() => getRedactedDatabaseSummary("not-a-valid-url"), {
        message: /Invalid database URL format/,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Terminal Masking & Non-Interactive Safety Tests
  // ---------------------------------------------------------------------------
  describe("promptMasked() non-interactive safety", () => {
    it("rejects non-interactive input fail-closed instead of falling back to plain text", async () => {
      // In this Node test runner environment, process.stdin.isTTY is false
      if (!process.stdin.isTTY) {
        await assert.rejects(
          async () => {
            await promptMasked("Enter password: ");
          },
          {
            message: /interactive terminal \(TTY\)/,
          }
        );
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Programmatic Password Reset Execution Logic Tests (Mock PoolClient)
  // ---------------------------------------------------------------------------
  describe("executePasswordReset() transactional rules", () => {
    it("rejects passwords shorter than 12 characters before any query", async () => {
      const fakeClient = {
        query: async () => {
          throw new Error("Should not reach database query");
        },
      } as unknown as PoolClient;

      await assert.rejects(
        async () => {
          await executePasswordReset(fakeClient, {
            userId: "u-123",
            username: "cashier1",
            newPasswordPlain: "short123",
          });
        },
        {
          message: /at least 12 characters long/,
        }
      );
    });

    it("preserves exact password without trimming whitespace", async () => {
      const passwordWithSpaces = "  ValidLongPassword!2026  ";
      const executedQueries: { text: string; values?: unknown[] }[] = [];

      const mockClient = {
        query: async (text: string, values?: unknown[]) => {
          executedQueries.push({ text, values });
          if (text.includes("UPDATE public.users")) {
            return { rowCount: 1 };
          }
          if (text.includes("DELETE FROM public.user_sessions")) {
            return { rowCount: 2 };
          }
          if (text.includes("INSERT INTO public.audit_logs")) {
            return { rowCount: 1 };
          }
          return { rowCount: 0 };
        },
      } as unknown as PoolClient;

      const result = await executePasswordReset(mockClient, {
        userId: "target-uuid-456",
        username: "cashier1",
        newPasswordPlain: passwordWithSpaces,
        resetBy: "TEST_RUNNER",
      });

      assert.equal(result.updatedUserId, "target-uuid-456");
      assert.equal(result.username, "cashier1");
      assert.equal(result.sessionsInvalidated, 2);

      // Verify UPDATE statement parameters
      const updateQuery = executedQueries.find((q) => q.text.includes("UPDATE public.users"));
      assert.ok(updateQuery);
      const generatedHash = updateQuery.values?.[0] as string;
      assert.ok(typeof generatedHash === "string");
      assert.ok(generatedHash.startsWith("scrypt$N=32768,r=8,p=1$"));

      // Verify exact password with spaces verifies against generated hash
      assert.equal(await verifyPassword(passwordWithSpaces, generatedHash), true);

      // Verify trimmed password DOES NOT match (proving exact characters were preserved!)
      assert.equal(await verifyPassword(passwordWithSpaces.trim(), generatedHash), false);
    });

    it("uses 6 distinct parameter placeholders with explicit ::uuid and ::jsonb casts in audit log query to prevent PostgreSQL 42P08 inconsistent types error", async () => {
      let auditLogQueryText = "";
      let auditLogValues: unknown[] = [];

      const mockClient = {
        query: async (text: string, values?: unknown[]) => {
          if (text.includes("UPDATE public.users")) return { rowCount: 1 };
          if (text.includes("DELETE FROM public.user_sessions")) return { rowCount: 0 };
          if (text.includes("INSERT INTO public.audit_logs")) {
            auditLogQueryText = text;
            auditLogValues = values || [];
            return { rowCount: 1 };
          }
          return { rowCount: 0 };
        },
      } as unknown as PoolClient;

      const targetUserId = "11111111-2222-3333-4444-555555555555";
      await executePasswordReset(mockClient, {
        userId: targetUserId,
        username: "cashier1",
        newPasswordPlain: "SecurePassword!2026",
      });

      // 1. Must use 6 distinct values
      assert.equal(auditLogValues.length, 6, "Must supply exactly 6 distinct parameter values");
      assert.equal(auditLogValues[0], targetUserId); // user_id
      assert.equal(auditLogValues[1], "PASSWORD_RESET"); // action
      assert.equal(auditLogValues[2], "USER"); // entity_type
      assert.equal(auditLogValues[3], targetUserId); // entity_id (as distinct parameter!)
      assert.ok(typeof auditLogValues[4] === "string"); // details (JSON string)
      assert.equal(auditLogValues[5], "127.0.0.1"); // ip_address

      // 2. Query must NOT reuse $1 for entity_id
      assert.doesNotMatch(
        auditLogQueryText,
        /VALUES\s*\(\s*\$1[^,]*,\s*'PASSWORD_RESET'[^,]*,\s*'USER'[^,]*,\s*\$1/i,
        "Must NOT reuse parameter $1 across UUID (user_id) and VARCHAR (entity_id) columns"
      );

      // 3. Query must contain explicit type casts
      assert.match(auditLogQueryText, /\$1::uuid/i, "Must explicitly cast user_id parameter to ::uuid");
      assert.match(auditLogQueryText, /\$4/, "Must use distinct parameter $4 for entity_id");
      assert.match(auditLogQueryText, /\$5::jsonb/i, "Must explicitly cast details parameter to ::jsonb");
    });

    it("throws an error and triggers rollback if UPDATE affects 0 rows", async () => {
      const mockClient = {
        query: async (text: string) => {
          if (text.includes("UPDATE public.users")) {
            return { rowCount: 0 }; // 0 rows affected
          }
          return { rowCount: 0 };
        },
      } as unknown as PoolClient;

      await assert.rejects(
        async () => {
          await executePasswordReset(mockClient, {
            userId: "non-existent-uuid",
            username: "unknown_user",
            newPasswordPlain: "SecurePassword!2026",
          });
        },
        {
          message: /Integrity violation: expected exactly 1 user row to be updated, but affected 0/,
        }
      );
    });

    it("throws an error and triggers rollback if UPDATE affects multiple rows", async () => {
      const mockClient = {
        query: async (text: string) => {
          if (text.includes("UPDATE public.users")) {
            return { rowCount: 2 }; // Unsafe multi-row update
          }
          return { rowCount: 0 };
        },
      } as unknown as PoolClient;

      await assert.rejects(
        async () => {
          await executePasswordReset(mockClient, {
            userId: "ambiguous-uuid",
            username: "ambiguous_user",
            newPasswordPlain: "SecurePassword!2026",
          });
        },
        {
          message: /Integrity violation: expected exactly 1 user row to be updated, but affected 2/,
        }
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Isolated Disposable Database Transaction & Rollback Integration Test
  // ---------------------------------------------------------------------------
  describe("Disposable Local PostgreSQL 17 Database Test", () => {
    const testDbUrl = process.env.TEST_DATABASE_URL;
    const isTestDbAvailable =
      testDbUrl &&
      (testDbUrl.includes("127.0.0.1") || testDbUrl.includes("localhost")) &&
      !testDbUrl.toLowerCase().includes("supabase");

    if (!isTestDbAvailable) {
      it.skip("Disposable database test skipped (TEST_DATABASE_URL not configured for local test DB)");
      return;
    }

    const testPool = new Pool({ connectionString: testDbUrl, max: 2 });

    it("executes password reset transactionally and confirms rollback on error leaves DB untouched", async () => {
      const client = await testPool.connect();
      const testUserId = randomUUID();
      const testUsername = `test_cashier_${Date.now()}`;
      const originalPassword = "OriginalPassword!2026";
      const originalHash = "scrypt$N=32768,r=8,p=1$fakeSaltBase64$fakeDerivedKey";

      try {
        // 1. Insert temporary user in disposable test DB
        await client.query(
          `INSERT INTO public.users (id, username, full_name, password_hash, role, is_active)
           VALUES ($1, $2, 'Test Cashier', $3, 'CASHIER', true)`,
          [testUserId, testUsername, originalHash]
        );

        // 2. Insert mock active session
        await client.query(
          `INSERT INTO public.user_sessions (token_hash, user_id, ip_address, expires_at)
           VALUES ($1, $2, '127.0.0.1', NOW() + INTERVAL '1 hour')`,
          [randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, ""), testUserId]
        );

        // Verify session exists
        const sessionCountBefore = await client.query<{ cnt: number }>(
          `SELECT COUNT(*)::int AS cnt FROM public.user_sessions WHERE user_id = $1`,
          [testUserId]
        );
        assert.equal(sessionCountBefore.rows[0].cnt, 1);

        // 3. Test ROLLBACK ON FAILURE: Simulate failure in transaction
        await client.query("BEGIN");
        let threwError = false;
        try {
          // Attempt reset with invalid/mismatched username that affects 0 rows
          await executePasswordReset(client, {
            userId: testUserId,
            username: "mismatched_wrong_username",
            newPasswordPlain: "NewSecurePassword!2026",
          });
          await client.query("COMMIT");
        } catch (err) {
          threwError = true;
          await client.query("ROLLBACK");
        }
        assert.equal(threwError, true, "Should have thrown integrity error");

        // Verify that after rollback, user password hash and session are 100% UNCHANGED
        const userAfterRollback = await client.query<{ password_hash: string }>(
          `SELECT password_hash FROM public.users WHERE id = $1`,
          [testUserId]
        );
        assert.equal(
          userAfterRollback.rows[0].password_hash,
          originalHash,
          "User password hash must remain untouched after rollback"
        );

        const sessionAfterRollback = await client.query<{ cnt: number }>(
          `SELECT COUNT(*)::int AS cnt FROM public.user_sessions WHERE user_id = $1`,
          [testUserId]
        );
        assert.equal(
          sessionAfterRollback.rows[0].cnt,
          1,
          "User session must remain active after rollback"
        );

        // 4. Test SUCCESSFUL TRANSACTION:
        await client.query("BEGIN");
        const newPasswordPlain = "BrandNewValidSecret!2026";
        const result = await executePasswordReset(client, {
          userId: testUserId,
          username: testUsername,
          newPasswordPlain,
          resetBy: "TEST_AUDITOR",
        });
        await client.query("COMMIT");

        assert.equal(result.updatedUserId, testUserId);
        assert.equal(result.sessionsInvalidated, 1);

        // Verify user row was updated
        const userAfterSuccess = await client.query<{
          id: string;
          username: string;
          full_name: string;
          role: string;
          is_active: boolean;
          password_hash: string;
        }>(
          `SELECT id, username, full_name, role, is_active, password_hash
           FROM public.users WHERE id = $1`,
          [testUserId]
        );
        const updatedRow = userAfterSuccess.rows[0];

        // All fields PRESERVED
        assert.equal(updatedRow.id, testUserId);
        assert.equal(updatedRow.username, testUsername);
        assert.equal(updatedRow.full_name, "Test Cashier");
        assert.equal(updatedRow.role, "CASHIER");
        assert.equal(updatedRow.is_active, true);

        // Hash updated and validates new password
        assert.notEqual(updatedRow.password_hash, originalHash);
        assert.equal(await verifyPassword(newPasswordPlain, updatedRow.password_hash), true);

        // Sessions invalidated
        const sessionAfterSuccess = await client.query<{ cnt: number }>(
          `SELECT COUNT(*)::int AS cnt FROM public.user_sessions WHERE user_id = $1`,
          [testUserId]
        );
        assert.equal(sessionAfterSuccess.rows[0].cnt, 0);

        // Audit log exists
        const auditLog = await client.query<{ action: string; details: any }>(
          `SELECT action, details FROM public.audit_logs WHERE user_id = $1 AND action = 'PASSWORD_RESET'`,
          [testUserId]
        );
        assert.equal(auditLog.rows.length, 1);
        assert.equal(auditLog.rows[0].action, "PASSWORD_RESET");
        assert.equal(auditLog.rows[0].details.reset_by, "TEST_AUDITOR");
      } finally {
        // Clean up temporary user and audit records
        await client.query(`DELETE FROM public.audit_logs WHERE user_id = $1`, [testUserId]).catch(() => {});
        await client.query(`DELETE FROM public.user_sessions WHERE user_id = $1`, [testUserId]).catch(() => {});
        await client.query(`DELETE FROM public.users WHERE id = $1`, [testUserId]).catch(() => {});
        client.release();
      }
    });

    after(async () => {
      await testPool.end();
    });

    it("reproduces PostgreSQL 42P08 inconsistent types error when $1 is reused across UUID and VARCHAR, and verifies fix succeeds", async () => {
      const client = await testPool.connect();
      try {
        // 1. Reproduce 42P08: Query with reused parameter $1 across UUID (user_id) and VARCHAR (entity_id) fails
        await assert.rejects(
          async () => {
            await client.query({
              name: "stmt_reused_param_42p08_fail",
              text: `INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
                     VALUES ($1, 'PASSWORD_RESET', 'USER', $1, $2, '127.0.0.1')`,
              values: [randomUUID(), JSON.stringify({ test: true })],
            });
          },
          (err: any) => {
            // Must match PostgreSQL error code 42P08
            return (
              err.code === "42P08" ||
              /inconsistent types deduced for parameter \$1/i.test(err.message)
            );
          }
        );

        // 2. Verify fix: Query with distinct parameters and explicit type casts passes without error
        const testUserId = randomUUID();
        const testDetails = JSON.stringify({ test: "clean" });
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO public.users (id, username, full_name, password_hash, role, is_active)
           VALUES ($1, $2, 'FK User', 'dummyhash', 'CASHIER', true)`,
          [testUserId, `tmp_fk_${Date.now()}`]
        );
        await client.query({
          name: "stmt_distinct_param_42p08_fixed",
          text: `INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
                 VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6)`,
          values: [
            testUserId,
            "PASSWORD_RESET",
            "USER",
            testUserId,
            testDetails,
            "127.0.0.1",
          ],
        });
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
    });
  });
});
