import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_AUTOMATION_RETRY_ATTEMPTS,
  buildAutomationEventId,
  isRetryableAutomationError,
  simulateAutomationDryRun,
} from '../../shared/automation-engine.ts';
import { createDefaultOrgConfig } from '../../shared/defaults.ts';

test('skips workflow execution cleanly when conditions are not met', () => {
  const orgConfig = createDefaultOrgConfig();
  const dryRun = simulateAutomationDryRun(
    [{ id: 'c1', fieldKey: 'answers.loan_product', operator: 'equals', value: 'Home Loan' }],
    [
      { id: 'a1', type: 'assign_lead_employee', config: { employeeId: 'emp-ananya' } },
      { id: 'a2', type: 'create_follow_up_task', config: { taskTitle: 'Call back', dueHours: 4 } },
    ],
    orgConfig,
    {
      answers: { full_name: 'Demo Lead', loan_product: 'Personal Loan' },
    }
  );

  assert.equal(dryRun.wouldExecute, false);
  assert.equal(dryRun.conditionResults[0]?.passed, false);
});

test('flags invalid action configuration before execution so partial failures are caught early', () => {
  const orgConfig = createDefaultOrgConfig();
  const dryRun = simulateAutomationDryRun(
    [],
    [
      { id: 'a1', type: 'assign_lead_employee', config: { employeeId: 'emp-nonexistent' } },
      { id: 'a2', type: 'assign_lead_queue', config: { queueId: 'queue-missing' } },
      { id: 'a3', type: 'change_status', config: { targetStatus: 'Invalid Stage' } },
    ],
    orgConfig,
    { answers: { full_name: 'Demo Lead' } }
  );

  assert.equal(dryRun.wouldExecute, true);
  assert.equal(dryRun.plannedActions.every((p) => !p.valid), true);
  assert.equal(dryRun.warnings.length, 3);
});

test('enforces retry classification and deterministic event IDs for duplicate suppression and retry ceilings', () => {
  const firstEventId = buildAutomationEventId('form_submitted', 'form_submission', 42);
  const duplicateEventId = buildAutomationEventId('form_submitted', 'form_submission', 42);
  const nextSubmissionEventId = buildAutomationEventId('form_submitted', 'form_submission', 43);

  assert.equal(firstEventId, duplicateEventId);
  assert.notEqual(firstEventId, nextSubmissionEventId);
  assert.equal(MAX_AUTOMATION_RETRY_ATTEMPTS, 5);
  assert.equal(isRetryableAutomationError(new Error('Database timeout ECONNRESET')), true);
  assert.equal(
    isRetryableAutomationError(new Error('Configured employee does not exist in tenant org config.')),
    false
  );
});
