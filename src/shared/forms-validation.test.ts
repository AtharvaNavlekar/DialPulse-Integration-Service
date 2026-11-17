import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSubmissionsCsv,
  detectRestrictedKycField,
  validateFormFieldsSafety,
  validateSubmissionAnswers,
} from './forms-validation.ts';
import type { FormFieldDefinition } from './types.ts';

const SAMPLE_FIELDS: FormFieldDefinition[] = [
  { id: '1', key: 'full_name', type: 'short_text', label: 'Full Name', required: true, validation: { minLength: 2 } },
  { id: '2', key: 'notes', type: 'long_text', label: 'Notes', required: false },
  { id: '3', key: 'email', type: 'email', label: 'Email', required: true },
  { id: '4', key: 'phone', type: 'phone', label: 'Phone', required: true },
  { id: '5', key: 'amount', type: 'number', label: 'Amount', required: true, validation: { min: 10, max: 500 } },
  { id: '6', key: 'product', type: 'dropdown', label: 'Product', required: true, options: ['Home Loan', 'Business Loan'] },
  { id: '7', key: 'priority', type: 'single_choice', label: 'Priority', required: true, options: ['Normal', 'Urgent'] },
  { id: '8', key: 'channels', type: 'multiple_choice', label: 'Preferred Channels', required: true, options: ['Phone', 'Email'] },
  { id: '9', key: 'callback_date', type: 'date', label: 'Callback Date', required: true },
  { id: '10', key: 'consent', type: 'checkbox', label: 'Consent', required: true },
];

test('detects restricted KYC fields in form builder', () => {
  assert.equal(detectRestrictedKycField({ label: 'Aadhaar Number', key: 'aadhaar_no' }), 'aadhaar');
  assert.equal(detectRestrictedKycField({ label: 'PAN Card Copy', key: 'pan_copy' }), 'pan card');
  assert.equal(detectRestrictedKycField({ label: 'Applicant Name', key: 'full_name' }), null);

  const errors = validateFormFieldsSafety([
    ...SAMPLE_FIELDS,
    { id: '11', key: 'bank_statement', type: 'short_text', label: 'Bank Statement Link', required: false },
  ]);
  assert.equal(errors.length, 1);
  assert.match(errors[0] ?? '', /restricted sensitive\/KYC/i);
});

test('validates all 10 field types and rejects invalid inputs', () => {
  const invalid = validateSubmissionAnswers(SAMPLE_FIELDS, {
    full_name: 'A',
    email: 'not-an-email',
    phone: '12',
    amount: '5',
    product: 'Unknown',
    priority: 'Normal',
    channels: [],
    callback_date: 'not-a-date',
    consent: false,
  });

  assert.equal(invalid.valid, false);
  assert.ok(invalid.fieldErrors.full_name);
  assert.ok(invalid.fieldErrors.email);
  assert.ok(invalid.fieldErrors.phone);
  assert.ok(invalid.fieldErrors.amount);
  assert.ok(invalid.fieldErrors.product);
  assert.ok(invalid.fieldErrors.channels);
  assert.ok(invalid.fieldErrors.callback_date);
  assert.ok(invalid.fieldErrors.consent);

  const valid = validateSubmissionAnswers(SAMPLE_FIELDS, {
    full_name: 'Aarav Demo',
    notes: 'Synthetic test case',
    email: 'aarav.demo@example.com',
    phone: '+91 98111 22334',
    amount: '150',
    product: 'Home Loan',
    priority: 'Normal',
    channels: ['Phone', 'Email'],
    callback_date: '2026-11-20',
    consent: true,
  });

  assert.equal(valid.valid, true);
  assert.equal(valid.sanitizedAnswers.amount, 150);
  assert.deepEqual(valid.sanitizedAnswers.channels, ['Phone', 'Email']);
});

test('CSV export neutralizes formula injection and omits restricted fields', () => {
  const csv = buildSubmissionsCsv(
    [
      { id: '1', key: 'full_name', type: 'short_text', label: 'Full Name', required: true },
      { id: '2', key: 'pan_no', type: 'short_text', label: 'PAN Number', required: false },
    ],
    [
      {
        id: 42,
        source: 'public_form',
        createdAt: '2026-11-15T10:00:00.000Z',
        answers: { full_name: '=CMD|calc', pan_no: 'ABCDE1234F' },
      },
    ]
  );

  assert.ok(!csv.includes('ABCDE1234F'));
  assert.ok(csv.includes("'=CMD|calc"));
});
