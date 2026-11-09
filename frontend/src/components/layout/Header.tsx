import { Icon } from "../ui/Icon";

interface HeaderProps {
  onOpenMenu: () => void;
  currentScreen: "dashboard" | "invoice";
}

export function Header({ onOpenMenu, currentScreen }: HeaderProps) {
  return (
    <header className="sticky top-0 z-20 flex h-[76px] items-center border-b border-slate-200/80 bg-white/95 px-4 backdrop-blur md:px-8 lg:px-10">
      <button
        onClick={onOpenMenu}
        className="mr-3 rounded-xl border border-slate-200 p-2.5 text-[#092547] lg:hidden"
        aria-label="Open menu"
      >
        <Icon name="menu" className="h-5 w-5" />
      </button>

      <div className="hidden text-sm text-slate-400 sm:block">
        Dashboard <span className="mx-2 text-slate-300">/</span>{" "}
        <span className="font-semibold text-[#092547]">
          {currentScreen === "dashboard" ? "Overview" : "New Invoice"}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-3">
        <div className="hidden text-right md:block">
          <p className="text-sm font-bold text-[#092547]">Saturday, May 24, 2025</p>
          <p className="mt-0.5 text-xs text-slate-400">Kurunegala, Sri Lanka</p>
        </div>
        <button
          className="relative ml-2 rounded-xl border border-slate-200 bg-white p-2.5 text-slate-500 transition hover:bg-slate-50"
          aria-label="Notifications"
        >
          <Icon name="bell" className="h-5 w-5" />
          <span className="absolute right-2 top-2 h-2 w-2 rounded-full border-2 border-white bg-[#f58220]" />
        </button>
      </div>
    </header>
  );
}
