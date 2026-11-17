import {
  DEFAULT_USER_PREFERENCES,
  coalescePendingPatches,
  decideInitialPreferenceSync,
  mergePreferencePatch,
  sanitizeStoredUserPreferences,
} from './preferences.ts';
import type {
  PreferenceDensity,
  ThemeMode,
  UserPreferencesData,
  UserPreferencesPayload,
} from './types.ts';

export interface PreferencesSnapshot {
  preferences: UserPreferencesData;
  persisted: boolean;
  updatedAt: string | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  hasFailedPatch: boolean;
}

export interface PreferencesControllerDeps {
  fetchPreferences: () => Promise<UserPreferencesPayload>;
  savePreferences: (
    patch: Partial<UserPreferencesData>
  ) => Promise<UserPreferencesPayload>;
  readLegacyStorage: () => {
    legacyTheme: string | null;
    legacyPrefsJson: string | null;
  };
  clearLegacyStorage: () => void;
  applyTheme?: (theme: ThemeMode) => void;
  applyDensity?: (density: PreferenceDensity) => void;
  onSnapshot?: (snapshot: PreferencesSnapshot) => void;
}

export function createPreferencesController(deps: PreferencesControllerDeps) {
  let activeUid: string | null = null;
  let loadGeneration = 0;
  let confirmedPrefs: UserPreferencesData = { ...DEFAULT_USER_PREFERENCES };
  let pendingPatch: Partial<UserPreferencesData> | null = null;
  let failedPatch: Partial<UserPreferencesData> | null = null;
  let activeSaveLoop: Promise<boolean> | null = null;

  let snapshot: PreferencesSnapshot = {
    preferences: { ...DEFAULT_USER_PREFERENCES },
    persisted: false,
    updatedAt: null,
    loading: false,
    saving: false,
    error: null,
    hasFailedPatch: false,
  };

  function emit(next: Partial<PreferencesSnapshot>) {
    snapshot = { ...snapshot, ...next };
    deps.applyTheme?.(snapshot.preferences.theme);
    deps.applyDensity?.(snapshot.preferences.density);
    deps.onSnapshot?.(snapshot);
  }

  function applyConfirmed(
    nextPrefs: UserPreferencesData,
    isPersisted: boolean,
    nextUpdatedAt: string | null,
    extra: Partial<PreferencesSnapshot> = {}
  ) {
    confirmedPrefs = sanitizeStoredUserPreferences(nextPrefs);
    emit({
      preferences: confirmedPrefs,
      persisted: isPersisted,
      updatedAt: nextUpdatedAt,
      ...extra,
    });
  }

  async function flushSaveQueue(expectedUid: string, expectedGen: number): Promise<boolean> {
    if (activeSaveLoop) {
      return activeSaveLoop;
    }

    const runner = (async (): Promise<boolean> => {
      emit({ saving: true });
      let allSucceeded = true;

      while (
        pendingPatch &&
        activeUid === expectedUid &&
        loadGeneration === expectedGen
      ) {
        const batch = pendingPatch;
        pendingPatch = null;

        try {
          const saved = await deps.savePreferences(batch);
          if (activeUid !== expectedUid || loadGeneration !== expectedGen) {
            return false;
          }

          confirmedPrefs = sanitizeStoredUserPreferences(saved.preferences);
          failedPatch = null;

          if (pendingPatch) {
            emit({
              persisted: saved.persisted,
              updatedAt: saved.updatedAt,
              error: null,
              hasFailedPatch: false,
            });
          } else {
            emit({
              preferences: confirmedPrefs,
              persisted: saved.persisted,
              updatedAt: saved.updatedAt,
              error: null,
              hasFailedPatch: false,
            });
          }
        } catch (err) {
          if (activeUid !== expectedUid || loadGeneration !== expectedGen) {
            return false;
          }
          allSucceeded = false;
          failedPatch = coalescePendingPatches(batch, pendingPatch ?? {});
          pendingPatch = null;
          emit({
            preferences: confirmedPrefs,
            error:
              err instanceof Error
                ? err.message
                : 'Failed to save workspace preferences.',
            hasFailedPatch: true,
          });
          break;
        }
      }

      if (activeUid === expectedUid && loadGeneration === expectedGen) {
        emit({ saving: false });
      }
      activeSaveLoop = null;
      return allSucceeded;
    })();

    activeSaveLoop = runner;
    return runner;
  }

  async function loadForUser(uid: string, gen: number): Promise<void> {
    emit({ loading: true, error: null, hasFailedPatch: false });
    try {
      const serverPayload = await deps.fetchPreferences();
      if (activeUid !== uid || loadGeneration !== gen) return;

      const { legacyTheme, legacyPrefsJson } = deps.readLegacyStorage();
      const decision = decideInitialPreferenceSync({
        serverPayload,
        legacyTheme,
        legacyPrefsJson,
      });

      if (decision.action === 'apply_server') {
        if (decision.clearLegacyStorage) {
          deps.clearLegacyStorage();
        }
        applyConfirmed(decision.preferences, true, serverPayload.updatedAt, {
          loading: false,
          error: null,
          hasFailedPatch: false,
        });
        return;
      }

      if (decision.action === 'migrate_legacy') {
        emit({
          preferences: decision.optimisticPreferences,
          persisted: false,
          updatedAt: null,
        });
        try {
          const migrated = await deps.savePreferences(decision.migrationPatch);
          if (activeUid !== uid || loadGeneration !== gen) return;
          deps.clearLegacyStorage();
          applyConfirmed(
            migrated.preferences,
            migrated.persisted,
            migrated.updatedAt,
            {
              loading: false,
              error: null,
              hasFailedPatch: false,
            }
          );
        } catch (migrationErr) {
          if (activeUid !== uid || loadGeneration !== gen) return;
          failedPatch = decision.migrationPatch;
          applyConfirmed({ ...DEFAULT_USER_PREFERENCES }, false, null, {
            loading: false,
            error:
              migrationErr instanceof Error
                ? migrationErr.message
                : 'Unable to migrate browser preferences to PostgreSQL.',
            hasFailedPatch: true,
          });
        }
        return;
      }

      applyConfirmed(decision.preferences, false, null, {
        loading: false,
        error: null,
        hasFailedPatch: false,
      });
    } catch (err) {
      if (activeUid !== uid || loadGeneration !== gen) return;
      applyConfirmed({ ...DEFAULT_USER_PREFERENCES }, false, null, {
        loading: false,
        error:
          err instanceof Error
            ? err.message
            : 'Unable to load workspace preferences.',
        hasFailedPatch: false,
      });
    }
  }

  return {
    getSnapshot: (): PreferencesSnapshot => snapshot,

    async setActiveUser(uid: string | null): Promise<void> {
      const prevUid = activeUid;
      if (uid === prevUid && uid !== null) {
        return;
      }

      loadGeneration += 1;
      const currentGen = loadGeneration;
      activeUid = uid;
      pendingPatch = null;
      failedPatch = null;
      activeSaveLoop = null;

      if (!uid) {
        if (prevUid !== null) {
          deps.clearLegacyStorage();
        }
        applyConfirmed({ ...DEFAULT_USER_PREFERENCES }, false, null, {
          loading: false,
          saving: false,
          error: null,
          hasFailedPatch: false,
        });
        return;
      }

      if (prevUid !== null && prevUid !== uid) {
        deps.clearLegacyStorage();
      }

      await loadForUser(uid, currentGen);
    },

    async updatePreferences(
      patch: Partial<UserPreferencesData>
    ): Promise<boolean> {
      const uid = activeUid;
      const gen = loadGeneration;
      if (!uid) {
        emit({ error: 'Sign in to save workspace preferences.' });
        return false;
      }

      failedPatch = null;
      const optimistic = mergePreferencePatch(snapshot.preferences, patch);
      emit({
        preferences: optimistic,
        error: null,
        hasFailedPatch: false,
      });

      pendingPatch = coalescePendingPatches(pendingPatch, patch);
      return flushSaveQueue(uid, gen);
    },

    async resetPreferences(): Promise<boolean> {
      return this.updatePreferences({ ...DEFAULT_USER_PREFERENCES });
    },

    async retrySave(): Promise<boolean> {
      if (!failedPatch) return true;
      const patch = failedPatch;
      failedPatch = null;
      return this.updatePreferences(patch);
    },

    async reloadPreferences(): Promise<void> {
      if (!activeUid) return;
      loadGeneration += 1;
      pendingPatch = null;
      failedPatch = null;
      activeSaveLoop = null;
      await loadForUser(activeUid, loadGeneration);
    },
  };
}
