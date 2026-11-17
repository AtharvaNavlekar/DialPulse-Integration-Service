import { z } from 'zod';
import type {
  PreferenceDateFormat,
  PreferenceDensity,
  ThemeMode,
  UserPreferencesData,
  UserPreferencesPayload,
} from './types.ts';

export const LEGACY_THEME_STORAGE_KEY = 'dialpulse_workspace_theme';
export const LEGACY_PREFERENCES_STORAGE_KEY = 'dialpulse_workspace_preferences_v1';

export const VALID_THEMES = ['light', 'dark'] as const;
export const VALID_DENSITIES = ['comfortable', 'compact'] as const;
export const VALID_DATE_FORMATS = ['locale', 'iso_short', 'day_month_year'] as const;

export const SUPPORTED_TIMEZONES = [
  { value: 'Asia/Kolkata', label: 'Asia/Kolkata (IST · UTC+05:30)' },
  { value: 'UTC', label: 'UTC (Coordinated Universal Time)' },
  { value: 'Asia/Singapore', label: 'Asia/Singapore (SGT · UTC+08:00)' },
  { value: 'Europe/London', label: 'Europe/London (GMT/BST)' },
  { value: 'America/New_York', label: 'America/New_York (ET)' },
] as const;

export const DEFAULT_USER_PREFERENCES: Readonly<UserPreferencesData> = Object.freeze({
  theme: 'light',
  density: 'comfortable',
  timezone: 'Asia/Kolkata',
  dateFormat: 'locale',
});

export function isValidThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark';
}

export function isValidDensity(value: unknown): value is PreferenceDensity {
  return value === 'comfortable' || value === 'compact';
}

export function isValidDateFormat(value: unknown): value is PreferenceDateFormat {
  return (
    value === 'locale' ||
    value === 'iso_short' ||
    value === 'day_month_year'
  );
}

export function isValidIanaTimezone(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (
    trimmed !== value ||
    trimmed.length < 2 ||
    trimmed.length > 80 ||
    /\s/.test(trimmed)
  ) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: trimmed });
    return true;
  } catch {
    return false;
  }
}

export const UserPreferencesUpdateSchema = z
  .object({
    theme: z.enum(VALID_THEMES).optional(),
    density: z.enum(VALID_DENSITIES).optional(),
    timezone: z
      .string()
      .refine(isValidIanaTimezone, { message: 'Invalid IANA timezone.' })
      .optional(),
    dateFormat: z.enum(VALID_DATE_FORMATS).optional(),
  })
  .strict()
  .refine(
    (obj) =>
      obj.theme !== undefined ||
      obj.density !== undefined ||
      obj.timezone !== undefined ||
      obj.dateFormat !== undefined,
    { message: 'At least one preference field must be provided.' }
  );

export type ValidatedUserPreferencesPatch = z.infer<typeof UserPreferencesUpdateSchema>;

export function sanitizeStoredUserPreferences(
  raw?: Partial<Record<keyof UserPreferencesData, unknown>> | null
): UserPreferencesData {
  return {
    theme: isValidThemeMode(raw?.theme)
      ? raw.theme
      : DEFAULT_USER_PREFERENCES.theme,
    density: isValidDensity(raw?.density)
      ? raw.density
      : DEFAULT_USER_PREFERENCES.density,
    timezone: isValidIanaTimezone(raw?.timezone)
      ? raw.timezone
      : DEFAULT_USER_PREFERENCES.timezone,
    dateFormat: isValidDateFormat(raw?.dateFormat)
      ? raw.dateFormat
      : DEFAULT_USER_PREFERENCES.dateFormat,
  };
}

export function mergePreferencePatch(
  base: UserPreferencesData,
  patch: Partial<UserPreferencesData>
): UserPreferencesData {
  return sanitizeStoredUserPreferences({
    theme: patch.theme ?? base.theme,
    density: patch.density ?? base.density,
    timezone: patch.timezone ?? base.timezone,
    dateFormat: patch.dateFormat ?? base.dateFormat,
  });
}

export function coalescePendingPatches(
  pending: Partial<UserPreferencesData> | null,
  incoming: Partial<UserPreferencesData>
): Partial<UserPreferencesData> {
  return {
    ...(pending ?? {}),
    ...incoming,
  };
}

export function extractValidLegacyLocalStoragePreferences(
  rawTheme: string | null | undefined,
  rawPrefsJson: string | null | undefined
): {
  hasLegacyData: boolean;
  patch: Partial<UserPreferencesData>;
} {
  const patch: Partial<UserPreferencesData> = {};

  if (isValidThemeMode(rawTheme)) {
    patch.theme = rawTheme;
  }

  if (typeof rawPrefsJson === 'string' && rawPrefsJson.trim()) {
    try {
      const parsed = JSON.parse(rawPrefsJson) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        if (isValidThemeMode(record.theme) && patch.theme === undefined) {
          patch.theme = record.theme;
        }
        if (isValidDensity(record.density)) {
          patch.density = record.density;
        }
        if (isValidIanaTimezone(record.timezone)) {
          patch.timezone = record.timezone;
        }
        if (isValidDateFormat(record.dateFormat)) {
          patch.dateFormat = record.dateFormat;
        }
      }
    } catch {
      // Ignore malformed legacy localStorage payloads
    }
  }

  return {
    hasLegacyData: Object.keys(patch).length > 0,
    patch,
  };
}

export type InitialPreferenceSyncDecision =
  | {
      action: 'apply_server';
      preferences: UserPreferencesData;
      clearLegacyStorage: boolean;
    }
  | {
      action: 'migrate_legacy';
      migrationPatch: Partial<UserPreferencesData>;
      optimisticPreferences: UserPreferencesData;
      clearLegacyStorage: boolean;
    }
  | {
      action: 'use_defaults';
      preferences: UserPreferencesData;
      clearLegacyStorage: boolean;
    };

export function decideInitialPreferenceSync(input: {
  serverPayload: UserPreferencesPayload;
  legacyTheme: string | null | undefined;
  legacyPrefsJson: string | null | undefined;
}): InitialPreferenceSyncDecision {
  const serverPrefs = sanitizeStoredUserPreferences(
    input.serverPayload.preferences
  );

  if (input.serverPayload.persisted) {
    return {
      action: 'apply_server',
      preferences: serverPrefs,
      clearLegacyStorage: true,
    };
  }

  const legacy = extractValidLegacyLocalStoragePreferences(
    input.legacyTheme,
    input.legacyPrefsJson
  );

  if (legacy.hasLegacyData) {
    return {
      action: 'migrate_legacy',
      migrationPatch: legacy.patch,
      optimisticPreferences: mergePreferencePatch(serverPrefs, legacy.patch),
      clearLegacyStorage: true,
    };
  }

  return {
    action: 'use_defaults',
    preferences: serverPrefs,
    clearLegacyStorage: false,
  };
}

export function formatWorkspaceTimestamp(
  iso: string | Date,
  prefs: Pick<UserPreferencesData, 'timezone' | 'dateFormat'>
): string {
  const date = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const timeZone = isValidIanaTimezone(prefs.timezone)
    ? prefs.timezone
    : DEFAULT_USER_PREFERENCES.timezone;

  if (prefs.dateFormat === 'iso_short') {
    return date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  }

  if (prefs.dateFormat === 'day_month_year') {
    return date.toLocaleString('en-GB', {
      timeZone,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return date.toLocaleString(undefined, {
    timeZone,
  });
}
