# Business & Technical Requirements Specification

## Project: NPR Metal Crusher — Billing & Management System

---

## 1. Executive Summary
The NPR Metal Crusher Billing & Management System is an enterprise-grade operational management and billing application built for a real-world Sri Lankan metal crusher workshop. The system automates invoice issuance, cash receipt collection, customer receivables tracking, material price governance, and daily cash reconciliation.

---

## 2. Stakeholders & User Roles

### 2.1 User Roles
1. **Cashier (2 Accounts Initially):**
   - Workstation-oriented, desktop-first fast billing interface.
   - Authorized to create new customer invoices using server-enforced material prices.
   - Authorized to search customer records and purchase history.
   - Authorized to record new cash payments against unpaid or partially paid invoices.
   - Authorized to print confirmed A5 invoices.
   - **Strict Restriction:** Cannot edit or delete issued invoices.
   - **Strict Restriction:** Cannot edit or delete recorded payments.
   - **Strict Restriction:** Cannot modify material prices.
   - **Strict Restriction:** Cannot access executive reports or audit trails.

2. **Owner (1 Account Initially):**
   - Responsive management dashboard accessible on desktop, tablet, and mobile.
   - Full oversight of sales, collected cash, outstanding debts, and customer ledgers.
   - Exclusive authority to configure and update material prices (with full audit logging).
   - Authority to execute auditable payment corrections and issue invoice credit notes.
   - Authority to view cashier activity logs, system audit logs, and cash drawer reconciliations.

### 2.2 Account Governance
- Fixed initial user provisioning: Exactly 1 Owner and 2 Cashiers.
- Individual login credentials for each user (no shared logins).
- **Public self-registration is strictly prohibited.**
- Session expiration, remote revocation, and rate-limited login protection.

---

## 3. Functional Business Requirements

### 3.1 Materials Management
- **Initial Materials Catalog:**
  1. `3/4"` (Aggregate)
  2. `Dust` (Crushed stone powder)
  3. `6×9` (Rubble aggregate)
  4. `ABC` (Aggregate Base Course)
- **Unit of Measurement:** Strictly cubic meters (`m³`).
- **Quantities:** Must support positive decimal values with up to three decimal places (e.g. `5.250 m³`).
- **Price Authority:** Managed strictly by the Owner. Cashiers cannot alter unit prices.
- **Historical Snapshot Rule:** When an invoice is created, the agreed unit price and material name are frozen permanently on the line item record. Subsequent price updates by the Owner do not alter historical invoices.

### 3.2 Invoicing Workflow
- **Customer Information:**
  - Customer / Company Name (Mandatory)
  - Contact Telephone Number (Mandatory, formatted for Sri Lanka)
  - Delivery Location / Site Address (Mandatory)
- **Multi-Item Support:** An invoice can contain multiple material line items.
- **Line Item Details:**
  - Selected material from server catalogue
  - Positive decimal quantity (m³)
  - Locked unit price (LKR / m³)
  - Line total = `ROUND(quantity * unit_price, 2)`
- **Transport Handling:**
  - Option 1: "With Transport" (delivery provided; optional positive transport fee in LKR added).
  - Option 2: "Without Transport" (customer pickup; transport fee locked to `0.00`).
- **Financial Calculations:**
  - Subtotal = Sum of all line item totals
  - Grand Total = Subtotal + Transport Fee
  - Initial Paid Amount = Cash received at invoice creation (`0 <= paid <= grand_total`)
  - Balance Due = Grand Total - Initial Paid Amount
  - Payment Status = `UNPAID` (paid = 0), `PARTIALLY_PAID` (0 < paid < grand_total), or `PAID` (paid = grand_total)
- **Invoice Numbering:** Unique, server-generated, sequential invoice numbers (e.g., `NPR-INV-2026-00001`).
- **Server Timestamps:** Issue timestamp assigned by server (`Asia/Colombo`).
- **A5 Invoice Printing:**
  - Supported directly from cashier workstation upon confirmed database persistence.
  - Formatted strictly for standard A5 sheets (or half-letter).

### 3.3 Cash Payment Collection
- **Payment Method:** Strictly **CASH ONLY**.
- **Payment Flexibility:** Invoices can be fully paid at creation, partially paid, or issued on credit (unpaid).
- **Subsequent Payments:** Cashiers can search unpaid invoices and record additional cash installments.
- **Append-Only Ledger:** Every payment is recorded as an immutable receipt event with cashier ID, receipt number, timestamp, invoice reference, and amount.
- **Integrity Bounds:** Payments must be strictly positive (`> 0`) and cannot exceed the current outstanding balance.
- **Idempotency & Concurrency:** Protected against double submissions (client UUID keys) and concurrent overpayments (`SELECT ... FOR UPDATE`).
- **Corrections:** In case of data entry error, the Owner executes an auditable adjustment record; original payment records are never modified.

### 3.4 Owner Management & Reporting
- **Executive Dashboard:** Live metrics for today's sales, collected cash, outstanding receivables, and invoice count.
- **Date-Range Reports:** Filterable sales and volume breakdown by material across custom date intervals.
- **Cashier Shift Reconciliation:** Report showing exact cash collected per cashier for end-of-day drawer balancing.
- **Customer Debtor Ledger:** Comprehensive list of customers with aging outstanding balances and payment history.
- **Audit Trail:** Complete log of material price alterations, payment adjustments, and system events.

---

## 4. Non-Functional Requirements

### 4.1 Language, Localization & Currency
- **Language:** Entire application interface, navigation, buttons, error messages, and printed invoices must be in **English**.
- **Currency:** Sri Lankan Rupees (`LKR` or `Rs.`), formatted as `Rs. 102,000.00`.
- **Timezone:** All reporting and business dates respect Sri Lanka Standard Time (`Asia/Colombo`, UTC+05:30).

### 4.2 Performance & Reliability
- Fast cashier interface: Sub-second response times for customer searches and invoice calculations.
- Transactional ACID guarantees on all invoice and payment operations.
- Clean offline-ready error notifications without unhandled promise rejections.

### 4.3 Security & Compliance
- Passwords hashed with `scrypt` or `bcrypt` (work factor 12).
- Zero-knowledge database session storage (SHA-256 token hashing).
- HttpOnly, SameSite, Secure cookies for all session data.
- Server-side RBAC independent of client UI rendering.
- Parameterized SQL queries throughout to eliminate SQL injection vulnerabilities.
- Complete audit trail for financial oversight.
