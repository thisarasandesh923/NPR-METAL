import { useState, useRef, type FormEvent } from "react";
import { ApiError } from "../../api/client.ts";
import { Icon } from "../../components/ui/Icon.tsx";
import { useAuth } from "../../context/AuthContext.tsx";
import type { UserRole } from "../../types/auth.ts";

export function LandingPage() {
  const { login, sessionNotice, clearSessionNotice } = useAuth();
  const [activeRole, setActiveRole] = useState<UserRole>("OWNER");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRateLimited, setIsRateLimited] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const authCardRef = useRef<HTMLDivElement>(null);
  const usernameInputRef = useRef<HTMLInputElement>(null);

  const selectPortal = (role: UserRole) => {
    setActiveRole(role);
    setErrorMessage(null);
    clearSessionNotice();
    authCardRef.current?.scrollIntoView?.({ behavior: "smooth" });
    setTimeout(() => {
      usernameInputRef.current?.focus();
    }, 100);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    clearSessionNotice();
    setErrorMessage(null);
    setIsRateLimited(false);

    const trimmedUsername = username.trim();
    if (trimmedUsername.length < 3 || trimmedUsername.length > 50) {
      setErrorMessage(
        activeRole === "CASHIER"
          ? "කරුණාකර වලංගු පරිශීලක නාමයක් ඇතුළත් කරන්න (අක්ෂර 3-50)."
          : "Please enter a valid username (3 to 50 characters)."
      );
      return;
    }

    if (password.length === 0) {
      setErrorMessage(
        activeRole === "CASHIER"
          ? "කරුණාකර මුරපදය ඇතුළත් කරන්න."
          : "Please enter your password."
      );
      return;
    }

    setIsSubmitting(true);
    try {
      await login({
        username: trimmedUsername,
        password,
        portal: activeRole,
      });
      setPassword("");
    } catch (err) {
      setPassword("");
      if (err instanceof ApiError) {
        setIsRateLimited(err.status === 429);
        setErrorMessage(err.message);
      } else {
        setErrorMessage(
          activeRole === "CASHIER"
            ? "පිවිසීමේ දෝෂයක් සිදු විය. කරුණාකර නැවත උත්සාහ කරන්න."
            : "An unexpected sign-in error occurred. Please try again."
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f4f7fb] text-[#092547]">
      {/* 1. Industrial Top Navigation Bar */}
      <header className="sticky top-0 z-40 border-b border-slate-200/90 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="brand-mark" aria-hidden="true">
              <span>N</span>
            </div>
            <div>
              <p className="text-lg font-black tracking-tight text-[#092547] sm:text-xl">
                NPR <span className="text-[#f58220]">METAL</span> CRUSHER
              </p>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                Seenimodara, Sri Lanka · Proprietor: Nalaka Ranasinghe
              </p>
            </div>
          </div>

          {/* Quick Header Portal Buttons */}
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              id="header-owner-login-btn"
              onClick={() => selectPortal("OWNER")}
              className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold transition sm:px-4 sm:py-2.5 sm:text-sm ${
                activeRole === "OWNER"
                  ? "bg-[#092547] text-white shadow-sm"
                  : "border border-slate-200 bg-white text-[#092547] hover:bg-slate-50"
              }`}
            >
              <Icon name="lock" className="h-3.5 w-3.5 text-[#f58220]" />
              <span>Owner Login</span>
            </button>

            <button
              type="button"
              id="header-cashier-login-btn"
              onClick={() => selectPortal("CASHIER")}
              className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold transition sm:px-4 sm:py-2.5 sm:text-sm ${
                activeRole === "CASHIER"
                  ? "bg-[#f58220] text-white shadow-[0_4px_16px_rgba(245,130,32,0.25)]"
                  : "border border-slate-200 bg-white text-[#092547] hover:bg-slate-50"
              }`}
            >
              <Icon name="invoice" className="h-3.5 w-3.5" />
              <span>කැෂියර් පිවිසුම</span>
            </button>
          </div>
        </div>
      </header>

      {/* 2. Hero Section with Dual Portal Entry Points & Staff Auth Card */}
      <section className="relative overflow-hidden bg-gradient-to-b from-[#092547] to-[#0f3461] px-4 py-12 text-white sm:px-6 sm:py-16 lg:px-8 lg:py-20">
        {/* Subtle Industrial Grid Background */}
        <div
          className="pointer-events-none absolute inset-0 opacity-5"
          style={{
            backgroundImage:
              "radial-gradient(#ffffff 1px, transparent 1px), radial-gradient(#ffffff 1px, #092547 1px)",
            backgroundSize: "24px 24px",
            backgroundPosition: "0 0, 12px 12px",
          }}
          aria-hidden="true"
        />

        <div className="relative mx-auto max-w-7xl">
          <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-12 lg:gap-10">
            {/* Left 7 Columns: Quarry Branding & Dual Portal Cards */}
            <div className="lg:col-span-7">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-orange-400/30 bg-orange-500/10 px-3.5 py-1 text-xs font-bold tracking-wide text-orange-300">
                <span className="h-2 w-2 rounded-full bg-[#f58220] animate-pulse" />
                CONSTRUCTION AGGREGATES &amp; WORKSHOP OPERATIONS
              </div>

              <h1 className="text-3xl font-black tracking-tight text-white sm:text-5xl sm:leading-tight">
                NPR Metal Crusher
                <span className="block text-2xl font-bold tracking-normal text-slate-300 sm:text-3xl">
                  Billing &amp; Workshop Management System
                </span>
              </h1>

              <p className="mt-4 max-w-2xl text-sm leading-relaxed text-slate-300 sm:text-base">
                Operational billing, real-time cash payment collection, daily
                crushing production logs, heavy machine working-hour metrics, and
                employee payroll designed for Sri Lankan aggregate workshops.
              </p>

              {/* Two Distinct Entry Points */}
              <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Entry 1: Owner Login (English) */}
                <div
                  onClick={() => selectPortal("OWNER")}
                  className={`group relative cursor-pointer rounded-2xl border p-5 transition sm:p-6 ${
                    activeRole === "OWNER"
                      ? "border-[#f58220] bg-white/10 shadow-[0_0_30px_rgba(245,130,32,0.15)] ring-2 ring-[#f58220]/50"
                      : "border-white/15 bg-white/5 hover:border-white/30 hover:bg-white/10"
                  }`}
                >
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#092547] text-[#f58220] shadow-sm">
                      <Icon name="lock" className="h-5 w-5" />
                    </div>
                    <span className="rounded-full bg-blue-400/15 px-2.5 py-0.5 text-[11px] font-bold text-blue-200">
                      Executive Management
                    </span>
                  </div>

                  <h2 className="text-lg font-bold text-white">
                    Owner Login
                  </h2>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-300">
                    Financial summaries, live cash flow, material price updates,
                    worker payroll, and operations approval queue.
                  </p>

                  <div className="mt-4 flex items-center gap-2 text-xs font-bold text-[#f58220] group-hover:text-orange-300">
                    <span>Sign In as Owner</span>
                    <Icon name="arrow" className="h-3.5 w-3.5 transition group-hover:translate-x-1" />
                  </div>
                </div>

                {/* Entry 2: Cashier Login (Sinhala) */}
                <div
                  onClick={() => selectPortal("CASHIER")}
                  className={`group relative cursor-pointer rounded-2xl border p-5 transition sm:p-6 ${
                    activeRole === "CASHIER"
                      ? "border-[#f58220] bg-white/10 shadow-[0_0_30px_rgba(245,130,32,0.15)] ring-2 ring-[#f58220]/50"
                      : "border-white/15 bg-white/5 hover:border-white/30 hover:bg-white/10"
                  }`}
                >
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#f58220] text-white shadow-sm">
                      <Icon name="invoice" className="h-5 w-5" />
                    </div>
                    <span className="rounded-full bg-orange-400/20 px-2.5 py-0.5 text-[11px] font-bold text-orange-200">
                      මුදල් අයකැමි කවුළුව
                    </span>
                  </div>

                  <h2 className="text-lg font-bold text-white">
                    කැෂියර් පිවිසුම
                  </h2>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-300">
                    දෛනික බිල්පත් නිකුත් කිරීම (3/4&quot;, Dust, 6×9, ABC), මුදල්
                    එකතු කිරීම, A5 මුද්‍රණය සහ මෙහෙයුම් සටහන්.
                  </p>

                  <div className="mt-4 flex items-center gap-2 text-xs font-bold text-[#f58220] group-hover:text-orange-300">
                    <span>කැෂියර් පිවිසුම වෙත</span>
                    <Icon name="arrow" className="h-3.5 w-3.5 transition group-hover:translate-x-1" />
                  </div>
                </div>
              </div>

              {/* Real Operational Highlights */}
              <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <p className="text-xs font-semibold text-slate-300">Aggregates</p>
                  <p className="mt-0.5 text-sm font-extrabold text-white">3/4&quot;, Dust, 6×9, ABC</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <p className="text-xs font-semibold text-slate-300">Billing Slips</p>
                  <p className="mt-0.5 text-sm font-extrabold text-white">A5 Direct Print</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <p className="text-xs font-semibold text-slate-300">Payment Ledger</p>
                  <p className="mt-0.5 text-sm font-extrabold text-white">Append-Only Cash</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <p className="text-xs font-semibold text-slate-300">Currency</p>
                  <p className="mt-0.5 text-sm font-extrabold text-white">LKR (Rs.) Fixed</p>
                </div>
              </div>
            </div>

            {/* Right 5 Columns: Staff Authentication Card */}
            <div className="lg:col-span-5" ref={authCardRef} id="auth-card">
              <div className="rounded-3xl border border-slate-200/90 bg-white p-6 text-[#092547] shadow-[0_20px_50px_rgba(0,0,0,0.3)] sm:p-8">
                {/* Role Switcher Tabs */}
                <div className="mb-6 grid grid-cols-2 gap-1.5 rounded-xl bg-slate-100 p-1">
                  <button
                    type="button"
                    id="tab-owner-login"
                    onClick={() => {
                      setActiveRole("OWNER");
                      setErrorMessage(null);
                    }}
                    className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-extrabold transition ${
                      activeRole === "OWNER"
                        ? "bg-[#092547] text-white shadow-sm"
                        : "text-slate-600 hover:text-[#092547]"
                    }`}
                  >
                    <Icon name="lock" className="h-3.5 w-3.5" />
                    <span>Owner Login</span>
                  </button>

                  <button
                    type="button"
                    id="tab-cashier-login"
                    onClick={() => {
                      setActiveRole("CASHIER");
                      setErrorMessage(null);
                    }}
                    className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-extrabold transition ${
                      activeRole === "CASHIER"
                        ? "bg-[#f58220] text-white shadow-sm"
                        : "text-slate-600 hover:text-[#092547]"
                    }`}
                  >
                    <Icon name="invoice" className="h-3.5 w-3.5" />
                    <span>කැෂියර් පිවිසුම</span>
                  </button>
                </div>

                {/* Form Header */}
                <div className="mb-5">
                  <div className="mb-2 inline-flex items-center gap-2 rounded-full px-2.5 py-0.5 text-xs font-bold bg-[#edf3fa] text-[#124f8c]">
                    <Icon name="lock" className="h-3 w-3" />
                    <span>Staff Authentication</span>
                  </div>

                  <h2 className="text-xl font-black tracking-tight text-[#092547] sm:text-2xl">
                    Sign In to Billing System
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    {activeRole === "CASHIER"
                      ? "දෛනික බිල්පත් සහ මෙහෙයුම් කටයුතු සඳහා පිවිසෙන්න."
                      : "Enter your assigned owner credentials to access management."}
                  </p>
                </div>

                {/* Alerts */}
                {sessionNotice && !errorMessage && (
                  <div
                    role="status"
                    className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-900"
                  >
                    {sessionNotice}
                  </div>
                )}

                {errorMessage && (
                  <div
                    role="alert"
                    className={`mb-4 rounded-xl border px-4 py-3 text-xs font-semibold ${
                      isRateLimited
                        ? "border-amber-300 bg-amber-50 text-amber-900"
                        : "border-rose-200 bg-rose-50 text-rose-700"
                    }`}
                  >
                    {errorMessage}
                  </div>
                )}

                {/* Login Form */}
                <form onSubmit={handleSubmit} noValidate className="space-y-4">
                  <div>
                    <label
                      htmlFor="login-username"
                      className="mb-1.5 block text-xs font-bold uppercase tracking-[0.06em] text-slate-600"
                    >
                      {activeRole === "CASHIER"
                        ? "පරිශීලක නාමය (Username)"
                        : "Username"}
                    </label>
                    <input
                      id="login-username"
                      ref={usernameInputRef}
                      name="username"
                      type="text"
                      autoComplete="username"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      required
                      disabled={isSubmitting}
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder={
                        activeRole === "CASHIER"
                          ? "කැෂියර් පරිශීලක නාමය"
                          : "Enter owner username"
                      }
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-[#092547] outline-none transition placeholder:text-slate-400 focus:border-[#124f8c] focus:ring-4 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-400"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="login-password"
                      className="mb-1.5 block text-xs font-bold uppercase tracking-[0.06em] text-slate-600"
                    >
                      {activeRole === "CASHIER"
                        ? "මුරපදය (Password)"
                        : "Password"}
                    </label>
                    <input
                      id="login-password"
                      name="password"
                      type="password"
                      autoComplete="current-password"
                      required
                      disabled={isSubmitting}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={
                        activeRole === "CASHIER"
                          ? "මුරපදය ඇතුළත් කරන්න"
                          : "Enter password"
                      }
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-[#092547] outline-none transition placeholder:text-slate-400 focus:border-[#124f8c] focus:ring-4 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-400"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className={`mt-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-white transition focus:outline-none focus:ring-4 disabled:cursor-not-allowed disabled:opacity-65 ${
                      activeRole === "CASHIER"
                        ? "bg-[#f58220] shadow-[0_8px_22px_rgba(245,130,32,0.25)] hover:bg-[#e77418] focus:ring-orange-200"
                        : "bg-[#092547] shadow-[0_8px_22px_rgba(9,37,71,0.25)] hover:bg-[#0f3461] focus:ring-blue-200"
                    }`}
                  >
                    {isSubmitting ? (
                      <span className="flex items-center gap-2">
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        <span>
                          {activeRole === "CASHIER" ? "පිවිසෙමින්..." : "Signing in..."}
                        </span>
                      </span>
                    ) : (
                      <span>
                        {activeRole === "CASHIER"
                          ? "කැෂියර් පිවිසුම (Sign In)"
                          : "Sign In as Owner"}
                      </span>
                    )}
                  </button>
                </form>

                <p className="mt-5 border-t border-slate-100 pt-3 text-center text-xs text-slate-400">
                  Authorized workshop staff only · Role-based access control
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. Real Material Specifications Section */}
      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="mb-8">
          <span className="text-xs font-bold uppercase tracking-[0.14em] text-[#f58220]">
            Aggregate Catalog
          </span>
          <h2 className="text-2xl font-black text-[#092547] sm:text-3xl">
            Crushed Metal &amp; Aggregate Grades
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Standard construction aggregates produced and billed in cubic metres (m³).
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md">
            <span className="rounded-lg bg-orange-100 px-2.5 py-1 text-xs font-extrabold text-[#f58220]">
              Code: 3/4
            </span>
            <h3 className="mt-3 text-lg font-bold text-[#092547]">
              3/4&quot; Crushed Metal
            </h3>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
              Graded 19mm aggregate for structural concrete casting, lintels, columns, beams, and slabs.
            </p>
            <p className="mt-3 text-xs font-bold text-slate-400">Standard Unit: m³</p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md">
            <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-extrabold text-slate-700">
              Code: DUST
            </span>
            <h3 className="mt-3 text-lg font-bold text-[#092547]">
              Quarry Dust
            </h3>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
              Fine aggregate (0-5mm) for asphalt mixing, cement block manufacturing, and interlock paving beds.
            </p>
            <p className="mt-3 text-xs font-bold text-slate-400">Standard Unit: m³</p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md">
            <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-extrabold text-slate-700">
              Code: 6X9
            </span>
            <h3 className="mt-3 text-lg font-bold text-[#092547]">
              6×9&quot; Rubble
            </h3>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
              Heavy foundation rubble (150-225mm) for civil foundations, gravity retaining walls, and embankments.
            </p>
            <p className="mt-3 text-xs font-bold text-slate-400">Standard Unit: m³</p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md">
            <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-extrabold text-slate-700">
              Code: ABC
            </span>
            <h3 className="mt-3 text-lg font-bold text-[#092547]">
              Aggregate Base Coarse
            </h3>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
              Dense graded mixture (0-37.5mm) for heavy road sub-base construction and engineered compaction.
            </p>
            <p className="mt-3 text-xs font-bold text-slate-400">Standard Unit: m³</p>
          </div>
        </div>
      </section>

      {/* 4. Core Workshop Modules Section */}
      <section className="border-t border-slate-200/80 bg-white px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="mb-8">
            <span className="text-xs font-bold uppercase tracking-[0.14em] text-[#124f8c]">
              System Architecture
            </span>
            <h2 className="text-2xl font-black text-[#092547] sm:text-3xl">
              Workshop Operational Capabilities
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Integrated modules operating across cashier counters and owner workstations.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-2xl border border-slate-200/80 bg-[#f8fafc] p-6">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-[#092547]">
                <Icon name="invoice" className="h-5 w-5" />
              </div>
              <h3 className="text-base font-extrabold text-[#092547]">
                Aggregate Invoicing &amp; A5 Print
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-slate-600">
                Customer account lookup, exact volume calculation in m³, transport fee toggling, and clean A5 slip printing.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/80 bg-[#f8fafc] p-6">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800">
                <Icon name="cash" className="h-5 w-5" />
              </div>
              <h3 className="text-base font-extrabold text-[#092547]">
                Append-Only Cash Ledger
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-slate-600">
                Permanent cash collection records with idempotency key protection, balance tracking, and auditable adjustments.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/80 bg-[#f8fafc] p-6">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-orange-100 text-[#f58220]">
                <Icon name="sales" className="h-5 w-5" />
              </div>
              <h3 className="text-base font-extrabold text-[#092547]">
                Daily Crushed Production
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-slate-600">
                Shift-based output logging per material type, stockpile identification, and batch reference recording.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/80 bg-[#f8fafc] p-6">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-800">
                <Icon name="dashboard" className="h-5 w-5" />
              </div>
              <h3 className="text-base font-extrabold text-[#092547]">
                Machinery &amp; Diesel Tracking
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-slate-600">
                Excavators, crushers, and wheel loader hour-meter tracking, gross running time, and fuel consumption logs.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/80 bg-[#f8fafc] p-6">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-purple-100 text-purple-800">
                <Icon name="customers" className="h-5 w-5" />
              </div>
              <h3 className="text-base font-extrabold text-[#092547]">
                Worker Attendance &amp; Payroll
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-slate-600">
                Shift tracking (full-day, half-day, night, overtime), cash advance deductions, and confidential owner payslips.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/80 bg-[#f8fafc] p-6">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-rose-100 text-rose-800">
                <Icon name="check" className="h-5 w-5" />
              </div>
              <h3 className="text-base font-extrabold text-[#092547]">
                Two-Tier Owner Approvals
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-slate-600">
                Cashiers draft operational records, requiring explicit Owner verification and approval before finalizing reports.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 5. Clean Footer */}
      <footer className="border-t border-slate-200 bg-[#092547] px-4 py-8 text-white sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-3">
            <div className="brand-mark h-8 w-8 text-sm" aria-hidden="true">
              <span>N</span>
            </div>
            <div>
              <p className="text-sm font-extrabold tracking-tight">
                NPR <span className="text-[#f58220]">METAL</span> CRUSHER
              </p>
              <p className="text-[10px] text-slate-400">
                Seenimodara, Sri Lanka · Proprietor: Nalaka Ranasinghe
              </p>
            </div>
          </div>

          <p className="text-center text-xs text-slate-400 sm:text-right">
            NPR Metal Crusher Billing &amp; Workshop Management System · Secure Session Protected
          </p>
        </div>
      </footer>
    </div>
  );
}

export default LandingPage;
