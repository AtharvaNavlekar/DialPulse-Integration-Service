import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useAuth } from './AuthContext.tsx';
import { clearLegacyThemeStorage, useTheme } from './ThemeContext.tsx';
import {
  DEFAULT_USER_PREFERENCES,
  LEGACY_PREFERENCES_STORAGE_KEY,
  LEGACY_THEME_STORAGE_KEY,
  formatWorkspaceTimestamp,
} from '../shared/preferences.ts';
import {
  createPreferencesController,
  type PreferencesSnapshot,
} from '../shared/preferences-controller.ts';
import type {
  UserPreferencesData,
  UserPreferencesPayload,
} from '../shared/types.ts';

interface PreferencesContextValue {
  preferences: UserPreferencesData;
  persisted: boolean;
  updatedAt: string | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  hasFailedPatch: boolean;
  updatePreferences: (patch: Partial<UserPreferencesData>) => Promise<boolean>;
  resetPreferences: () => Promise<boolean>;
  retrySave: () => Promise<boolean>;
  reloadPreferences: () => Promise<void>;
  formatTimestamp: (iso: string | Date) => string;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

function readLegacyStorage(): {
  legacyTheme: string | null;
  legacyPrefsJson: string | null;
} {
  if (typeof window === 'undefined') {
    return { legacyTheme: null, legacyPrefsJson: null };
  }
  try {
    return {
      legacyTheme: localStorage.getItem(LEGACY_THEME_STORAGE_KEY),
      legacyPrefsJson: localStorage.getItem(LEGACY_PREFERENCES_STORAGE_KEY),
    };
  } catch {
    return { legacyTheme: null, legacyPrefsJson: null };
  }
}

function clearAllLegacyPreferenceStorage(): void {
  clearLegacyThemeStorage();
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(LEGACY_PREFERENCES_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}

function applyDocumentDensity(density: UserPreferencesData['density']): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.density = density;
}

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const { firebaseUser, apiFetch } = useAuth();
  const { setThemeLocal, registerPersistHandler } = useTheme();

  const [snapshot, setSnapshot] = useState<PreferencesSnapshot>(() => ({
    preferences: { ...DEFAULT_USER_PREFERENCES },
    persisted: false,
    updatedAt: null,
    loading: false,
    saving: false,
    error: null,
    hasFailedPatch: false,
  }));

  const apiFetchRef = useRef(apiFetch);
  apiFetchRef.current = apiFetch;
  const setThemeLocalRef = useRef(setThemeLocal);
  setThemeLocalRef.current = setThemeLocal;

  const controllerRef = useRef<ReturnType<typeof createPreferencesController> | null>(
    null
  );

  if (!controllerRef.current) {
    controllerRef.current = createPreferencesController({
      fetchPreferences: () =>
        apiFetchRef.current<UserPreferencesPayload>('/api/workspace/preferences'),
      savePreferences: (patch) =>
        apiFetchRef.current<UserPreferencesPayload>('/api/workspace/preferences', {
          method: 'PUT',
          body: JSON.stringify(patch),
        }),
      readLegacyStorage,
      clearLegacyStorage: clearAllLegacyPreferenceStorage,
      applyTheme: (theme) => setThemeLocalRef.current(theme),
      applyDensity: applyDocumentDensity,
      onSnapshot: (next) => setSnapshot(next),
    });
  }

  const uid = firebaseUser?.uid ?? null;

  useEffect(() => {
    const controller = controllerRef.current!;
    if (!uid) {
      registerPersistHandler(null);
      void controller.setActiveUser(null);
      return;
    }

    registerPersistHandler((nextTheme) =>
      controller.updatePreferences({ theme: nextTheme })
    );
    void controller.setActiveUser(uid);

    return () => {
      registerPersistHandler(null);
    };
  }, [uid, registerPersistHandler]);

  const updatePreferences = useCallback(
    (patch: Partial<UserPreferencesData>) =>
      controllerRef.current!.updatePreferences(patch),
    []
  );

  const resetPreferences = useCallback(
    () => controllerRef.current!.resetPreferences(),
    []
  );

  const retrySave = useCallback(
    () => controllerRef.current!.retrySave(),
    []
  );

  const reloadPreferences = useCallback(
    () => controllerRef.current!.reloadPreferences(),
    []
  );

  const formatTimestamp = useCallback(
    (iso: string | Date) =>
      formatWorkspaceTimestamp(iso, snapshot.preferences),
    [snapshot.preferences]
  );

  return (
    <PreferencesContext.Provider
      value={{
        preferences: snapshot.preferences,
        persisted: snapshot.persisted,
        updatedAt: snapshot.updatedAt,
        loading: snapshot.loading,
        saving: snapshot.saving,
        error: snapshot.error,
        hasFailedPatch: snapshot.hasFailedPatch,
        updatePreferences,
        resetPreferences,
        retrySave,
        reloadPreferences,
        formatTimestamp,
      }}
    >
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  const ctx = useContext(PreferencesContext);
  if (!ctx) {
    throw new Error('usePreferences must be used inside PreferencesProvider');
  }
  return ctx;
}
