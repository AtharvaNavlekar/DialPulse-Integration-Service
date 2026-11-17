import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createDefaultOrgConfig } from '../../shared/defaults.ts';
import type {
  ConnectionDetailsPayload,
  DurableEventRecord,
  IntegrationConnectionRecord,
  IntegrationOverviewPayload,
  ProviderCatalogEntry,
  WebhookLogRecord,
} from '../../shared/types.ts';
import { ConnectionDetailsDrawer } from './ConnectionDetailsDrawer.tsx';
import { ConnectionsPanel } from './ConnectionsPanel.tsx';
import { DeadLetterQueuePanel } from './DeadLetterQueuePanel.tsx';
import { EventProcessingPanel } from './EventProcessingPanel.tsx';
import { ExternalMappingsPanel } from './ExternalMappingsPanel.tsx';
import { IntegrationAuditPanel } from './IntegrationAuditPanel.tsx';
import { IntegrationOverviewPanel } from './IntegrationOverviewPanel.tsx';
import { ProviderCatalogPanel } from './ProviderCatalogPanel.tsx';
import { WebhookActivityPanel } from './WebhookActivityPanel.tsx';
import {
  fetchDurableEvents,
  fetchIntegrationOverview,
  fetchWebhookLogs,
  replayDeadLetterEventApi,
  type ApiFetchFn,
} from './integrations-api.ts';

const noop = () => {};
const formatTs = (d: string | Date) => new Date(d).toISOString();
const orgRoles = createDefaultOrgConfig().roles;
const adminPerms = orgRoles.find((r) => r.key === 'admin')!;
const operatorPerms = orgRoles.find((r) => r.key === 'operator')!;
const managerPerms = orgRoles.find((r) => r.key === 'manager')!;

const sampleOverview: IntegrationOverviewPayload = {
  providersTotal: 7,
  connections: {
    total: 2,
    active: 1,
    pending: 1,
    verified: 0,
    disabled: 0,
    revoked: 0,
    error: 0,
  },
  webhooks: {
    total: 5,
    verified: 4,
    rejected: 1,
    processed: 4,
    failed: 1,
    lastReceivedAt: '2026-01-10T10:00:00.000Z',
  },
  events: {
    outboxPending: 0,
    outboxProcessing: 0,
    outboxPublished: 10,
    outboxDeadLetter: 1,
    inboxReceived: 0,
    inboxProcessing: 0,
    inboxSucceeded: 9,
    inboxDeadLetter: 1,
    totalProcessed: 19,
    totalDeadLetter: 2,
    retryableFailures: 3,
    oldestPendingAt: '2026-01-10T09:58:00.000Z',
    oldestPendingAgeSeconds: 120,
    lastSuccessfulProcessedAt: '2026-01-10T10:00:00.000Z',
  },
  mappingsTotal: 3,
  worker: {
    status: 'healthy',
    workerId: 'worker-1',
    enabled: true,
    running: true,
    stopping: false,
    healthy: true,
    pollIntervalMs: 2000,
    maxConcurrency: 3,
    leaseDurationMs: 60000,
    lastPollAt: '2026-01-10T10:00:00.000Z',
    lastSuccessAt: '2026-01-10T10:00:00.000Z',
    lastError: null,
  },
  secretManager: {
    gcpSdkInstalled: true,
    gcpProjectAllowlistCount: 0,
    gcpProjectAllowlist: [],
    hasConfiguredProjectAllowlist: false,
    envDevOnlyAllowed: true,
    runtimeMode: 'development_env_fallback',
    statusLabel: 'Dev/Test Fallback Active · GCP IAM Unconfigured',
    blockerReason:
      'Blocked for GCP Secret Manager until GCP_SECRET_MANAGER_PROJECT_ALLOWLIST and GCP Secret Manager IAM permissions are configured.',
  },
  ecosystemAdapters: {
    clientCrm: {
      providerId: 'client_crm',
      mode: 'mock_adapter',
      contractStatus: 'blocked_pending_api_contract',
      missingContractDetails: ['Confirmed Client CRM REST API contract required.'],
    },
    centralCrm: {
      providerId: 'central_crm',
      mode: 'mock_adapter',
      contractStatus: 'blocked_pending_api_contract',
      missingContractDetails: ['Confirmed Central CRM REST API contract required.'],
    },
  },
};

const sampleProviders: ProviderCatalogEntry[] = [
  {
    providerId: 'dialpulse_web',
    name: 'DialPulse Web',
    category: 'Internal Intake',
    authMethod: 'webhook_hmac',
    requiredScopes: ['intake:submit'],
    capabilities: ['inbound_webhooks'],
    status: 'approved_ready',
    configurationSchema: ['allowedOrigins'],
    webhookSupport: true,
    rateLimitPerMinute: 120,
    maxDataClassification: 'confidential',
    connectionLifecycle: ['pending', 'active', 'disabled', 'revoked'],
    costModelNote: 'Internal module.',
  },
  {
    providerId: 'voice_telephony_approved',
    name: 'Voice Telephony (Planned)',
    category: 'Telephony',
    authMethod: 'api_key_hmac',
    requiredScopes: ['calls:initiate'],
    capabilities: ['call_dispatch'],
    status: 'planned_unapproved',
    configurationSchema: ['accountId'],
    webhookSupport: true,
    rateLimitPerMinute: 60,
    maxDataClassification: 'restricted',
    connectionLifecycle: ['pending'],
    costModelNote: 'Blocked pending vendor contract.',
  },
];

const sampleConnection: IntegrationConnectionRecord = {
  id: 42,
  tenantId: 1,
  providerId: 'dialpulse_web',
  connectionName: 'DialPulse Web Primary',
  status: 'active',
  authMode: 'webhook_hmac',
  secretRef: {
    provider: 'gcp_secret_manager',
    secretName: 'projects/dialpulse-prod/secrets/web-whsec',
    version: '1',
  },
  allowedScopes: ['intake:submit'],
  config: { allowedOrigins: ['https://dialpulse.in'] },
  environment: 'production',
  approvedByUid: 'uid-admin',
  approvedAt: '2026-01-10T09:00:00.000Z',
  lastSuccessAt: '2026-01-10T10:00:00.000Z',
  lastErrorAt: null,
  lastErrorSummary: null,
  createdAt: '2026-01-10T08:00:00.000Z',
  updatedAt: '2026-01-10T10:00:00.000Z',
};

const sampleWebhook: WebhookLogRecord = {
  id: 7,
  tenantId: 1,
  connectionId: 42,
  connectionName: 'DialPulse Web Primary',
  providerId: 'dialpulse_web',
  providerEventId: 'evt-web-1',
  eventType: 'web_enquiry_submitted',
  payloadSha256: 'a'.repeat(64),
  verificationOutcome: 'verified',
  processingStatus: 'enqueued',
  httpStatus: 202,
  sanitizedFailureReason: null,
  receivedAt: '2026-01-10T10:00:00.000Z',
  processedAt: '2026-01-10T10:00:01.000Z',
};

const sampleDlqEvent: DurableEventRecord = {
  id: 19,
  source: 'inbox',
  consumerName: 'automation_runner',
  status: 'dead_letter',
  eventType: 'lead_created',
  eventId: 'evt-dlq-19',
  createdAt: '2026-01-10T10:00:00.000Z',
  availableAt: '2026-01-10T10:00:00.000Z',
  attempts: 5,
  maxAttempts: 5,
  lastError: 'Missing assigned employee emp-99',
  replayCount: 0,
  lastReplayedAt: null,
  lastReplayedByUid: null,
  lastReplayReason: null,
};

test('integrations-api forwards filters and endpoints accurately', async () => {
  const calls: Array<{ path: string; options?: RequestInit }> = [];
  const mockFetcher: ApiFetchFn = async <T,>(path: string, options?: RequestInit) => {
    calls.push({ path, options });
    return {} as T;
  };

  await fetchIntegrationOverview(mockFetcher);
  await fetchWebhookLogs(mockFetcher, {
    providerId: 'dialpulse_web',
    verificationOutcome: 'invalid_signature',
    offset: 25,
    limit: 25,
  });
  await fetchDurableEvents(mockFetcher, {
    source: 'inbox',
    status: 'dead_letter',
    search: 'evt-1',
  });
  await replayDeadLetterEventApi(mockFetcher, 'inbox', 19, 'Fixed employee config');

  assert.equal(calls[0]?.path, '/api/integrations/overview');
  assert.ok(calls[1]?.path.includes('/api/integrations/webhooks/logs?'));
  assert.ok(calls[1]?.path.includes('verificationOutcome=invalid_signature'));
  assert.ok(calls[2]?.path.includes('/api/automations/events?'));
  assert.ok(calls[2]?.path.includes('status=dead_letter'));
  assert.equal(calls[3]?.path, '/api/automations/events/inbox/19/replay');
  assert.equal(calls[3]?.options?.method, 'POST');
});

test('IntegrationOverviewPanel renders KPIs, honest blockers, and unavailable retry state', () => {
  const okHtml = renderToStaticMarkup(
    React.createElement(IntegrationOverviewPanel, {
      overview: sampleOverview,
      loading: false,
      error: null,
      onRetry: noop,
      onNavigateTab: noop,
      formatTimestamp: formatTs,
    })
  );
  assert.ok(okHtml.includes('Dead-Letter Queue'));
  assert.ok(okHtml.includes('Blocked · Pending API Contract'));
  assert.ok(okHtml.includes('Dev/Test Fallback Active'));
  assert.ok(okHtml.includes('3 queued for retry'));
  assert.ok(okHtml.includes('2m 0s'));

  const errorHtml = renderToStaticMarkup(
    React.createElement(IntegrationOverviewPanel, {
      overview: null,
      loading: false,
      error: 'Database temporarily unreachable',
      onRetry: noop,
      onNavigateTab: noop,
      formatTimestamp: formatTs,
    })
  );
  assert.ok(errorHtml.includes('Database temporarily unreachable'));
  assert.ok(errorHtml.includes('Retry Overview'));
});

test('ProviderCatalogPanel blocks planned_unapproved creation and restricts non-admins', () => {
  const html = renderToStaticMarkup(
    React.createElement(ProviderCatalogPanel, {
      providers: sampleProviders,
      connections: [sampleConnection],
      ecosystemAdapters: sampleOverview.ecosystemAdapters,
      secretManager: sampleOverview.secretManager,
      permissions: adminPerms,
      loading: false,
      error: null,
      onRetry: noop,
      onCreatePendingForProvider: noop,
    })
  );
  assert.ok(html.includes('DialPulse Web'));
  assert.ok(html.includes('Planned · Activation Blocked'));
  assert.ok(html.includes('Activation blocked: Blocked pending vendor contract.'));

  const managerHtml = renderToStaticMarkup(
    React.createElement(ProviderCatalogPanel, {
      providers: sampleProviders,
      connections: [sampleConnection],
      ecosystemAdapters: sampleOverview.ecosystemAdapters,
      secretManager: sampleOverview.secretManager,
      permissions: managerPerms,
      loading: false,
      error: null,
      onRetry: noop,
      onCreatePendingForProvider: noop,
    })
  );
  assert.ok(managerHtml.includes('requires Workspace Admin settings management permission'));
});

test('ConnectionsPanel and ConnectionDetailsDrawer render masked secret references and all 9 sections', () => {
  const connHtml = renderToStaticMarkup(
    React.createElement(ConnectionsPanel, {
      connections: [sampleConnection],
      providers: sampleProviders,
      permissions: adminPerms,
      loading: false,
      error: null,
      providerFilter: '',
      statusFilter: '',
      createModalProvider: null,
      createModalOpen: false,
      onChangeProviderFilter: noop,
      onChangeStatusFilter: noop,
      onOpenCreateModal: noop,
      onCloseCreateModal: noop,
      onCreatePending: async () => {},
      onActivate: async () => {},
      onDisable: async () => {},
      onRevoke: async () => {},
      onInspect: noop,
      onRetry: noop,
      formatTimestamp: formatTs,
    })
  );
  assert.ok(connHtml.includes('gcp_secret_manager:projects/dialpulse-prod/secrets/web-whsec@1'));

  const detailsPayload: ConnectionDetailsPayload = {
    connection: sampleConnection,
    provider: sampleProviders[0]!,
    recentWebhooks: [sampleWebhook],
    webhookTotal: 1,
    relatedMappings: [],
    auditHistory: [
      {
        id: 1,
        tenantId: 1,
        actorUid: 'uid-admin',
        actorLabel: 'Admin',
        module: 'integration',
        action: 'integration.connection_activated',
        entityType: 'integration_connection',
        entityId: '42',
        summary: 'Activated connection',
        metadata: {},
        createdAt: '2026-01-10T09:00:00.000Z',
      },
    ],
  };

  const drawerHtml = renderToStaticMarkup(
    React.createElement(ConnectionDetailsDrawer, {
      open: true,
      details: detailsPayload,
      loading: false,
      error: null,
      onClose: noop,
      formatTimestamp: formatTs,
    })
  );
  for (let i = 1; i <= 9; i += 1) {
    assert.ok(drawerHtml.includes(`${i}. `));
  }
  assert.ok(drawerHtml.includes('Plaintext secret values are never stored'));
});

test('Webhook, Event, DLQ, Mappings, and Audit panels render operational states and enforce RBAC', () => {
  const webhookHtml = renderToStaticMarkup(
    React.createElement(WebhookActivityPanel, {
      logs: [sampleWebhook],
      total: 1,
      limit: 25,
      offset: 0,
      loading: false,
      error: null,
      filters: {
        providerId: '',
        connectionId: '',
        verificationOutcome: '',
        processingStatus: '',
        eventType: '',
        dateRange: 'all',
      },
      providers: sampleProviders,
      connections: [sampleConnection],
      onChangeFilters: noop,
      onPageChange: noop,
      onRetry: noop,
      formatTimestamp: formatTs,
    })
  );
  assert.ok(webhookHtml.includes('aaaaaaaaaaaaaaaaaaaa'.slice(0, 12)));

  const eventsHtml = renderToStaticMarkup(
    React.createElement(EventProcessingPanel, {
      outbox: [],
      inbox: [sampleDlqEvent],
      outboxTotal: 0,
      inboxTotal: 1,
      limit: 25,
      offset: 0,
      workerHealth: sampleOverview.worker,
      loading: false,
      error: null,
      filters: {
        source: 'all',
        status: 'all',
        consumerName: '',
        eventType: '',
        search: '',
        dateRange: 'all',
      },
      onChangeFilters: noop,
      onPageChange: noop,
      onRefreshWorker: noop,
      onRetry: noop,
      formatTimestamp: formatTs,
    })
  );
  assert.ok(eventsHtml.includes('Durable Outbox / Inbox Worker'));
  assert.ok(eventsHtml.includes('evt-dlq-19'));

  // Operator cannot trigger Replay button
  const opDlqHtml = renderToStaticMarkup(
    React.createElement(DeadLetterQueuePanel, {
      outbox: [],
      inbox: [sampleDlqEvent],
      outboxTotal: 0,
      inboxTotal: 1,
      limit: 25,
      offset: 0,
      loading: false,
      error: null,
      filters: { source: 'all', search: '' },
      roleKey: 'operator',
      permissions: operatorPerms,
      onChangeFilters: noop,
      onPageChange: noop,
      onReplay: async () => {},
      onRetry: noop,
      formatTimestamp: formatTs,
    })
  );
  assert.ok(opDlqHtml.includes('canReplayEvents'));
  assert.ok(opDlqHtml.includes('cannot trigger DLQ replay'));
  assert.equal(opDlqHtml.includes('>Replay<'), false);

  // Operator granted canReplayEvents dynamically CAN trigger Replay button
  const grantedOpDlqHtml = renderToStaticMarkup(
    React.createElement(DeadLetterQueuePanel, {
      outbox: [],
      inbox: [sampleDlqEvent],
      outboxTotal: 0,
      inboxTotal: 1,
      limit: 25,
      offset: 0,
      loading: false,
      error: null,
      filters: { source: 'all', search: '' },
      roleKey: 'operator',
      permissions: {
        ...operatorPerms,
        capabilities: {
          ...operatorPerms.capabilities!,
          canReplayEvents: true,
        },
      },
      onChangeFilters: noop,
      onPageChange: noop,
      onReplay: async () => {},
      onRetry: noop,
      formatTimestamp: formatTs,
    })
  );
  assert.equal(grantedOpDlqHtml.includes('cannot trigger DLQ replay'), false);
  assert.ok(grantedOpDlqHtml.includes('>Replay<'));

  const mappingsHtml = renderToStaticMarkup(
    React.createElement(ExternalMappingsPanel, {
      mappings: [],
      total: 0,
      limit: 25,
      offset: 0,
      loading: false,
      error: null,
      filters: { providerId: '', connectionId: '', entityType: '', search: '' },
      providers: sampleProviders,
      connections: [sampleConnection],
      onChangeFilters: noop,
      onPageChange: noop,
      onRetry: noop,
      formatTimestamp: formatTs,
    })
  );
  assert.ok(mappingsHtml.includes('Read-only operational explorer'));

  const auditHtml = renderToStaticMarkup(
    React.createElement(IntegrationAuditPanel, {
      entries: [],
      total: 0,
      limit: 25,
      offset: 0,
      loading: false,
      error: null,
      filters: { entryType: 'all', search: '', dateRange: 'all' },
      onChangeFilters: noop,
      onPageChange: noop,
      onRetry: noop,
      formatTimestamp: formatTs,
    })
  );
  assert.ok(auditHtml.includes('No integration audit entries match these filters.'));
});
