import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getMigrationDatabaseUrl,
  getRuntimeDatabaseUrl,
  isPrivilegedMigrationRoleUsername,
  isRestrictedRuntimeRoleUrl,
  isRestrictedRuntimeRoleUsername,
} from "../db/config.js";

describe("Phase 2C — Backend Database Connection Separation & Safety Guards", () => {
  it("detects npr_app_user and privileged roles in direct and Supavisor project-scoped formats", () => {
    assert.equal(isRestrictedRuntimeRoleUsername("npr_app_user"), true);
    assert.equal(isRestrictedRuntimeRoleUsername("NPR_APP_USER"), true);
    assert.equal(isRestrictedRuntimeRoleUsername("npr_app_user.abcdefghijk"), true);
    assert.equal(
      isRestrictedRuntimeRoleUrl(
        "postgresql://npr_app_user.projref:pwd@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=verify-full"
      ),
      true
    );
    assert.equal(isRestrictedRuntimeRoleUsername("postgres"), false);
    assert.equal(isRestrictedRuntimeRoleUsername("postgres.abcdefghijk"), false);
    assert.equal(isRestrictedRuntimeRoleUsername("npr_app_user_admin"), false);

    assert.equal(isPrivilegedMigrationRoleUsername("postgres"), true);
    assert.equal(isPrivilegedMigrationRoleUsername("postgres.abcdefghijk"), true);
    assert.equal(isPrivilegedMigrationRoleUsername("supabase_admin"), true);
    assert.equal(isPrivilegedMigrationRoleUsername("npr_app_user.abcdefghijk"), false);
  });

  it("isolates runtime DATABASE_URL from privileged MIGRATION_DATABASE_URL", () => {
    const runtime =
      "postgresql://npr_app_user.ref:secret@pooler.supabase.com:5432/postgres?sslmode=verify-full&sslrootcert=/ca.crt";
    const migration =
      "postgresql://postgres.ref:adminsecret@pooler.supabase.com:5432/postgres?sslmode=verify-full&sslrootcert=/ca.crt";

    assert.equal(
      getRuntimeDatabaseUrl({
        DATABASE_URL: runtime,
        MIGRATION_DATABASE_URL: migration,
      }),
      runtime
    );

    // Runtime pool must never silently fall back to MIGRATION_DATABASE_URL
    assert.throws(
      () => getRuntimeDatabaseUrl({ MIGRATION_DATABASE_URL: migration }),
      /DATABASE_URL is not configured/
    );

    // Once MIGRATION_DATABASE_URL is present (post-cutover), DATABASE_URL must not stay postgres
    assert.throws(
      () =>
        getRuntimeDatabaseUrl({
          DATABASE_URL: migration,
          MIGRATION_DATABASE_URL: migration,
        }),
      /DATABASE_URL must use restricted runtime role npr_app_user/
    );
  });

  it("refuses elevated postgres credentials and non-verify-full remote TLS in production", () => {
    const prodRuntime =
      "postgresql://npr_app_user.ref:secret@pooler.supabase.com:5432/postgres?sslmode=verify-full&sslrootcert=/ca.crt";
    const prodPrivileged =
      "postgresql://postgres.ref:secret@pooler.supabase.com:5432/postgres?sslmode=verify-full&sslrootcert=/ca.crt";
    const prodRequireOnly =
      "postgresql://npr_app_user.ref:secret@pooler.supabase.com:5432/postgres?sslmode=require";

    assert.equal(
      getRuntimeDatabaseUrl({
        NODE_ENV: "production",
        DATABASE_URL: prodRuntime,
      }),
      prodRuntime
    );

    assert.throws(
      () =>
        getRuntimeDatabaseUrl({
          NODE_ENV: "production",
          DATABASE_URL: prodPrivileged,
        }),
      /Refusing to start runtime pool in production without restricted role npr_app_user/
    );

    assert.throws(
      () =>
        getRuntimeDatabaseUrl({
          NODE_ENV: "production",
          DATABASE_URL: prodRequireOnly,
        }),
      /must specify sslmode=verify-full on remote hosts in production/
    );
  });

  it("uses MIGRATION_DATABASE_URL when set and blocks npr_app_user from running migrations", () => {
    const runtime =
      "postgresql://npr_app_user.ref:secret@pooler.supabase.com:5432/postgres?sslmode=verify-full";
    const migration =
      "postgresql://postgres.ref:adminsecret@pooler.supabase.com:5432/postgres?sslmode=verify-full";

    assert.equal(
      getMigrationDatabaseUrl({
        DATABASE_URL: runtime,
        MIGRATION_DATABASE_URL: migration,
      }),
      migration
    );

    assert.throws(
      () =>
        getMigrationDatabaseUrl({
          MIGRATION_DATABASE_URL: runtime,
        }),
      /MIGRATION_DATABASE_URL must use a privileged migration role/
    );

    assert.throws(
      () =>
        getMigrationDatabaseUrl({
          DATABASE_URL: runtime,
        }),
      /Refusing to run migration tooling as restricted runtime role npr_app_user/
    );

    assert.throws(
      () =>
        getMigrationDatabaseUrl({
          DATABASE_URL:
            "postgresql://npr_app_user:secret@127.0.0.1:55432/npr_test_db",
        }),
      /Refusing to run migration tooling as restricted runtime role npr_app_user/
    );
  });

  it("supports pre-cutover non-production transition when MIGRATION_DATABASE_URL is unset", () => {
    const privilegedTransitionUrl =
      "postgresql://postgres.ref:adminsecret@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=verify-full&sslrootcert=/ca.crt";

    assert.equal(
      getMigrationDatabaseUrl({
        DATABASE_URL: privilegedTransitionUrl,
      }),
      privilegedTransitionUrl
    );
    assert.equal(
      getRuntimeDatabaseUrl({
        NODE_ENV: "development",
        DATABASE_URL: privilegedTransitionUrl,
      }),
      privilegedTransitionUrl
    );
  });

  it("blocks TLS-downgrade modes and pg-connection-string ?user= / ?ssl=0 bypass overrides", () => {
    for (const badMode of ["disable", "allow", "prefer", "no-verify"]) {
      assert.throws(
        () =>
          getRuntimeDatabaseUrl({
            DATABASE_URL: `postgresql://npr_app_user.ref:pwd@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=${badMode}`,
          }),
        /must not weaken or bypass TLS verification/
      );
      assert.throws(
        () =>
          getMigrationDatabaseUrl({
            MIGRATION_DATABASE_URL: `postgresql://postgres.ref:pwd@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=${badMode}`,
          }),
        /must not weaken or bypass TLS verification/
      );
    }

    assert.throws(
      () =>
        getRuntimeDatabaseUrl({
          DATABASE_URL:
            "postgresql://npr_app_user.ref:pwd@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?ssl=0",
        }),
      /must not disable TLS via ssl=0/
    );

    assert.throws(
      () =>
        getMigrationDatabaseUrl({
          MIGRATION_DATABASE_URL:
            "postgresql://postgres.ref:pwd@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?user=npr_app_user.ref",
        }),
      /must not specify a conflicting \?user= query override/
    );

    // Local test Docker URLs remain permitted without TLS
    const localDockerUrl =
      "postgresql://postgres:test@127.0.0.1:55432/npr_test_db";
    assert.equal(
      getMigrationDatabaseUrl({ MIGRATION_DATABASE_URL: localDockerUrl }),
      localDockerUrl
    );
  });
});