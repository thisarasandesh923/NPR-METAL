import { Icon } from "../ui/Icon";
import { DEMO_NAV_ITEMS } from "../../data/demo/navigation";

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  onCreate: () => void;
  onDashboard: () => void;
  currentScreen: "dashboard" | "invoice";
}

export function Sidebar({
  open,
  onClose,
  onCreate,
  onDashboard,
  currentScreen,
}: SidebarProps) {
  return (
    <>
      <div
        className={`fixed inset-0 z-30 bg-[#071b35]/50 backdrop-blur-sm transition-opacity lg:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
      />
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[274px] flex-col bg-[#092547] text-white shadow-2xl transition-transform duration-300 lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-[92px] items-center gap-3 border-b border-white/10 px-6">
          <div className="brand-mark" aria-hidden="true">
            <span>N</span>
          </div>
          <div>
            <p className="text-[19px] font-extrabold tracking-[0.02em]">
              NPR <span className="text-[#f58220]">METAL</span>
            </p>
            <p className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.17em] text-blue-200/70">
              Crusher & Workshop
            </p>
          </div>
          <button
            className="ml-auto rounded-lg p-2 text-blue-100 hover:bg-white/10 lg:hidden"
            onClick={onClose}
            aria-label="Close menu"
          >
            <Icon name="close" className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 px-4 py-7">
          <p className="mb-3 px-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-200/50">
            Main Menu
          </p>
          <div className="space-y-1.5">
            {DEMO_NAV_ITEMS.map((item) => (
              <button
                key={item.label}
                onClick={() => {
                  if (item.icon === "invoice") onCreate();
                  if (item.icon === "dashboard") onDashboard();
                  onClose();
                }}
                className={`group flex w-full items-center gap-3.5 rounded-xl px-4 py-3.5 text-left text-sm font-semibold transition ${
                  (item.icon === "dashboard" && currentScreen === "dashboard") ||
                  (item.icon === "invoice" && currentScreen === "invoice")
                    ? "bg-[#f58220] text-white shadow-[0_8px_24px_rgba(245,130,32,.22)]"
                    : "text-blue-100/75 hover:bg-white/8 hover:text-white"
                }`}
              >
                <Icon name={item.icon} className="h-[21px] w-[21px] shrink-0" />
                {item.label}
              </button>
            ))}
          </div>
        </nav>

        <div className="border-t border-white/10 p-4">
          <div className="mb-3 flex items-center gap-3 rounded-xl bg-white/[0.06] p-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#f58220] text-sm font-bold">
              K
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">Kasun Perera</p>
              <p className="text-xs text-blue-200/60">Cashier</p>
            </div>
          </div>
          <button className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold text-blue-100/65 transition hover:bg-white/8 hover:text-white">
            <Icon name="logout" className="h-5 w-5" />
            Logout
          </button>
        </div>
      </aside>
    </>
  );
}
