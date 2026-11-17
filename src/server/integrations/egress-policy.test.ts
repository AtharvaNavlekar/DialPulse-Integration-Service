import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyFieldSensitivity,
  evaluateDataEgressPolicy,
} from './egress-policy.ts';

test('classifies KYC and banking fields as restricted and strips them by default', () => {
  assert.equal(classifyFieldSensitivity('aadhaar_number'), 'restricted');
  assert.equal(classifyFieldSensitivity('pan_card'), 'restricted');
  assert.equal(classifyFieldSensitivity('bank_statement_url'), 'restricted');
  assert.equal(classifyFieldSensitivity('email'), 'confidential');
  assert.equal(classifyFieldSensitivity('loan_product'), 'internal');

  const res = evaluateDataEgressPolicy({
    payload: {
      full_name: 'Aarav Demo',
      loan_product: 'Home Loan',
      aadhaar_number: '1234-5678-9012',
      pan_card: 'ABCDE1234F',
      unapproved_note: 'Internal only',
    },
    destinationProviderId: 'voice_telephony_approved',
    maxAllowedClassification: 'confidential',
    approvedFieldAllowlist: ['full_name', 'loan_product', 'aadhaar_number'],
    purpose: 'Outbound qualification callback',
    hasPermission: true,
    providerApproved: true,
  });

  assert.equal(res.allowed, true);
  assert.deepEqual(res.sanitizedPayload, {
    full_name: 'Aarav Demo',
    loan_product: 'Home Loan',
  });
  assert.equal(res.blockedFields.length, 3);
  assert.ok(res.blockedFields.some((b) => b.key === 'aadhaar_number'));
  assert.ok(res.blockedFields.some((b) => b.key === 'pan_card'));
  assert.ok(res.blockedFields.some((b) => b.key === 'unapproved_note'));
});

test('denies egress when provider is unapproved or caller lacks permission', () => {
  const unapproved = evaluateDataEgressPolicy({
    payload: { loan_product: 'Home Loan' },
    destinationProviderId: 'voice_telephony_approved',
    maxAllowedClassification: 'confidential',
    approvedFieldAllowlist: ['loan_product'],
    purpose: 'Call trigger',
    hasPermission: true,
    providerApproved: false,
  });
  assert.equal(unapproved.allowed, false);

  const forbidden = evaluateDataEgressPolicy({
    payload: { loan_product: 'Home Loan' },
    destinationProviderId: 'client_crm',
    maxAllowedClassification: 'confidential',
    approvedFieldAllowlist: ['loan_product'],
    purpose: 'Sync lead',
    hasPermission: false,
    providerApproved: true,
  });
  assert.equal(forbidden.allowed, false);
});
