import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFormAnalytics } from './form-analytics.ts';
import type { FormFieldDefinition } from './types.ts';

const FIELDS: FormFieldDefinition[] = [
  { id: '1', key: 'full_name', type: 'short_text', label: 'Full Name', required: true },
  { id: '2', key: 'notes', type: 'long_text', label: 'Notes', required: false },
];

test('computes submission source counts, 7-day trend, and field fill rates', () => {
  const ref = new Date('2026-11-15T12:00:00.000Z');
  const summary = computeFormAnalytics(
    7,
    FIELDS,
    [
      {
        source: 'public_form',
        answers: { full_name: 'Aarav', notes: 'Interested' },
        createdAt: '2026-11-15T09:00:00.000Z',
      },
      {
        source: 'preview_test',
        answers: { full_name: 'Riya', notes: '' },
        createdAt: '2026-11-14T15:00:00.000Z',
      },
    ],
    ref
  );

  assert.equal(summary.totalSubmissions, 2);
  assert.equal(summary.publicSubmissions, 1);
  assert.equal(summary.previewSubmissions, 1);
  assert.equal(summary.lastSubmittedAt, '2026-11-15T09:00:00.000Z');
  assert.equal(summary.dailyTrend.length, 7);
  assert.equal(summary.dailyTrend[6]?.count, 1);
  assert.equal(summary.dailyTrend[5]?.count, 1);
  assert.equal(summary.fieldStats[0]?.fillRatePercent, 100);
  assert.equal(summary.fieldStats[1]?.fillRatePercent, 50);
});
