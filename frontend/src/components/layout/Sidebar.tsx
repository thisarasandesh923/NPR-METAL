import { Icon } from "../ui/Icon.tsx";
import { getNavItemsForRole } from "../../features/auth/authNavigation.ts";
import type { AppScreen, AuthUser } from "../../types/auth.ts";

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  user: AuthUser;
  currentScreen: AppScreen;
  onNavigate: (screen: AppScreen) => void;
  onLogout: () => Promise<void>;
  isLoggingOut: boolean;
  logoutError: string | null;
}

function getInitials(fullName: string): string {
  const parts = fullName
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function Sidebar({
  open,
  onClose,
  user,
  currentScreen,
  onNavigate,
  onLogout,
  isLoggingOut,
  logoutError,
}: SidebarProps) {
  const navItems = getNavItemsForRole(user.role);
  const roleLabel = user.role === "OWNER" ? "Owner" : "Cashier";

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
              Crusher &amp; Workshop
            </p>
          </div>
          <button
            type="button"
            className="ml-auto rounded-lg p-2 text-blue-100 hover:bg-white/10 lg:hidden"
            onClick={onClose}
            aria-label="Close menu"
          >
            <Icon name="close" className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-4 py-7" aria-label="Primary Navigation">
          <p className="mb-3 px-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-200/50">
            {roleLabel} Workspace
          </p>
          <div className="space-y-1.5">
            {navItems.map((item) => {
              const active = item.screen !== undefined && item.screen === currentScreen;
              return (
                <button
                  key={item.label}
                  type="button"
                  disabled={item.disabled}
                  onClick={() => {
                    if (item.screen && !item.disabled) {
                      onNavigate(item.screen);
                      onClose();
                    }
                  }}
                  className={`group flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-left text-sm font-semibold transition ${
                    active
                      ? "bg-[#f58220] text-white shadow-[0_8px_24px_rgba(245,130,32,.22)]"
                      : item.disabled
                        ? "cursor-not-allowed text-blue-100/35"
                        : "text-blue-100/75 hover:bg-white/8 hover:text-white"
                  }`}
                >
                  <Icon name={item.icon} className="h-[20px] w-[20px] shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.badge && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.05em] ${
                        active
                          ? "bg-white/20 text-white"
                          : item.badge === "Demo"
                            ? "bg-amber-400/20 text-amber-200"
                            : "bg-white/10 text-blue-200/60"
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </nav>

        <div className="border-t border-white/10 p-4">
          <div className="mb-3 flex items-center gap-3 rounded-xl bg-white/[0.06] p-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#f58220] text-sm font-bold">
              {getInitials(user.fullName)}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">{user.fullName}</p>
              <p className="text-xs text-blue-200/70">
                {roleLabel} · {user.username}
              </p>
            </div>
          </div>

          {logoutError && (
            <p role="alert" className="mb-2.5 rounded-lg bg-rose-500/20 px-3 py-2 text-xs text-rose-100">
              {logoutError}
            </p>
          )}

          <button
            type="button"
            disabled={isLoggingOut}
            onClick={() => {
              void onLogout().catch(() => {});
            }}
            className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold text-blue-100/75 transition hover:bg-white/8 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Icon name="logout" className="h-5 w-5" />
            {isLoggingOut ? "Signing out..." : "Logout"}
          </button>
        </div>
      </aside>
    </>
  );
}
