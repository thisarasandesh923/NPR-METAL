# Supabase Deployment Checklist & Security Runbook

## Project: NPR Metal Crusher — Billing & Management System

---

## 1. Verified Target & Transport Security (TLS)

- **Target Environment:** Supabase PostgreSQL 17.x (`ap-south-1` — Mumbai, South Asia).
- **Connection Mode:** Supavisor **Session Pooler** (Port `5432`) for migrations (supports `pg_try_advisory_lock` and transactional DDL). Never execute `node-pg-migrate` over Transaction Pooler (Port `6543`).
- **TLS / SSL Requirement (`sslmode=verify-full`):**
  - Client-side verification confirmed that without explicit SSL settings in `DATABASE_URL` or `pg.Pool`, `node-postgres` defaults to an unencrypted connection (`encrypted=false`).
  - Supabase Supavisor presents a certificate signed by Supabase's Root CA (`prod-ca-2021.crt`), which is not bundled in Node.js's default CA trust store.
  - **Never** substitute `rejectUnauthorized: false` or `sslmode=no-verify`.

### Windows 11 Setup Steps for Supabase Root CA & `sslmode=verify-full`
1. **Download Official CA Certificate:**
   - Open your intended **NPR Metal Crusher** project in **Supabase Dashboard** -> **Project Settings** -> **Database** -> **SSL Configuration** -> click **Download SSL Certificate** (`prod-ca-2021.crt`).
2. **Store Outside Git Repository:**
   - Create `C:\Users\<YourWindowsUsername>\.postgresql\` (if missing) and move `prod-ca-2021.crt` there.
   - Verify the certificate stays completely outside `e:\npr project\NPR-Metal-Crusher-System\`.
3. **Configure `backend/.env` Without Contradictory Pool/CLI Options:**
   - Append `?sslmode=verify-full&sslrootcert=C:/Users/<YourWindowsUsername>/.postgresql/prod-ca-2021.crt` to `DATABASE_URL` in `backend/.env` (using forward slashes `/` in the path avoids backslash escaping bugs in URLs).
   - **Important (`pg` & `node-pg-migrate` Compatibility):**
     - `backend/src/db/pool.ts` passes `{ connectionString: databaseUrl }` directly to `pg.Pool`, allowing `pg-connection-string` to load `ca` via `sslrootcert` and enforce full CA + hostname verification (`verify-full`). Do **not** add a conflicting `ssl: { rejectUnauthorized: true }` override inside `pool.ts` (which would strip the custom `ca` property).
     - `backend/package.json` migration scripts intentionally omit `--reject-unauthorized` CLI overrides so `node-pg-migrate` passes `DATABASE_URL` directly through `pg-connection-string`, guaranteeing identical `verify-full` + CA verification for migrations and read-only checks (`npm --prefix backend run db:check` and `npm --prefix backend run migrate:status`).

---

## 2. Backup Readiness & Verification Plan

Because automated backup coverage depends on the Supabase subscription tier (Free plans do not provide downloadable daily automated backups; Pro/Enterprise provide daily backups and Point-in-Time Recovery):

1. **Inspect Dashboard Backups:** Check **Supabase Dashboard -> Database -> Backups** prior to migration to confirm whether automated daily backups or PITR snapshots exist.
2. **Manual Logical Backup (`pg_dump`):** Before executing schema changes or whenever business data is present:
   ```bash
   pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges --schema=public -f backup_pre_migration.dump
   ```
3. **Protect Backup Artifacts:**
   - **NEVER** store `.dump` or `.sql` backups inside the Git repository.
   - Store encrypted backups outside the project root with restricted filesystem permissions.
4. **Verify Backup Integrity:**
   - Validate archive structure with `pg_restore --list backup_pre_migration.dump`.
   - Test restoring into an isolated disposable local PostgreSQL 17 container (`pg_restore -d npr_restore_test backup_pre_migration.dump`) before relying on a backup in production.
5. **Migration Failure Recovery:**
   - `node-pg-migrate` runs migrations `001`–`006` inside `--single-transaction` (`BEGIN ... COMMIT`). Any SQL failure automatically rolls back all pending changes cleanly.
   - Do **not** execute `down` migrations; only forward-only `007_*.sql` fixes are permitted once committed.

---

## 3. Pre-Flight Checklist (Phase 2B3C Execution Gate)

Complete every item before executing migrations against Supabase:

- [ ] **1. Project Identity Confirmed:** User explicitly verified in Supabase Dashboard (`Settings -> General -> Reference ID`) that `backend/.env` targets the **NPR Metal Crusher** Mumbai project.
- [ ] **2. TLS Hardened:** `DATABASE_URL` configured with `sslmode=verify-full` and Supabase Root CA (`prod-ca-2021.crt`).
- [ ] **3. Backup Confirmed:** Dashboard backup availability verified (or manual `pg_dump` completed if existing data exists).
- [ ] **4. Execution Role Verified:** Migrating using the `postgres` role via Session Pooler (Port `5432`).
- [ ] **5. Read-Only Recheck Passed:**
  ```bash
  npm --prefix backend run migrate:check
  npm --prefix backend run typecheck
  npm --prefix backend run migrate:status
  ```
- [ ] **6. Approved Migration File Inventory:**
  - `001_core_schema.sql`
  - `002_invoices_and_items.sql`
  - `003_payments_and_adjustments.sql`
  - `004_audit_and_reporting.sql`
  - `005_integrity_triggers.sql`
  - `006_supabase_security_hardening.sql`
- [ ] **7. Execute Forward-Only Migrations:**
  ```bash
  npm --prefix backend run migrate:up
  ```
- [ ] **8. Confirm Applied Migration Status:**
  ```bash
  npm --prefix backend run migrate:status
  ```

---

## 4. Post-Migration Verification Queries (Read-Only)

Run read-only verification checks after `migrate:up` completes:

1. **Object Counts:** Expect **13 tables** (`12` business + `pgmigrations`), **4 views**, **19 user-defined triggers**, and **all 13 tables with `relrowsecurity = true`**.
2. **View Security:** Confirm `reloptions` includes `security_invoker=true` on all 4 views (`invoice_ledger_view`, `daily_cash_reconciliation_view`, `cashier_shift_reconciliation_view`, `customer_balances_view`).
3. **Zero Exposure Verification:** Confirm `anon` and `authenticated` have `false` for `has_table_privilege` and `has_function_privilege` across all `public` billing tables, views, sequences, functions, and `pgmigrations`.
4. **Stop Conditions:** Abort immediately and roll back if any migration warns/errors, if non-empty unexpected tables exist in `public`, or if TLS verification fails.

---

## 5. Dedicated Restricted Runtime Role (`npr_app_user`) Provisioning Runbook (Phase 2C)

Execute this procedure **only after** migrations `001`–`006` are verified as `[APPLIED]` and TLS `sslmode=verify-full` + pre-change logical backups are confirmed.

### 5.1 Pre-Flight Verification (Read-Only)
Confirm the intended database identity, role state, `scram-sha-256` encryption, and migration status before making changes:

```sql
SELECT current_database(), current_user, version();
SHOW password_encryption; -- Expect 'scram-sha-256'
SELECT name, run_on FROM public.pgmigrations ORDER BY id;
SELECT rolname FROM pg_roles WHERE rolname = 'npr_app_user'; -- Expect 0 rows prior to first provisioning
```

Abort immediately if migrations `001`–`006` are incomplete or if `current_database()` is not `postgres`.

### 5.2 Staged Role Provisioning & Non-Logged Password Setup
1. **Create role initially with `NOLOGIN` (no plaintext secret in SQL):**
   In Supabase Dashboard SQL Editor or `psql` (connected as `postgres` over Session Pooler port `5432` with `sslmode=verify-full`):
   ```sql
   CREATE ROLE npr_app_user WITH
     NOLOGIN
     NOSUPERUSER
     NOCREATEDB
     NOCREATEROLE
     NOREPLICATION
     NOINHERIT
     NOBYPASSRLS;
   ```
2. **Apply transactional least-privilege grants & RLS policies while `NOLOGIN`:**
   Execute `database/scripts/apply_runtime_role_policies.sql` inside its `BEGIN ... COMMIT` block. It fails safely if `npr_app_user` holds elevated flags, role memberships, or `public` object ownership, or if migrations `001`–`006` hardening is missing.
3. **Verify grants & RLS before enabling login:** Confirm role flags, `0` memberships, `29` policies, `public_create = false`, and `pgmigrations` `SELECT = false` (queries in §5.3).
4. **Set a strong SCRAM-SHA-256 password without plaintext logs or terminal history:**
   - Generate a URL-safe secret directly in memory or interactive session, or use `psql`'s masked prompt (`SET password_encryption = 'scram-sha-256'; \password npr_app_user`) so the secret is never written to Git, shell history, or logs. Avoid URI-reserved characters (`@`, `#`, `:`, `?`, `/`) or percent-encode them strictly.
5. **Enable `LOGIN` only after security verification passes:**
   ```sql
   ALTER ROLE npr_app_user WITH LOGIN VALID UNTIL 'infinity';
   ```

### 5.3 Post-Provisioning Verification Queries (Read-Only)
Verify privileges (before enabling `LOGIN` and again after enabling `LOGIN`), and allow 15–30 seconds for Supavisor auth cache propagation before testing client connections:

```sql
SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolvaliduntil
FROM pg_roles WHERE rolname = 'npr_app_user';

SELECT COUNT(*) AS membership_count
FROM pg_auth_members
WHERE member = (SELECT oid FROM pg_roles WHERE rolname = 'npr_app_user'); -- Expect 0

SELECT COUNT(*) AS rls_policy_count
FROM pg_policies
WHERE schemaname = 'public' AND 'npr_app_user' = ANY(roles); -- Expect 29

SELECT
  has_schema_privilege('npr_app_user', 'public', 'USAGE') AS public_usage,   -- true
  has_schema_privilege('npr_app_user', 'public', 'CREATE') AS public_create, -- false
  has_table_privilege('npr_app_user', 'public.pgmigrations', 'SELECT') AS mig_select; -- false
```

---

## 6. Supavisor Connection Separation & Recovery Procedure

### 6.1 Supavisor Custom-Role Connection Format
Supabase Supavisor (Session Pooler port `5432`) requires tenant-scoped usernames (`<ROLE>.<PROJECT_REF>`) and explicit `/postgres` database target:
- **Runtime API (`DATABASE_URL`):**
  `postgresql://npr_app_user.<PROJECT_REF>:<URL_SAFE_PASSWORD>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=verify-full&sslrootcert=C:/Users/<YourWindowsUsername>/.postgresql/prod-ca-2021.crt`
- **Schema Migrations (`MIGRATION_DATABASE_URL`):**
  `postgresql://postgres.<PROJECT_REF>:<MIGRATION_PASSWORD>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=verify-full&sslrootcert=C:/Users/<YourWindowsUsername>/.postgresql/prod-ca-2021.crt`

### 6.2 Backwards-Compatible Transition & Cutover Order
1. **Pre-Cutover Transition (Non-Production Only):** While `MIGRATION_DATABASE_URL` is unset, `DATABASE_URL` (`postgres.<PROJECT_REF>`) remains temporarily backwards-compatible in development (`server.ts` logs a non-secret warning). In `NODE_ENV=production`, startup strictly rejects elevated roles and requires `npr_app_user` + `sslmode=verify-full`.
2. **Cutover:** Complete §5 (`NOLOGIN` -> `apply_runtime_role_policies.sql` -> read-only verify -> non-logged password -> `LOGIN`), then update `backend/.env` so `MIGRATION_DATABASE_URL` holds `postgres.<PROJECT_REF>` and `DATABASE_URL` holds `npr_app_user.<PROJECT_REF>`.
3. **Runtime Guarantee:** `backend/src/db/pool.ts` strictly reads `DATABASE_URL` (never `MIGRATION_DATABASE_URL`). Once `MIGRATION_DATABASE_URL` is configured, `getRuntimeDatabaseUrl()` also refuses privileged roles in `DATABASE_URL`. `run-migrations.ts` and `migration-status.ts` refuse `npr_app_user`.
4. **Post-Cutover Verification:** Run `npm --prefix backend run db:check` (verifying `npr_app_user.<PROJECT_REF>`) and `npm --prefix backend run migrate:status` (verifying `[APPLIED]` `001`–`006` via `MIGRATION_DATABASE_URL`).

### 6.3 Safe Recovery / Rollback Procedure
- **If `28P01` auth failure occurs immediately after creation:** Wait 30 seconds for Supavisor cache refresh, confirm `rolcanlogin = true` and `VALID UNTIL 'infinity'`, and re-run `SET password_encryption = 'scram-sha-256'; ALTER ROLE npr_app_user WITH PASSWORD '...';`.
- **If an emergency backend rollback is required:** Temporarily restore `postgres.<PROJECT_REF>` in `DATABASE_URL` (keeping `sslmode=verify-full`) while diagnosing missing grants; never bypass RLS via `ALTER ROLE ... BYPASSRLS`.
- **To disable or rotate `npr_app_user` immediately:** Run `ALTER ROLE npr_app_user NOLOGIN;` or rotate the password out-of-band without re-running migrations.
