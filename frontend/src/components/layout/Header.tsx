import { Icon } from "../ui/Icon.tsx";
import type { AppScreen, AuthUser } from "../../types/auth.ts";

interface HeaderProps {
  user: AuthUser;
  onOpenMenu: () => void;
  currentScreen: AppScreen;
}

const SCREEN_TITLES: Record<AppScreen, string> = {
  "owner-dashboard": "Owner Overview & Reports",
  "cashier-dashboard": "Cashier Dashboard",
  "new-invoice": "New Invoice",
  invoices: "Invoice History",
  "invoice-detail": "Invoice Details",
  "material-prices": "Material Price Management",
  "daily-operations": "Daily Workshop Operations",
  approvals: "Owner Approvals Queue",
  "workers-machines": "Workers & Machines",
  payroll: "Payroll & Expenses (Owner Only)",
};

function formatColomboDate(): string {
  try {
    return new Intl.DateTimeFormat("en-LK", {
      timeZone: "Asia/Colombo",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(new Date());
  } catch {
    return new Date().toDateString();
  }
}

export function Header({ user, onOpenMenu, currentScreen }: HeaderProps) {
  return (
    <header className="no-print sticky top-0 z-20 flex h-[76px] items-center border-b border-slate-200/80 bg-white/95 px-4 backdrop-blur md:px-8 lg:px-10">
      <button
        type="button"
        onClick={onOpenMenu}
        className="mr-3 rounded-xl border border-slate-200 p-2.5 text-[#092547] lg:hidden"
        aria-label="Open menu"
      >
        <Icon name="menu" className="h-5 w-5" />
      </button>

      <div className="flex items-center gap-3 text-sm text-slate-400">
        <span className="hidden sm:inline">Workspace</span>
        <span className="hidden text-slate-300 sm:inline">/</span>
        <span className="font-semibold text-[#092547]">
          {SCREEN_TITLES[currentScreen]}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-3">
        <span className="hidden rounded-full bg-[#edf3fa] px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.05em] text-[#124f8c] sm:inline-flex">
          {user.role}
        </span>
        <div className="hidden text-right md:block">
          <p className="text-sm font-bold text-[#092547]">{formatColomboDate()}</p>
          <p className="mt-0.5 text-xs text-slate-400">Kurunegala, Sri Lanka</p>
        </div>
      </div>
    </header>
  );
}
