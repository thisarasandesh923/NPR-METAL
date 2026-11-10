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

## 5. Dedicated Restricted Runtime Role (`npr_app_user`) Strategy

Once initial schema deployment is verified and Express backend connectivity is ready to drop elevated `postgres` credentials:

1. DBA manually creates `npr_app_user` (`LOGIN`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`, `NOBYPASSRLS`) with a high-entropy password (never committed to Git).
2. DBA executes `database/scripts/apply_runtime_role_policies.sql` to apply column-restricted `GRANT`s and operation-scoped RLS policies compatible with `NOBYPASSRLS`.
3. Update runtime backend environment credentials to connect as `npr_app_user` with `sslmode=verify-full` while reserving `postgres` exclusively for schema migrations.
