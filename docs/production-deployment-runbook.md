# Production Deployment Runbook — NPR Metal Crusher System

## 1. Pre-Deployment Warnings & Prerequisites
- **Supabase Free Tier Backup Notice:** Supabase Free Tier does not include automated Point-in-Time Recovery (PITR) or automatic scheduled backups. **Before deploying Migration `008`**, execute a manual `pg_dump` backup from a trusted operator terminal using the privileged `postgres` connection URL and store the encrypted dump offline.
- **Verified Production Baseline:**
  - PostgreSQL 17.11 (Mumbai `ap-south-1` Session Pooler port `5432`, `sslmode=verify-full`)
  - Migrations `001`–`007` already applied
  - Restricted runtime role `npr_app_user` (`NOLOGIN` -> `LOGIN` with `NOBYPASSRLS`, SCRAM-SHA-256)
  - Zero production accounts or business records exist yet until operator onboarding runs.

---

## 2. Database Migration (`008_operations_and_payroll.sql`)
Run migrations using the privileged `MIGRATION_DATABASE_URL` (never `npr_app_user`):

```powershell
# In backend/ directory (MIGRATION_DATABASE_URL set in backend/.env)
npm --prefix backend run migrate:status
npm --prefix backend run migrate:dry-run
npm --prefix backend run migrate:up
npm --prefix backend run db:check
```

Then apply/verify the runtime role grants & RLS policies (including the 12 new `008` tables) as superuser/`postgres` via `psql`:
```powershell
psql "$env:MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f database/scripts/apply_runtime_role_policies.sql
```

### Post-Migration Verification Queries
Verify via `psql` that:
1. `pgmigrations` records `001` through `008` with zero pending files.
2. `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public'` shows `rowsecurity = true` for ALL 24 application tables (`pg_tables` excluding internal views).
3. Zero `anon` / `authenticated` / `PUBLIC` table or sequence grants exist (`db:check` + read-only privilege inspection).

---

## 3. Secure Initial User & Material Catalog Bootstrap (CLI Only — Zero Hardcoded Secrets)
Do **not** create accounts through public signup (there is none). On day-of-launch, the operator provisions:
- **1 OWNER** account (`role = 'OWNER'`)
- **2 CASHIER** accounts (`role = 'CASHIER'`)
- Confirmed selling prices in `materials` (`3/4"`, `Dust`, `6×9`, `ABC`)

Use a temporary operator one-liner or interactive CLI script reading `ADMIN_PASSWORD` from a masked `Read-Host -AsSecureString` prompt and hashing with `backend/src/modules/auth/password.ts` (`scrypt`, 16-byte random salt, `N=16384`). Never store plaintext passwords in files, shell history, or git.

---

## 4. Production Backend Environment & Reverse Proxy Checklist
1. **`NODE_ENV=production`**
2. **`DATABASE_URL`**: Must use `npr_app_user` (never `postgres`), Session Pooler port `5432`, `sslmode=verify-full`, `sslrootcert` pointing to the verified Supabase CA certificate.
3. **`MIGRATION_DATABASE_URL`**: Removed or left unset on public web runtime containers (only used by operator deployment job).
4. **`ALLOWED_ORIGINS`**: Explicit production origin(s), e.g. `https://billing.nprcrusher.lk` (no `*` wildcards).
5. **TLS & Reverse Proxy (Nginx / Caddy / Cloud Run / Cloudflare):**
   - Terminate HTTPS at the edge with valid TLS certificate and `X-Forwarded-Proto: https`.
   - Set `TRUST_PROXY=1` (matching reverse proxy hop count) so Express sets `Secure`, `HttpOnly`, `SameSite=Lax` cookies reliably and applies accurate client-IP rate limiting.
   - Serve the Vite `frontend/dist` static bundle and reverse-proxy `/api/*` on the **exact same origin** so cookie auth + CSRF (`X-Requested-With: XMLHttpRequest`) require zero cross-site cookies.

---

## 5. Production Smoke-Test Checklist (Post-Launch)
1. `GET /api/health` returns `200 OK` without leaking DB URLs or versions.
2. Unauthenticated `GET /api/auth/me` returns `401`; `GET /api/payroll/periods` returns `401`.
3. Sign in as **Cashier 1**:
   - Issue a real invoice or verify active materials load (`3/4"`, `Dust`, `6×9`, `ABC`).
   - Verify Payroll, Material Price Edit, and Approvals tabs are absent AND `GET /api/payroll/compensation` returns `403`.
   - Submit 1 Daily Operations draft entry.
4. Sign in as **Owner** (separate browser/device):
   - Approve the pending submission via Approvals Queue.
   - Verify Financial & Operations Reports load with `Asia/Colombo` business dates.
   - Export a CSV and XLSX report cleanly.

---

## 6. Open Workshop Policies Pending Client Decision
Before altering default formulas in production, confirm these workshop rules with the NPR Owner:
1. Overtime rate multipliers (hourly OT vs custom flat bonus rates per role).
2. Monthly salaried worker deduction / proration formula for unpaid leave days.
3. Fixed scheduled working hours per machine (used for utilization `%` when entered; left uncomputed `"Not Scheduled"` until defined).
4. Physical stockpile inventory deduction model (`production_logs m³` vs `invoice_items m³`).
5. Customer **`CASH_REFUND`** & full **Invoice Cancellation (`Credit Note`)** policy (`ENTRY_REVERSAL` for clerical mistakes is enabled and active; cash-out refunds await Owner confirmation).

