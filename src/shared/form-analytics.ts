import type {
  FormAnalyticsDailyPoint,
  FormAnalyticsFieldStat,
  FormAnalyticsSummary,
  FormFieldDefinition,
} from './types.ts';

function isAnswerFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.length > 0;
  return String(value).trim().length > 0;
}

export function computeFormAnalytics(
  formId: number,
  fields: FormFieldDefinition[],
  submissions: Array<{
    source: string;
    answers: Record<string, unknown>;
    createdAt: Date | string;
  }>,
  referenceDate: Date = new Date()
): FormAnalyticsSummary {
  const totalSubmissions = submissions.length;
  let publicSubmissions = 0;
  let previewSubmissions = 0;
  let lastSubmittedAt: string | null = null;

  const dayBuckets = new Map<string, number>();
  const dayLabels: Array<{ date: string; label: string }> = [];

  for (let i = 6; i >= 0; i--) {
    const d = new Date(referenceDate);
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - i);
    const iso = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
    dayBuckets.set(iso, 0);
    dayLabels.push({ date: iso, label });
  }

  for (const sub of submissions) {
    if (sub.source === 'public_form') publicSubmissions++;
    else previewSubmissions++;

    const createdIso =
      sub.createdAt instanceof Date
        ? sub.createdAt.toISOString()
        : new Date(sub.createdAt).toISOString();

    if (!lastSubmittedAt || createdIso > lastSubmittedAt) {
      lastSubmittedAt = createdIso;
    }

    const dayKey = createdIso.slice(0, 10);
    if (dayBuckets.has(dayKey)) {
      dayBuckets.set(dayKey, (dayBuckets.get(dayKey) ?? 0) + 1);
    }
  }

  const dailyTrend: FormAnalyticsDailyPoint[] = dayLabels.map((item) => ({
    date: item.date,
    label: item.label,
    count: dayBuckets.get(item.date) ?? 0,
  }));

  const fieldStats: FormAnalyticsFieldStat[] = fields.map((field) => {
    let filled = 0;
    for (const sub of submissions) {
      if (isAnswerFilled(sub.answers?.[field.key])) {
        filled++;
      }
    }
    const fillRatePercent =
      totalSubmissions === 0 ? 0 : Math.round((filled / totalSubmissions) * 100);
    return {
      key: field.key,
      label: field.label,
      type: field.type,
      required: field.required,
      responseCount: filled,
      fillRatePercent,
    };
  });

  return {
    formId,
    totalSubmissions,
    publicSubmissions,
    previewSubmissions,
    lastSubmittedAt,
    dailyTrend,
    fieldStats,
  };
}
