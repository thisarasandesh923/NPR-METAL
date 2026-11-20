import type { ReactNode } from "react";
import { useAuth } from "../../../context/AuthContext.tsx";
import type { UserRole } from "../../../types/auth.ts";
import { Icon } from "../../../components/ui/Icon.tsx";
import { LandingPage } from "../../landing/LandingPage.tsx";

interface ProtectedRouteProps {
  children: ReactNode;
  allowedRoles?: readonly UserRole[];
  onFallbackHome?: () => void;
}

export function ProtectedRoute({
  children,
  allowedRoles,
  onFallbackHome,
}: ProtectedRouteProps) {
  const { status, user } = useAuth();

  if (status === "loading") {
    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center bg-[#f4f7fb] px-4 text-center"
        role="status"
        aria-live="polite"
      >
        <div className="mb-4 flex items-center gap-3">
          <div className="brand-mark" aria-hidden="true">
            <span>N</span>
          </div>
          <div className="text-left">
            <p className="text-[19px] font-extrabold tracking-[0.02em] text-[#092547]">
              NPR <span className="text-[#f58220]">METAL</span>
            </p>
            <p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-slate-400">
              Crusher &amp; Workshop
            </p>
          </div>
        </div>
        <div className="h-7 w-7 animate-spin rounded-full border-3 border-slate-200 border-t-[#f58220]" />
        <p className="mt-3 text-sm font-semibold text-slate-500">
          Verifying workstation session...
        </p>
      </div>
    );
  }

  if (status !== "authenticated" || !user) {
    return <LandingPage />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return (
      <div className="mx-auto max-w-xl p-6 md:p-10" role="alert">
        <div className="rounded-2xl border border-rose-200 bg-white p-6 shadow-sm md:p-8">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
            <Icon name="lock" className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-extrabold text-[#092547]">
            Access Restricted
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Your account role ({user.role === "OWNER" ? "Owner" : "Cashier"}) does
            not have permission to open this section.
          </p>
          {onFallbackHome && (
            <button
              type="button"
              onClick={onFallbackHome}
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#092547] px-5 py-3 text-sm font-bold text-white transition hover:bg-[#0f3461]"
            >
              Return to My Dashboard
            </button>
          )}
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
