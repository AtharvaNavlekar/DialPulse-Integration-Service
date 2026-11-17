import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildConsoleQueryString,
  canManageConnections,
  canReplayDeadLetters,
  canViewIntegrationsConsole,
  classifyConnectionActionPermissions,
  describeDateRangeWindow,
  mapConnectionStatusTone,
  mapEventStatusTone,
  mapProviderStatusLabel,
  mapWebhookOutcomeTone,
  maskSecretReferenceLabel,
  mergeSortedDurableEvents,
  truncateDigest,
  validatePendingConnectionDraft,
  validateReplaySubmission,
} from './integrations-console.ts';
import type { DurableEventRecord } from './types.ts';

test('RBAC helper functions enforce console, connection management, and DLQ replay gates', () => {
  assert.equal(
    canViewIntegrationsConsole({ canManageSettings: true, canManageAutomations: false }),
    true
  );
  assert.equal(
    canViewIntegrationsConsole({ canManageSettings: false, canManageAutomations: true }),
    true
  );
  assert.equal(
    canViewIntegrationsConsole({ canManageSettings: false, canManageAutomations: false }),
    false
  );

  assert.equal(canManageConnections({ canManageSettings: true }), true);
  assert.equal(canManageConnections({ canManageSettings: false }), false);

  assert.equal(canReplayDeadLetters('admin', { canManageAutomations: true }), true);
  assert.equal(canReplayDeadLetters('manager', { canManageAutomations: true }), true);
  assert.equal(canReplayDeadLetters('manager', { canManageAutomations: false }), false);
  assert.equal(canReplayDeadLetters('operator', { canManageAutomations: true }), false);
  assert.equal(canReplayDeadLetters('viewer', { canManageAutomations: true }), false);
});

test('classifyConnectionActionPermissions prevents activating planned_unapproved or revoked connections', () => {
  const planned = classifyConnectionActionPermissions(
    { status: 'pending', providerId: 'voice_telephony_approved' },
    { status: 'planned_unapproved' },
    true
  );
  assert.equal(planned.canActivate, false);
  assert.ok(planned.activateDisabledReason?.includes('planned_unapproved'));
  assert.equal(planned.canDisable, true);
  assert.equal(planned.canRevoke, true);

  const revoked = classifyConnectionActionPermissions(
    { status: 'revoked', providerId: 'dialpulse_web' },
    { status: 'approved_ready' },
    true
  );
  assert.equal(revoked.canActivate, false);
  assert.equal(revoked.canDisable, false);
  assert.equal(revoked.canRevoke, false);

  const readyPending = classifyConnectionActionPermissions(
    { status: 'pending', providerId: 'dialpulse_web' },
    { status: 'approved_ready' },
    true
  );
  assert.equal(readyPending.canActivate, true);
  assert.equal(readyPending.activateDisabledReason, null);
});

test('validatePendingConnectionDraft blocks sensitive keys, path traversal, and malformed JSON', () => {
  const sensitive = validatePendingConnectionDraft({
    providerId: 'dialpulse_web',
    connectionName: 'Valid Connection',
    authMode: 'webhook_hmac',
    secretProvider: 'gcp_secret_manager',
    secretName: 'projects/dialpulse-prod/secrets/web-whsec',
    secretVersion: 'latest',
    allowedScopesText: 'intake:submit',
    configJsonText: '{"apiKey": "secret-leak"}',
    environment: 'production',
  });
  assert.equal(sensitive.valid, false);
  assert.ok(sensitive.error?.includes('SecretReference'));

  const traversal = validatePendingConnectionDraft({
    providerId: 'dialpulse_web',
    connectionName: 'Valid Connection',
    authMode: 'webhook_hmac',
    secretProvider: 'gcp_secret_manager',
    secretName: 'projects/../secrets/bad',
    secretVersion: '1',
    allowedScopesText: 'intake:submit',
    configJsonText: '{}',
    environment: 'development',
  });
  assert.equal(traversal.valid, false);

  const valid = validatePendingConnectionDraft({
    providerId: 'dialpulse_web',
    connectionName: 'DialPulse Web Intake',
    authMode: 'webhook_hmac',
    secretProvider: 'gcp_secret_manager',
    secretName: 'projects/dialpulse-prod/secrets/web-whsec',
    secretVersion: '2',
    allowedScopesText: 'intake:submit, lead:create',
    configJsonText: '{"allowedOrigins": ["https://dialpulse.in"]}',
    environment: 'production',
  });
  assert.equal(valid.valid, true);
  assert.deepEqual(valid.scopes, ['intake:submit', 'lead:create']);
  assert.deepEqual(valid.parsedConfig, {
    allowedOrigins: ['https://dialpulse.in'],
  });
});

test('validateReplaySubmission requires 3..300 char reason and async confirmation checkbox', () => {
  assert.equal(validateReplaySubmission('ok', true).valid, false);
  assert.equal(validateReplaySubmission('x'.repeat(301), true).valid, false);
  assert.equal(validateReplaySubmission('Fixed missing employee', false).valid, false);

  const ok = validateReplaySubmission('  Fixed org config employee mapping  ', true);
  assert.equal(ok.valid, true);
  assert.equal(ok.trimmedReason, 'Fixed org config employee mapping');
});

test('formatting, query string, sorting, and status tone helpers behave deterministically', () => {
  assert.equal(
    buildConsoleQueryString({ providerId: 'dialpulse_web', offset: 25, empty: '' }),
    '?providerId=dialpulse_web&offset=25'
  );
  assert.equal(
    maskSecretReferenceLabel({
      provider: 'gcp_secret_manager',
      secretName: 'web-secret',
      version: '3',
    }),
    'gcp_secret_manager:web-secret@3'
  );
  assert.equal(truncateDigest('abcdef1234567890', 8), 'abcdef12…');
  assert.equal(mapConnectionStatusTone('active'), 'success');
  assert.equal(mapConnectionStatusTone('revoked'), 'error');
  assert.equal(mapWebhookOutcomeTone('verified'), 'success');
  assert.equal(mapWebhookOutcomeTone('invalid_signature'), 'error');
  assert.equal(mapEventStatusTone('dead_letter'), 'error');
  assert.equal(mapProviderStatusLabel('planned_unapproved').tone, 'warning');

  const events = mergeSortedDurableEvents(
    [
      {
        id: 1,
        source: 'outbox',
        status: 'pending',
        eventType: 'lead_created',
        eventId: 'e1',
        createdAt: '2026-01-01T10:00:00.000Z',
        availableAt: '2026-01-01T10:00:00.000Z',
        attempts: 0,
        maxAttempts: 5,
        lastError: null,
        replayCount: 0,
        lastReplayedAt: null,
        lastReplayedByUid: null,
        lastReplayReason: null,
      },
    ],
    [
      {
        id: 2,
        source: 'inbox',
        status: 'dead_letter',
        eventType: 'web_enquiry_submitted',
        eventId: 'e2',
        createdAt: '2026-01-01T12:00:00.000Z',
        availableAt: '2026-01-01T12:00:00.000Z',
        attempts: 3,
        maxAttempts: 5,
        lastError: 'Failure',
        replayCount: 0,
        lastReplayedAt: null,
        lastReplayedByUid: null,
        lastReplayReason: null,
      } satisfies DurableEventRecord,
    ]
  );
  assert.equal(events[0]?.eventId, 'e2');

  const win = describeDateRangeWindow('24h', new Date('2026-01-02T12:00:00.000Z'));
  assert.equal(win.from, '2026-01-01T12:00:00.000Z');
  assert.equal(win.to, '2026-01-02T12:00:00.000Z');
});
