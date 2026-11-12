import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar.tsx";
import { Header } from "./Header.tsx";
import type { AppScreen, AuthUser } from "../../types/auth.ts";

interface MainLayoutProps {
  children: ReactNode;
  user: AuthUser;
  menuOpen: boolean;
  onCloseMenu: () => void;
  onOpenMenu: () => void;
  currentScreen: AppScreen;
  onNavigate: (screen: AppScreen) => void;
  onLogout: () => Promise<void>;
  isLoggingOut: boolean;
  logoutError: string | null;
}

export function MainLayout({
  children,
  user,
  menuOpen,
  onCloseMenu,
  onOpenMenu,
  currentScreen,
  onNavigate,
  onLogout,
  isLoggingOut,
  logoutError,
}: MainLayoutProps) {
  return (
    <div className="min-h-screen bg-[#f4f7fb] text-slate-900">
      <Sidebar
        open={menuOpen}
        onClose={onCloseMenu}
        user={user}
        currentScreen={currentScreen}
        onNavigate={onNavigate}
        onLogout={onLogout}
        isLoggingOut={isLoggingOut}
        logoutError={logoutError}
      />
      <main className="min-h-screen lg:ml-[274px]">
        <Header user={user} onOpenMenu={onOpenMenu} currentScreen={currentScreen} />
        {children}
      </main>
    </div>
  );
}
