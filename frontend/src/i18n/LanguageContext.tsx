import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "../context/AuthContext.tsx";
import { translations, type Language, type Translations } from "./translations.ts";

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  toggleLanguage: () => void;
  t: (key: keyof Translations, params?: Record<string, string | number>) => string;
  isSinhala: boolean;
}

const LanguageContext = createContext<LanguageContextType | null>(null);

const STORAGE_KEY = "npr_preferred_language";

export function LanguageProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  // Initialize from storage or role
  const [language, setLanguageState] = useState<Language>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "en" || stored === "si") {
        return stored;
      }
    } catch {
      // storage not accessible
    }
    // Default: CASHIER -> Sinhala, OWNER -> English
    return user?.role === "CASHIER" ? "si" : "en";
  });

  // Whenever user role changes, if no explicit manual preference was stored, adjust default
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored && user) {
        setLanguageState(user.role === "CASHIER" ? "si" : "en");
      }
    } catch {
      if (user) {
        setLanguageState(user.role === "CASHIER" ? "si" : "en");
      }
    }
  }, [user]);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // ignore
    }
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguageState((prev) => {
      const next: Language = prev === "si" ? "en" : "si";
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const t = useCallback(
    (key: keyof Translations, params?: Record<string, string | number>): string => {
      const dict = translations[language] ?? translations.en;
      let text = dict[key] ?? translations.en[key] ?? key;
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          text = text.split(`{${k}}`).join(String(v));
        }
      }
      return text;
    },
    [language]
  );

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      toggleLanguage,
      t,
      isSinhala: language === "si",
    }),
    [language, setLanguage, toggleLanguage, t]
  );

  return (
    <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextType {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return ctx;
}
