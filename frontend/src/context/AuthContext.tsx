import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  getCurrentSessionRequest,
  loginRequest,
  logoutRequest,
  type LoginCredentials,
} from "../api/auth.ts";
import { ApiError, setUnauthorizedHandler } from "../api/client.ts";
import type { AuthStatus, AuthUser } from "../types/auth.ts";

export interface AuthContextValue {
  user: AuthUser | null;
  status: AuthStatus;
  sessionNotice: string | null;
  logoutError: string | null;
  isLoggingOut: boolean;
  clearSessionNotice: () => void;
  clearLogoutError: () => void;
  login: (credentials: LoginCredentials) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<AuthUser | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const FOCUS_REVALIDATE_THROTTLE_MS = 30_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const authVersionRef = useRef(0);
  const lastFocusCheckRef = useRef(0);
  const mountedRef = useRef(true);

  const handleUnauthorizedExpiry = useCallback(() => {
    authVersionRef.current += 1;
    setUser(null);
    setStatus("unauthenticated");
    setLogoutError(null);
    setSessionNotice(
      "Your session has expired or been signed out. Please sign in again."
    );
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    setUnauthorizedHandler(handleUnauthorizedExpiry);
    return () => {
      mountedRef.current = false;
      setUnauthorizedHandler(null);
    };
  }, [handleUnauthorizedExpiry]);

  useEffect(() => {
    const controller = new AbortController();
    const versionAtStart = authVersionRef.current;

    void (async () => {
      try {
        const currentUser = await getCurrentSessionRequest(controller.signal);
        if (!mountedRef.current || controller.signal.aborted) {
          return;
        }
        if (authVersionRef.current !== versionAtStart) {
          return;
        }
        if (currentUser) {
          setUser(currentUser);
          setStatus("authenticated");
          lastFocusCheckRef.current = Date.now();
        } else {
          setUser(null);
          setStatus("unauthenticated");
        }
      } catch (err) {
        if (!mountedRef.current || controller.signal.aborted) {
          return;
        }
        if (authVersionRef.current !== versionAtStart) {
          return;
        }
        setUser(null);
        setStatus("unauthenticated");
        if (err instanceof ApiError && err.code !== "REQUEST_ABORTED") {
          setSessionNotice(err.message);
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, []);

  const refreshSession = useCallback(async (): Promise<AuthUser | null> => {
    const versionAtStart = authVersionRef.current;
    try {
      const currentUser = await getCurrentSessionRequest();
      if (!mountedRef.current || authVersionRef.current !== versionAtStart) {
        return null;
      }
      if (!currentUser) {
        handleUnauthorizedExpiry();
        return null;
      }
      setUser(currentUser);
      setStatus("authenticated");
      return currentUser;
    } catch {
      return null;
    }
  }, [handleUnauthorizedExpiry]);

  useEffect(() => {
    if (status !== "authenticated" || typeof window === "undefined") {
      return;
    }

    const onWindowFocus = () => {
      const now = Date.now();
      if (now - lastFocusCheckRef.current < FOCUS_REVALIDATE_THROTTLE_MS) {
        return;
      }
      lastFocusCheckRef.current = now;
      void refreshSession();
    };

    window.addEventListener("focus", onWindowFocus);
    return () => {
      window.removeEventListener("focus", onWindowFocus);
    };
  }, [refreshSession, status]);

  const login = useCallback(async (credentials: LoginCredentials): Promise<AuthUser> => {
    const authenticatedUser = await loginRequest(credentials);
    authVersionRef.current += 1;
    lastFocusCheckRef.current = Date.now();
    if (mountedRef.current) {
      setUser(authenticatedUser);
      setStatus("authenticated");
      setSessionNotice(null);
      setLogoutError(null);
    }
    return authenticatedUser;
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    if (isLoggingOut) {
      return;
    }
    setIsLoggingOut(true);
    setLogoutError(null);
    try {
      await logoutRequest();
      authVersionRef.current += 1;
      if (mountedRef.current) {
        setUser(null);
        setStatus("unauthenticated");
        setSessionNotice(null);
      }
    } catch (err) {
      if (mountedRef.current) {
        const message =
          err instanceof ApiError
            ? err.message
            : "Could not complete sign out. Please try again.";
        setLogoutError(message);
      }
      throw err;
    } finally {
      if (mountedRef.current) {
        setIsLoggingOut(false);
      }
    }
  }, [isLoggingOut]);

  const clearSessionNotice = useCallback(() => {
    setSessionNotice(null);
  }, []);

  const clearLogoutError = useCallback(() => {
    setLogoutError(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      sessionNotice,
      logoutError,
      isLoggingOut,
      clearSessionNotice,
      clearLogoutError,
      login,
      logout,
      refreshSession,
    }),
    [
      clearLogoutError,
      clearSessionNotice,
      isLoggingOut,
      login,
      logout,
      logoutError,
      refreshSession,
      sessionNotice,
      status,
      user,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
