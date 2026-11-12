# Phased Development Roadmap & Quality Gates

## Project: NPR Metal Crusher — Billing & Management System

---

## 1. Roadmap Overview

The NPR Metal Crusher system is implemented across nine controlled, testable, and non-destructive phases. Every phase must pass the strict **Six Quality Gates** prior to proceeding.

```
Phase 0A ──> Phase 1 ──> Phase 2 ──> Phase 3 ──> Phase 4 ──> Phase 5 ──> Phase 6 ──> Phase 7 ──> Phase 8
Foundation    English    Database     Auth &      Catalog &   Invoicing &  Payments &   Owner      Hardening
& Safety      Frontend   Migrations   Sessions    Customers   A5 Printing  Concurrency  Reports    & Handover
```

---

## 2. Phase-by-Phase Plan

### Phase 0A: Professional Project Foundation (Current Phase)
- **Objective:** Establish the permanent engineering baseline, repository hygiene, security exclusions, and architecture documentation without touching runtime code.
- **Deliverables:**
  - Verified `.gitignore` excluding all `.env` files, credentials, and build outputs.
  - `AGENTS.md` specifying permanent architecture, financial integrity, security, and coding rules.
  - Complete documentation suite under `docs/` (`requirements.md`, `architecture.md`, `database-design.md`, `development-roadmap.md`).
  - Root `README.md` with accurate setup, architecture, and verification instructions.
  - Verified clean TypeScript checks (`tsc --noEmit`) and builds on existing code.
  - Git status safety assessment and identification of files safe for initial commit.
- **Quality Gates:** Zero errors on typecheck, `.env` verified as untracked.

---

### Phase 1: Frontend Conversion to English & Modular Architecture
- **Objective:** Convert the Figma-generated prototype entirely to English and modularize `App.tsx` into clean, feature-based components without breaking current UI behavior.
- **Deliverables:**
  - Replace all Sinhala text, labels, place-holders, and notifications with clear English strings.
  - Replace `Noto Sans Sinhala` font import with professional modern typography (`Inter`).
  - Decompose `frontend/src/App.tsx` into modular feature components:
    - `features/cashier/CashierDashboard.tsx`
    - `features/cashier/NewInvoicePage.tsx`
    - `components/layout/Sidebar.tsx`, `Header.tsx`
    - `components/ui/StatCard.tsx`, `Table.tsx`, `Button.tsx`
  - Maintain mock state and visual polish identically to the Figma prototype.
- **Quality Gates:** `npm run build` succeeds, `npx tsc --noEmit` passes with 0 errors, English-only text verified.

---

### Phase 2: Database Schema & Version-Controlled Migrations
- **Objective:** Formulate the complete PostgreSQL schema and author migration files in `database/migrations/`.
- **Deliverables:**
  - Create directory `database/migrations/`.
  - Author `001_initial_schema.sql` (Tables: `users`, `user_sessions`, `materials`, `material_price_history`, `customers`, `invoices`, `invoice_items`, `payments`, `payment_adjustments`, `audit_logs`).
  - Author `002_integrity_triggers_and_views.sql` (Immutability triggers, ledger views, reconciliation views).
  - Prepare a safe, non-destructive migration execution plan.
  - **Rule:** Do NOT execute migrations without explicit user review and approval.
- **Quality Gates:** Validated PostgreSQL DDL syntax, schema review approval.

---

### Phase 3: Secure Authentication & Role Authorization
- **Objective:** Implement session-backed authentication in Express with role enforcement and React login integration.
- **Deliverables:**
  - Database seed script for initial accounts (1 Owner, 2 Cashiers) with secure password hashing (`scrypt`/`bcrypt`).
  - Cryptographically secure 256-bit session token generator and SHA-256 pre-storage hashing in `user_sessions`.
  - `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.
  - Secure cookie configuration (`HttpOnly`, `SameSite=Lax`, `Secure` in prod).
  - Rate limiting on login attempts (5 attempts / 15 mins).
  - `authMiddleware` and `requireRole(['OWNER'])` guards.
  - React `AuthContext`, `LoginPage`, and session restoration on app load.
  - Configure Vite reverse proxy (`/api` -> `http://localhost:4000`) for seamless same-origin communication.
- **Quality Gates:** Auth unit tests pass, cookies verified `HttpOnly`, unauthorized API requests blocked with 401/403.

---

### Phase 4: Materials Catalogue & Customer Management
- **Objective:** Implement backend APIs and frontend integration for materials and customer directories.
- **Deliverables:**
  - `GET /api/materials` (active materials and prices for cashiers).
  - `PUT /api/materials/:id/price` (Owner only; writes to `material_price_history` and `audit_logs`).
  - `GET /api/customers/search?q=` (fast phone/name lookups).
  - `GET /api/customers/:id/history` (view past customer purchases).
  - Frontend integration: New Invoice screen dynamically consumes server-configured material prices and provides typeahead customer search.
- **Quality Gates:** Cashiers prevented from modifying prices; customer search returns sub-second results.

---

### Phase 5: Transactional Invoicing & English A5 Print Engine
- **Objective:** Implement atomic invoice generation and dedicated cashier A5 printing.
- **Deliverables:**
  - `POST /api/invoices` with transactional ACID guarantee:
    - Atomically persists invoice, customer snapshot, line items, and optional initial cash payment.
    - Server-side sequential invoice numbering (`NPR-INV-YYYY-XXXXX`).
    - Recalculates and validates all line totals and transport fee on the server.
  - Immutability trigger verification (issued invoices cannot be updated or deleted).
  - `GET /api/invoices/:id` and `GET /api/invoices` with pagination and date filters.
  - Pixel-perfect English A5 printable invoice layout (`@media print`).
- **Quality Gates:** Multi-item invoice persistence passes transaction rollback tests; A5 print preview verified.

---

### Phase 6: Append-Only Cash Payments & Concurrency Control
- **Objective:** Implement idempotent, append-only cash payment recording against invoice balances.
- **Deliverables:**
  - `POST /api/payments` requiring a client-generated UUID `idempotency_key`.
  - Exclusive row-level locking (`SELECT ... FOR UPDATE`) during payment processing to eliminate race conditions.
  - Receipt number generation (`NPR-REC-YYYY-XXXXX`).
  - Synchronized update of `paid_amount`, `balance_amount`, and `payment_status`.
  - Frontend "Record Cash Payment" modal on invoice history and customer ledger.
  - Automated integration tests:
    - Duplicate request test (verifies identical idempotency key produces no duplicate row).
    - Concurrent payment test (verifies simultaneous requests cannot overpay).
- **Quality Gates:** Automated concurrency tests pass with 100% success; zero possibility of negative balance.

---

### Phase 7: Owner Dashboard, Cash Reconciliation & Financial Reports
- **Objective:** Implement executive oversight, daily shift reconciliation, and audit log inspection.
- **Deliverables:**
  - `GET /api/reports/dashboard` (today's revenue, collected cash, outstanding debtors).
  - `GET /api/reports/sales-summary` (sales and volume breakdown by material and custom date range).
  - `GET /api/reports/cash-reconciliation` (shift cash collected per cashier for drawer balancing).
  - `GET /api/reports/outstanding-balances` (aging debtor balances and contact list).
  - `GET /api/audit-logs` (Owner-only security and operational audit trail).
  - `POST /api/payments/:id/adjust` (Auditable owner payment correction / void).
  - Responsive Owner Dashboard UI.
- **Quality Gates:** Role-based access verified; financial reports cross-checked against raw ledger view.

---

### Phase 8: Hardening, Automated Testing & Senior Review Handover
- **Objective:** Final end-to-end verification, security hardening, and code audit readiness for core billing.
- **Deliverables:**
  - Full automated regression test suite across backend and frontend.
  - Security audit: Parameterization check, header verification (`Helmet`), rate limits, cookie flags.
  - Comprehensive Senior Developer review documentation and walkthrough guide.
- **Quality Gates:** All quality gates pass across the entire codebase.

---

### Phase 9 (Planned Future Scope): Workshop Operations, Production & Payroll Management
- **Status:** Requirements captured in [requirements.md](./requirements.md#L96-L111); **not yet implemented**. Pending client sign-off on payroll, machine-hour, and production measurement rules before schema migration.
- **Planned Scope:**
  - Worker attendance tracking and strictly **OWNER-only** confidential wage rates & payroll approval.
  - Machine working hours & downtime logs.
  - Daily crushed metal production quantities.
  - Spreadsheet-style daily operations entry submitted by Cashiers and reviewed/approved by the Owner.
  - Combined Owner operational and financial reports.

---

## 3. Strict Quality Gates (Applied per Phase)

Every phase submission must pass the following checklist:

| Quality Gate | Method | Acceptance Standard |
|---|---|---|
| **1. TypeScript Typecheck** | `npm run typecheck` / `tsc --noEmit` | **0 errors** across both `backend` and `frontend`. |
| **2. Code Linting** | `npm run format` / linter check | Consistent style, no unused imports, strict typings. |
| **3. Automated Tests** | `npm test` | All unit, integration, and concurrency tests pass. |
| **4. Build Verification** | `npm run build` | Clean production build of both client and server. |
| **5. Git Diff Review** | `git diff` | Minimal, focused diff; no temporary or unapproved files. |
| **6. Security Review** | Code audit | Zero credentials, parameterization everywhere, RBAC on server. |
