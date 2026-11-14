import { Icon } from "../ui/Icon.tsx";
import { useLanguage } from "../../i18n/LanguageContext.tsx";
import type { Translations } from "../../i18n/translations.ts";
import type { AppScreen, AuthUser } from "../../types/auth.ts";

interface HeaderProps {
  user: AuthUser;
  onOpenMenu: () => void;
  currentScreen: AppScreen;
}

const SCREEN_TITLE_KEYS: Record<AppScreen, keyof Translations> = {
  "owner-dashboard": "navOwnerDashboard",
  "cashier-dashboard": "navCashierDashboard",
  "new-invoice": "navNewInvoice",
  invoices: "navInvoiceHistory",
  "invoice-detail": "invoiceDetailTitle",
  "material-prices": "navPriceManagement",
  "daily-operations": "navDailyOperations",
  approvals: "navApprovals",
  "workers-machines": "navWorkersMachines",
  payroll: "navPayroll",
};

function formatColomboDate(language: string): string {
  try {
    const locale = language === "si" ? "si-LK" : "en-LK";
    return new Intl.DateTimeFormat(locale, {
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
  const { t, language, toggleLanguage, isSinhala } = useLanguage();
  const screenTitleKey = SCREEN_TITLE_KEYS[currentScreen];
  const screenTitle = screenTitleKey ? t(screenTitleKey) : currentScreen;
  const roleName = user.role === "CASHIER" ? t("roleCashier") : t("roleOwner");

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
        <span className="hidden sm:inline">{t("workspace")}</span>
        <span className="hidden text-slate-300 sm:inline">/</span>
        <span className="font-semibold text-[#092547]">{screenTitle}</span>
      </div>

      <div className="ml-auto flex items-center gap-3">
        {/* Language Switcher Pill */}
        <button
          type="button"
          onClick={toggleLanguage}
          title={isSinhala ? "Switch to English" : "සිංහල භාෂාවට මාරු වන්න"}
          className="flex items-center gap-1.5 rounded-full border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-bold text-[#092547] shadow-sm transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-[#f58220]"
        >
          <span className="text-[13px]">{isSinhala ? "🇱🇰 සිංහල" : "🇬🇧 English"}</span>
          <span className="text-[10px] text-slate-400">⇄ {isSinhala ? "EN" : "සිං"}</span>
        </button>

        <span className="hidden rounded-full bg-[#edf3fa] px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.05em] text-[#124f8c] sm:inline-flex">
          {roleName}
        </span>
        <div className="hidden text-right md:block">
          <p className="text-sm font-bold text-[#092547]">
            {formatColomboDate(language)}
          </p>
          <p className="mt-0.5 text-xs text-slate-400">
            {t("locationKurunegala")}
          </p>
        </div>
      </div>
    </header>
  );
}
