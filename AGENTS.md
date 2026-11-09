# AGENTS.md — NPR Metal Crusher Engineering & Operational Rules

## 1. Project Overview & Mission
- **System:** NPR Metal Crusher — Billing & Management System
- **Context:** Real-world Sri Lankan metal crusher workshop producing construction aggregates (3/4", Dust, 6×9, ABC).
- **Core Goal:** Provide a reliable, secure, maintainable, and audit-compliant billing, payment collection, and management web application.
- **Audience:** Cashier workstations (desktop-first) and Owner management (desktop/mobile responsive).
- **Review Standard:** All code is written for review by a Senior Full-Stack Engineer and Software Architect. Prioritize simplicity, maintainability, and enterprise-grade correctness over unnecessary frameworks or complex abstractions.

---

## 2. Core Architectural Principles

### 2.1 Technology Stack Standards
- **Frontend:** React 19, TypeScript (strict), Vite, Tailwind CSS v4. Feature-based modular architecture.
- **Backend:** Node.js (v20+ / v24+), Express 5, TypeScript (strict), native ES Modules (`NodeNext` resolution).
- **Database:** Supabase PostgreSQL (South Asia / Mumbai), accessed exclusively via Express backend using `pg` (node-postgres). Direct Supabase Data API is disabled.
- **Database Migrations:** Single consistent directory at `database/migrations/`. Forward-only, versioned, transactional SQL migration files.

### 2.2 ESM & Import Conventions
- In backend TypeScript files, all relative module imports **must include explicit `.js` extensions** (e.g., `import app from "./app.js";`), adhering strictly to NodeNext ESM specifications.
- Monolithic files are prohibited. Follow the 4-tier backend design:
  `Routes -> Controllers (Zod Validation) -> Services (Business Logic) -> Repositories (Parameterized SQL)`.

---

## 3. Financial Integrity & Immutability Rules

### 3.1 Strict Financial Precision
- **Never use native JavaScript floating-point numbers** for financial calculations or storage.
- Database schema must enforce:
  - Monetary values: `NUMERIC(12, 2)` (LKR, two decimal places).
  - Material volumes: `NUMERIC(10, 3)` (m³, up to three decimal places).
  - Line totals: `CHECK (line_total = ROUND(quantity * unit_price, 2))`.
  - Invariants: `CHECK (paid_amount + balance_amount = grand_total)`.
- Re-calculate and verify all line totals, transport fees, subtotals, and balances on the server inside database transactions.

### 3.2 Permanent Invoice Immutability
- Once an invoice is issued, its invoice number, customer snapshots (name, phone, delivery location), line items, quantities, agreed unit prices, transport fee, and grand total are **permanently immutable**.
- Cashiers cannot edit or delete issued invoices or recorded line items.
- Database triggers must reject any `UPDATE` or `DELETE` on commercial invoice terms and line items.

### 3.3 Append-Only Cash Payments Ledger
- Payments are strictly **CASH ONLY** and **append-only**.
- No user (cashier or owner) may execute an `UPDATE` or `DELETE` on a payment record.
- The authoritative financial balance is derived from the payment ledger:
  `balance_due = grand_total - SUM(payments.amount)`.
- Transactionally maintained summary fields on `invoices` (`paid_amount`, `balance_amount`, `payment_status`) must be updated strictly under an exclusive row lock (`SELECT ... FOR UPDATE`) within the payment transaction.

### 3.4 Payment Concurrency & Idempotency
- Every payment submission must include a client-generated UUID `idempotency_key`.
- The database enforces `UNIQUE (idempotency_key)` to eliminate double-clicks and duplicate network submissions.
- Concurrent payment requests on the same invoice must serialize using `SELECT ... FOR UPDATE` to prevent race conditions and overpayments.

### 3.5 Auditable Owner Corrections
- Errors are never silently overwritten.
- Erroneous payments must be corrected via formal, auditable records in `payment_adjustments` referencing the original payment, authorizer, and a mandatory business reason.
- Erroneous invoices must be handled via formal, numbered Credit Notes / Cancellations.

---

## 4. Application Security Standards

### 4.1 Secrets & Environment Management
- **NEVER** read, print, log, commit, or expose `.env` files or database credentials.
- Do not place backend environment variables or secrets into the frontend build.
- Maintain a clean, sanitized `.env.example` with placeholders only.

### 4.2 Authentication & Session Architecture
- Authentication uses a server-side PostgreSQL session store (`user_sessions` table).
- Passwords must be hashed using secure algorithms (`scrypt` or `bcrypt` with work factor 12).
- Session tokens must possess 256 bits of cryptographic entropy (`crypto.randomBytes(32)`).
- **Zero-knowledge session store:** Only the SHA-256 hash of the session token is stored in the database.
- Sessions are delivered via `HttpOnly`, `SameSite=Lax`, and `Secure` (in production) cookies.
- Support immediate session revocation on logout or on demand by the Owner.
- Rate-limit login attempts (max 5 failed attempts per 15-minute window per IP/user).

### 4.3 Same-Origin Architecture & CSRF Defense
- Development uses the Vite reverse proxy (`/api -> http://localhost:4000`) so the application remains same-origin.
- State-changing API endpoints (`POST`, `PUT`, `DELETE`) require custom headers (e.g. `X-Requested-With: XMLHttpRequest`), preventing cross-origin CSRF exploits without pre-flight validation.

### 4.4 Authorization & Query Safety
- Enforce role-based access control (RBAC) on the server. Never rely on client-side UI visibility.
  - Cashiers: Create invoices, view invoice history, search customers, record cash payments against unpaid balances.
  - Owner: All cashier actions + price management, payment adjustments, business reports, cash reconciliation, and audit logs.
- All database queries must use **parameterized placeholders (`$1, $2`)**. Dynamic SQL string concatenation is strictly forbidden.
- Error handling must be centralized. Never leak internal SQL error codes, schema details, or stack traces to HTTP clients.

---

## 5. UI, Language & Regional Standards
- **Language:** The entire user interface, navigation, buttons, error messages, form labels, and printed documents must be **100% in English**.
- **Currency:** Sri Lankan Rupees (`LKR` or `Rs.`), formatted with comma separators and two decimals (e.g., `Rs. 102,000.00`).
- **Timezone:** Business dates and daily reporting must calculate against `Asia/Colombo` timezone, while timestamps in PostgreSQL are stored as `TIMESTAMPTZ` (UTC).
- **Print Layout:** Invoices must support clean, pixel-perfect A5 printing (`@media print`) directly from the cashier workstation.

---

## 6. Development Workflow & Quality Gates

Every implementation task must satisfy these **Six Quality Gates** before submission:
1. **TypeScript Typecheck:** `tsc --noEmit` passes with 0 errors across both `backend` and `frontend`.
2. **Linting & Formatting:** Code adheres to clean formatting, no unused imports or variables.
3. **Automated Testing:** Unit and integration tests pass for business logic and financial transactions.
4. **Build Verification:** `npm run build` succeeds cleanly in both `backend` and `frontend`.
5. **Git Diff Review:** Focused, minimal diffs with zero secret leaks, temporary files, or unnecessary churn.
6. **Security Review:** No direct SQL concatenation, no client-side price trusts, complete server-side role validation.

---

## 7. Operational Discipline
- **Inspect Before Modifying:** Always inspect existing code before making changes.
- **Small, Reviewable Steps:** Never execute massive unstructured rewrites. Work in planned, verifiable phases.
- **Zero Unapproved Production/DB Changes:** Never run database migrations or destructive operations without explicit user approval.
- **No Automatic Git Pushes/Commits:** Never execute `git push` or automatic commits without user consent.
