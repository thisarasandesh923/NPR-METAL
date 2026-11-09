import { Icon } from "../../../components/ui/Icon";
import type { DemoInvoice } from "../../../types/invoice";

interface RecentInvoicesTableProps {
  invoices: DemoInvoice[];
}

export function RecentInvoicesTable({ invoices }: RecentInvoicesTableProps) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_4px_20px_rgba(15,39,71,.045)]">
      <div className="flex flex-col justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:flex-row sm:items-center md:px-6">
        <div>
          <h2 className="text-lg font-extrabold text-[#092547]">Recent Invoices</h2>
          <p className="mt-1 text-xs text-slate-400">Latest invoices issued today</p>
        </div>
        <button className="flex items-center gap-2 self-start text-sm font-bold text-[#e77418] transition hover:text-[#bc5810] sm:self-auto">
          View All
          <Icon name="arrow" className="h-4 w-4" />
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[850px] border-collapse">
          <thead>
            <tr className="bg-[#f8fafc] text-left">
              <th>Invoice No.</th>
              <th>Customer</th>
              <th>Material</th>
              <th>Quantity</th>
              <th>Total</th>
              <th>Status</th>
              <th>Time</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {invoices.map((invoice) => (
              <tr
                key={invoice.id}
                className="group border-t border-slate-100 transition hover:bg-slate-50/80"
              >
                <td className="font-extrabold text-[#124f8c]">{invoice.id}</td>
                <td>
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#edf3fa] text-xs font-extrabold text-[#124f8c]">
                      {invoice.initials}
                    </span>
                    <span className="font-bold text-slate-700">{invoice.customer}</span>
                  </div>
                </td>
                <td className="font-medium text-slate-600">{invoice.material}</td>
                <td className="font-semibold text-slate-600">{invoice.quantity}</td>
                <td className="font-extrabold text-[#092547]">{invoice.total}</td>
                <td>
                  <span
                    className={`status ${
                      invoice.status === "Paid"
                        ? "status-paid"
                        : invoice.status === "Partial"
                          ? "status-partial"
                          : "status-due"
                    }`}
                  >
                    <span />
                    {invoice.status}
                  </span>
                </td>
                <td className="text-slate-400">{invoice.time}</td>
                <td>
                  <button
                    className="rounded-lg p-2 text-slate-300 transition hover:bg-white hover:text-[#124f8c] hover:shadow"
                    aria-label={`View ${invoice.id}`}
                  >
                    <Icon name="arrow" className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-slate-100 px-5 py-4 text-xs text-slate-400 md:px-6">
        <span>Showing {invoices.length} of 12 invoices</span>
        <span className="font-semibold">Last updated: Just now</span>
      </div>
    </section>
  );
}
