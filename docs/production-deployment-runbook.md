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

## 3. Secure Initial User & Material Catalog Bootstrap (CLI Onboarding)
Do **not** create accounts through public signup (there is none). On day-of-launch, the operator provisions:
- **1 OWNER** account (`role = 'OWNER'`)
- **2 CASHIER** accounts (`role = 'CASHIER'`)
- Confirmed initial selling prices in `materials` (`3/4"`, `Dust`, `6×9`, `ABC`)

Run the interactive onboarding script (zero hardcoded secrets):
```powershell
# In backend/ directory with MIGRATION_DATABASE_URL or DATABASE_URL set
npm --prefix backend run onboard:users
```

The script interactively prompts for:
1. Owner username & password (hashed via `scrypt`, 16-byte random salt, `N=16384`).
2. Cashier 1 username & password.
3. Cashier 2 username & password.
4. Unit prices (LKR per m³) for:
   - `3/4"` (e.g. `Rs. 8,500.00`)
   - `Dust` (e.g. `Rs. 4,200.00`)
   - `6×9` (e.g. `Rs. 7,800.00`)
   - `ABC` (e.g. `Rs. 6,500.00`)

Never store plaintext passwords in files, shell history, or git.

---

## 4. Disaster Recovery & Database Backup Rehearsal

### 4.1 Automated Offline Backup (`pg_dump`)
Run the backup script before any release or on a daily automated schedule (e.g., via Task Scheduler or cron):
```powershell
powershell -ExecutionPolicy Bypass -File scripts/database/backup-supabase.ps1 `
  -BackupDir "D:\NPR_Backups" `
  -RetentionDays 30
```
This generates a timestamped, compressed custom-format dump (`npr_metal_crusher_YYYYMMDD_HHMMSS.dump`) using `pg_dump -Fc`.

### 4.2 Disaster Recovery Rehearsal (`pg_restore`)
Regularly verify that the database can be fully recovered onto a clean staging/local database without touching production:
```powershell
# Restore into an isolated local/staging database
powershell -ExecutionPolicy Bypass -File scripts/database/restore-rehearsal.ps1 `
  -TargetDatabaseUrl "postgresql://postgres:password@localhost:5432/npr_recovery_test?sslmode=disable" `
  -BackupFile "D:\NPR_Backups\npr_metal_crusher_YYYYMMDD_HHMMSS.dump"
```
The script validates:
- Schema restore and clean exit.
- Table existence across all 24 core tables (`users`, `user_sessions`, `materials`, `customers`, `invoices`, `invoice_items`, `payments`, `workers`, `daily_attendance`, `salary_advances`, `payroll_periods`, `worker_payslips`, `machine_working_logs`, `production_logs`, etc.).
- Financial trigger integrity.

---

## 5. Low-Cost Production Hosting Architecture ($5 – $12 / Month)

For a real-world Sri Lankan metal crusher workshop, the application must run with high uptime, low network latency, robust TLS security, and minimal monthly infrastructure cost.

### Option A: Managed PaaS + Managed DB (Recommended)
- **Frontend & Backend API:** Render Web Service or Railway ($5 – $7 / mo).
  - Single Node.js 24 runtime serving Express API (`/api/*`) and static Vite bundle (`frontend/dist`) on the same origin.
  - Zero cross-origin cookie or CORS complexity.
- **Database:** Supabase PostgreSQL in Mumbai (`ap-south-1`) — ~30–45 ms ping from Sri Lanka.
  - Free Tier ($0/mo) for initial months (up to 500 MB database, plenty for hundreds of thousands of invoices).
  - Scheduled daily offline backups via `scripts/database/backup-supabase.ps1`.
- **DNS & CDN:** Cloudflare Free Tier ($0/mo) with full Edge TLS (HTTPS), HTTP/3, and DDoS protection.
- **Estimated Total Cost:** **$5 – $7 / month**.

### Option B: Self-Hosted Cloud VPS (Maximum Control & Cost Savings)
- **Cloud Provider:** DigitalOcean Droplet (Singapore `sgp1`, ~35 ms latency to Colombo) or Hetzner Cloud (CX22 / CPX11).
  - 2 GB RAM, 1–2 vCPUs, 25–40 GB NVMe SSD: **$4 – $6 / month**.
- **Web Server / Reverse Proxy:** Caddy v2.
  - Automatic Let's Encrypt SSL/TLS certificates.
  - Built-in compression (gzip / zstd).
  - Reverse proxies `/api/*` to Express on `127.0.0.1:4000` and serves `frontend/dist` directly.
- **Process Manager:** PM2 (`pm2 start dist/server.js --name npr-api`) or Docker Compose.
- **Estimated Total Cost:** **$4 – $6 / month**.

---

## 6. Workshop Cashier & Owner Device Setup

### 6.1 Cashier Workstation (Desktop / POS)
- **Language Default:** Defaults automatically to **Sinhala (`si`)** (`"මුදල් අයකැමි පුවරුව"`). A top-header pill button (`🇱🇰 සිංහල / 🇬🇧 English`) allows instant switching.
- **Material Codes & Invoices:** Key aggregate codes (`3/4"`, `Dust`, `6×9`, `ABC`), Invoice IDs (`INV-YYYY-XXXX`), and currency symbols (`Rs.`) remain in standard Latin characters for compatibility with barcode readers and standard POS thermal/A5 slips.
- **A5 Invoice Printing:**
  - Cashiers click **"Print A5 Slip" / "A5 රිසිට්පත මුද්‍රණය"**.
  - Browser print dialog opens pre-configured for A5 landscape/portrait with custom `@media print` CSS hiding navigation sidebars, buttons, and status bars.

### 6.2 Owner Mobile & Remote Access
- Owner can access the management dashboard via any modern smartphone browser (Chrome / Safari).
- Full mobile-responsive UI with collapsible navigation, quick approval action buttons, daily business summary KPI cards, and CSV/Excel exports.
- Multi-factor session security: Session cookie is `HttpOnly`, `SameSite=Lax`, and `Secure`.
- LAN Dev access: During on-site network setup or local staging, RFC 1918 private IPs (`192.168.8.x`, `10.x.x.x`, `172.16-31.x.x`) are automatically permitted by the development CORS configuration.

---

## 7. Production Backend Environment & Reverse Proxy Checklist
1. **`NODE_ENV=production`**
2. **`DATABASE_URL`**: Must use `npr_app_user` (never `postgres`), Session Pooler port `5432`, `sslmode=verify-full`, `sslrootcert` pointing to the verified Supabase CA certificate.
3. **`MIGRATION_DATABASE_URL`**: Removed or left unset on public web runtime containers (only used by operator deployment job).
4. **`ALLOWED_ORIGINS`**: Explicit production origin(s), e.g. `https://billing.nprcrusher.lk` (no `*` wildcards).
5. **TLS & Reverse Proxy (Nginx / Caddy / Cloud Run / Cloudflare):**
   - Terminate HTTPS at the edge with valid TLS certificate and `X-Forwarded-Proto: https`.
   - Set `TRUST_PROXY=1` (matching reverse proxy hop count) so Express sets `Secure`, `HttpOnly`, `SameSite=Lax` cookies reliably and applies accurate client-IP rate limiting.
   - Serve the Vite `frontend/dist` static bundle and reverse-proxy `/api/*` on the **exact same origin** so cookie auth + CSRF (`X-Requested-With: XMLHttpRequest`) require zero cross-site cookies.

---

## 8. Production Smoke-Test Checklist (Post-Launch)
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

## 9. Open Workshop Policies Pending Client Decision
Before altering default formulas in production, confirm these workshop rules with the NPR Owner:
1. Overtime rate multipliers (hourly OT vs custom flat bonus rates per role).
2. Monthly salaried worker deduction / proration formula for unpaid leave days.
3. Fixed scheduled working hours per machine (used for utilization `%` when entered; left uncomputed `"Not Scheduled"` until defined).
4. Physical stockpile inventory deduction model (`production_logs m³` vs `invoice_items m³`).
5. Customer **`CASH_REFUND`** & full **Invoice Cancellation (`Credit Note`)** policy (`ENTRY_REVERSAL` for clerical mistakes is enabled and active; cash-out refunds await Owner confirmation).
