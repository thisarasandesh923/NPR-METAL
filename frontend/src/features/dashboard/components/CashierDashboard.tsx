import { Icon } from "../../../components/ui/Icon.tsx";
import { StatCard } from "./StatCard.tsx";
import { RecentInvoicesTable } from "./RecentInvoicesTable.tsx";
import { DEMO_DASHBOARD_STATS } from "../../../data/demo/stats.ts";
import { DEMO_RECENT_INVOICES } from "../../../data/demo/invoices.ts";
import type { AuthUser } from "../../../types/auth.ts";

interface CashierDashboardProps {
  user: AuthUser;
  onCreateInvoice: () => void;
}

function getFirstName(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) {
    return "Cashier";
  }
  return trimmed.split(/\s+/)[0];
}

export function CashierDashboard({
  user,
  onCreateInvoice,
}: CashierDashboardProps) {
  const firstName = getFirstName(user.fullName);

  return (
    <div className="mx-auto max-w-[1500px] p-4 md:p-8 lg:p-10">
      <section className="mb-8 flex flex-col justify-between gap-5 xl:flex-row xl:items-center">
        <div>
          <p className="mb-2 text-sm font-bold text-[#f58220]">
            Welcome, {firstName}!
          </p>
          <h1 className="text-2xl font-extrabold tracking-tight text-[#092547] md:text-[32px]">
            Cashier Dashboard
          </h1>
          <p className="mt-2 text-sm text-slate-500 md:text-[15px]">
            Signed in as <span className="font-semibold text-[#092547]">{user.fullName}</span> ({user.role}).
          </p>
        </div>
        <button
          type="button"
          onClick={onCreateInvoice}
          className="flex min-h-14 items-center justify-center gap-3 rounded-xl bg-[#f58220] px-6 text-[15px] font-bold text-white shadow-[0_10px_28px_rgba(245,130,32,.25)] transition hover:-translate-y-0.5 hover:bg-[#e77418] focus:outline-none focus:ring-4 focus:ring-orange-200"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/20">
            <Icon name="plus" className="h-5 w-5" />
          </span>
          Open Invoice UI Simulation (Demo)
        </button>
      </section>

      <section
        aria-label="Isolated UI Demo Preview"
        className="rounded-3xl border-2 border-dashed border-amber-300 bg-amber-50/40 p-4 md:p-6"
      >
        <div className="mb-6 flex flex-col justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3.5 sm:flex-row sm:items-center">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.08em] text-amber-900">
              Demo Preview Only — Not Real Workshop Financial Data
            </p>
            <p className="mt-0.5 text-xs text-amber-800">
              Your login session is live, but the sample totals and invoices below are illustrative UI placeholders until Phase 4 connects PostgreSQL billing endpoints.
            </p>
          </div>
          <span className="inline-flex shrink-0 self-start rounded-full bg-amber-200/80 px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.06em] text-amber-950 sm:self-center">
            Demo Data
          </span>
        </div>

        <section className="mb-8 grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
          {DEMO_DASHBOARD_STATS.map((stat) => (
            <StatCard key={stat.label} stat={stat} />
          ))}
        </section>

        <RecentInvoicesTable invoices={DEMO_RECENT_INVOICES} />
      </section>

      <p className="mt-6 text-center text-[11px] text-slate-400">
        NPR Metal Crusher Management System · Authenticated Workstation
      </p>
    </div>
  );
}
