import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAutomationEventId,
  evaluateAllAutomationConditions,
  evaluateAutomationCondition,
  isRetryableAutomationError,
  simulateAutomationDryRun,
} from './automation-engine.ts';
import { createDefaultOrgConfig } from './defaults.ts';

test('evaluates equals, contains, is_present, and is_empty conditions against nested answers', () => {
  const payload = {
    formId: 5,
    answers: {
      full_name: 'Riya Verma (Demo)',
      loan_product: 'Home Loan',
      notes: '',
    },
  };

  assert.equal(
    evaluateAutomationCondition(
      { id: 'c1', fieldKey: 'loan_product', operator: 'equals', value: 'home loan' },
      payload
    ),
    true
  );

  assert.equal(
    evaluateAutomationCondition(
      { id: 'c2', fieldKey: 'full_name', operator: 'contains', value: 'verma' },
      payload
    ),
    true
  );

  assert.equal(
    evaluateAutomationCondition(
      { id: 'c3', fieldKey: 'full_name', operator: 'is_present' },
      payload
    ),
    true
  );

  assert.equal(
    evaluateAutomationCondition(
      { id: 'c4', fieldKey: 'notes', operator: 'is_empty' },
      payload
    ),
    true
  );

  assert.equal(
    evaluateAllAutomationConditions(
      [
        { id: 'c1', fieldKey: 'loan_product', operator: 'equals', value: 'Home Loan' },
        { id: 'c4', fieldKey: 'notes', operator: 'is_empty' },
      ],
      payload
    ),
    true
  );
});

test('builds deterministic automation event IDs for deduplication and classifies retryable errors', () => {
  assert.equal(
    buildAutomationEventId('form_submitted', 'form_submission', 99),
    'form_submitted:form_submission:99'
  );
  assert.equal(isRetryableAutomationError(new Error('Database timeout while inserting')), true);
  assert.equal(isRetryableAutomationError(new Error('Invalid employee ID reference')), false);
});

test('simulates automation dry-run without mutating state and flags invalid org references', () => {
  const org = createDefaultOrgConfig();
  const res = simulateAutomationDryRun(
    [{ id: 'c1', fieldKey: 'loan_product', operator: 'equals', value: 'Home Loan' }],
    [
      { id: 'a1', type: 'assign_lead_employee', config: { employeeId: 'emp-ananya' } },
      { id: 'a2', type: 'assign_lead_queue', config: { queueId: 'missing-queue' } },
    ],
    org,
    { answers: { loan_product: 'Home Loan' } }
  );

  assert.equal(res.wouldExecute, true);
  assert.equal(res.plannedActions[0]?.valid, true);
  assert.equal(res.plannedActions[1]?.valid, false);
  assert.equal(res.warnings.length, 1);
});
