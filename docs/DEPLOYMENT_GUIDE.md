# Production Deployment Guide — NPR Metal Crusher System

**Target Environment:** Web Production (Desktop Cashier Workstations + Mobile/Desktop Owner Access)  
**Database:** Supabase PostgreSQL 17 (Region: `ap-south-1` Mumbai)  
**Backend:** Node.js v24 LTS + Express 5  
**Frontend:** React 19 + TypeScript + Vite  

---

## 1. Hosting Architecture Options & Evaluation

For a Sri Lankan industrial aggregate production enterprise, high availability, sub-50ms latency from local ISPs (Dialog, SLT-Mobitel), resilient session cookies, and low operational overhead are critical.

### Option A: Unified Same-Origin Architecture on Render or Railway (Strongly Recommended)
- **Concept:** A single Node.js runtime container running Express, which serves:
  1. API endpoints under `/api/*`
  2. The pre-built React frontend static assets (`frontend/dist`) on the root `/`
- **Why this is optimal:**
  - **Zero Cross-Origin Issues:** Frontend and API share the exact same protocol, domain, and port (`https://nprcrusher.com` or `https://npr-system.onrender.com`).
  - **Rock-Solid Cookie Auth:** Session cookies operate in standard `SameSite=Lax; HttpOnly; Secure` mode without third-party cookie restrictions or browser tracking prevention blocks.
  - **No Complex Reverse Proxy:** Simplifies setup and debugging.
  - **Estimated Cost:** $5 – $7 / month.

### Option B: Decoupled Architecture (Netlify Frontend + Railway/Render Backend)
- **Concept:** Frontend deployed on Netlify Edge CDN; Backend API deployed as a web service on Railway or Render.
- **Trade-offs:**
  - Requires Netlify rewrite proxy (`/api/* -> https://api.nprcrusher.com/:splat`) to keep requests same-origin, OR
  - Cross-origin cookies requiring `SameSite=None; Secure` and partitioned cookie attributes, which can be blocked by certain mobile browser privacy extensions.
- **Estimated Cost:** $0 (Netlify Free) + $5 (Backend PaaS) = ~$5 / month.

---

## 2. Environment Variables Configuration

Create a production `.env` file on the deployment host. **Never commit actual production values to Git.**

### Backend Environment Variables (`backend/.env`)

```ini
# Server Configuration
PORT=4000
NODE_ENV=production

# Database Connection (Restricted Runtime Role through Supavisor Session Pooler)
# Format: postgresql://npr_app_user.<PROJECT_REF>:<PASSWORD>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=verify-full&sslrootcert=/etc/ssl/certs/prod-ca-2021.crt
DATABASE_URL=postgresql://npr_app_user:YOUR_SECURE_PASSWORD@YOUR_SUPABASE_HOST:5432/postgres?sslmode=verify-full

# Privileged Migration Connection (Used ONLY during offline migration execution, NEVER at runtime)
# MIGRATION_DATABASE_URL=postgresql://postgres:YOUR_MIGRATION_PASSWORD@YOUR_SUPABASE_HOST:5432/postgres?sslmode=verify-full

# Security & Session Hardening
COOKIE_SECURE=true
TRUST_PROXY=1
ALLOWED_ORIGINS=https://your-production-domain.com

# Session Lifetimes
SESSION_IDLE_TTL_MS=1800000        # 30 minutes
SESSION_MAX_LIFETIME_MS=43200000   # 12 hours
SESSION_RENEW_THRESHOLD_MS=900000  # 15 minutes

# Rate Limiting Defenses
LOGIN_RATE_LIMIT_MAX_FAILURES=5
LOGIN_RATE_LIMIT_WINDOW_MS=900000  # 15 minutes
```

### Frontend Environment Variables (`frontend/.env.production`)

```ini
# When deployed with unified same-origin architecture (Option A), leave VITE_API_URL empty:
VITE_API_URL=

# If using decoupled architecture without reverse proxy:
# VITE_API_URL=https://api.your-production-domain.com
```

---

## 3. Production Build & Deployment Execution

### Step 1: Build Frontend Assets
```powershell
# From project root
npm --prefix frontend run build
```
The output directory will be created at `frontend/dist/`.

### Step 2: Build Backend Services
```powershell
# From project root
npm --prefix backend run build
```
The output JavaScript files will be created at `backend/dist/`.

### Step 3: Run Database Health Check
```powershell
npm --prefix backend run db:check
```

### Step 4: Verify Migration Status
```powershell
npm --prefix backend run migrate:status
```
Ensure all 14 migrations display `[APPLIED]` and 0 migrations are `[PENDING]`.

### Step 5: Start Production Backend
```powershell
npm --prefix backend run start
```

---

## 4. Supabase Database Hardening & TLS Verification

1. **Root CA Placement:**
   - Download the official Supabase CA (`prod-ca-2021.crt`).
   - On the Linux production container, place it in `/etc/ssl/certs/prod-ca-2021.crt` or supply it via custom path specified in `sslrootcert`.
2. **Session Pooler Mandatory:**
   - Always connect to port `5432` (Supavisor Session Pooler).
   - Do NOT connect to transaction pooler port `6543` for migrations or operations requiring session-level advisory locks.
3. **Automated Offline Backups:**
   - Execute the PowerShell backup script `scripts/database/backup-supabase.ps1` before any deployment change:
     ```powershell
     powershell -ExecutionPolicy Bypass -File scripts/database/backup-supabase.ps1 -BackupDir "E:\npr project\backups" -RetentionDays 30
     ```

---

## 5. Post-Deployment Verification Checklist

Once deployed to production:
1. **Health Check:** Send a GET request to `/api/health` and verify HTTP 200 `{ status: "ok" }`.
2. **Owner Login:** Test login on `https://your-domain.com` -> Owner Portal with credentials for `nalaka`.
3. **Cashier Login:** Test login on Cashier Portal with credentials for `cashier1`.
4. **Session Cookie:** Confirm in browser Developer Tools that cookie `npr_session` has `HttpOnly: true`, `SameSite: Lax`, and `Secure: true`.
5. **Print Layout:** Issue a sample test draft or preview and verify A5 printing from the cashier workstation.
