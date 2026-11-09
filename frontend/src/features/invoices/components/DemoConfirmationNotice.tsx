import { Icon } from "../../../components/ui/Icon";

export function DemoConfirmationNotice() {
  return (
    <div className="mb-6 flex flex-col gap-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 sm:flex-row sm:items-center">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
        <Icon name="check" className="h-6 w-6" />
      </div>
      <div>
        <p className="font-extrabold text-emerald-900">
          Invoice Simulation Confirmed (Demo Preview)
        </p>
        <p className="mt-1 text-xs leading-5 text-emerald-700">
          This is a UI prototype demonstration. In production, issued invoices are permanently saved to PostgreSQL, locked against cashier edits, and routed to the A5 print engine.
        </p>
      </div>
    </div>
  );
}
