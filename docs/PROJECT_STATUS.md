# Project Status — NPR Metal Crusher Billing & Management System

**Generated:** November 21, 2026  
**System:** NPR Metal Crusher — Billing & Management System  
**Deployment Target:** Production Staging / Supabase PostgreSQL 17 (ap-south-1 Mumbai)  
**Client Environment:** Cashier Workshop Workstation (Desktop) & Owner Mobile/Desktop  

---

## 1. Executive Summary

The NPR Metal Crusher Billing & Management System is feature-complete, rigorously tested, and undergoing final deployment preparation. 
All 14 database schema migrations have been applied and verified against the live PostgreSQL database. The application features zero floating-point financial calculations, strict invoice immutability, append-only payment and salary adjustment ledgers, role-based authorization for Owner and Cashier portals, and multi-language support (English for Owner, Sinhala/English for Cashier).

---

## 2. Feature Implementation Status Matrix

| Module | Feature | Status | Notes / Verification |
| :--- | :--- | :--- | :--- |
| **Authentication** | Owner Login (`nalaka`) | **VERIFIED WORKING** | Verified via live database audit logs (`LOGIN_SUCCEEDED`). |
| **Authentication** | Cashier Login (`cashier1`) | **NEEDS USER ACTION** | Account exists and is active. Hash format is valid scrypt, but stored derived key does not match tested password (`INVALID_PASSWORD`). Masked reset CLI prepared. |
| **Authentication** | Cashier Login (`cashier2`) | **NEEDS USER ACTION** | Account exists and is active. Password verification pending. |
| **Authentication** | Cross-Portal Protection | **VERIFIED WORKING** | Owner blocked from Cashier portal; Cashier blocked from Owner portal (`CROSS_ROLE_LOGIN_FORBIDDEN`). |
| **Authentication** | Rate Limiting | **VERIFIED WORKING** | Max 5 failed attempts per 15-minute window per IP/user (`TooManyRequestsError`). |
| **Authentication** | Session Management | **VERIFIED WORKING** | SHA-256 session token hashing, HttpOnly cookies, 30-min idle TTL, 12-hr max lifetime. |
| **Navigation** | State Persistence | **VERIFIED WORKING** | Active screen persisted in `sessionStorage` across F5 reload without React Router. |
| **Navigation** | Refresh Protection | **VERIFIED WORKING** | Background 30s session refresh does NOT reset active screen to dashboard. |
| **Invoices** | Customer Management | **VERIFIED WORKING** | Customer creation, live phone search, location history. |
| **Invoices** | Material Selection | **VERIFIED WORKING** | 11-product aggregate catalog, 4 active materials, m³ units. |
| **Invoices** | Price & Line Calculations | **VERIFIED WORKING** | Scaled BigInt arithmetic (`ROUND(quantity * unit_price, 2)`). Zero floating-point drift. |
| **Invoices** | Transport Fee Options | **VERIFIED WORKING** | Optional flat transport fee added to grand total. |
| **Invoices** | Permanent Immutability | **VERIFIED WORKING** | Database triggers `forbid_invoice_mutation` and `forbid_invoice_items_mutation` reject UPDATE/DELETE. |
| **Invoices** | Printing | **VERIFIED WORKING** | Clean A5 landscape print layout and 80mm thermal receipt layout. |
| **Payments** | Cash Payments | **VERIFIED WORKING** | CASH ONLY payments recorded against invoices under row lock (`SELECT ... FOR UPDATE`). |
| **Payments** | Append-Only Ledger | **VERIFIED WORKING** | No direct UPDATE/DELETE on payment rows. Balances derived from ledger. |
| **Payments** | Payment Corrections | **VERIFIED WORKING** | Owner-only corrections and voids via `payment_adjustments` ledger with mandatory reason. |
| **Payments** | Idempotency | **VERIFIED WORKING** | Client UUID idempotency key prevents duplicate network submissions. |
| **Materials** | 11 Products Expansion | **VERIFIED WORKING** | Migration 009 applied. 4 active materials (3/4, Dust, 6x9, ABC), 7 inactive pending price confirmation. |
| **Materials** | Cashier Price Updates | **VERIFIED WORKING** | Cashiers can update active material selling price with mandatory reason (Migration 010). |
| **Materials** | Price Change Audit | **VERIFIED WORKING** | `material_price_history` records all historical price changes, changed by, and reason (Migration 011). |
| **Operations** | Daily Work & Shifts | **VERIFIED WORKING** | Machine hours, operator shifts, production records, spreadsheet draft-to-submit. |
| **Operations** | Advances & Expenses | **VERIFIED WORKING** | Cashier & Owner can record worker advances and yard operating expenses (Migration 012). |
| **Payroll** | Custom Salary Periods | **VERIFIED WORKING** | Cashier & Owner can create custom non-overlapping salary periods (Migration 013). |
| **Payroll** | Advance Deductions | **VERIFIED WORKING** | Advances occurring strictly within the period dates are automatically deducted from net payable. |
| **Payroll** | Owner Approval | **VERIFIED WORKING** | Draft entries initialized automatically; only OWNER can approve entries for payment. |
| **Payroll** | Cash Disbursements | **VERIFIED WORKING** | Cashier & Owner can disburse cash payments against approved entries (Migration 013). |
| **Payroll** | CASH ONLY Constraint | **VERIFIED WORKING** | Migration 014 enforces `CHECK (payment_method = 'CASH')` on all salary payments. |
| **Payroll** | Salary Corrections | **VERIFIED WORKING** | Owner can correct approved salary amounts and correct/void salary payments with audit trail. |
| **Reporting** | Financial Summary | **VERIFIED WORKING** | Daily & monthly sales, collections, receivables, and net effective salary payouts (Stage 3.5A). |
| **Reporting** | Export Generation | **VERIFIED WORKING** | Formula-injection-safe CSV, XLSX, and PDF exports. |

---

## 3. Known Blockers & Required Actions

1. **`cashier1` / `cashier2` Password Reset:**
   - **Status:** Actionable via local secure CLI tool.
   - **Prerequisite:** Explicit operator approval to execute `npm --prefix backend run reset:password -- cashier1`.
2. **Material Price Confirmation:**
   - **Status:** Development placeholder prices exist in `materials` table.
   - **Action Required:** Real business selling prices must be reviewed and confirmed by Owner Nalaka before live billing commences.
