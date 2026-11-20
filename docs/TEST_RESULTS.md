# Test Results & Quality Assurance Audit — NPR Metal Crusher System

**Execution Date:** November 21, 2026  
**Environment:** Node.js v24.12.0, PostgreSQL 17 (ap-south-1 Mumbai), Vite v8.3.6, React 19  
**Overall Result:** **139 / 139 TESTS PASSED (100% SUCCESS RATE)**  

---

## 1. Quality Gates Summary

| Verification Gate | Command | Result | Notes |
| :--- | :--- | :--- | :--- |
| **Backend Typecheck** | `npm --prefix backend run typecheck` | **PASS (0 errors)** | Strict TypeScript compilation (`tsc --noEmit`). |
| **Frontend Typecheck** | `npm --prefix frontend run typecheck` | **PASS (0 errors)** | Strict TypeScript compilation (`tsc -p tsconfig.json --noEmit`). |
| **Backend Unit Tests** | `npm --prefix backend run test:unit` | **PASS (93/94 tests, 1 skipped)** | Duration: 2.04s across 17 suites (1 live container test skipped). |
| **Frontend Unit & UI Tests** | `npm --prefix frontend test` | **PASS (54/54 tests)** | Duration: 4.44s across 9 suites. |
| **Frontend Production Build** | `npm --prefix frontend run build` | **PASS (Clean build)** | Built in 1.18s with zero errors (`vite build`). |
| **Live Database Connectivity** | `npm --prefix backend run db:check` | **PASS** | Live connection established and verified. |
| **Migration Status** | `npm --prefix backend run migrate:status` | **PASS (14/14 applied)** | All migrations 001–014 applied in order. |

---

## 2. Detailed Backend Test Suite Breakdown (85 Tests)

```
▶ Phase 3A — Auth Unit Tests (Hashing, Cookies, SecurityConfig & RBAC) (7 tests)
  ✔ hashes and verifies passwords with scrypt and timing-safe dummy fallback
  ✔ generates 256-bit tokens, hashes to 64-char SHA-256, and formats secure cookies
  ✔ enforces explicit non-wildcard ALLOWED_ORIGINS and Secure cookies in production
  ✔ blocks test-only registerExtraRoutes hook in production
  ✔ requireRole fails closed on missing auth or unknown roles
  ✔ permits local LAN RFC 1918 private origins in development and rejects them in production
  ✔ enforces cross-role login restrictions: accepts valid roles on their own portal and rejects cross-portal logins

▶ Phase 2C — Backend Database Connection Separation & Safety Guards (6 tests)
  ✔ detects npr_app_user and privileged roles in direct and Supavisor project-scoped formats
  ✔ isolates runtime DATABASE_URL from privileged MIGRATION_DATABASE_URL
  ✔ refuses elevated postgres credentials and non-verify-full remote TLS in production
  ✔ uses MIGRATION_DATABASE_URL when set and blocks npr_app_user from running migrations
  ✔ supports pre-cutover non-production transition when MIGRATION_DATABASE_URL is unset
  ✔ blocks TLS-downgrade modes and pg-connection-string ?user= / ?ssl=0 bypass overrides

▶ 11-Product Catalogue Expansion & Owner Activation Workflow — Unit Tests (3 tests)
  ✔ verifies approved 11 products catalogue specifications and m³ units
  ✔ verifies forward-only migration 009 SQL structure and constraints
  ✔ enforces validation rules when activating inactive materials

▶ Cashier & Owner Material Price Management Permissions — Unit Tests (9 tests)
  ✔ verifies migration 010 SQL structure and permissions trigger update
  ✔ permits Cashier to update price of active material with valid reason and version
  ✔ blocks Cashier from passing isActive (activation remains Owner-only)
  ✔ blocks Cashier from updating inactive materials
  ✔ rejects price updates with version conflicts (optimistic concurrency)
  ✔ verifies price history query generation with cashier, material, and date filters
  ✔ verifies forward-only migration 011 SQL structure, RLS policy definition, and constraints
  ✔ verifies RLS policy logic: permits active OWNER and active CASHIER, rejects inactive or unauthorized roles
  ✔ ensures updatePrice service strictly binds server session identity for material_price_history insertion

▶ Phase 2 — Cashier Payroll, Advances & Expenses Permissions — Unit Tests (8 tests)
  ✔ verifies forward-only migration 012 SQL structure, trigger function, and RLS policies
  ✔ verifies trigger function and RLS policies allow active OWNER and active CASHIER, reject others
  ✔ ensures upsertCompensationProfile validates mandatory reason and captures old vs new rates in audit_logs
  ✔ ensures upsertCompensationProfile enforces optimistic concurrency (expectedVersion)
  ✔ ensures recordAdvance and recordExpense strictly bind server session identity
  ✔ verifies repository queries do not reference pe.remaining_payable or pe.paid_amount and do not clamp with GREATEST
  ✔ verifies payroll entry mapping across zero payments, partial payments, multiple payments, and overpayments
  ✔ verifies findPayrollEntryById query structure and locking clause

▶ Manual Monthly Salary System — Backend Unit Tests (4 tests)
  ✔ rejects overlapping payroll periods to prevent double advance deductions
  ✔ creates non-overlapping period and automatically initializes DRAFT entries for active workers
  ✔ calculates applicable advances strictly within period dates
  ✔ allows Owner to enter manual salary, deducting advances and calculating net payable

▶ Billing MVP — Fixed-Point BigInt Money Utilities (2 tests)
  ✔ parses and formats exact decimals without IEEE-754 floating-point drift
  ✔ rejects negative numbers, scientific notation, and excess decimal places

▶ Stage 3.2A — Cashier Period Creation & Salary Disbursement Unit Tests (11 tests)
  ✔ verifies route authorization: Cashier can create periods and record payments, but cannot approve or view audit history
  ✔ allows Cashier to create a custom salary period, recording creator actor and auto-initializing worker entries
  ✔ rejects period creation when dates overlap with an existing active period
  ✔ allows Cashier to record a CASH payment against an APPROVED payroll entry
  ✔ strictly rejects salary payments on DRAFT entries
  ✔ strictly rejects non-CASH salary payment methods
  ✔ strictly rejects payment exceeding remaining payable
  ✔ safely replays identical payment requests via idempotency key without duplicate inserts
  ✔ verifies repository calculates paid_amount and remaining_payable with salary_payment_adjustments subquery
  ✔ verifies listSalaryPayments returns effectiveAmount alongside amount
  ✔ verifies listPayrollPeriods returns creator and approver audit metadata

▶ Stage 3.2B — Owner Approved Salary Corrections & Payment Adjustments Unit Tests (12 tests)
  ✔ verifies route authorization: Approved salary corrections and payment adjustments are strictly OWNER-ONLY
  ✔ allows Owner to correct an APPROVED salary amount, updating net payable and logging audit details
  ✔ blocks approved salary reduction below the amount already paid out
  ✔ blocks approved salary correction when applicable advances exceed proposed gross salary
  ✔ rejects approved salary correction on version conflict (optimistic concurrency)
  ✔ allows Owner to correct a salary payment once (30,000 -> 25,000)
  ✔ supports repeated corrections on the same payment (25,000 -> 20,000)
  ✔ allows Owner to VOID a previously corrected payment (20,000 -> 0)
  ✔ strictly rejects any adjustments after a payment has been VOIDED
  ✔ safely replays identical payment adjustment requests via idempotency key without duplicate inserts
  ✔ rejects payment adjustment when stale expectedPriorAmount does not match DB
  ✔ rejects payment adjustment if corrected amount causes total entry paid to exceed net payable

▶ Stage 3.5A — Salary Financial Reporting & Export Consistency (10 tests)
  ✔ verifies SQL structure: fetchFinancialReport uses authoritative correlated subquery with ORDER BY id DESC LIMIT 1
  ✔ verifies SQL structure: fetchPayrollExportRows uses authoritative correlated subquery in paid_totals CTE
  ✔ Case 1: unadjusted payment correctly aggregates original amount without adjustments
  ✔ Case 2: single payment correction (30,000 -> 25,000) reflects latest adjusted amount
  ✔ Case 3: repeated payment corrections (25,000 -> 20,000) uses latest correction and avoids double-counting
  ✔ Case 4: voided payment (20,000 -> 0.00) reflects 0.00 paid and full net payable remaining
  ✔ Case 5: multiple payment receipts on one salary entry aggregate each receipt's effective amount independently
  ✔ Case 6: partial payments calculate paid totals and remaining balances accurately
  ✔ Case 7: financial invariant holds across adjustments (paid_lkr + remaining_lkr = net_payable_lkr)
  ✔ Case 8: export values match authoritative payroll repository logic
  ✔ Case 9: unadjusted historical payments remain unaffected
  ✔ Case 10: invoiced sales, cash collections, and open receivables remain completely independent and unaffected

▶ Operations Time Utilities — Unit Tests (2 tests)
  ✔ parses, normalizes, and handles same-day and overnight shifts
  ✔ detects overlapping shifts including across midnight

▶ Report Export Utilities — Formula Injection & Binary Formats (2 tests)
  ✔ neutralizes dangerous leading characters in spreadsheets
  ✔ builds BOM UTF-8 CSV, valid XLSX (PK), and valid PDF (%PDF-)
```

---

## 3. Detailed Frontend Test Suite Breakdown (54 Tests)

```
▶ Owner Approvals Queue — Runtime Crash Fix & Edge Case Regression Tests (5 tests)
  ✔ regression: correctly extracts data.pending from backend response avoiding undefined .length crash
  ✔ handles missing or malformed pending approvals payload gracefully without throwing
  ✔ renders pending submissions across all three categories when data is present
  ✔ does not mask backend failures by showing 'All Caught Up' when API call fails
  ✔ ErrorBoundary prevents full application white-screen when a component crashes

▶ Phase 3B — Frontend Authentication API, RBAC Guards & React UI Tests (7 tests)
  ✔ enforces credentials:include, CSRF X-Requested-With headers, 429 retry formatting, network error handling, and role payload validation
  ✔ enforces role-based screen routing helpers fail-closed
  ✔ never exposes dashboards while checking session, then renders LoginPage when unauthenticated
  ✔ restores authenticated OWNER session via GET /api/auth/me and avoids fake totals on Owner Dashboard
  ✔ supports OWNER login, isolated Demo toggle, real Logout, and CASHIER login with visible Demo labels
  ✔ handles rate limiting (429), network failures, and blocks CASHIER from OWNER-only ProtectedRoute
  ✔ evicts user immediately to LoginPage when an authenticated API call returns 401 (expired/revoked session)

▶ Phase 4 Billing MVP — Frontend Invoice, Payment, A5 Print & Owner Views (4 tests)
  ✔ formats LKR fixed-point strings and Asia/Colombo timestamps accurately
  ✔ completes CASHIER invoice creation from live materials, A5 print rendering, and subsequent payment recording
  ✔ renders live PostgreSQL financial overview metrics and saved invoices on OwnerDashboard
  ✔ supports dual print layouts (A5 and 80mm POS Thermal) with correct data and non-interfering styles

▶ Landing Page & Dual Login Navigation — Frontend Tests (6 tests)
  ✔ renders modern industrial landing page branded NPR Metal Crusher with real aggregate catalog
  ✔ switches between Owner Login (English) and කැෂියර් පිවිසුම (Sinhala) entry points
  ✔ authenticates Owner and routes strictly to Owner Dashboard, then returns to Landing Page on logout
  ✔ authenticates Cashier on Cashier Portal and routes strictly to Cashier Dashboard
  ✔ rejects Owner credentials on Cashier Portal, displays safe error, and stays on Landing Page
  ✔ rejects Cashier credentials on Owner Portal, displays safe error, and stays on Landing Page

▶ Navigation State Persistence & Session Refresh Protection (11 tests)
  ✔ saves and restores navigation state scoped to user ID and role
  ✔ safely resolves invoice-detail with positive invoiceId or falls back to invoices list
  ✔ prevents role bypass through sessionStorage tampering
  ✔ clears saved navigation on clearSavedNavigation()
  ✔ Owner: restores Payroll tab across browser reload (F5)
  ✔ Owner: restores Invoices tab across browser reload (F5)
  ✔ Owner: restores Daily Operations tab across browser reload (F5)
  ✔ Cashier: restores New Invoice (Billing) tab across browser reload (F5)
  ✔ Cashier: restores Payroll tab across browser reload (F5)
  ✔ preserves active screen during session refresh and window focus revalidation
  ✔ logout clears saved navigation state and subsequent login starts at Dashboard

▶ Phase 5-6 Operations, Approvals, Price Management, Payroll & Payment Reversal (8 tests)
  ✔ computes spreadsheet net hour previews accurately and enforces strict RBAC route blocking
  ✔ blocks Cashier from Owner navigation links and allows Cashier spreadsheet Draft -> Submit
  ✔ allows Owner to update Material Prices, approve pending queues, inspect Reports, and reverse erroneous payment entry
  ✔ renders 11 products catalogue and allows Owner to configure price and activate inactive materials
  ✔ allows Cashier to update selling price immediately without Owner approval, while keeping audit history Owner-only
  ✔ displays Owner-visible price change audit history with role badges and filtering by cashier, material, and date
  ✔ Stage 2: allows Cashier to view Salary Periods, enter Manual Salary with mandatory reason, record Advances and Expenses
  ✔ Stage 2: allows Owner to view Salary Periods, create custom Periods, and view Salary Audit History

▶ Stage 3.3 — Owner and Cashier Manual Salary Frontend Integration (2 tests)
  ✔ 1-10: Cashier role permissions: can create period, disburse cash against approved entry, but cannot approve, correct salary, view history, or access adjustments tab
  ✔ 11-15: Owner role permissions: period creator metadata, approved salary correction with floor check, payment receipts tab, AMOUNT_CORRECTION and VOID ledger actions

▶ Cashier Sinhala UI Localization & Language Switcher — Frontend Tests (2 tests)
  ✔ verifies Sinhala dictionary completeness and natural Sri Lankan business terminology
  ✔ renders CASHIER role in natural Sinhala by default without explicit user configuration

▶ invoiceCalculator utilities (9 tests)
  ✔ calculates subtotal correctly from material rows
  ✔ handles empty items array gracefully with 0 subtotal
  ✔ adds transport fee when withTransport is true
  ✔ ignores transport fee when withTransport is false
  ✔ calculates paidAmount and balance correctly for partial payment
  ✔ flags overpayment, caps paidAmount, and calculates excess when cash exceeds grandTotal
  ✔ determines correct payment statuses (Unpaid, Paid, Partial, Invalid Overpaid)
  ✔ calculates entire invoice summary atomically with valid payment
  ✔ calculates entire invoice summary with overpayment warning state
```
