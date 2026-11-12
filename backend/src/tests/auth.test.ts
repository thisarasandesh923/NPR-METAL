import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import pg from "pg";
import { createApp } from "../app.js";
import type { SecurityConfig } from "../config/securityConfig.js";
import { SESSION_COOKIE_NAME, hashSessionToken } from "../modules/auth/cookies.js";
import { hashPassword } from "../modules/auth/password.js";

const { Pool } = pg;

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

const TEST_URL = getVerifiedLocalTestUrl();
const adminPool = new Pool({ connectionString: TEST_URL, max: 4 });
let appUserPool: pg.Pool;

function extractCookieToken(setCookieHeader: string | null): string | null {
  if (!setCookieHeader) return null;
  const match = new RegExp(`^${SESSION_COOKIE_NAME}=([^;]+)`).exec(setCookieHeader);
  return match ? decodeURIComponent(match[1]) : null;
}

function buildTestConfig(overrides: Partial<SecurityConfig> = {}): SecurityConfig {
  return {
    isProduction: false,
    allowedOrigins: new Set(["http://localhost:5173"]),
    cookieSecure: false,
    trustProxy: 1,
    sessionIdleTtlMs: 30 * 60 * 1000,
    sessionMaxLifetimeMs: 12 * 60 * 60 * 1000,
    sessionRenewThresholdMs: 15 * 60 * 1000,
    loginRateLimitMaxFailures: 5,
    loginRateLimitWindowMs: 15 * 60 * 1000,
    ...overrides,
  };
}

async function startTestServer(config: SecurityConfig = buildTestConfig()): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const app = createApp({
    pool: appUserPool,
    securityConfig: config,
    registerExtraRoutes: (expressApp, { requireAuth, requireRole }) => {
      expressApp.get(
        "/api/test-rbac/owner-only",
        requireAuth,
        requireRole("OWNER"),
        (req, res) => {
          res.status(200).json({ success: true, data: { actor: req.auth?.user } });
        }
      );
      expressApp.get(
        "/api/test-rbac/staff",
        requireAuth,
        requireRole("CASHIER", "OWNER"),
        (req, res) => {
          res.status(200).json({ success: true, data: { actor: req.auth?.user } });
        }
      );
    },
  });

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

describe("Phase 3A — Authentication & RBAC Integration Tests (Isolated PostgreSQL 17 + npr_app_user)", () => {
  const runSuffix = randomUUID().slice(0, 8);
  const ownerUsername = `owner_${runSuffix}`;
  const cashierUsername = `cashier_${runSuffix}`;
  const inactiveUsername = `inactive_${runSuffix}`;
  const ownerPwd = "OwnerStrongPwd!2026#1";
  const cashierPwd = "CashierStrongPwd!2026#2";
  const inactivePwd = "InactiveStrongPwd!2026#3";

  let ownerId = "";
  let cashierId = "";
  let inactiveId = "";

  before(async () => {
    const idCheck = await adminPool.query<{ db: string }>(
      "SELECT current_database() AS db"
    );
    assert.equal(idCheck.rows[0]?.db, "npr_test_db");

    const ownerHash = await hashPassword(ownerPwd);
    const cashierHash = await hashPassword(cashierPwd);
    const inactiveHash = await hashPassword(inactivePwd);

    ownerId = (
      await adminPool.query<{ id: string }>(
        `INSERT INTO public.users (username, password_hash, full_name, role, is_active)
         VALUES ($1, $2, 'Test Owner', 'OWNER', true) RETURNING id`,
        [ownerUsername, ownerHash]
      )
    ).rows[0].id;

    cashierId = (
      await adminPool.query<{ id: string }>(
        `INSERT INTO public.users (username, password_hash, full_name, role, is_active)
         VALUES ($1, $2, 'Test Cashier', 'CASHIER', true) RETURNING id`,
        [cashierUsername, cashierHash]
      )
    ).rows[0].id;

    inactiveId = (
      await adminPool.query<{ id: string }>(
        `INSERT INTO public.users (username, password_hash, full_name, role, is_active)
         VALUES ($1, $2, 'Test Inactive', 'CASHIER', false) RETURNING id`,
        [inactiveUsername, inactiveHash]
      )
    ).rows[0].id;

    const appUrl = new URL(TEST_URL);
    appUrl.username = "npr_app_user";
    appUrl.password = process.env.TEST_APP_USER_PASSWORD ?? "test_only_app_password_2b2";
    appUserPool = new Pool({ connectionString: appUrl.toString(), max: 6 });
  });

  after(async () => {
    await appUserPool.end();
    await adminPool.end();
  });

  it("1-7, 10-18, 20-23. Full OWNER & CASHIER auth, cookie security, RBAC, forged roles, SQLi, CSRF, CORS & zero secret leakage", async () => {
    const loggedLines: string[] = [];
    const origLog = console.log;
    const origWarn = console.warn;
    const origErr = console.error;
    console.log = (...args: unknown[]) => loggedLines.push(args.map(String).join(" "));
    console.warn = (...args: unknown[]) => loggedLines.push(args.map(String).join(" "));
    console.error = (...args: unknown[]) => loggedLines.push(args.map(String).join(" "));

    const srv = await startTestServer();
    try {
      // 20a. Missing CSRF header blocked on state-changing requests
      const noCsrf = await fetch(`${srv.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: ownerUsername, password: ownerPwd }),
      });
      assert.equal(noCsrf.status, 403);
      const noCsrfJson = (await noCsrf.json()) as { error: { code: string } };
      assert.equal(noCsrfJson.error.code, "CSRF_VALIDATION_FAILED");

      // 20b. Disallowed Origin rejected with 403 and zero ACAO header
      const badOrigin = await fetch(`${srv.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          Origin: "https://evil-attacker.example",
        },
        body: JSON.stringify({ username: ownerUsername, password: ownerPwd }),
      });
      assert.equal(badOrigin.status, 403);
      assert.equal(badOrigin.headers.get("access-control-allow-origin"), null);

      // 3, 4, 5, 18. Wrong password, unknown account, inactive account, SQL injection -> generic 401
      const expectedGenericBodies: string[] = [];
      let badIdx = 1;
      for (const badCreds of [
        { username: ownerUsername, password: "WrongPassword999!" },
        { username: `nonexistent_${runSuffix}`, password: "SomePassword123!" },
        { username: inactiveUsername, password: inactivePwd },
        { username: `${ownerUsername}' OR '1'='1`, password: "x" },
        { username: "admin'; DROP TABLE users; --", password: "x" },
      ]) {
        const res = await fetch(`${srv.baseUrl}/api/auth/login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Requested-With": "XMLHttpRequest",
            "X-Forwarded-For": `203.0.113.${badIdx++}`,
            Origin: "http://localhost:5173",
          },
          body: JSON.stringify(badCreds),
        });
        assert.equal(res.status, 401);
        assert.equal(res.headers.get("set-cookie"), null);
        const bodyText = await res.text();
        expectedGenericBodies.push(bodyText);
        assert.doesNotMatch(bodyText, /password_hash|users|postgres|syntax/i);
      }
      // Identical generic message prevents account enumeration
      assert.equal(new Set(expectedGenericBodies).size, 1);

      // 13 & 14. GET /api/auth/me with missing & invalid session rejected
      const missingRes = await fetch(`${srv.baseUrl}/api/auth/me`);
      assert.equal(missingRes.status, 401);

      const invalidRes = await fetch(`${srv.baseUrl}/api/auth/me`, {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=invalid_forged_token_abcdefghijklmnopqrstuvwxyz` },
      });
      assert.equal(invalidRes.status, 401);

      // 1 & 6 & 7. Successful OWNER login
      const ownerLogin = await fetch(`${srv.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "X-Forwarded-For": "203.0.113.100",
          Origin: "http://localhost:5173",
        },
        body: JSON.stringify({ username: ownerUsername.toUpperCase(), password: ownerPwd }),
      });
      assert.equal(ownerLogin.status, 200);
      assert.equal(ownerLogin.headers.get("access-control-allow-origin"), "http://localhost:5173");
      assert.equal(ownerLogin.headers.get("access-control-allow-credentials"), "true");
      assert.match(ownerLogin.headers.get("cache-control") ?? "", /no-store/i);

      const ownerSetCookie = ownerLogin.headers.get("set-cookie") ?? "";
      assert.match(ownerSetCookie, /HttpOnly/i);
      assert.match(ownerSetCookie, /SameSite=Lax/i);
      const ownerToken = extractCookieToken(ownerSetCookie)!;
      assert.ok(ownerToken && ownerToken.length >= 40);

      const ownerBody = (await ownerLogin.json()) as {
        success: boolean;
        data: { user: Record<string, unknown> };
      };
      assert.equal(ownerBody.success, true);
      assert.equal(ownerBody.data.user.role, "OWNER");
      assert.equal(ownerBody.data.user.id, ownerId);
      assert.equal("password_hash" in ownerBody.data.user, false);

      // Verify DB stored ONLY SHA-256 hash, never plaintext token
      const ownerTokenHash = hashSessionToken(ownerToken);
      const dbSess = await adminPool.query<{ token_hash: string; user_id: string }>(
        "SELECT token_hash, user_id FROM public.user_sessions WHERE user_id = $1",
        [ownerId]
      );
      assert.equal(dbSess.rows.some((r) => r.token_hash === ownerTokenHash), true);
      assert.equal(dbSess.rows.some((r) => r.token_hash === ownerToken), false);

      // 12 & 15. OWNER GET /auth/me & OWNER-only route succeed
      const ownerMe = await fetch(`${srv.baseUrl}/api/auth/me`, {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${ownerToken}` },
      });
      assert.equal(ownerMe.status, 200);
      const ownerMeText = await ownerMe.text();
      assert.doesNotMatch(ownerMeText, /password_hash/i);

      const ownerOnlyOk = await fetch(`${srv.baseUrl}/api/test-rbac/owner-only`, {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${ownerToken}` },
      });
      assert.equal(ownerOnlyOk.status, 200);

      // 2 & 16 & 17. CASHIER login with forged role:'OWNER' stays CASHIER & forbidden from OWNER route
      const cashierLogin = await fetch(`${srv.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-NPR-CSRF": "1",
          "X-Forwarded-For": "203.0.113.101",
        },
        body: JSON.stringify({
          username: cashierUsername,
          password: cashierPwd,
          role: "OWNER",
        }),
      });
      assert.equal(cashierLogin.status, 200);
      const cashierBody = (await cashierLogin.json()) as {
        data: { user: { id: string; role: string } };
      };
      assert.equal(cashierBody.data.user.role, "CASHIER");
      assert.equal(cashierBody.data.user.id, cashierId);
      const cashierToken = extractCookieToken(cashierLogin.headers.get("set-cookie"))!;

      // Cashier forbidden from OWNER route even with spoofed header
      const cashierForbidden = await fetch(`${srv.baseUrl}/api/test-rbac/owner-only`, {
        headers: {
          Cookie: `${SESSION_COOKIE_NAME}=${cashierToken}`,
          "X-User-Role": "OWNER",
        },
      });
      assert.equal(cashierForbidden.status, 403);

      // Cashier allowed on staff route
      const cashierStaff = await fetch(`${srv.baseUrl}/api/test-rbac/staff`, {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${cashierToken}` },
      });
      assert.equal(cashierStaff.status, 200);

      // Session fixation check: logging in while holding old ownerToken invalidates old session
      const reLogin = await fetch(`${srv.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "X-Forwarded-For": "203.0.113.100",
          Cookie: `${SESSION_COOKIE_NAME}=${ownerToken}`,
        },
        body: JSON.stringify({ username: ownerUsername, password: ownerPwd }),
      });
      assert.equal(reLogin.status, 200);
      const rotatedToken = extractCookieToken(reLogin.headers.get("set-cookie"))!;
      assert.notEqual(rotatedToken, ownerToken);

      const staleMe = await fetch(`${srv.baseUrl}/api/auth/me`, {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${ownerToken}` },
      });
      assert.equal(staleMe.status, 401);

      // 10 & 11. Logout invalidates session and repeated logout succeeds idempotently
      const logout1 = await fetch(`${srv.baseUrl}/api/auth/logout`, {
        method: "POST",
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          Cookie: `${SESSION_COOKIE_NAME}=${rotatedToken}`,
        },
      });
      assert.equal(logout1.status, 200);
      assert.match(logout1.headers.get("set-cookie") ?? "", /Max-Age=0/);

      const afterLogoutMe = await fetch(`${srv.baseUrl}/api/auth/me`, {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${rotatedToken}` },
      });
      assert.equal(afterLogoutMe.status, 401);

      const logout2 = await fetch(`${srv.baseUrl}/api/auth/logout`, {
        method: "POST",
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          Cookie: `${SESSION_COOKIE_NAME}=${rotatedToken}`,
        },
      });
      assert.equal(logout2.status, 200);

      // 22. Assert no sensitive data appeared in console logs or audit_logs.details
      const joinedLogs = loggedLines.join("\n");
      assert.doesNotMatch(joinedLogs, new RegExp(ownerPwd));
      assert.doesNotMatch(joinedLogs, new RegExp(cashierPwd));
      assert.doesNotMatch(joinedLogs, new RegExp(ownerToken));
      assert.doesNotMatch(joinedLogs, new RegExp(cashierToken));

      const auditRows = await adminPool.query<{ details: Record<string, unknown> }>(
        "SELECT details FROM public.audit_logs WHERE created_at >= NOW() - INTERVAL '5 minutes'"
      );
      const auditText = JSON.stringify(auditRows.rows);
      assert.doesNotMatch(auditText, new RegExp(ownerPwd));
      assert.doesNotMatch(auditText, new RegExp(ownerToken));
      assert.doesNotMatch(auditText, new RegExp(cashierToken));
    } finally {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origErr;
      await srv.close();
    }
  });

  it("5b, 8 & 9. Enforces session revocation, disabled user cutoff, sliding renewal cap & expiration", async () => {
    // Configure short max lifetime & threshold so we can test sliding renewal capped at created_at + maxLifetime
    const srv = await startTestServer(
      buildTestConfig({
        sessionIdleTtlMs: 60_000,
        sessionMaxLifetimeMs: 120_000,
        sessionRenewThresholdMs: 90_000,
      })
    );

    try {
      const loginRes = await fetch(`${srv.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({ username: cashierUsername, password: cashierPwd }),
      });
      assert.equal(loginRes.status, 200);
      const token = extractCookieToken(loginRes.headers.get("set-cookie"))!;
      const tokenHash = hashSessionToken(token);

      // Sliding renewal updates expires_at but clamps to created_at + 120s
      const renewRes = await fetch(`${srv.baseUrl}/api/auth/me`, {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${token}` },
      });
      assert.equal(renewRes.status, 200);
      assert.ok(renewRes.headers.get("set-cookie"));

      // Simulate past absolute lifetime (created_at backdated > 120s ago even while expires_at is future) -> MUST reject
      await adminPool.query(
        "UPDATE public.user_sessions SET created_at = NOW() - INTERVAL '10 minutes', expires_at = NOW() + INTERVAL '1 hour' WHERE token_hash = $1",
        [tokenHash]
      );
      const absExpired = await fetch(`${srv.baseUrl}/api/auth/me`, {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${token}` },
      });
      assert.equal(absExpired.status, 401);

      // Fresh login -> test idle expiration (expires_at <= NOW())
      const login2 = await fetch(`${srv.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify({ username: cashierUsername, password: cashierPwd }),
      });
      const token2 = extractCookieToken(login2.headers.get("set-cookie"))!;
      await adminPool.query(
        "UPDATE public.user_sessions SET expires_at = NOW() - INTERVAL '1 second' WHERE token_hash = $1",
        [hashSessionToken(token2)]
      );
      const idleExpired = await fetch(`${srv.baseUrl}/api/auth/me`, {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${token2}` },
      });
      assert.equal(idleExpired.status, 401);

      // Fresh login -> test remote session revocation (DELETE from user_sessions)
      const login3 = await fetch(`${srv.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify({ username: cashierUsername, password: cashierPwd }),
      });
      const token3 = extractCookieToken(login3.headers.get("set-cookie"))!;
      await adminPool.query("DELETE FROM public.user_sessions WHERE token_hash = $1", [
        hashSessionToken(token3),
      ]);
      const revoked = await fetch(`${srv.baseUrl}/api/auth/me`, {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${token3}` },
      });
      assert.equal(revoked.status, 401);

      // Fresh login -> test disabling user immediately kills active session
      const login4 = await fetch(`${srv.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify({ username: cashierUsername, password: cashierPwd }),
      });
      const token4 = extractCookieToken(login4.headers.get("set-cookie"))!;
      await adminPool.query("UPDATE public.users SET is_active = false WHERE id = $1", [
        cashierId,
      ]);
      try {
        const disabledMe = await fetch(`${srv.baseUrl}/api/auth/me`, {
          headers: { Cookie: `${SESSION_COOKIE_NAME}=${token4}` },
        });
        assert.equal(disabledMe.status, 401);
      } finally {
        await adminPool.query("UPDATE public.users SET is_active = true WHERE id = $1", [
          cashierId,
        ]);
      }
    } finally {
      await srv.close();
    }
  });

  it("19. Enforces durable PostgreSQL-backed rate limiting across server restarts", async () => {
    const targetUsername = `ratelimit_${runSuffix}`;
    const targetHash = await hashPassword("ValidRateLimitPwd!123");
    await adminPool.query(
      `INSERT INTO public.users (username, password_hash, full_name, role, is_active)
       VALUES ($1, $2, 'Rate Limit Cashier', 'CASHIER', true)`,
      [targetUsername, targetHash]
    );

    // Clear prior IP failures simulation using 1 trusted proxy hop in test config
    const testIp = `198.51.100.${Math.floor(Math.random() * 200) + 10}`;
    const rlConfig = buildTestConfig({ trustProxy: 1, loginRateLimitMaxFailures: 5 });

    // Server instance #1 receives 5 bad logins with varying case/whitespace on same username
    const srv1 = await startTestServer(rlConfig);
    try {
      const variations = [
        targetUsername,
        targetUsername.toUpperCase(),
        `  ${targetUsername}  `,
        ` ${targetUsername.toUpperCase()}`,
        targetUsername,
      ];
      for (const variant of variations) {
        const failRes = await fetch(`${srv1.baseUrl}/api/auth/login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Requested-With": "XMLHttpRequest",
            "X-Forwarded-For": testIp,
          },
          body: JSON.stringify({ username: variant, password: "WrongPassword!" }),
        });
        assert.equal(failRes.status, 401);
      }
    } finally {
      await srv1.close();
    }

    // Server instance #2 (simulating full backend restart) MUST STILL block attempt #6 with 429
    const srv2 = await startTestServer(rlConfig);
    try {
      const blockedRes = await fetch(`${srv2.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "X-Forwarded-For": testIp,
        },
        body: JSON.stringify({ username: targetUsername, password: "ValidRateLimitPwd!123" }),
      });
      assert.equal(blockedRes.status, 429);
      const retryAfter = Number(blockedRes.headers.get("retry-after"));
      assert.ok(retryAfter > 0 && retryAfter <= 900);
      const body = (await blockedRes.json()) as { error: { code: string } };
      assert.equal(body.error.code, "RATE_LIMIT_EXCEEDED");
    } finally {
      await srv2.close();
    }
  });

  it("24. Rejects Origin:null, untrusted CORS preflight, bad Referer, Sec-Fetch-Site:cross-site, spoofed X-Forwarded-For, and handles concurrent logout/renewal safely", async () => {
    // 24a. Strict CSRF / CORS / Fetch Metadata checks
    const srv = await startTestServer(buildTestConfig({ trustProxy: false }));
    try {
      const nullOrigin = await fetch(`${srv.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          Origin: "null",
        },
        body: JSON.stringify({ username: ownerUsername, password: ownerPwd }),
      });
      assert.equal(nullOrigin.status, 403);
      assert.equal(nullOrigin.headers.get("access-control-allow-origin"), null);

      const preflightDenied = await fetch(`${srv.baseUrl}/api/auth/login`, {
        method: "OPTIONS",
        headers: {
          Origin: "https://evil.example",
          "Access-Control-Request-Method": "POST",
        },
      });
      assert.equal(preflightDenied.status, 403);
      assert.equal(preflightDenied.headers.get("access-control-allow-origin"), null);

      const badReferer = await fetch(`${srv.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          Referer: "https://evil.example/phish.html",
        },
        body: JSON.stringify({ username: ownerUsername, password: ownerPwd }),
      });
      assert.equal(badReferer.status, 403);

      // Cross-site top-level GET navigation attempt blocked by Fetch Metadata
      const crossSiteGet = await fetch(`${srv.baseUrl}/api/auth/me`, {
        headers: { "Sec-Fetch-Site": "cross-site" },
      });
      assert.equal(crossSiteGet.status, 403);

      // 24b. Untrusted X-Forwarded-For cannot bypass IP lockout when trustProxy=false
      for (let i = 0; i < 5; i++) {
        const failRes = await fetch(`${srv.baseUrl}/api/auth/login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Requested-With": "XMLHttpRequest",
            "X-Forwarded-For": `198.51.101.${i + 1}`,
          },
          body: JSON.stringify({
            username: `spoof_user_${runSuffix}_${i}`,
            password: "WrongPassword!",
          }),
        });
        assert.equal(failRes.status, 401);
      }
      const sixthWithDifferentHeader = await fetch(`${srv.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "X-Forwarded-For": "198.51.101.250",
        },
        body: JSON.stringify({ username: ownerUsername, password: ownerPwd }),
      });
      assert.equal(sixthWithDifferentHeader.status, 429);
    } finally {
      await srv.close();
    }

    // 24c. Concurrent logout vs sliding renewal race leaves session strictly invalidated
    const raceSrv = await startTestServer(
      buildTestConfig({
        trustProxy: 1,
        sessionIdleTtlMs: 60_000,
        sessionMaxLifetimeMs: 120_000,
        sessionRenewThresholdMs: 90_000,
      })
    );
    try {
      const loginRes = await fetch(`${raceSrv.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "X-Forwarded-For": "203.0.113.222",
        },
        body: JSON.stringify({ username: cashierUsername, password: cashierPwd }),
      });
      assert.equal(loginRes.status, 200);
      const token = extractCookieToken(loginRes.headers.get("set-cookie"))!;

      const [meRace, logoutRace] = await Promise.all([
        fetch(`${raceSrv.baseUrl}/api/auth/me`, {
          headers: { Cookie: `${SESSION_COOKIE_NAME}=${token}` },
        }),
        fetch(`${raceSrv.baseUrl}/api/auth/logout`, {
          method: "POST",
          headers: {
            "X-Requested-With": "XMLHttpRequest",
            Cookie: `${SESSION_COOKIE_NAME}=${token}`,
          },
        }),
      ]);
      assert.equal(logoutRace.status, 200);
      assert.ok(meRace.status === 200 || meRace.status === 401);

      const afterRaceMe = await fetch(`${raceSrv.baseUrl}/api/auth/me`, {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${token}` },
      });
      assert.equal(afterRaceMe.status, 401);
    } finally {
      await raceSrv.close();
    }
  });
});