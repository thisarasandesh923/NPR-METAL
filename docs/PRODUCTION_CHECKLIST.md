# Production Release Checklist — NPR Metal Crusher System

**Release Target:** NPR Metal Crusher Billing & Management System  
**Verification Date:** November 21, 2026  
**Status:** **READY FOR RELEASE PENDING USER CREDENTIAL RESET & PRICE CONFIRMATION**  

---

## 1. Pre-Deployment Engineering Gates

### Code Quality & Build Integrity
- [x] **Backend TypeScript Check:** `npm --prefix backend run typecheck` passes with 0 errors.
- [x] **Frontend TypeScript Check:** `npm --prefix frontend run typecheck` passes with 0 errors.
- [x] **Backend Unit Tests:** 85/85 unit tests pass cleanly across 12 test suites.
- [x] **Frontend Tests:** 54/54 tests pass cleanly across 9 test suites.
- [x] **Frontend Production Build:** `npm --prefix frontend run build` produces optimized static bundle.
- [x] **Backend Build:** `npm --prefix backend run build` compiles to `backend/dist/`.

### Database Integrity & Migrations
- [x] **Applied Migrations:** All 14 migrations (001 through 014) verified as `[APPLIED]` in `public.pgmigrations`.
- [x] **Database Connectivity:** `npm --prefix backend run db:check` succeeds over TLS.
- [x] **Row-Level Security:** RLS enabled (`relrowsecurity = true`) across all public application tables.
- [x] **Runtime Role Restricted:** Production runtime uses unprivileged `npr_app_user` (`NOBYPASSRLS`).
- [x] **Financial Constraints:**
  - `line_total = ROUND(quantity * unit_price, 2)`
  - `paid_amount + balance_amount = grand_total`
  - `CHECK (payment_method = 'CASH')` on salary payments
  - Append-only triggers active on `payments` and `salary_payment_adjustments`.

### Application Security
- [x] **Zero Secrets in Repository:** `.env` files ignored by Git; `.env.example` contains sanitized placeholders.
- [x] **Password Hashing:** Scrypt with $N=32768, r=8, p=1$, random 16-byte salt, 64-byte key length.
- [x] **Zero-Knowledge Sessions:** Only SHA-256 token hashes stored in database.
- [x] **Cookie Security:** `HttpOnly`, `SameSite=Lax`, and `Secure` configured for production.
- [x] **CSRF Defenses:** `X-Requested-With` custom header enforced for all state-changing endpoints.
- [x] **Cross-Portal Protection:** Owner portal rejects Cashiers; Cashier portal rejects Owners.
- [x] **Rate Limiting:** Max 5 failed login attempts per 15-minute window per IP / user entity.

---

## 2. Launch Day Operations Checklist

### User Accounts & Passwords
- [x] **Owner Account (`nalaka`):** Login verified working (`LOGIN_SUCCEEDED` recorded in audit logs).
- [ ] **Cashier 1 (`cashier1`):** Reset password using `npm --prefix backend run reset:password -- cashier1` and confirm successful login via Cashier portal.
- [ ] **Cashier 2 (`cashier2`):** Verify password or reset using `npm --prefix backend run reset:password -- cashier2`.

### Commercial Pricing Confirmation
- [ ] **Owner Price Confirmation:** Owner Nalaka must review and confirm selling prices for all 4 active aggregates:
  - 3/4 Metal (LKR per m³)
  - Dust (LKR per m³)
  - 6×9 Aggregate (LKR per m³)
  - ABC (LKR per m³)
- [ ] **Activate Inactive Products (Optional):** Owner can configure prices and activate any of the remaining 7 products (Chip, 2×2, 1", 1 1/2, SubBase, Mix, Quarry Muck) via Owner Price Management.

### Workstation Setup
- [ ] **Cashier Desktop Browser:** Add bookmark / desktop shortcut to `https://your-production-url.com`.
- [ ] **A5 Printer Configuration:** Test print sample invoice on Cashier workstation printer (check paper orientation, margins, and header alignment).
- [ ] **Owner Mobile Device:** Add website shortcut to home screen for fast mobile access.

---

## 3. Disaster Recovery & Emergency Procedures

### Database Backup
- [x] **Backup Script Verified:** `scripts/database/backup-supabase.ps1` produces valid `pg_dump -Fc` custom-format archives.
- [x] **Restore Rehearsal Passed:** Previous backup archive successfully restored into isolated local PostgreSQL Docker container.
- [ ] **Pre-Launch Snapshot:** Take a fresh logical backup immediately prior to public DNS cutover:
  ```powershell
  powershell -ExecutionPolicy Bypass -File scripts/database/backup-supabase.ps1 -BackupDir "E:\npr project\backups"
  ```

### Rollback Strategy
- **Application Code:** Revert container deployment to previous commit/image tag.
- **Database:** Supabase schema uses forward-only migrations. Any operational fixes must be applied via forward-only versioned migration scripts rather than destructive down migrations.
