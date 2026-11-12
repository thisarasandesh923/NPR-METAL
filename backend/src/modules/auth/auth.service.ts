import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { SecurityConfig } from "../../config/securityConfig.js";
import { TooManyRequestsError, UnauthorizedError } from "../../errors/appError.js";
import {
  acquireLoginThrottleLocks,
  createSession,
  deleteSessionByTokenHash,
  findSessionWithUserByTokenHash,
  findUserForLogin,
  getLoginThrottleState,
  insertAuthAuditLog,
  purgeExpiredUserSessions,
  renewSessionExpiry,
} from "./auth.repository.js";
import {
  isValidUserRole,
  type AuthContext,
  type SafeAuthUser,
} from "./auth.types.js";
import { generateSessionToken, hashSessionToken } from "./cookies.js";
import { verifyAgainstDummyPassword, verifyPassword } from "./password.js";

export interface LoginInput {
  username: string;
  password: string;
  ipAddress: string;
  userAgent: string | null;
  existingSessionToken?: string;
}

export interface LoginResult {
  rawToken: string;
  expiresAt: Date;
  user: SafeAuthUser;
}

export interface SessionAuthenticationResult {
  auth: AuthContext;
  renewedExpiresAt: Date | null;
}

function hashUsernameKey(normalizedUsername: string): string {
  return createHash("sha256")
    .update(`login:${normalizedUsername}`)
    .digest("hex");
}

function normalizeIpAddress(rawIp: string): string {
  const trimmed = rawIp.trim();
  const unmapped = trimmed.startsWith("::ffff:") ? trimmed.slice(7) : trimmed;
  return (unmapped || "unknown").slice(0, 45);
}

function normalizeUserAgent(rawUa: string | null): string | null {
  if (!rawUa) {
    return null;
  }
  const trimmed = rawUa.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 512) : null;
}

export class AuthService {
  constructor(
    private readonly pool: Pool,
    private readonly config: SecurityConfig
  ) {}

  async login(input: LoginInput): Promise<LoginResult> {
    const normalizedUsername = input.username.trim().toLowerCase();
    const userEntityId = hashUsernameKey(normalizedUsername);
    const ipAddress = normalizeIpAddress(input.ipAddress);
    const userAgent = normalizeUserAgent(input.userAgent);

    const client = await this.pool.connect();
    let inTransaction = false;
    try {
      await client.query("BEGIN");
      inTransaction = true;

      await acquireLoginThrottleLocks(client, userEntityId, ipAddress);

      const throttle = await getLoginThrottleState(client, {
        userEntityId,
        ipAddress,
        windowMs: this.config.loginRateLimitWindowMs,
      });

      const isUserThrottled =
        throttle.userFailureCount >= this.config.loginRateLimitMaxFailures;
      const isIpThrottled =
        throttle.ipFailureCount >= this.config.loginRateLimitMaxFailures;

      if (isUserThrottled || isIpThrottled) {
        const oldestRelevant = [
          isUserThrottled ? throttle.userOldestFailureAt : null,
          isIpThrottled ? throttle.ipOldestFailureAt : null,
        ]
          .filter((d): d is Date => d !== null)
          .sort((a, b) => a.getTime() - b.getTime())[0];

        const retryAfterMs = oldestRelevant
          ? oldestRelevant.getTime() +
            this.config.loginRateLimitWindowMs -
            Date.now()
          : this.config.loginRateLimitWindowMs;

        await client.query("COMMIT");
        inTransaction = false;
        throw new TooManyRequestsError(Math.max(1, Math.ceil(retryAfterMs / 1000)));
      }

      const userRow = await findUserForLogin(client, normalizedUsername);

      if (!userRow || !userRow.is_active) {
        await verifyAgainstDummyPassword(input.password);
        await insertAuthAuditLog(client, {
          userId: null,
          action: "LOGIN_FAILED",
          entityType: "AUTH_LOGIN",
          entityId: userEntityId,
          details: {
            reason: userRow ? "INACTIVE_USER" : "UNKNOWN_USER",
          },
          ipAddress,
        });
        await client.query("COMMIT");
        inTransaction = false;
        throw new UnauthorizedError(
          "Invalid username or password.",
          "INVALID_CREDENTIALS"
        );
      }

      const passwordValid = await verifyPassword(
        input.password,
        userRow.password_hash
      );

      if (!passwordValid || !isValidUserRole(userRow.role)) {
        await insertAuthAuditLog(client, {
          userId: userRow.id,
          action: "LOGIN_FAILED",
          entityType: "AUTH_LOGIN",
          entityId: userEntityId,
          details: {
            reason: !passwordValid ? "INVALID_PASSWORD" : "INVALID_ROLE",
          },
          ipAddress,
        });
        await client.query("COMMIT");
        inTransaction = false;
        throw new UnauthorizedError(
          "Invalid username or password.",
          "INVALID_CREDENTIALS"
        );
      }

      // Session fixation defense & opportunistic expired session cleanup for this account
      if (input.existingSessionToken) {
        const oldHash = hashSessionToken(input.existingSessionToken);
        await deleteSessionByTokenHash(client, oldHash);
      }
      await purgeExpiredUserSessions(client, userRow.id);

      const rawToken = generateSessionToken();
      const tokenHash = hashSessionToken(rawToken);
      const requestedExpiresAt = new Date(
        Date.now() + this.config.sessionIdleTtlMs
      );

      const createdSession = await createSession(client, {
        tokenHash,
        userId: userRow.id,
        ipAddress,
        userAgent,
        expiresAt: requestedExpiresAt,
      });

      await insertAuthAuditLog(client, {
        userId: userRow.id,
        action: "LOGIN_SUCCEEDED",
        entityType: "AUTH_LOGIN",
        entityId: userEntityId,
        details: {
          sessionId: createdSession.id,
          role: userRow.role,
        },
        ipAddress,
      });

      await client.query("COMMIT");
      inTransaction = false;

      return {
        rawToken,
        expiresAt: createdSession.expiresAt,
        user: {
          id: userRow.id,
          username: userRow.username,
          fullName: userRow.full_name,
          role: userRow.role,
        },
      };
    } catch (err) {
      if (inTransaction) {
        await client.query("ROLLBACK").catch(() => {});
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async logout(params: {
    rawToken?: string;
    ipAddress: string;
  }): Promise<void> {
    if (!params.rawToken) {
      return;
    }

    const tokenHash = hashSessionToken(params.rawToken);
    const ipAddress = normalizeIpAddress(params.ipAddress);

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const deleted = await deleteSessionByTokenHash(client, tokenHash);
      if (deleted) {
        await insertAuthAuditLog(client, {
          userId: deleted.userId,
          action: "LOGOUT",
          entityType: "AUTH_SESSION",
          entityId: deleted.id,
          details: {},
          ipAddress,
        });
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async authenticateSession(
    rawToken: string
  ): Promise<SessionAuthenticationResult> {
    if (!rawToken || rawToken.length < 32 || rawToken.length > 256) {
      throw new UnauthorizedError("Authentication required.", "UNAUTHORIZED");
    }

    const tokenHash = hashSessionToken(rawToken);
    const row = await findSessionWithUserByTokenHash(this.pool, tokenHash);

    if (!row) {
      throw new UnauthorizedError("Authentication required.", "UNAUTHORIZED");
    }

    const nowMs = Date.now();
    const absoluteCapMs =
      row.created_at.getTime() + this.config.sessionMaxLifetimeMs;
    const isIdleExpired = row.expires_at.getTime() <= nowMs;
    const isAbsoluteExpired = absoluteCapMs <= nowMs;

    if (
      isIdleExpired ||
      isAbsoluteExpired ||
      !row.is_active ||
      !isValidUserRole(row.role)
    ) {
      // Clean up invalid/expired/deactivated session immediately
      await deleteSessionByTokenHash(this.pool, tokenHash).catch(() => {});
      throw new UnauthorizedError(
        "Session is invalid or expired.",
        "UNAUTHORIZED"
      );
    }

    let effectiveExpiresAt = row.expires_at;
    let renewedExpiresAt: Date | null = null;

    const remainingMs = row.expires_at.getTime() - nowMs;
    if (remainingMs < this.config.sessionRenewThresholdMs) {
      const candidateMs = Math.min(
        nowMs + this.config.sessionIdleTtlMs,
        absoluteCapMs
      );
      if (candidateMs > row.expires_at.getTime()) {
        const updated = await renewSessionExpiry(this.pool, {
          sessionId: row.session_id,
          newExpiresAt: new Date(candidateMs),
        });
        if (!updated) {
          // Session was concurrently revoked, logged out, or expired during renewal
          throw new UnauthorizedError(
            "Session is invalid or expired.",
            "UNAUTHORIZED"
          );
        }
        effectiveExpiresAt = updated;
        renewedExpiresAt = updated;
      }
    }

    return {
      auth: {
        sessionId: row.session_id,
        expiresAt: effectiveExpiresAt,
        user: {
          id: row.id,
          username: row.username,
          fullName: row.full_name,
          role: row.role,
        },
      },
      renewedExpiresAt,
    };
  }
}
