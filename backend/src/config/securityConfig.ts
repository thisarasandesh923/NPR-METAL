export type TrustProxySetting = boolean | number | "loopback";

export interface SecurityConfig {
  isProduction: boolean;
  allowedOrigins: ReadonlySet<string>;
  cookieSecure: boolean;
  trustProxy: TrustProxySetting;
  sessionIdleTtlMs: number;
  sessionMaxLifetimeMs: number;
  sessionRenewThresholdMs: number;
  loginRateLimitMaxFailures: number;
  loginRateLimitWindowMs: number;
}

const DEFAULT_DEV_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

const DEFAULT_IDLE_TIMEOUT_MINUTES = 30;
const MIN_IDLE_TIMEOUT_MINUTES = 5;
const MAX_IDLE_TIMEOUT_MINUTES = 480;

const DEFAULT_MAX_LIFETIME_HOURS = 12;
const MIN_MAX_LIFETIME_HOURS = 1;
const MAX_MAX_LIFETIME_HOURS = 24;

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

function parseTrustProxy(rawValue: string | undefined): TrustProxySetting {
  const trimmed = rawValue?.trim().toLowerCase();
  if (!trimmed || trimmed === "false" || trimmed === "0") {
    return false;
  }
  if (trimmed === "true") {
    throw new Error(
      "Wildcard TRUST_PROXY=true is prohibited; specify a hop count (e.g. '1') or 'loopback'."
    );
  }
  if (trimmed === "loopback") {
    return "loopback";
  }
  const hops = Number(trimmed);
  if (Number.isInteger(hops) && hops >= 1 && hops <= 5) {
    return hops;
  }
  throw new Error(
    `Invalid TRUST_PROXY value "${rawValue}"; expected false, loopback, or integer hop count 1-5.`
  );
}

function parseBoundedIntEnv(
  rawValue: string | undefined,
  envName: string,
  defaultValue: number,
  minValue: number,
  maxValue: number
): number {
  const trimmed = rawValue?.trim();
  if (!trimmed) {
    return defaultValue;
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < minValue || parsed > maxValue) {
    throw new Error(
      `Invalid ${envName} value "${rawValue}"; expected integer between ${minValue} and ${maxValue}.`
    );
  }
  return parsed;
}

function parseAllowedOrigins(
  rawOrigins: string | undefined,
  isProduction: boolean
): ReadonlySet<string> {
  const trimmed = rawOrigins?.trim();
  if (!trimmed) {
    if (isProduction) {
      throw new Error(
        "ALLOWED_ORIGINS must be explicitly configured in production."
      );
    }
    return new Set(DEFAULT_DEV_ORIGINS);
  }

  const parsedOrigins = new Set<string>();
  for (const part of trimmed.split(",")) {
    const candidate = part.trim();
    if (!candidate) {
      continue;
    }
    if (candidate === "*") {
      throw new Error("Wildcard '*' is prohibited in ALLOWED_ORIGINS.");
    }

    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      throw new Error(`Invalid origin entry in ALLOWED_ORIGINS: ${candidate}`);
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(
        `ALLOWED_ORIGINS entries must use http or https protocol: ${candidate}`
      );
    }

    parsedOrigins.add(url.origin);
  }

  if (isProduction && parsedOrigins.size === 0) {
    throw new Error(
      "ALLOWED_ORIGINS must contain at least one valid origin in production."
    );
  }

  return parsedOrigins;
}

export function resolveSecurityConfig(
  env: NodeJS.ProcessEnv = process.env
): SecurityConfig {
  const isProduction = env.NODE_ENV?.trim().toLowerCase() === "production";
  const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS, isProduction);
  const cookieSecure =
    isProduction || env.COOKIE_SECURE?.trim().toLowerCase() === "true";
  const trustProxy = parseTrustProxy(env.TRUST_PROXY);

  const idleMinutes = parseBoundedIntEnv(
    env.SESSION_IDLE_TIMEOUT_MINUTES,
    "SESSION_IDLE_TIMEOUT_MINUTES",
    DEFAULT_IDLE_TIMEOUT_MINUTES,
    MIN_IDLE_TIMEOUT_MINUTES,
    MAX_IDLE_TIMEOUT_MINUTES
  );
  const maxLifetimeHours = parseBoundedIntEnv(
    env.SESSION_MAX_LIFETIME_HOURS,
    "SESSION_MAX_LIFETIME_HOURS",
    DEFAULT_MAX_LIFETIME_HOURS,
    MIN_MAX_LIFETIME_HOURS,
    MAX_MAX_LIFETIME_HOURS
  );

  const sessionIdleTtlMs = idleMinutes * 60 * 1000;
  const sessionMaxLifetimeMs = maxLifetimeHours * 60 * 60 * 1000;
  if (sessionIdleTtlMs > sessionMaxLifetimeMs) {
    throw new Error(
      "SESSION_IDLE_TIMEOUT_MINUTES cannot exceed SESSION_MAX_LIFETIME_HOURS."
    );
  }

  return {
    isProduction,
    allowedOrigins,
    cookieSecure,
    trustProxy,
    sessionIdleTtlMs,
    sessionMaxLifetimeMs,
    sessionRenewThresholdMs: Math.floor(sessionIdleTtlMs / 2),
    loginRateLimitMaxFailures: 5,
    loginRateLimitWindowMs: FIFTEEN_MINUTES_MS,
  };
}
