import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DEFAULT_USER_PREFERENCES,
  LEGACY_PREFERENCES_STORAGE_KEY,
  LEGACY_THEME_STORAGE_KEY,
} from '../shared/preferences.ts';
import { createPreferencesController } from '../shared/preferences-controller.ts';
import type {
  UserPreferencesData,
  UserPreferencesPayload,
} from '../shared/types.ts';
import { PreferencesViewContent } from './PreferencesView.tsx';

test('PreferencesViewContent renders loading, persisted, compact density, and error+retry states accurately', () => {
  const loadingHtml = renderToStaticMarkup(
    React.createElement(PreferencesViewContent, {
      preferences: { ...DEFAULT_USER_PREFERENCES },
      persisted: false,
      updatedAt: null,
      loading: true,
      saving: false,
      error: null,
      hasFailedPatch: false,
      onUpdate: () => {},
      onReset: () => {},
      onRetrySave: () => {},
      onReload: () => {},
    })
  );
  assert.match(loadingHtml, /Loading saved workspace preferences/);
  assert.match(loadingHtml, /Loading preferences/);

  const persistedHtml = renderToStaticMarkup(
    React.createElement(PreferencesViewContent, {
      preferences: {
        theme: 'dark',
        density: 'compact',
        timezone: 'UTC',
        dateFormat: 'iso_short',
      },
      persisted: true,
      updatedAt: '2026-11-17T08:00:00.000Z',
      loading: false,
      saving: false,
      error: null,
      hasFailedPatch: false,
      previewIso: '2026-11-15T14:30:00.000Z',
      onUpdate: () => {},
      onReset: () => {},
      onRetrySave: () => {},
      onReload: () => {},
    })
  );
  assert.match(persistedHtml, /Synced · 2026-11-17 08:00 UTC/);
  assert.match(persistedHtml, /2026-11-15 14:30 UTC/);
  assert.match(persistedHtml, /data-density="compact"/);
  assert.match(persistedHtml, /py-1\.5 px-2\.5/);

  const errorHtml = renderToStaticMarkup(
    React.createElement(PreferencesViewContent, {
      preferences: { ...DEFAULT_USER_PREFERENCES },
      persisted: false,
      updatedAt: null,
      loading: false,
      saving: false,
      error: 'Network timeout saving preferences.',
      hasFailedPatch: true,
      onUpdate: () => {},
      onReset: () => {},
      onRetrySave: () => {},
      onReload: () => {},
    })
  );
  assert.match(errorHtml, /Network timeout saving preferences/);
  assert.match(errorHtml, /Retry Save/);
  assert.match(errorHtml, /Reload Saved Preferences/);
  assert.match(errorHtml, /Sync failed/);
});

test('PreferencesController handles initial load, coalesced updates, error rollback+retry, sign-out reset, account switch, and legacy localStorage rules', async () => {
  const serverDb = new Map<string, UserPreferencesPayload>();
  const storage = new Map<string, string>();
  let currentUid: string | null = null;
  let putCalls = 0;
  let failNextPut = false;
  const themeHistory: string[] = [];
  const densityHistory: string[] = [];

  serverDb.set('user-a', {
    preferences: {
      theme: 'dark',
      density: 'compact',
      timezone: 'UTC',
      dateFormat: 'iso_short',
    },
    persisted: true,
    updatedAt: '2026-11-17T09:00:00.000Z',
  });

  // Stale browser storage from an old build should NEVER overwrite User A's server state
  storage.set(LEGACY_THEME_STORAGE_KEY, 'light');
  storage.set(
    LEGACY_PREFERENCES_STORAGE_KEY,
    JSON.stringify({ density: 'comfortable', timezone: 'Europe/London' })
  );

  const controller = createPreferencesController({
    fetchPreferences: async () => {
      if (!currentUid) throw new Error('Unauthenticated');
      return (
        serverDb.get(currentUid) ?? {
          preferences: { ...DEFAULT_USER_PREFERENCES },
          persisted: false,
          updatedAt: null,
        }
      );
    },
    savePreferences: async (patch: Partial<UserPreferencesData>) => {
      putCalls += 1;
      if (failNextPut) {
        failNextPut = false;
        throw new Error('Simulated 500 save failure');
      }
      if (!currentUid) throw new Error('Unauthenticated');
      const existing = serverDb.get(currentUid)?.preferences ?? {
        ...DEFAULT_USER_PREFERENCES,
      };
      const merged: UserPreferencesData = {
        ...existing,
        ...patch,
      };
      const nextPayload: UserPreferencesPayload = {
        preferences: merged,
        persisted: true,
        updatedAt: '2026-11-17T09:05:00.000Z',
      };
      serverDb.set(currentUid, nextPayload);
      return nextPayload;
    },
    readLegacyStorage: () => ({
      legacyTheme: storage.get(LEGACY_THEME_STORAGE_KEY) ?? null,
      legacyPrefsJson: storage.get(LEGACY_PREFERENCES_STORAGE_KEY) ?? null,
    }),
    clearLegacyStorage: () => {
      storage.delete(LEGACY_THEME_STORAGE_KEY);
      storage.delete(LEGACY_PREFERENCES_STORAGE_KEY);
    },
    applyTheme: (t) => themeHistory.push(t),
    applyDensity: (d) => densityHistory.push(d),
  });

  // 1. User A signs in -> loads persisted DB state and clears stale localStorage without PUT
  currentUid = 'user-a';
  await controller.setActiveUser('user-a');
  assert.equal(putCalls, 0);
  assert.equal(storage.has(LEGACY_THEME_STORAGE_KEY), false);
  assert.equal(storage.has(LEGACY_PREFERENCES_STORAGE_KEY), false);
  assert.deepEqual(controller.getSnapshot().preferences, {
    theme: 'dark',
    density: 'compact',
    timezone: 'UTC',
    dateFormat: 'iso_short',
  });
  assert.equal(themeHistory.at(-1), 'dark');
  assert.equal(densityHistory.at(-1), 'compact');

  // 2. Rapid sequential updates coalesce safely and persist
  const p1 = controller.updatePreferences({ theme: 'light' });
  const p2 = controller.updatePreferences({ timezone: 'Europe/London' });
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(r1, true);
  assert.equal(r2, true);
  assert.deepEqual(controller.getSnapshot().preferences, {
    theme: 'light',
    density: 'compact',
    timezone: 'Europe/London',
    dateFormat: 'iso_short',
  });

  // 3. Failed PUT sets error, keeps hasFailedPatch, rolls back UI to confirmed state, and retrySave succeeds
  failNextPut = true;
  const failedResult = await controller.updatePreferences({ theme: 'dark' });
  assert.equal(failedResult, false);
  assert.equal(controller.getSnapshot().error, 'Simulated 500 save failure');
  assert.equal(controller.getSnapshot().hasFailedPatch, true);
  assert.equal(controller.getSnapshot().preferences.theme, 'light');

  const retryResult = await controller.retrySave();
  assert.equal(retryResult, true);
  assert.equal(controller.getSnapshot().error, null);
  assert.equal(controller.getSnapshot().hasFailedPatch, false);
  assert.equal(controller.getSnapshot().preferences.theme, 'dark');

  // 4. Sign out resets cleanly to defaults
  currentUid = null;
  await controller.setActiveUser(null);
  assert.deepEqual(controller.getSnapshot().preferences, DEFAULT_USER_PREFERENCES);
  assert.equal(controller.getSnapshot().persisted, false);
  assert.equal(themeHistory.at(-1), 'light');
  assert.equal(densityHistory.at(-1), 'comfortable');

  // 5. Account switch to User B (unpersisted) with legacy localStorage migrates valid keys once and clears storage
  storage.set(LEGACY_THEME_STORAGE_KEY, 'dark');
  storage.set(
    LEGACY_PREFERENCES_STORAGE_KEY,
    JSON.stringify({ density: 'compact', timezone: 'Asia/Singapore' })
  );
  currentUid = 'user-b';
  await controller.setActiveUser('user-b');
  assert.equal(controller.getSnapshot().persisted, true);
  assert.deepEqual(controller.getSnapshot().preferences, {
    theme: 'dark',
    density: 'compact',
    timezone: 'Asia/Singapore',
    dateFormat: 'locale',
  });
  assert.equal(storage.has(LEGACY_THEME_STORAGE_KEY), false);
  assert.equal(storage.has(LEGACY_PREFERENCES_STORAGE_KEY), false);

  // 6. Reset defaults persists defaults back to PostgreSQL
  const resetOk = await controller.resetPreferences();
  assert.equal(resetOk, true);
  assert.deepEqual(controller.getSnapshot().preferences, DEFAULT_USER_PREFERENCES);
});
