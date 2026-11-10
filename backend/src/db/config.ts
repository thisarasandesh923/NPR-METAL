const LOCAL_TEST_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const INSECURE_REMOTE_SSL_MODES = new Set([
  "disable",
  "allow",
  "prefer",
  "no-verify",
]);

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return LOCAL_TEST_HOSTS.has(normalized);
}

function decodeUsername(rawUsername: string): string {
  try {
    return decodeURIComponent(rawUsername).trim().toLowerCase();
  } catch {
    return rawUsername.trim().toLowerCase();
  }
}

function getEffectiveUsername(parsed: URL): string {
  const queryUser = parsed.searchParams.get("user");
  return decodeUsername(queryUser ?? parsed.username);
}

function getEffectiveHostname(parsed: URL): string {
  const queryHost = parsed.searchParams.get("host");
  return (queryHost ?? parsed.hostname).trim();
}

/**
 * Detects whether a PostgreSQL username represents the restricted runtime role
 * (`npr_app_user` locally or `npr_app_user.<PROJECT_REF>` on Supabase Supavisor).
 */
export function isRestrictedRuntimeRoleUsername(rawUsername: string): boolean {
  const normalized = decodeUsername(rawUsername);
  return normalized === "npr_app_user" || normalized.startsWith("npr_app_user.");
}

/**
 * Detects known elevated PostgreSQL / Supabase migration roles that must never
 * run business APIs in production or after runtime/migration split cutover.
 */
export function isPrivilegedMigrationRoleUsername(rawUsername: string): boolean {
  const normalized = decodeUsername(rawUsername);
  return (
    normalized === "postgres" ||
    normalized.startsWith("postgres.") ||
    normalized === "supabase_admin" ||
    normalized.startsWith("supabase_admin.")
  );
}

export function isRestrictedRuntimeRoleUrl(connectionString: string): boolean {
  try {
    const parsed = new URL(connectionString);
    return (
      isRestrictedRuntimeRoleUsername(parsed.username) ||
      isRestrictedRuntimeRoleUsername(parsed.searchParams.get("user") ?? "")
    );
  } catch {
    return false;
  }
}

export function isPrivilegedMigrationRoleUrl(connectionString: string): boolean {
  try {
    const parsed = new URL(connectionString);
    return (
      isPrivilegedMigrationRoleUsername(parsed.username) ||
      isPrivilegedMigrationRoleUsername(parsed.searchParams.get("user") ?? "")
    );
  } catch {
    return false;
  }
}

/**
 * Validates a PostgreSQL connection URL without ever echoing credentials in errors.
 * Guards against pg-connection-string query overrides (?host=, ?user=, ?ssl=0, etc.).
 */
export function parseAndValidateDatabaseUrl(
  connectionString: string,
  envVarName: string,
  options: { requireStrictRemoteTls?: boolean } = {}
): URL {
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error(`${envVarName} is not a valid PostgreSQL connection URL`);
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(
      `${envVarName} must use a postgres:// or postgresql:// protocol`
    );
  }

  const effectiveHost = getEffectiveHostname(parsed);
  if (!effectiveHost) {
    throw new Error(`${envVarName} must include a database host`);
  }

  const queryUser = parsed.searchParams.get("user");
  if (queryUser !== null && decodeUsername(queryUser) !== decodeUsername(parsed.username)) {
    throw new Error(
      `${envVarName} must not specify a conflicting ?user= query override`
    );
  }

  const isLocal = isLocalHostname(effectiveHost);
  const sslParam = parsed.searchParams.get("ssl")?.trim().toLowerCase();
  const sslMode = parsed.searchParams.get("sslmode")?.trim().toLowerCase();

  if (!isLocal) {
    if (sslParam === "false" || sslParam === "0") {
      throw new Error(
        `${envVarName} must not disable TLS via ssl=${sslParam} on remote hosts`
      );
    }

    if (sslMode && INSECURE_REMOTE_SSL_MODES.has(sslMode)) {
      throw new Error(
        `${envVarName} must not weaken or bypass TLS verification on remote hosts (got sslmode=${sslMode})`
      );
    }

    if (options.requireStrictRemoteTls && sslMode !== "verify-full") {
      throw new Error(
        `${envVarName} must specify sslmode=verify-full on remote hosts in production`
      );
    }
  }

  return parsed;
}

/**
 * Resolves the runtime connection string for the Express application pool.
 * Strictly reads DATABASE_URL and never falls back to MIGRATION_DATABASE_URL.
 *
 * Security enforcement:
 * - In production (NODE_ENV === "production"), requires restricted runtime role
 *   `npr_app_user` (or `npr_app_user.<PROJECT_REF>`) and `sslmode=verify-full` for remote hosts.
 * - After split cutover (whenever MIGRATION_DATABASE_URL is set), refuses privileged
 *   `postgres` / `supabase_admin` credentials in DATABASE_URL.
 */
export function getRuntimeDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env
): string {
  const runtimeUrl = env.DATABASE_URL?.trim();
  if (!runtimeUrl) {
    throw new Error("DATABASE_URL is not configured");
  }

  const isProduction = env.NODE_ENV?.trim().toLowerCase() === "production";
  const hasSeparateMigrationUrl = Boolean(env.MIGRATION_DATABASE_URL?.trim());

  const parsed = parseAndValidateDatabaseUrl(runtimeUrl, "DATABASE_URL", {
    requireStrictRemoteTls: isProduction,
  });
  const effectiveUser = getEffectiveUsername(parsed);

  if (isProduction && !isRestrictedRuntimeRoleUsername(effectiveUser)) {
    throw new Error(
      "Refusing to start runtime pool in production without restricted role npr_app_user in DATABASE_URL."
    );
  }

  if (
    hasSeparateMigrationUrl &&
    (isPrivilegedMigrationRoleUsername(effectiveUser) ||
      !isRestrictedRuntimeRoleUsername(effectiveUser))
  ) {
    throw new Error(
      "MIGRATION_DATABASE_URL is configured; DATABASE_URL must use restricted runtime role npr_app_user rather than privileged credentials."
    );
  }

  return runtimeUrl;
}

/**
 * Resolves the privileged connection string for schema migrations and status checks.
 * Prefers MIGRATION_DATABASE_URL, falling back to DATABASE_URL only during pre-cutover
 * transition when DATABASE_URL is not using restricted runtime role npr_app_user.
 */
export function getMigrationDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env
): string {
  const isProduction = env.NODE_ENV?.trim().toLowerCase() === "production";
  const migrationUrl = env.MIGRATION_DATABASE_URL?.trim();

  if (migrationUrl) {
    const parsed = parseAndValidateDatabaseUrl(
      migrationUrl,
      "MIGRATION_DATABASE_URL",
      { requireStrictRemoteTls: isProduction }
    );
    const effectiveUser = getEffectiveUsername(parsed);
    if (isRestrictedRuntimeRoleUsername(effectiveUser)) {
      throw new Error(
        "MIGRATION_DATABASE_URL must use a privileged migration role, not restricted runtime role npr_app_user."
      );
    }
    return migrationUrl;
  }

  const fallbackUrl = env.DATABASE_URL?.trim();
  if (!fallbackUrl) {
    throw new Error(
      "MIGRATION_DATABASE_URL is not configured (and fallback DATABASE_URL is unset)"
    );
  }

  const parsedFallback = parseAndValidateDatabaseUrl(
    fallbackUrl,
    "DATABASE_URL",
    { requireStrictRemoteTls: isProduction }
  );
  const effectiveFallbackUser = getEffectiveUsername(parsedFallback);
  if (isRestrictedRuntimeRoleUsername(effectiveFallbackUser)) {
    throw new Error(
      "Refusing to run migration tooling as restricted runtime role npr_app_user. Configure MIGRATION_DATABASE_URL with the privileged migration role."
    );
  }

  return fallbackUrl;
}