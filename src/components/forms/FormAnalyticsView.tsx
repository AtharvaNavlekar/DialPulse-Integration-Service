import React from 'react';
import { usePreferences } from '../../context/PreferencesContext.tsx';
import type { FormAnalyticsSummary, FormRecord } from '../../shared/types.ts';
import { Card } from '../ui/Primitives.tsx';

export function FormAnalyticsView({
  form,
  analytics,
  loading,
}: {
  form: FormRecord;
  analytics: FormAnalyticsSummary | null;
  loading: boolean;
}) {
  const { formatTimestamp } = usePreferences();

  if (loading && !analytics) {
    return (
      <Card className="p-8 text-[13px] text-[var(--dp-on-surface-variant)]">
        Computing PostgreSQL submission analytics...
      </Card>
    );
  }

  if (!analytics) {
    return (
      <Card className="p-8 text-[13px] text-[var(--dp-on-surface-variant)]">
        Analytics data unavailable for &ldquo;{form.title}&rdquo;.
      </Card>
    );
  }

  const maxDayCount = Math.max(
    1,
    ...analytics.dailyTrend.map((point) => point.count)
  );
  const publicPct =
    analytics.totalSubmissions > 0
      ? Math.round((analytics.publicSubmissions / analytics.totalSubmissions) * 100)
      : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-5">
          <div className="text-[12px] font-medium text-[var(--dp-on-surface-variant)]">
            Total Submissions
          </div>
          <div className="mt-2 font-heading text-[24px] font-semibold text-[var(--dp-on-surface)] tabular-nums">
            {analytics.totalSubmissions}
          </div>
          <p className="text-[12px] text-[var(--dp-on-surface-variant)] mt-1">
            Stored in Cloud SQL PostgreSQL
          </p>
        </Card>

        <Card className="p-5">
          <div className="text-[12px] font-medium text-[var(--dp-on-surface-variant)]">
            Public Form Share
          </div>
          <div className="mt-2 font-heading text-[24px] font-semibold text-[var(--dp-primary)] tabular-nums">
            {analytics.publicSubmissions} ({publicPct}%)
          </div>
          <p className="text-[12px] text-[var(--dp-on-surface-variant)] mt-1">
            Via /f/{form.slug}
          </p>
        </Card>

        <Card className="p-5">
          <div className="text-[12px] font-medium text-[var(--dp-on-surface-variant)]">
            Preview Test Runs
          </div>
          <div className="mt-2 font-heading text-[24px] font-semibold text-[var(--dp-on-surface)] tabular-nums">
            {analytics.previewSubmissions}
          </div>
          <p className="text-[12px] text-[var(--dp-on-surface-variant)] mt-1">
            Internal QA submissions
          </p>
        </Card>

        <Card className="p-5">
          <div className="text-[12px] font-medium text-[var(--dp-on-surface-variant)]">
            Last Submission
          </div>
          <div className="mt-2 font-mono text-[14px] font-semibold text-[var(--dp-on-surface)] tabular-nums">
            {analytics.lastSubmittedAt
              ? formatTimestamp(analytics.lastSubmittedAt)
              : 'None yet'}
          </div>
          <p className="text-[12px] text-[var(--dp-on-surface-variant)] mt-1">
            {form.fields.length} active fields
          </p>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <Card className="lg:col-span-5 p-5 space-y-4">
          <div>
            <h2 className="text-[16px] font-semibold text-[var(--dp-on-surface)]">
              7-Day Submission Activity
            </h2>
            <p className="text-[12px] text-[var(--dp-on-surface-variant)]">
              Daily volume recorded for &ldquo;{form.title}&rdquo;
            </p>
          </div>
          <div className="space-y-3">
            {analytics.dailyTrend.map((day) => {
              const pct =
                day.count === 0
                  ? 0
                  : Math.max(6, Math.round((day.count / maxDayCount) * 100));
              return (
                <div
                  key={day.date}
                  className="grid grid-cols-12 items-center gap-3 text-[12px]"
                >
                  <div className="col-span-3 font-mono text-[var(--dp-on-surface-variant)] tabular-nums">
                    {day.label}
                  </div>
                  <div className="col-span-7 h-5 bg-[var(--dp-surface-container)] rounded-[var(--dp-radius-sm)] overflow-hidden">
                    <div
                      style={{ width: `${pct}%` }}
                      className="h-full bg-[var(--dp-primary)] rounded-[var(--dp-radius-sm)] transition-all duration-150"
                    />
                  </div>
                  <div className="col-span-2 text-right font-mono font-semibold text-[var(--dp-on-surface)] tabular-nums">
                    {day.count}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="lg:col-span-7 overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--dp-outline-variant)]">
            <h2 className="text-[16px] font-semibold text-[var(--dp-on-surface)]">
              Field Completion Coverage
            </h2>
            <p className="text-[12px] text-[var(--dp-on-surface-variant)]">
              Percentage of submissions containing a non-empty answer per field
            </p>
          </div>
          {analytics.fieldStats.length === 0 ? (
            <div className="p-8 text-center text-[13px] text-[var(--dp-on-surface-variant)]">
              No fields configured on this form.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <thead className="bg-[var(--dp-surface-container-low)] border-b border-[var(--dp-outline-variant)] text-[var(--dp-on-surface-variant)]">
                  <tr>
                    <th className="py-2.5 px-4 font-medium">Field</th>
                    <th className="py-2.5 px-4 font-medium">Type</th>
                    <th className="py-2.5 px-4 font-medium text-right">Answered</th>
                    <th className="py-2.5 px-4 font-medium text-right">Fill Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--dp-outline-variant)]">
                  {analytics.fieldStats.map((fs) => (
                    <tr key={fs.key}>
                      <td className="py-2.5 px-4 font-medium text-[var(--dp-on-surface)]">
                        {fs.label}
                        {fs.required && (
                          <span className="text-[var(--dp-error)] ml-1">*</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-[11px] text-[var(--dp-on-surface-variant)]">
                        {fs.type}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-[var(--dp-on-surface)]">
                        {fs.responseCount} / {analytics.totalSubmissions}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono font-semibold tabular-nums text-[var(--dp-primary)]">
                        {fs.fillRatePercent}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
