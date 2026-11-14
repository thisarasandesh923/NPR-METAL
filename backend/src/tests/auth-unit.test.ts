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
});
