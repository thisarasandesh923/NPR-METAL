import { Icon } from "../../../components/ui/Icon.tsx";
import type { AuthUser } from "../../../types/auth.ts";

interface OwnerDashboardProps {
  user: AuthUser;
  onOpenCashierDemo: () => void;
}

export function OwnerDashboard({
  user,
  onOpenCashierDemo,
}: OwnerDashboardProps) {
  return (
    <div className="mx-auto max-w-[1500px] p-4 md:p-8 lg:p-10">
      <section className="mb-8 flex flex-col justify-between gap-5 xl:flex-row xl:items-center">
        <div>
          <p className="mb-2 text-sm font-bold text-[#f58220]">
            Welcome, {user.fullName}
          </p>
          <h1 className="text-2xl font-extrabold tracking-tight text-[#092547] md:text-[32px]">
            Owner Management Portal
          </h1>
          <p className="mt-2 text-sm text-slate-500 md:text-[15px]">
            Workshop administration, security oversight, and financial reporting workspace.
          </p>
        </div>

        <button
          type="button"
          onClick={onOpenCashierDemo}
          className="flex min-h-12 items-center justify-center gap-2.5 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-[#092547] shadow-sm transition hover:border-[#f58220] hover:text-[#e77418]"
        >
          <Icon name="invoice" className="h-5 w-5 text-[#f58220]" />
          Open Cashier UI Preview (Demo Data)
        </button>
      </section>

      <div
        role="note"
        className="mb-8 flex flex-col gap-3 rounded-2xl border border-blue-200 bg-blue-50/80 p-5 sm:flex-row sm:items-start"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#124f8c] text-white">
          <Icon name="lock" className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-extrabold text-[#092547]">
            Live Authentication Connected — Billing &amp; Ledger Reporting Pending Phase 4
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            Your OWNER session is authenticated against PostgreSQL. Live workshop sales, cash reconciliation, price management, and audit log totals will appear here once Phase 4 backend reporting APIs are implemented. No simulated figures are shown as real financial totals.
          </p>
        </div>
      </div>

      <section className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <article className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_4px_20px_rgba(15,39,71,.045)]">
          <div className="mb-4 flex items-center justify-between">
            <span className="stat-icon stat-green">
              <Icon name="lock" className="h-5 w-5" />
            </span>
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-bold text-emerald-700">
              Active
            </span>
          </div>
          <p className="text-xs font-bold uppercase tracking-[0.06em] text-slate-400">
            Authenticated Account
          </p>
          <p className="mt-1.5 text-lg font-extrabold text-[#092547]">
            {user.fullName}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Username: <span className="font-semibold text-slate-700">{user.username}</span> · Role:{" "}
            <span className="font-bold text-[#124f8c]">{user.role}</span>
          </p>
        </article>

        <article className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_4px_20px_rgba(15,39,71,.045)]">
          <div className="mb-4 flex items-center justify-between">
            <span className="stat-icon stat-blue">
              <Icon name="sales" className="h-5 w-5" />
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold text-slate-600">
              Phase 4
            </span>
          </div>
          <p className="text-xs font-bold uppercase tracking-[0.06em] text-slate-400">
            Financial Ledger &amp; Daily Reconciliation
          </p>
          <p className="mt-1.5 text-lg font-extrabold text-[#092547]">
            Not Connected Yet
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Real LKR sales, cash drawer totals, and outstanding balances require Phase 4 backend endpoints.
          </p>
        </article>

        <article className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_4px_20px_rgba(15,39,71,.045)] sm:col-span-2 xl:col-span-1">
          <div className="mb-4 flex items-center justify-between">
            <span className="stat-icon bg-[#fff4ea] text-[#e77418]">
              <Icon name="balance" className="h-5 w-5" />
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold text-slate-600">
              Phase 4
            </span>
          </div>
          <p className="text-xs font-bold uppercase tracking-[0.06em] text-slate-400">
            Material Prices &amp; Adjustments
          </p>
          <p className="mt-1.5 text-lg font-extrabold text-[#092547]">
            Admin Controls Queued
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Material unit pricing (3/4&quot;, Dust, 6×9, ABC), credit notes, and audit trail review are scheduled next.
          </p>
        </article>
      </section>

      <p className="mt-6 text-center text-[11px] text-slate-400">
        NPR Metal Crusher Management System · Owner Administration Portal
      </p>
    </div>
  );
}
