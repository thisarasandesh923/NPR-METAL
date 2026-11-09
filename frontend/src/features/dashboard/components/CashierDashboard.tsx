import { Icon } from "../../../components/ui/Icon";
import { StatCard } from "./StatCard";
import { RecentInvoicesTable } from "./RecentInvoicesTable";
import { DEMO_DASHBOARD_STATS } from "../../../data/demo/stats";
import { DEMO_RECENT_INVOICES } from "../../../data/demo/invoices";

interface CashierDashboardProps {
  onCreateInvoice: () => void;
}

export function CashierDashboard({ onCreateInvoice }: CashierDashboardProps) {
  return (
    <div className="mx-auto max-w-[1500px] p-4 md:p-8 lg:p-10">
      <section className="mb-8 flex flex-col justify-between gap-5 xl:flex-row xl:items-center">
        <div>
          <p className="mb-2 text-sm font-bold text-[#f58220]">Welcome, Kasun!</p>
          <h1 className="text-2xl font-extrabold tracking-tight text-[#092547] md:text-[32px]">
            Cashier Dashboard
          </h1>
          <p className="mt-2 text-sm text-slate-500 md:text-[15px]">
            Manage today's sales and payment collection here.
          </p>
        </div>
        <button
          onClick={onCreateInvoice}
          className="flex min-h-14 items-center justify-center gap-3 rounded-xl bg-[#f58220] px-6 text-[15px] font-bold text-white shadow-[0_10px_28px_rgba(245,130,32,.25)] transition hover:-translate-y-0.5 hover:bg-[#e77418] focus:outline-none focus:ring-4 focus:ring-orange-200"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/20">
            <Icon name="plus" className="h-5 w-5" />
          </span>
          Create New Invoice
        </button>
      </section>

      <section className="mb-8 grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
        {DEMO_DASHBOARD_STATS.map((stat) => (
          <StatCard key={stat.label} stat={stat} />
        ))}
      </section>

      <RecentInvoicesTable invoices={DEMO_RECENT_INVOICES} />

      <p className="mt-6 text-center text-[11px] text-slate-400">
        NPR Metal Crusher Management System · Secure Cashier Workstation
      </p>
    </div>
  );
}
