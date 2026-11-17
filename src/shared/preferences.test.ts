import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_USER_PREFERENCES,
  UserPreferencesUpdateSchema,
  coalescePendingPatches,
  decideInitialPreferenceSync,
  extractValidLegacyLocalStoragePreferences,
  formatWorkspaceTimestamp,
  isValidIanaTimezone,
  sanitizeStoredUserPreferences,
} from './preferences.ts';

test('UserPreferencesUpdateSchema accepts valid partial/full updates and rejects invalid or unknown fields', () => {
  assert.equal(UserPreferencesUpdateSchema.safeParse({ theme: 'dark' }).success, true);
  assert.equal(
    UserPreferencesUpdateSchema.safeParse({
      theme: 'dark',
      density: 'compact',
      timezone: 'America/New_York',
      dateFormat: 'iso_short',
    }).success,
    true
  );

  // Empty patch rejected
  assert.equal(UserPreferencesUpdateSchema.safeParse({}).success, false);

  // Invalid values rejected
  assert.equal(UserPreferencesUpdateSchema.safeParse({ theme: 'midnight' }).success, false);
  assert.equal(UserPreferencesUpdateSchema.safeParse({ density: 'dense' }).success, false);
  assert.equal(UserPreferencesUpdateSchema.safeParse({ dateFormat: 'custom' }).success, false);
  assert.equal(UserPreferencesUpdateSchema.safeParse({ timezone: 'Mars/Olympus' }).success, false);
  assert.equal(UserPreferencesUpdateSchema.safeParse({ timezone: ' UTC ' }).success, false);

  // Unknown / ownership-spoofing fields rejected (.strict)
  assert.equal(
    UserPreferencesUpdateSchema.safeParse({ theme: 'dark', userId: 99 }).success,
    false
  );
  assert.equal(
    UserPreferencesUpdateSchema.safeParse({ theme: 'dark', uid: 'evil-uid' }).success,
    false
  );
  assert.equal(
    UserPreferencesUpdateSchema.safeParse({ density: 'compact', tenantId: 1 }).success,
    false
  );
  assert.equal(
    UserPreferencesUpdateSchema.safeParse({ timezone: 'UTC', extraFlag: true }).success,
    false
  );
});

test('isValidIanaTimezone and sanitizeStoredUserPreferences handle edge inputs safely', () => {
  assert.equal(isValidIanaTimezone('Asia/Kolkata'), true);
  assert.equal(isValidIanaTimezone('UTC'), true);
  assert.equal(isValidIanaTimezone('Europe/London'), true);
  assert.equal(isValidIanaTimezone('Invalid/Zone'), false);
  assert.equal(isValidIanaTimezone(''), false);
  assert.equal(isValidIanaTimezone(null), false);

  const sanitized = sanitizeStoredUserPreferences({
    theme: 'invalid',
    density: 'compact',
    timezone: 'Invalid/Zone',
    dateFormat: null,
  });
  assert.deepEqual(sanitized, {
    theme: DEFAULT_USER_PREFERENCES.theme,
    density: 'compact',
    timezone: DEFAULT_USER_PREFERENCES.timezone,
    dateFormat: DEFAULT_USER_PREFERENCES.dateFormat,
  });
});

test('extractValidLegacyLocalStoragePreferences sanitizes values and ignores tokens or invalid JSON', () => {
  const valid = extractValidLegacyLocalStoragePreferences(
    'dark',
    JSON.stringify({
      density: 'compact',
      timezone: 'UTC',
      dateFormat: 'day_month_year',
      token: 'secret-jwt-should-be-ignored',
      userId: 42,
    })
  );
  assert.equal(valid.hasLegacyData, true);
  assert.deepEqual(valid.patch, {
    theme: 'dark',
    density: 'compact',
    timezone: 'UTC',
    dateFormat: 'day_month_year',
  });
  assert.equal('token' in valid.patch, false);
  assert.equal('userId' in valid.patch, false);

  const invalid = extractValidLegacyLocalStoragePreferences(
    'neon',
    '{bad-json'
  );
  assert.equal(invalid.hasLegacyData, false);
  assert.deepEqual(invalid.patch, {});
});

test('decideInitialPreferenceSync never overwrites persisted DB state with stale localStorage', () => {
  const persistedDecision = decideInitialPreferenceSync({
    serverPayload: {
      preferences: {
        theme: 'light',
        density: 'comfortable',
        timezone: 'Asia/Kolkata',
        dateFormat: 'locale',
      },
      persisted: true,
      updatedAt: '2026-11-17T08:00:00.000Z',
    },
    legacyTheme: 'dark',
    legacyPrefsJson: JSON.stringify({ density: 'compact', timezone: 'UTC' }),
  });

  assert.equal(persistedDecision.action, 'apply_server');
  assert.equal(persistedDecision.clearLegacyStorage, true);
  if (persistedDecision.action === 'apply_server') {
    assert.equal(persistedDecision.preferences.theme, 'light');
    assert.equal(persistedDecision.preferences.density, 'comfortable');
  }

  const unpersistedWithLegacy = decideInitialPreferenceSync({
    serverPayload: {
      preferences: { ...DEFAULT_USER_PREFERENCES },
      persisted: false,
      updatedAt: null,
    },
    legacyTheme: 'dark',
    legacyPrefsJson: JSON.stringify({ density: 'compact' }),
  });
  assert.equal(unpersistedWithLegacy.action, 'migrate_legacy');
  if (unpersistedWithLegacy.action === 'migrate_legacy') {
    assert.deepEqual(unpersistedWithLegacy.migrationPatch, {
      theme: 'dark',
      density: 'compact',
    });
  }

  const unpersistedClean = decideInitialPreferenceSync({
    serverPayload: {
      preferences: { ...DEFAULT_USER_PREFERENCES },
      persisted: false,
      updatedAt: null,
    },
    legacyTheme: null,
    legacyPrefsJson: null,
  });
  assert.equal(unpersistedClean.action, 'use_defaults');
  assert.equal(unpersistedClean.clearLegacyStorage, false);
});

test('coalescePendingPatches and formatWorkspaceTimestamp preserve deterministic behavior', () => {
  let pending = coalescePendingPatches(null, { theme: 'dark' });
  pending = coalescePendingPatches(pending, { density: 'compact' });
  pending = coalescePendingPatches(pending, { theme: 'light', timezone: 'UTC' });
  assert.deepEqual(pending, {
    theme: 'light',
    density: 'compact',
    timezone: 'UTC',
  });

  const isoFormatted = formatWorkspaceTimestamp('2026-11-15T14:30:00.000Z', {
    timezone: 'UTC',
    dateFormat: 'iso_short',
  });
  assert.equal(isoFormatted, '2026-11-15 14:30 UTC');

  const dmyFormatted = formatWorkspaceTimestamp('2026-11-15T14:30:00.000Z', {
    timezone: 'UTC',
    dateFormat: 'day_month_year',
  });
  assert.match(dmyFormatted, /15 Nov 2026/);
});
