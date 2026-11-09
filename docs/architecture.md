# System Architecture Specification

## Project: NPR Metal Crusher — Billing & Management System

---

## 1. High-Level Architecture Overview

The system is designed as a secure, high-performance, modular web application with strict separation between user presentation, business logic orchestration, and database persistence.

```
┌────────────────────────────────────────────────────────┐
│             PRESENTATION TIER (FRONTEND)               │
│  React 19 + TypeScript + Vite + Tailwind CSS v4        │
│  • Feature-based modular UI (Auth, Cashier, Owner)     │
│  • English-only interface with Sri Lankan conventions  │
│  • Pixel-perfect A5 invoice printing engine            │
└───────────────────────────┬────────────────────────────┘
                            │
               HTTPS / Same-Origin API (/api)
               (HttpOnly Cookie + Custom CSRF Header)
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│             APPLICATION TIER (BACKEND API)             │
│  Node.js (NodeNext ESM) + Express 5 + TypeScript       │
│                                                        │
│  ├── Middleware (Auth, Role Guard, Zod Validate, CORS) │
│  ├── Controllers (Request parsing & Response DTOs)     │
│  ├── Services (Domain logic, Financial math, Events)   │
│  └── Repositories (Parameterized SQL Queries)          │
└───────────────────────────┬────────────────────────────┘
                            │
               Managed Connection Pool (pg.Pool)
               ACID Transactions & Row Locks
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│                DATA TIER (POSTGRESQL)                  │
│  Supabase PostgreSQL (South Asia / Mumbai)             │
│  • Version-controlled migrations in database/migrations│
│  • Strong CHECK constraints & immutability triggers    │
│  • Append-only payment ledger & dynamic views          │
└────────────────────────────────────────────────────────┘
```

---

## 2. Backend Modular Layer Architecture

To prevent monolithic spaghetti code, the Express application follows a strict 4-tier architecture:

```
[ HTTP Request ]
       │
       ▼
[ Controller ]       ── Validates request body, params, and queries using Zod.
       │                 Extracts typed input DTOs and handles HTTP status codes.
       ▼
[ Service ]          ── Implements domain rules: invoice sequencing, balance calculations,
       │                 payment bounds validation, and audit recording.
       │                 Manages explicit database transactions across repositories.
       ▼
[ Repository ]       ── Pure SQL execution using parameterized `$1, $2` placeholders.
       │                 Returns strongly typed database records. Zero business logic.
       ▼
[ PostgreSQL Pool ]
```

### Layer Rules & Boundaries
1. **Controllers** never write SQL queries and never execute business rules.
2. **Services** never access `req` or `res` Express objects. They operate entirely on clean TypeScript primitives.
3. **Repositories** are isolated data-access modules. They never call other repositories or handle HTTP concerns.
4. **Error Handling:** Application services throw domain-specific errors (`ValidationError`, `NotFoundError`, `ConflictError`, `ForbiddenError`), which are caught by the centralized error middleware and converted into sanitized client responses:
   ```json
   {
     "success": false,
     "error": {
       "code": "INSUFFICIENT_BALANCE",
       "message": "Payment amount exceeds outstanding invoice balance."
     }
   }
   ```

---

## 3. Financial Integrity & Ledger Architecture

### 3.1 Commercial Terms vs. Payment Ledger
- **Commercial Invariant:** An issued invoice constitutes a frozen legal transaction. Line items, quantities, agreed unit prices, transport fee, subtotal, and grand total **can never be updated or deleted**.
- **Payment Ledger:** Payments are recorded in an append-only table (`payments`). Every rupee received creates a new, immutable payment record.
- **Authoritative Balance Ground Truth:**
  ```sql
  balance_due = grand_total - COALESCE(SUM(payments.amount), 0.00)
  ```
- **Transactionally Synchronized Summary Columns:** For high-speed querying, `paid_amount`, `balance_amount`, and `payment_status` are maintained on the `invoices` table under database check constraints:
  ```sql
  CONSTRAINT chk_total_balance CHECK (paid_amount + balance_amount = grand_total)
  ```

### 3.2 Payment Concurrency & Idempotency
- **Idempotency Key:** When submitting a payment, the client generates a unique UUID v4 passed via the `idempotency_key` field. A unique constraint in PostgreSQL guarantees that network retries or double-clicks cannot produce duplicate payment rows.
- **Row-Level Locking:** During payment processing, the invoice row is locked using `SELECT ... FOR UPDATE`:
  ```sql
  SELECT id, grand_total, paid_amount, balance_amount, payment_status
  FROM invoices
  WHERE id = $invoiceId
  FOR UPDATE;
  ```
  This serializes concurrent attempts and guarantees that simultaneous payments from multiple terminals can never overpay an invoice.

---

## 4. Authentication & Security Architecture

### 4.1 Zero-Knowledge Session Store
Instead of vulnerable stateless JWTs in client storage, we implement a server-side session store in PostgreSQL:
1. When a user authenticates, a 256-bit cryptographically secure token is generated:
   ```ts
   const rawToken = crypto.randomBytes(32).toString('base64url');
   ```
2. The raw token is **never saved to the database**. Only its cryptographic hash is stored:
   ```ts
   const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
   ```
3. The raw token is transmitted to the browser in an `HttpOnly` cookie. Even if the database is dumped or leaked, active sessions cannot be reconstructed.

### 4.2 Cookie & Same-Origin Configuration
- **Cookie Name:** `npr_session`
- **Attributes:**
  - `HttpOnly: true` (immune to JavaScript XSS exfiltration)
  - `SameSite: 'Lax'` (safeguards against CSRF)
  - `Secure: process.env.NODE_ENV === 'production'` (TLS enforced in prod, works on localhost)
  - `Path: '/'`
- **Same-Origin API Routing:**
  - In development, Vite proxies `/api` directly to `http://localhost:4000`.
  - In production, a reverse proxy or single origin serves both static UI assets and `/api`.
  - Eliminates all CORS pre-flight overhead and treats all cookie exchanges as first-party.

### 4.3 CSRF Protection
All state-changing endpoints (`POST`, `PUT`, `DELETE`) require a custom header (`X-Requested-With: XMLHttpRequest` or `X-NPR-CSRF: 1`). Web browsers cannot attach custom headers cross-origin without CORS preflight clearance, providing a powerful second layer of CSRF defense alongside `SameSite` cookies.

### 4.4 Brute-Force & Rate Limiting
Login endpoints are protected by an IP- and username-based rate limiter allowing a maximum of **5 failed login attempts per 15-minute window**.

---

## 5. Frontend Architecture & Modularization

The frontend is structured by domain feature rather than technical categorization:

```
frontend/src/
├── api/             # Typed API client functions (fetch wrapper with credentials)
├── components/      # Shared presentation components (Button, Modal, Input, Table)
├── context/         # AuthContext (session state), ToastContext
├── features/
│   ├── auth/        # LoginPage, LoginForm
│   ├── cashier/     # CashierDashboard, NewInvoicePage, InvoicePrintA5, History
│   ├── customers/   # CustomerSearchModal, CustomerLedger
│   └── owner/       # OwnerDashboard, PriceManager, SalesReports, AuditTrail
├── types/           # Domain TypeScript definitions (Invoice, Material, Payment)
├── utils/           # Formatters (LKR currency, Asia/Colombo dates, print utilities)
├── App.tsx          # Router and view state orchestration
└── index.css        # Tailwind v4 theme, Inter font, @media print stylesheet
```

### 5.1 A5 Print Engine
The cashier application provides a dedicated, clean invoice print layout. Using CSS `@media print` with explicit A5 dimensions (`148mm x 210mm`), it renders a professional receipt containing:
- NPR Metal Crusher business header & contact details
- Invoice number, issue date/time, and cashier name
- Customer name, telephone, and delivery destination
- Itemized material table with m³, unit price, and line totals
- Transport indicator and charge
- Subtotal, grand total, cash received, and remaining balance due
- Terms of sale and signature lines
