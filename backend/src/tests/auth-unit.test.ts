import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import { createApp } from "../app.js";
import { resolveSecurityConfig } from "../config/securityConfig.js";
import { requireRole } from "../middleware/auth.middleware.js";
import {
  SESSION_COOKIE_NAME,
  formatClearSessionCookie,
  formatSessionCookie,
  generateSessionToken,
  hashSessionToken,
  parseCookies,
} from "../modules/auth/cookies.js";
import {
  hashPassword,
  verifyAgainstDummyPassword,
  verifyPassword,
} from "../modules/auth/password.js";
import { AuthService } from "../modules/auth/auth.service.js";
import { UnauthorizedError } from "../errors/appError.js";
import { errorHandler } from "../middleware/error.middleware.js";
import type { NextFunction, Request, Response } from "express";

describe("Phase 3A — Auth Unit Tests (Hashing, Cookies, SecurityConfig & RBAC)", () => {
  it("hashes and verifies passwords with scrypt and timing-safe dummy fallback", async () => {
    const hash = await hashPassword("WorkshopSecret!2026");
    assert.ok(hash.startsWith("scrypt$N=32768,r=8,p=1$"));
    assert.ok(hash.length <= 255);

    assert.equal(await verifyPassword("WorkshopSecret!2026", hash), true);
    assert.equal(await verifyPassword("WrongPassword", hash), false);
    assert.equal(await verifyPassword("WorkshopSecret!2026", "invalid-format"), false);
    assert.equal(await verifyAgainstDummyPassword("Anything123!"), false);
  });

  it("generates 256-bit tokens, hashes to 64-char SHA-256, and formats secure cookies", () => {
    const raw = generateSessionToken();
    assert.ok(raw.length >= 40);
    const hash = hashSessionToken(raw);
    assert.equal(hash.length, 64);
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.notEqual(hash, raw);

    const future = new Date(Date.now() + 3600 * 1000);
    const prodCookie = formatSessionCookie(raw, future, true);
    assert.match(prodCookie, new RegExp(`^${SESSION_COOKIE_NAME}=`));
    assert.match(prodCookie, /HttpOnly/);
    assert.match(prodCookie, /SameSite=Lax/);
    assert.match(prodCookie, /Path=\//);
    assert.match(prodCookie, /; Secure$/);

    const devCookie = formatSessionCookie(raw, future, false);
    assert.doesNotMatch(devCookie, /; Secure/);

    const cleared = formatClearSessionCookie(true);
    assert.match(cleared, /Max-Age=0/);
    assert.match(cleared, /; Secure$/);

    const parsed = parseCookies(`foo=bar; ${SESSION_COOKIE_NAME}=${encodeURIComponent(raw)}`);
    assert.equal(parsed[SESSION_COOKIE_NAME], raw);
  });

  it("enforces explicit non-wildcard ALLOWED_ORIGINS and Secure cookies in production", () => {
    assert.throws(
      () => resolveSecurityConfig({ NODE_ENV: "production" }),
      /ALLOWED_ORIGINS must be explicitly configured/
    );
    assert.throws(
      () =>
        resolveSecurityConfig({
          NODE_ENV: "production",
          ALLOWED_ORIGINS: "*",
        }),
      /Wildcard '\*' is prohibited/
    );

    const prod = resolveSecurityConfig({
      NODE_ENV: "production",
      ALLOWED_ORIGINS: "https://billing.nprcrusher.lk, https://admin.nprcrusher.lk",
    });
    assert.equal(prod.isProduction, true);
    assert.equal(prod.cookieSecure, true);
    assert.equal(prod.trustProxy, false);
    assert.equal(prod.sessionIdleTtlMs, 30 * 60 * 1000);
    assert.equal(prod.sessionMaxLifetimeMs, 12 * 60 * 60 * 1000);
    assert.equal(prod.sessionRenewThresholdMs, 15 * 60 * 1000);
    assert.equal(prod.allowedOrigins.has("https://billing.nprcrusher.lk"), true);
    assert.equal(prod.allowedOrigins.has("http://localhost:5173"), false);

    assert.throws(
      () =>
        resolveSecurityConfig({
          NODE_ENV: "production",
          ALLOWED_ORIGINS: "https://billing.nprcrusher.lk",
          TRUST_PROXY: "true",
        }),
      /Wildcard TRUST_PROXY=true is prohibited/
    );
    assert.equal(
      resolveSecurityConfig({
        TRUST_PROXY: "1",
        SESSION_IDLE_TIMEOUT_MINUTES: "15",
      }).trustProxy,
      1
    );
    assert.equal(
      resolveSecurityConfig({
        TRUST_PROXY: "loopback",
        SESSION_IDLE_TIMEOUT_MINUTES: "15",
      }).sessionIdleTtlMs,
      15 * 60 * 1000
    );
    assert.throws(
      () =>
        resolveSecurityConfig({
          SESSION_IDLE_TIMEOUT_MINUTES: "120",
          SESSION_MAX_LIFETIME_HOURS: "1",
        }),
      /cannot exceed SESSION_MAX_LIFETIME_HOURS/
    );
  });

  it("blocks test-only registerExtraRoutes hook in production", () => {
    const prodConfig = resolveSecurityConfig({
      NODE_ENV: "production",
      ALLOWED_ORIGINS: "https://billing.nprcrusher.lk",
    });

    assert.throws(
      () =>
        createApp({
          pool: {} as Pool,
          securityConfig: prodConfig,
          registerExtraRoutes: () => {},
        }),
      /cannot be registered in production/
    );
  });

  it("requireRole fails closed on missing auth or unknown roles", () => {
    const ownerOnly = requireRole("OWNER");
    let capturedErr: unknown = null;
    const next: NextFunction = (err?: unknown) => {
      capturedErr = err ?? null;
    };

    ownerOnly({} as Request, {} as Response, next);
    assert.equal((capturedErr as { statusCode?: number })?.statusCode, 401);

    capturedErr = null;
    ownerOnly(
      {
        auth: {
          sessionId: "s1",
          expiresAt: new Date(),
          user: {
            id: "u1",
            username: "bad",
            fullName: "Bad",
            role: "SUPERADMIN" as unknown as "OWNER",
          },
        },
      } as Request,
      {} as Response,
      next
    );
    assert.equal((capturedErr as { statusCode?: number })?.statusCode, 403);
  });

  it("permits local LAN RFC 1918 private origins in development and rejects them in production", async () => {
    const { isPrivateNetworkOrigin, createCorsAndOriginMiddleware } = await import(
      "../middleware/security.middleware.js"
    );

    // Private network helper assertions
    assert.equal(isPrivateNetworkOrigin("http://localhost:5173"), true);
    assert.equal(isPrivateNetworkOrigin("http://127.0.0.1:5173"), true);
    assert.equal(isPrivateNetworkOrigin("http://192.168.8.126:5173"), true);
    assert.equal(isPrivateNetworkOrigin("http://10.0.1.50:5173"), true);
    assert.equal(isPrivateNetworkOrigin("http://172.20.10.2:5173"), true);
    assert.equal(isPrivateNetworkOrigin("http://172.15.0.1:5173"), false); // outside 172.16-31
    assert.equal(isPrivateNetworkOrigin("http://172.32.0.1:5173"), false); // outside 172.16-31
    assert.equal(isPrivateNetworkOrigin("https://malicious-external.com"), false);
    assert.equal(isPrivateNetworkOrigin("not-a-valid-url"), false);

    const devOrigins = new Set(["http://localhost:5173"]);
    const devMiddleware = createCorsAndOriginMiddleware(devOrigins, false);
    const prodOrigins = new Set(["https://billing.nprcrusher.lk"]);
    const prodMiddleware = createCorsAndOriginMiddleware(prodOrigins, true);

    // 1. Mobile LAN origin in DEV -> Allowed
    let passed = false;
    let devErr: unknown = null;
    const reqLanDev = {
      get: (header: string) => (header.toLowerCase() === "origin" ? "http://192.168.8.126:5173" : undefined),
      method: "POST",
    } as unknown as Request;
    const headersSet: Record<string, string> = {};
    const resLanDev = {
      setHeader: (k: string, v: string) => { headersSet[k] = v; },
    } as unknown as Response;

    devMiddleware(reqLanDev, resLanDev, (err?: unknown) => {
      if (err) devErr = err;
      else passed = true;
    });
    assert.equal(passed, true, "Mobile LAN origin must pass CORS in development");
    assert.equal(devErr, null);
    assert.equal(headersSet["Access-Control-Allow-Origin"], "http://192.168.8.126:5173");
    assert.equal(headersSet["Access-Control-Allow-Credentials"], "true");

    // 2. Mobile LAN origin in PROD without whitelist -> Rejected with 403 ORIGIN_NOT_ALLOWED
    let prodErr: unknown = null;
    let prodPassed = false;
    const reqLanProd = {
      get: (header: string) => (header.toLowerCase() === "origin" ? "http://192.168.8.126:5173" : undefined),
      method: "POST",
    } as unknown as Request;
    const resLanProd = {
      setHeader: () => {},
    } as unknown as Response;

    prodMiddleware(reqLanProd, resLanProd, (err?: unknown) => {
      if (err) prodErr = err;
      else prodPassed = true;
    });
    assert.equal(prodPassed, false, "Mobile LAN origin must be blocked in production unless in ALLOWED_ORIGINS");
    assert.equal((prodErr as { statusCode?: number })?.statusCode, 403);
    assert.equal((prodErr as { code?: string })?.code, "ORIGIN_NOT_ALLOWED");
  });

  // --------------------------------------------------------------------------
  // CROSS-ROLE PORTAL LOGIN VERIFICATION
  // --------------------------------------------------------------------------
  it("enforces cross-role login restrictions: accepts valid roles on their own portal and rejects cross-portal logins", async () => {
    const ownerPwdHash = await hashPassword("OwnerSecret!2026");
    const cashierPwdHash = await hashPassword("CashierSecret!2026");

    const ownerRow = {
      id: "00000000-0000-0000-0000-000000000001",
      username: "owner_npr",
      password_hash: ownerPwdHash,
      full_name: "Bandara Wijekoon",
      role: "OWNER",
      is_active: true,
    };

    const cashierRow = {
      id: "c0000000-0000-0000-0000-000000000001",
      username: "cashier_sarath",
      password_hash: cashierPwdHash,
      full_name: "Sarath Cashier",
      role: "CASHIER",
      is_active: true,
    };

    function createMockAuthPool(activeUserRow: any) {
      const auditLogs: any[] = [];
      const sessionsCreated: any[] = [];
      let committed = false;
      let rolledBack = false;

      const mockClient = {
        query: async (sql: string, params?: unknown[]) => {
          if (sql === "BEGIN") return { rows: [] };
          if (sql === "COMMIT") {
            committed = true;
            return { rows: [] };
          }
          if (sql === "ROLLBACK") {
            rolledBack = true;
            return { rows: [] };
          }
          if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
          if (sql.includes("SELECT MAX(created_at) AS last_success_at"))
            return { rows: [{ last_success_at: null }] };
          if (sql.includes("SELECT COUNT(*)::int AS cnt"))
            return { rows: [{ cnt: 0, oldest_at: null }] };
          if (sql.includes("FROM public.users"))
            return { rows: activeUserRow ? [activeUserRow] : [] };
          if (sql.includes("INSERT INTO public.audit_logs")) {
            auditLogs.push({ sql, params });
            return { rows: [] };
          }
          if (sql.includes("DELETE FROM public.user_sessions")) return { rows: [] };
          if (sql.includes("INSERT INTO public.user_sessions")) {
            sessionsCreated.push({ sql, params });
            return {
              rows: [
                {
                  id: "sess-1",
                  expires_at: new Date(Date.now() + 3600000),
                  created_at: new Date(),
                },
              ],
            };
          }
          return { rows: [] };
        },
        release: () => {},
      };

      const mockPool = {
        connect: async () => mockClient,
      } as unknown as Pool;

      return { mockPool, auditLogs, sessionsCreated, isCommitted: () => committed };
    }

    const testConfig = resolveSecurityConfig({ NODE_ENV: "development" });

    // 1. Owner on Owner portal -> SUCCESS
    {
      const { mockPool, sessionsCreated, auditLogs } = createMockAuthPool(ownerRow);
      const authService = new AuthService(mockPool, testConfig);
      const result = await authService.login({
        username: "owner_npr",
        password: "OwnerSecret!2026",
        portal: "OWNER",
        ipAddress: "127.0.0.1",
        userAgent: "TestAgent",
      });
      assert.equal(result.user.role, "OWNER");
      assert.equal(sessionsCreated.length, 1, "Session must be created for valid Owner login");
      assert.ok(auditLogs.some((l) => l.params?.[1] === "LOGIN_SUCCEEDED"));
    }

    // 2. Cashier on Cashier portal -> SUCCESS
    {
      const { mockPool, sessionsCreated, auditLogs } = createMockAuthPool(cashierRow);
      const authService = new AuthService(mockPool, testConfig);
      const result = await authService.login({
        username: "cashier_sarath",
        password: "CashierSecret!2026",
        portal: "CASHIER",
        ipAddress: "127.0.0.1",
        userAgent: "TestAgent",
      });
      assert.equal(result.user.role, "CASHIER");
      assert.equal(sessionsCreated.length, 1, "Session must be created for valid Cashier login");
      assert.ok(auditLogs.some((l) => l.params?.[1] === "LOGIN_SUCCEEDED"));
    }

    // 3. Owner credentials on Cashier portal -> REJECT (CROSS_ROLE_LOGIN_FORBIDDEN)
    {
      const { mockPool, sessionsCreated, auditLogs, isCommitted } = createMockAuthPool(ownerRow);
      const authService = new AuthService(mockPool, testConfig);
      let capturedError: any = null;
      try {
        await authService.login({
          username: "owner_npr",
          password: "OwnerSecret!2026",
          portal: "CASHIER",
          ipAddress: "127.0.0.1",
          userAgent: "TestAgent",
        });
      } catch (err) {
        capturedError = err;
      }
      assert.ok(capturedError instanceof UnauthorizedError);
      assert.equal(capturedError.statusCode, 401);
      assert.equal(capturedError.code, "CROSS_ROLE_LOGIN_FORBIDDEN");
      assert.match(capturedError.message, /Only Cashier accounts can sign in through the Cashier Portal/i);
      assert.equal(sessionsCreated.length, 0, "No session must be created for cross-role login attempt");
      assert.equal(isCommitted(), true, "Audit log transaction must be committed");
      assert.ok(
        auditLogs.some(
          (l) =>
            l.params?.[1] === "LOGIN_FAILED" &&
            l.params?.[4]?.includes("CROSS_ROLE_PORTAL_MISMATCH")
        ),
        "Audit log must record CROSS_ROLE_PORTAL_MISMATCH"
      );
    }

    // 4. Cashier credentials on Owner portal -> REJECT (CROSS_ROLE_LOGIN_FORBIDDEN)
    {
      const { mockPool, sessionsCreated, auditLogs, isCommitted } = createMockAuthPool(cashierRow);
      const authService = new AuthService(mockPool, testConfig);
      let capturedError: any = null;
      try {
        await authService.login({
          username: "cashier_sarath",
          password: "CashierSecret!2026",
          portal: "OWNER",
          ipAddress: "127.0.0.1",
          userAgent: "TestAgent",
        });
      } catch (err) {
        capturedError = err;
      }
      assert.ok(capturedError instanceof UnauthorizedError);
      assert.equal(capturedError.statusCode, 401);
      assert.equal(capturedError.code, "CROSS_ROLE_LOGIN_FORBIDDEN");
      assert.match(capturedError.message, /Only Owner accounts can sign in through the Owner Portal/i);
      assert.equal(sessionsCreated.length, 0, "No session must be created for cross-role login attempt");
      assert.equal(isCommitted(), true, "Audit log transaction must be committed");
      assert.ok(
        auditLogs.some(
          (l) =>
            l.params?.[1] === "LOGIN_FAILED" &&
            l.params?.[4]?.includes("CROSS_ROLE_PORTAL_MISMATCH")
        ),
        "Audit log must record CROSS_ROLE_PORTAL_MISMATCH"
      );
    }

    // 5. Invalid credentials on either portal -> REJECT (INVALID_CREDENTIALS)
    {
      const { mockPool, sessionsCreated } = createMockAuthPool(ownerRow);
      const authService = new AuthService(mockPool, testConfig);
      let capturedError: any = null;
      try {
        await authService.login({
          username: "owner_npr",
          password: "WrongPassword!999",
          portal: "OWNER",
          ipAddress: "127.0.0.1",
          userAgent: "TestAgent",
        });
      } catch (err) {
        capturedError = err;
      }
      assert.ok(capturedError instanceof UnauthorizedError);
      assert.equal(capturedError.code, "INVALID_CREDENTIALS");
      assert.equal(sessionsCreated.length, 0);
    }

    // 6. Inactive account on either portal -> REJECT (INVALID_CREDENTIALS)
    {
      const inactiveOwner = { ...ownerRow, is_active: false };
      const { mockPool, sessionsCreated } = createMockAuthPool(inactiveOwner);
      const authService = new AuthService(mockPool, testConfig);
      let capturedError: any = null;
      try {
        await authService.login({
          username: "owner_npr",
          password: "OwnerSecret!2026",
          portal: "OWNER",
          ipAddress: "127.0.0.1",
          userAgent: "TestAgent",
        });
      } catch (err) {
        capturedError = err;
      }
      assert.ok(capturedError instanceof UnauthorizedError);
      assert.equal(capturedError.code, "INVALID_CREDENTIALS");
      assert.equal(sessionsCreated.length, 0);
    }
  });

  it("errorHandler outputs safe diagnostic metadata (SQLSTATE, code, sanitized message) without leaking credentials", () => {
    const errorLogs: string[] = [];
    const origConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      errorLogs.push(args.join(" "));
    };

    try {
      // 1. DatabaseError with SQLSTATE and routine
      const dbErr = Object.assign(new Error("permission denied for table users"), {
        name: "error",
        code: "42501",
        severity: "ERROR",
        routine: "aclcheck_error",
      });

      let responseStatus = 0;
      let responsePayload: any = null;
      const mockRes = {
        status(s: number) {
          responseStatus = s;
          return this;
        },
        json(p: any) {
          responsePayload = p;
        },
        setHeader() {},
      } as unknown as Response;

      errorHandler(dbErr, {} as Request, mockRes, (() => {}) as NextFunction);
      assert.equal(responseStatus, 500);
      assert.equal(responsePayload.error.code, "INTERNAL_ERROR");

      const logged = errorLogs[errorLogs.length - 1];
      assert.ok(logged.includes("[ERROR] Unhandled server error"));
      assert.ok(logged.includes("name=error"));
      assert.ok(logged.includes("code=42501"));
      assert.ok(logged.includes("severity=ERROR"));
      assert.ok(logged.includes("routine=aclcheck_error"));
      assert.ok(logged.includes("permission denied for table users"));

      // 2. Connection error with embedded credential in URL -> must be sanitized
      const connErr = new Error("Failed connecting to postgresql://npr_user:SuperSecretPassword123@db.supabase.co:5432/postgres");
      (connErr as any).code = "SELF_SIGNED_CERT_IN_CHAIN";

      errorHandler(connErr, {} as Request, mockRes, (() => {}) as NextFunction);
      const sanitizedLog = errorLogs[errorLogs.length - 1];
      assert.ok(sanitizedLog.includes("code=SELF_SIGNED_CERT_IN_CHAIN"));
      assert.ok(sanitizedLog.includes("postgresql://npr_user:***@db.supabase.co:5432/postgres"));
      assert.equal(sanitizedLog.includes("SuperSecretPassword123"), false);
    } finally {
      console.error = origConsoleError;
    }
  });
});
