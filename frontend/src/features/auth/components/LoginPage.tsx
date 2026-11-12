import { useState, type FormEvent } from "react";
import { ApiError } from "../../../api/client.ts";
import { Icon } from "../../../components/ui/Icon.tsx";
import { useAuth } from "../../../context/AuthContext.tsx";

export function LoginPage() {
  const { login, sessionNotice, clearSessionNotice } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRateLimited, setIsRateLimited] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
      setErrorMessage("Please enter a valid username (3 to 50 characters).");
      return;
    }

    if (password.length === 0) {
      setErrorMessage("Please enter your password.");
      return;
    }

    setIsSubmitting(true);
    try {
      await login({
        username: trimmedUsername,
        password,
      });
      setPassword("");
    } catch (err) {
      setPassword("");
      if (err instanceof ApiError) {
        setIsRateLimited(err.status === 429);
        setErrorMessage(err.message);
      } else {
        setErrorMessage(
          "An unexpected sign-in error occurred. Please try again."
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col justify-center bg-[#f4f7fb] px-4 py-10 sm:px-6">
      <div className="mx-auto w-full max-w-[440px]">
        <div className="mb-7 flex items-center justify-center gap-3.5">
          <div className="brand-mark" aria-hidden="true">
            <span>N</span>
          </div>
          <div>
            <p className="text-[22px] font-extrabold tracking-[0.02em] text-[#092547]">
              NPR <span className="text-[#f58220]">METAL</span>
            </p>
            <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              Crusher &amp; Workshop
            </p>
          </div>
        </div>

        <section className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-[0_12px_40px_rgba(9,37,71,0.08)] sm:p-8">
          <div className="mb-6">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-[#edf3fa] px-3 py-1 text-xs font-bold text-[#124f8c]">
              <Icon name="lock" className="h-3.5 w-3.5" />
              Staff Authentication
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight text-[#092547]">
              Sign In to Billing System
            </h1>
            <p className="mt-1.5 text-sm text-slate-500">
              Enter your assigned workshop username and password to continue.
            </p>
          </div>

          {sessionNotice && !errorMessage && (
            <div
              role="status"
              className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900"
            >
              {sessionNotice}
            </div>
          )}

          {errorMessage && (
            <div
              role="alert"
              className={`mb-5 rounded-xl border px-4 py-3 text-sm font-semibold ${
                isRateLimited
                  ? "border-amber-300 bg-amber-50 text-amber-900"
                  : "border-rose-200 bg-rose-50 text-rose-700"
              }`}
            >
              {errorMessage}
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <div>
              <label
                htmlFor="login-username"
                className="mb-1.5 block text-xs font-bold uppercase tracking-[0.06em] text-slate-600"
              >
                Username
              </label>
              <input
                id="login-username"
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
                placeholder="Enter username"
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-[#092547] outline-none transition placeholder:text-slate-400 focus:border-[#124f8c] focus:ring-4 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-400"
              />
            </div>

            <div>
              <label
                htmlFor="login-password"
                className="mb-1.5 block text-xs font-bold uppercase tracking-[0.06em] text-slate-600"
              >
                Password
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
                placeholder="Enter password"
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-[#092547] outline-none transition placeholder:text-slate-400 focus:border-[#124f8c] focus:ring-4 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-400"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#f58220] px-5 py-3 text-sm font-bold text-white shadow-[0_8px_22px_rgba(245,130,32,0.25)] transition hover:bg-[#e77418] focus:outline-none focus:ring-4 focus:ring-orange-200 disabled:cursor-not-allowed disabled:opacity-65"
            >
              {isSubmitting ? "Signing in..." : "Sign In"}
            </button>
          </form>

          <p className="mt-5 border-t border-slate-100 pt-4 text-center text-xs text-slate-400">
            Authorized staff accounts only. Contact the workshop owner for account access.
          </p>
        </section>

        <p className="mt-6 text-center text-[11px] text-slate-400">
          NPR Metal Crusher · Kurunegala, Sri Lanka
        </p>
      </div>
    </div>
  );
}
