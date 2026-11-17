import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { LEGACY_THEME_STORAGE_KEY } from '../shared/preferences.ts';
import type { ThemeMode } from '../shared/types.ts';

export type { ThemeMode };

export type ThemePersistHandler = (mode: ThemeMode) => Promise<boolean | void> | void;

interface ThemeContextValue {
  theme: ThemeMode;
  setTheme: (mode: ThemeMode) => void;
  toggleTheme: () => void;
  setThemeLocal: (mode: ThemeMode) => void;
  registerPersistHandler: (handler: ThemePersistHandler | null) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function resolveInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  try {
    const saved = localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') {
      return saved;
    }
    if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
  } catch {
    // ignore storage errors
  }
  return 'light';
}

export function applyDocumentTheme(mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (mode === 'dark') {
    root.classList.add('dark');
    root.style.colorScheme = 'dark';
  } else {
    root.classList.remove('dark');
    root.style.colorScheme = 'light';
  }
}

export function clearLegacyThemeStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(resolveInitialTheme);
  const persistHandlerRef = useRef<ThemePersistHandler | null>(null);

  useEffect(() => {
    applyDocumentTheme(theme);
  }, [theme]);

  const setThemeLocal = useCallback((mode: ThemeMode) => {
    setThemeState(mode);
    applyDocumentTheme(mode);
  }, []);

  const registerPersistHandler = useCallback(
    (handler: ThemePersistHandler | null) => {
      persistHandlerRef.current = handler;
    },
    []
  );

  const persistOrStoreLocal = useCallback((mode: ThemeMode) => {
    if (persistHandlerRef.current) {
      void persistHandlerRef.current(mode);
      return;
    }
    try {
      localStorage.setItem(LEGACY_THEME_STORAGE_KEY, mode);
    } catch {
      // ignore storage errors
    }
  }, []);

  const setTheme = useCallback(
    (mode: ThemeMode) => {
      setThemeState(mode);
      applyDocumentTheme(mode);
      persistOrStoreLocal(mode);
    },
    [persistOrStoreLocal]
  );

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: ThemeMode = prev === 'dark' ? 'light' : 'dark';
      applyDocumentTheme(next);
      persistOrStoreLocal(next);
      return next;
    });
  }, [persistOrStoreLocal]);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        setTheme,
        toggleTheme,
        setThemeLocal,
        registerPersistHandler,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used inside ThemeProvider');
  }
  return ctx;
}
