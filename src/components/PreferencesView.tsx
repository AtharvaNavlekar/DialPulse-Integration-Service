import React from 'react';
import { RefreshCw, RotateCcw } from 'lucide-react';
import { usePreferences } from '../context/PreferencesContext.tsx';
import { useToast } from '../context/ToastContext.tsx';
import {
  SUPPORTED_TIMEZONES,
  formatWorkspaceTimestamp,
} from '../shared/preferences.ts';
import type {
  PreferenceDateFormat,
  PreferenceDensity,
  ThemeMode,
  UserPreferencesData,
} from '../shared/types.ts';
import {
  AlertBanner,
  Button,
  Card,
  PageHeader,
  SELECT_BASE_CLASS,
  SegmentedControl,
  StatusIndicator,
} from './ui/Primitives.tsx';

export interface PreferencesViewContentProps {
  preferences: UserPreferencesData;
  persisted: boolean;
  updatedAt: string | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  hasFailedPatch: boolean;
  previewIso?: string;
  onUpdate: (patch: Partial<UserPreferencesData>) => void;
  onReset: () => void;
  onRetrySave: () => void;
  onReload: () => void;
}

const PREVIEW_ROWS = [
  {
    id: 'REQ-2041',
    applicant: 'Aarav Sharma',
    stage: 'KYC Verified',
    createdAt: '2026-11-15T09:15:00.000Z',
  },
  {
    id: 'REQ-2042',
    applicant: 'Meera Nair',
    stage: 'Callback Scheduled',
    createdAt: '2026-11-15T14:30:00.000Z',
  },
] as const;

export function PreferencesViewContent({
  preferences,
  persisted,
  updatedAt,
  loading,
  saving,
  error,
  hasFailedPatch,
  previewIso = '2026-11-15T14:30:00.000Z',
  onUpdate,
  onReset,
  onRetrySave,
  onReload,
}: PreferencesViewContentProps) {
  const formattedPreview = formatWorkspaceTimestamp(previewIso, preferences);
  const formattedUpdatedAt = updatedAt
    ? formatWorkspaceTimestamp(updatedAt, preferences)
    : null;
  const previewCellPad =
    preferences.density === 'compact' ? 'py-1.5 px-2.5' : 'py-2.5 px-4';

  const timezoneOptions = SUPPORTED_TIMEZONES.some(
    (tz) => tz.value === preferences.timezone
  )
    ? SUPPORTED_TIMEZONES
    : [
        { value: preferences.timezone, label: preferences.timezone },
        ...SUPPORTED_TIMEZONES,
      ];

  return (
    <div className="space-y-6" data-density={preferences.density}>
      <PageHeader
        title="Workspace Preferences"
        description="Customize your personal display theme, regional timezone, date formatting, and table density. Settings are synced per user account in PostgreSQL."
        actions={
          <div className="flex flex-wrap items-center gap-2.5">
            {loading ? (
              <StatusIndicator tone="info" label="Loading preferences..." />
            ) : saving ? (
              <StatusIndicator tone="info" label="Saving changes..." />
            ) : error ? (
              <StatusIndicator tone="error" label="Sync failed" />
            ) : persisted && formattedUpdatedAt ? (
              <StatusIndicator
                tone="success"
                label={`Synced · ${formattedUpdatedAt}`}
              />
            ) : (
              <StatusIndicator tone="neutral" label="Default profile settings" />
            )}

            <Button
              type="button"
              variant="secondary"
              disabled={loading || saving}
              onClick={onReset}
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              Reset Defaults
            </Button>
          </div>
        }
      />

      {error && (
        <div className="space-y-2.5">
          <AlertBanner tone="error" message={error} />
          <div className="flex flex-wrap items-center gap-2">
            {hasFailedPatch && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={saving || loading}
                onClick={onRetrySave}
              >
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                Retry Save
              </Button>
            )}
            <Button
              type="button"
              variant="tertiary"
              size="sm"
              disabled={saving || loading}
              onClick={onReload}
            >
              Reload Saved Preferences
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <Card className="p-8 text-[13px] text-[var(--dp-on-surface-variant)]">
          Loading saved workspace preferences...
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="p-6 space-y-5">
            <div>
              <h2 className="text-[16px] font-semibold text-[var(--dp-on-surface)]">
                Appearance & Layout
              </h2>
              <p className="text-[12px] text-[var(--dp-on-surface-variant)] mt-0.5">
                Uses the official DialPulse Light and Dark palettes and controls workspace grid spacing.
              </p>
            </div>

            <div className="space-y-2">
              <div className="text-[12px] font-medium text-[var(--dp-on-surface-variant)]">
                Theme Mode
              </div>
              <SegmentedControl<ThemeMode>
                options={[
                  { value: 'light', label: 'Light Mode' },
                  { value: 'dark', label: 'Dark Mode' },
                ]}
                value={preferences.theme}
                onChange={(next) => {
                  if (!saving && next !== preferences.theme) {
                    onUpdate({ theme: next });
                  }
                }}
              />
            </div>

            <div className="space-y-2 pt-1">
              <div className="text-[12px] font-medium text-[var(--dp-on-surface-variant)]">
                Data Grid Density
              </div>
              <SegmentedControl<PreferenceDensity>
                options={[
                  { value: 'comfortable', label: 'Comfortable' },
                  { value: 'compact', label: 'Compact' },
                ]}
                value={preferences.density}
                onChange={(next) => {
                  if (!saving && next !== preferences.density) {
                    onUpdate({ density: next });
                  }
                }}
              />
            </div>

            <div className="pt-2 space-y-2">
              <div className="text-[11px] font-medium text-[var(--dp-on-surface-variant)]">
                Density Preview ({preferences.density === 'compact' ? 'Compact row height' : 'Comfortable row height'})
              </div>
              <div className="overflow-hidden rounded-[var(--dp-radius-sm)] border border-[var(--dp-outline-variant)]">
                <table className="w-full text-left text-[12px]">
                  <thead className="bg-[var(--dp-surface-container-low)] border-b border-[var(--dp-outline-variant)] text-[var(--dp-on-surface-variant)]">
                    <tr>
                      <th className={`${previewCellPad} font-medium`}>Ref</th>
                      <th className={`${previewCellPad} font-medium`}>Lead</th>
                      <th className={`${previewCellPad} font-medium`}>Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--dp-outline-variant)]">
                    {PREVIEW_ROWS.map((row) => (
                      <tr key={row.id}>
                        <td className={`${previewCellPad} font-mono text-[var(--dp-on-surface-variant)] tabular-nums`}>
                          {row.id}
                        </td>
                        <td className={`${previewCellPad} text-[var(--dp-on-surface)]`}>
                          {row.applicant}
                        </td>
                        <td className={`${previewCellPad} font-mono text-[var(--dp-on-surface-variant)] tabular-nums`}>
                          {formatWorkspaceTimestamp(row.createdAt, preferences)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Card>

          <Card className="p-6 space-y-5">
            <div>
              <h2 className="text-[16px] font-semibold text-[var(--dp-on-surface)]">
                Regional Formatting
              </h2>
              <p className="text-[12px] text-[var(--dp-on-surface-variant)] mt-0.5">
                Applied to submission timestamps, audit logs, notifications, and analytics dates.
              </p>
            </div>

            <div>
              <label
                htmlFor="pref-timezone"
                className="block text-[12px] font-medium text-[var(--dp-on-surface-variant)] mb-1"
              >
                Display Timezone
              </label>
              <select
                id="pref-timezone"
                disabled={saving}
                value={preferences.timezone}
                onChange={(e) => onUpdate({ timezone: e.target.value })}
                className={`${SELECT_BASE_CLASS} w-full`}
              >
                {timezoneOptions.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="pref-dateformat"
                className="block text-[12px] font-medium text-[var(--dp-on-surface-variant)] mb-1"
              >
                Timestamp Format
              </label>
              <select
                id="pref-dateformat"
                disabled={saving}
                value={preferences.dateFormat}
                onChange={(e) =>
                  onUpdate({
                    dateFormat: e.target.value as PreferenceDateFormat,
                  })
                }
                className={`${SELECT_BASE_CLASS} w-full`}
              >
                <option value="locale">System Locale Standard</option>
                <option value="day_month_year">15 Nov 2026, 14:30</option>
                <option value="iso_short">ISO-8601 UTC (2026-11-15 14:30)</option>
              </select>
            </div>

            <div className="p-3.5 rounded-[var(--dp-radius-sm)] bg-[var(--dp-surface-container-low)] border border-[var(--dp-outline-variant)] text-[12px]">
              <span className="text-[var(--dp-on-surface-variant)]">Live Preview: </span>
              <span className="font-mono text-[var(--dp-on-surface)] tabular-nums">
                {formattedPreview}
              </span>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

export function PreferencesView() {
  const {
    preferences,
    persisted,
    updatedAt,
    loading,
    saving,
    error,
    hasFailedPatch,
    updatePreferences,
    resetPreferences,
    retrySave,
    reloadPreferences,
  } = usePreferences();
  const { pushToast } = useToast();

  const handleUpdate = async (patch: Partial<UserPreferencesData>) => {
    const ok = await updatePreferences(patch);
    if (!ok) {
      pushToast('Failed to save workspace preferences.', 'error');
      return;
    }
    if (patch.theme) {
      pushToast(`Saved ${patch.theme} theme preference.`, 'info');
    } else if (patch.density) {
      pushToast(`Saved ${patch.density} display density.`, 'info');
    } else if (patch.timezone) {
      pushToast('Saved timezone preference.', 'info');
    } else if (patch.dateFormat) {
      pushToast('Saved timestamp format preference.', 'info');
    }
  };

  const handleReset = async () => {
    const ok = await resetPreferences();
    if (ok) {
      pushToast('Workspace preferences reset to defaults.', 'info');
    } else {
      pushToast('Failed to reset workspace preferences.', 'error');
    }
  };

  const handleRetrySave = async () => {
    const ok = await retrySave();
    if (ok) {
      pushToast('Workspace preferences saved.', 'info');
    }
  };

  return (
    <PreferencesViewContent
      preferences={preferences}
      persisted={persisted}
      updatedAt={updatedAt}
      loading={loading}
      saving={saving}
      error={error}
      hasFailedPatch={hasFailedPatch}
      onUpdate={(patch) => void handleUpdate(patch)}
      onReset={() => void handleReset()}
      onRetrySave={() => void handleRetrySave()}
      onReload={() => void reloadPreferences()}
    />
  );
}
