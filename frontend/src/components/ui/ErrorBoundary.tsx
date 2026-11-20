import React, { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children?: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  public override state: ErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("ErrorBoundary caught an unhandled page error:", error, errorInfo);
  }

  public reset = (): void => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  public override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="mx-auto my-8 max-w-lg rounded-2xl border border-rose-200 bg-white p-6 text-center shadow-lg"
        >
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 text-rose-600">
            <svg
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-[#092547]">
            {this.props.fallbackTitle ?? "Something went wrong"}
          </h2>
          <p className="mt-2 text-xs leading-relaxed text-slate-600">
            An unexpected error occurred while rendering this section.
          </p>
          {this.state.error?.message && (
            <div className="mt-3 rounded-lg bg-slate-50 p-2.5 font-mono text-[11px] text-slate-700 break-words">
              {this.state.error.message}
            </div>
          )}
          <div className="mt-5 flex justify-center gap-3">
            <button
              type="button"
              onClick={this.reset}
              className="rounded-xl bg-[#092547] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#124f8c]"
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
