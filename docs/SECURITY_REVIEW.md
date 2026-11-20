# Security Review & Architecture Audit — NPR Metal Crusher System

**Audit Date:** November 21, 2026  
**Auditor:** Senior Full-Stack & Application Security Engineer  
**Scope:** Authentication, Authorization (RBAC), Session Security, Database Hardening, Financial Integrity, and Network Defenses  

---

## 1. Authentication & Credential Architecture

### 1.1 Password Hashing Specification
The system utilizes Node.js native `crypto.scrypt` with OWASP-recommended parameters:
- **Cost Factor ($N$):** $32,768$ ($2^{15}$)
- **Block Size ($r$):** $8$
- **Parallelization ($p$):** $1$
- **Key Length:** $64$ bytes ($512$ bits)
- **Salt:** $16$ cryptographically random bytes via `crypto.randomBytes(16)`
- **Encoded Format:** `scrypt$N=32768,r=8,p=1$<salt_base64url>$<derived_key_base64url>`
- **Timing Attack Mitigation:** When a username is unknown or an account is inactive, `AuthService.login()` executes a simulated verification against `DUMMY_PASSWORD_HASH` to guarantee identical execution timing and prevent user enumeration.

### 1.2 Session Security & Zero-Knowledge Storage
- **Token Entropy:** 256 bits of cryptographic entropy generated via `crypto.randomBytes(32)` (43 base64url characters).
- **Database Storage:** Zero-knowledge session store. Only the SHA-256 hash (`crypto.createHash("sha256")`) of the session token is stored in `public.user_sessions`. Even in the event of an unauthorized database read, active session tokens cannot be derived.
- **Cookie Security:**
  - `HttpOnly`: Accessible only to HTTP requests; protected against client-side XSS inspection.
  - `SameSite=Lax`: Defends against Cross-Site Request Forgery (CSRF).
  - `Secure`: Required in production (HTTPS).
  - `Path=/`: Scoped to the application root.
- **Session Lifecycle:**
  - Idle TTL: 30 minutes of inactivity.
  - Maximum Lifetime: 12 hours absolute cutoff.
  - Immediate Revocation: Tokens are wiped on logout (`DELETE FROM user_sessions WHERE token_hash = $1`).

### 1.3 Rate Limiting & Brute-Force Defense
- Monitored via `public.audit_logs` using PostgreSQL advisory locks (`pg_advisory_xact_lock`).
- Threshold: Maximum **5 failed login attempts per 15-minute rolling window** per IP address or user entity ID.
- Exceeding the threshold triggers HTTP 429 (`TooManyRequestsError`) with an exact `Retry-After` header.

---

## 2. Authorization & Role-Based Access Control (RBAC)

### 2.1 Server-Authoritative Identity
- **Never Trust the Client:** Client requests are prohibited from supplying arbitrary `actorId`, `ownerId`, or `cashierId` fields.
- **Session Binding:** All state-changing operations strictly resolve the actor's identity (`req.auth.user.id`, `req.auth.user.role`) from the server-validated session.
- **Cross-Role Portal Guard:**
  - Owner Portal strictly rejects Cashier accounts (`CROSS_ROLE_LOGIN_FORBIDDEN`).
  - Cashier Portal strictly rejects Owner accounts (`CROSS_ROLE_LOGIN_FORBIDDEN`).

### 2.2 Permissions Matrix

| Feature | Cashier Role | Owner Role | Security Mechanism |
| :--- | :--- | :--- | :--- |
| **Create Invoices** | Allowed | Allowed | Zod validation + DB constraints |
| **View Invoices** | Allowed | Allowed | Parameterized SQL |
| **Edit/Delete Issued Invoices** | **BLOCKED** | **BLOCKED** | Immutable DB triggers (`forbid_invoice_mutation`) |
| **Record Cash Payments** | Allowed | Allowed | Transactional `SELECT ... FOR UPDATE` |
| **Adjust/Void Payments** | **BLOCKED** | Allowed | OwnerGuard + append-only ledger |
| **Update Material Selling Price** | Allowed (active materials) | Allowed | Version-checked optimistic concurrency |
| **Activate/Deactivate Materials** | **BLOCKED** | Allowed | Owner-only route guard |
| **View Price Change Audit History** | **BLOCKED** | Allowed | OwnerGuard + RLS policy |
| **Create Salary Periods** | Allowed | Allowed | Non-overlapping period constraint |
| **Enter/Edit Draft Salaries** | Allowed | Allowed | DRAFT status check |
| **Approve Salaries** | **BLOCKED** | Allowed | OwnerGuard (`role = 'OWNER'`) |
| **Disburse Salary Cash** | Allowed | Allowed | Must be APPROVED + CASH ONLY constraint |
| **Correct Approved Salaries** | **BLOCKED** | Allowed | OwnerGuard + floor check (`>= paid_amount`) |
| **View Salary Audit History** | **BLOCKED** | Allowed | OwnerGuard |

---

## 3. Financial Integrity & Transactional Defenses

### 3.1 Strict Financial Precision (No Floating Point)
- JavaScript IEEE-754 floating-point operations are completely banned for monetary and material calculations.
- Implemented with custom fixed-point BigInt utilities (`money.ts`):
  - Monetary values: Parsed and stored as cents (`NUMERIC(12, 2)`).
  - Material volumes: Parsed and stored as thousandths of $m^3$ (`NUMERIC(10, 3)`).
  - Line Totals: Enforced via `CHECK (line_total = ROUND(quantity * unit_price, 2))`.
  - Invariants: Enforced via `CHECK (paid_amount + balance_amount = grand_total)`.

### 3.2 Append-Only Financial Ledgers
- Payments and salary adjustments operate on append-only tables (`payments`, `payment_adjustments`, `salary_payments`, `salary_payment_adjustments`).
- Database triggers `trg_payments_append_only` and `trg_salary_payment_adjustments_append_only` intercept and raise SQL exceptions on any `UPDATE` or `DELETE`.
- Balances are derived authoritatively from the append-only ledger.

### 3.3 Concurrency & Idempotency
- All payment submissions require a client-generated UUID `idempotency_key`.
- Unique constraints (`UNIQUE (idempotency_key)`) guarantee duplicate network requests replay the existing receipt rather than double-inserting financial records.
- Deadlock prevention and race condition mitigation use serialized row locks:
  `Parent (payroll_entries / invoices) FOR UPDATE -> Child (payments) FOR UPDATE`.

---

## 4. Database Security & Supabase Hardening

### 4.1 Restricted Runtime Role (`npr_app_user`)
- In production, the backend runs under the unprivileged `npr_app_user` role.
- Role properties: `LOGIN`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOBYPASSRLS`.
- Direct Supabase Data APIs (PostgREST) are disabled. External client access to database ports is protected.

### 4.2 Row-Level Security (RLS)
- RLS is explicitly enabled (`rowsecurity = true`) on all business tables.
- Tables without explicit read access fail closed.

### 4.3 Separation of Migration and Runtime Connections
- `DATABASE_URL` (Runtime): Strictly uses `npr_app_user` through Supabase Session Pooler (port `5432`) with `sslmode=verify-full`.
- `MIGRATION_DATABASE_URL` (Migrations): Privileged `postgres` role used only during offline deployment maintenance.

---

## 5. Network & Transport Security

- **TLS / SSL:** Remote connections enforce `sslmode=verify-full` with Supabase Root CA certificate validation. Non-verify or disabled SSL is blocked by `config.ts`.
- **CSRF Defense:** State-changing API endpoints (`POST`, `PUT`, `PATCH`, `DELETE`) require custom headers (`X-Requested-With: XMLHttpRequest` or `X-NPR-CSRF: 1`), preventing standard cross-origin form submission exploits without pre-flight validation.
- **CORS:** Strict origin allowlist (`ALLOWED_ORIGINS`). Wildcard `*` origins are rejected at startup in production.
