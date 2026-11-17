import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { and, eq } from 'drizzle-orm';
import { createApp } from '../../../server.ts';
import { closePool, db } from '../../db/index.ts';
import {
  activityLogs,
  automations,
  eventInbox,
  eventOutbox,
  eventReplayLogs,
  externalIdMappings,
  integrationConnections,
  leadIntakeRecords,
  providerWebhookLogs,
  tenants,
  workspaceOrgConfigs,
} from '../../db/schema.ts';
import { createDefaultOrgConfig } from '../../shared/defaults.ts';
import type { RoleKey } from '../../shared/types.ts';
import { DurableEventWorker } from '../events/event-worker.ts';
import { enqueueOutboxEvent } from '../events/outbox-repository.ts';
import { type AuthRequest, createRequireAuth } from '../middleware/auth.ts';
import { createAutomationsRouter } from '../routes/automations.ts';
import { createIntegrationsRouter } from '../routes/integrations.ts';
import { seedTenantRolePermissions } from '../services/rbac-service.ts';
import {
  ExternalMappingConflictError,
  externalIdMappingService,
} from './external-mappings.ts';
import { EnvDevOnlySecretStore } from './secret-store.ts';
import { computeWebhookHmacSignature } from './webhook-verifier.ts';

let publicServer: Server;
let publicBaseUrl = '';

let adminServer: Server;
let adminBaseUrl = '';

let tenantAId = 0;
let tenantBId = 0;

let activeRoleKey: RoleKey = 'admin';
let activeUserUid = 'test:admin-a';
let activeTenantIds: number[] = [];
let activeManagerCanManageAutomations = true;

const testSecretStore = new EnvDevOnlySecretStore({
  nodeEnv: 'test',
  overrides: {
    TEST_DIALPULSE_WEB_WHSEC: 'whsec_test_dialpulse_web_secret_001',
    TEST_CLIENT_CRM_WHSEC: 'whsec_test_client_crm_secret_002',
  },
});

let fixedClockSeconds = 1_760_000_000;

test.before(async () => {
  const suffix = randomUUID().slice(0, 8);
  const [tenantA] = await db
    .insert(tenants)
    .values({
      slug: `test-int009-a-${suffix}`,
      name: `Integration Tenant A (${suffix})`,
    })
    .returning();
  const [tenantB] = await db
    .insert(tenants)
    .values({
      slug: `test-int009-b-${suffix}`,
      name: `Integration Tenant B (${suffix})`,
    })
    .returning();

  tenantAId = tenantA!.id;
  tenantBId = tenantB!.id;
  activeTenantIds = [tenantAId];

  await db.insert(workspaceOrgConfigs).values([
    { tenantId: tenantAId, config: createDefaultOrgConfig() },
    { tenantId: tenantBId, config: createDefaultOrgConfig() },
  ]);
  await Promise.all([
    seedTenantRolePermissions(tenantAId, 'test:bootstrap'),
    seedTenantRolePermissions(tenantBId, 'test:bootstrap'),
  ]);

  // App 1: Actual server createApp() with raw-body webhook ingress
  const publicApp = createApp({
    webhookOptions: {
      secretStore: testSecretStore,
      nowFn: () => fixedClockSeconds,
      maxReplayWindowSeconds: 300,
    },
  });
  await new Promise<void>((resolve) => {
    publicServer = publicApp.listen(0, '127.0.0.1', () => {
      const addr = publicServer.address() as AddressInfo;
      publicBaseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });

  // App 2: Authenticated API app with real tenant-guard + RBAC middleware
  const authMiddleware = createRequireAuth({
    verifyIdToken: async () =>
      ({
        uid: activeUserUid,
        email: `${activeUserUid}@dialpulse.example`,
        name: 'Integration Test Actor',
      }) as never,
    ensureMemberships: async (uid) => ({
      user: {
        id: 1,
        uid,
        email: `${uid}@dialpulse.example`,
        displayName: 'Integration Test Actor',
        activeTenantId: activeTenantIds[0] ?? tenantAId,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      memberships: activeTenantIds.map((tId) => ({
        tenantId: tId,
        tenantSlug: `tenant-${tId}`,
        tenantName: `Tenant ${tId}`,
        industry: 'Financial Services & Loan DSA',
        roleKey: activeRoleKey,
        departmentName: 'Operations',
      })),
      activeTenantId: activeTenantIds[0] ?? tenantAId,
    }),
  });

  const adminApp = express();
  adminApp.use(express.json({ limit: '1mb' }));
  adminApp.use(
    '/api/integrations',
    createIntegrationsRouter({
      authMiddleware,
      secretStore: testSecretStore,
    })
  );
  adminApp.use(
    '/api/automations',
    createAutomationsRouter((req, res, next) =>
      authMiddleware(req, res, (err?: unknown) => {
        if (err) return next(err);
        const authReq = req as AuthRequest;
        if (authReq.authContext?.activeMembership.roleKey === 'manager') {
          authReq.authContext.permissions.canManageAutomations =
            activeManagerCanManageAutomations;
          if (authReq.authContext.permissions.capabilities) {
            authReq.authContext.permissions.capabilities.canManageAutomations =
              activeManagerCanManageAutomations;
            authReq.authContext.permissions.capabilities.canReplayEvents =
              activeManagerCanManageAutomations;
          }
        }
        next();
      })
    )
  );

  await new Promise<void>((resolve) => {
    adminServer = adminApp.listen(0, '127.0.0.1', () => {
      const addr = adminServer.address() as AddressInfo;
      adminBaseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

test.after(async () => {
  await Promise.all([
    new Promise<void>((resolve) => publicServer.close(() => resolve())),
    new Promise<void>((resolve) => adminServer.close(() => resolve())),
  ]);
  if (tenantAId > 0) await db.delete(tenants).where(eq(tenants.id, tenantAId));
  if (tenantBId > 0) await db.delete(tenants).where(eq(tenants.id, tenantBId));
  await closePool();
});

test('connection lifecycle, tenant isolation, planned-provider activation guard, and bidirectional external_id_mappings uniqueness', async () => {
  activeRoleKey = 'admin';
  activeUserUid = 'test:admin-a';
  activeTenantIds = [tenantAId];

  // 1. Catalog listing works and planned providers stay planned_unapproved
  const catalogRes = await fetch(`${adminBaseUrl}/api/integrations/providers`, {
    headers: { Authorization: 'Bearer test-jwt' },
  });
  assert.equal(catalogRes.status, 200);
  const catalogJson = (await catalogRes.json()) as {
    providers: Array<{ providerId: string; status: string }>;
  };
  assert.equal(
    catalogJson.providers.find((p) => p.providerId === 'voice_telephony_approved')?.status,
    'planned_unapproved'
  );

  // 2. Creating a planned_unapproved connection stays pending and activation fails closed (422)
  const createPlannedRes = await fetch(`${adminBaseUrl}/api/integrations/connections`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-jwt',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      providerId: 'voice_telephony_approved',
      connectionName: 'Planned Telephony Slot',
      authMode: 'api_key_hmac',
      secretRef: {
        provider: 'env_dev_only',
        secretName: 'TEST_DIALPULSE_WEB_WHSEC',
        version: '1',
      },
      allowedScopes: ['calls:initiate', 'calls:webhooks'],
      config: { accountId: 'acct-1' },
      environment: 'development',
    }),
  });
  assert.equal(createPlannedRes.status, 201);
  const plannedJson = (await createPlannedRes.json()) as {
    connection: { id: number; status: string };
  };
  assert.equal(plannedJson.connection.status, 'pending');

  const activatePlannedRes = await fetch(
    `${adminBaseUrl}/api/integrations/connections/${plannedJson.connection.id}/activate`,
    {
      method: 'POST',
      headers: { Authorization: 'Bearer test-jwt' },
    }
  );
  assert.equal(activatePlannedRes.status, 422);

  // 3. Create valid dialpulse_web connection -> verify secretRef masked, no plaintext secret returned
  const createWebRes = await fetch(`${adminBaseUrl}/api/integrations/connections`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-jwt',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      providerId: 'dialpulse_web',
      connectionName: 'DialPulse Web Production Intake',
      authMode: 'webhook_hmac',
      secretRef: {
        provider: 'env_dev_only',
        secretName: 'TEST_DIALPULSE_WEB_WHSEC',
        version: '1',
      },
      allowedScopes: ['intake:submit'],
      config: { allowedOrigins: ['https://dialpulse.in'] },
      environment: 'development',
    }),
  });
  assert.equal(createWebRes.status, 201);
  const webConnJson = (await createWebRes.json()) as {
    connection: { id: number; status: string; secretRef: { secretName: string } };
  };
  assert.equal(webConnJson.connection.status, 'pending');
  assert.equal(
    JSON.stringify(webConnJson).includes('whsec_test_dialpulse_web_secret_001'),
    false
  );

  // 4. Tenant B cannot view or activate Tenant A's connection
  activeTenantIds = [tenantBId];
  const crossTenantGet = await fetch(
    `${adminBaseUrl}/api/integrations/connections/${webConnJson.connection.id}`,
    { headers: { Authorization: 'Bearer test-jwt' } }
  );
  assert.equal(crossTenantGet.status, 404);

  // 5. Activate as Tenant A admin
  activeTenantIds = [tenantAId];
  const activateWebRes = await fetch(
    `${adminBaseUrl}/api/integrations/connections/${webConnJson.connection.id}/activate`,
    {
      method: 'POST',
      headers: { Authorization: 'Bearer test-jwt' },
    }
  );
  assert.equal(activateWebRes.status, 200);
  const activatedJson = (await activateWebRes.json()) as {
    connection: { status: string; approvedByUid: string };
  };
  assert.equal(activatedJson.connection.status, 'active');
  assert.equal(activatedJson.connection.approvedByUid, 'test:admin-a');

  // 6. Bidirectional external_id_mappings uniqueness & conflict protection
  const mapping1 = await externalIdMappingService.upsertConnectionMapping({
    tenantId: tenantAId,
    connectionId: webConnJson.connection.id,
    providerId: 'dialpulse_web',
    internalEntityType: 'lead_intake',
    internalEntityId: '9001',
    externalEntityType: 'web_enquiry',
    externalEntityId: 'WEB-EXT-9001',
  });
  assert.equal(mapping1.externalEntityId, 'WEB-EXT-9001');

  const resolvedForward = await externalIdMappingService.resolveByInternal({
    tenantId: tenantAId,
    connectionId: webConnJson.connection.id,
    internalEntityType: 'lead_intake',
    internalEntityId: '9001',
  });
  const resolvedReverse = await externalIdMappingService.resolveByExternal({
    tenantId: tenantAId,
    connectionId: webConnJson.connection.id,
    externalEntityType: 'web_enquiry',
    externalEntityId: 'WEB-EXT-9001',
  });
  assert.equal(resolvedForward?.id, mapping1.id);
  assert.equal(resolvedReverse?.id, mapping1.id);

  // Reject silent reassignment of same externalEntityId to a second internal record
  await assert.rejects(
    externalIdMappingService.upsertConnectionMapping({
      tenantId: tenantAId,
      connectionId: webConnJson.connection.id,
      providerId: 'dialpulse_web',
      internalEntityType: 'lead_intake',
      internalEntityId: '9002',
      externalEntityType: 'web_enquiry',
      externalEntityId: 'WEB-EXT-9001',
    }),
    (err: unknown) => err instanceof ExternalMappingConflictError
  );

  const mappingsApiRes = await fetch(
    `${adminBaseUrl}/api/integrations/mappings?providerId=dialpulse_web`,
    { headers: { Authorization: 'Bearer test-jwt' } }
  );
  assert.equal(mappingsApiRes.status, 200);
  const mappingsApiJson = (await mappingsApiRes.json()) as {
    mappings: Array<{ externalEntityId: string }>;
  };
  assert.equal(mappingsApiJson.mappings.length, 1);
});

test('inbound webhooks enforce raw-body HMAC verification, size/content-type limits, replay protection, deduplication, and worker execution', async () => {
  activeRoleKey = 'admin';
  activeUserUid = 'test:admin-a';
  activeTenantIds = [tenantAId];

  const [conn] = await db
    .insert(integrationConnections)
    .values({
      tenantId: tenantAId,
      providerId: 'dialpulse_web',
      connectionName: `Webhook Ingress Conn ${randomUUID().slice(0, 6)}`,
      status: 'active',
      authMode: 'webhook_hmac',
      secretRef: {
        provider: 'env_dev_only',
        secretName: 'TEST_DIALPULSE_WEB_WHSEC',
        version: '1',
      },
      allowedScopes: ['intake:submit'],
      config: {},
      environment: 'development',
      approvedByUid: 'test:admin-a',
      approvedAt: new Date(),
    })
    .returning();

  const endpoint = `${publicBaseUrl}/api/integrations/webhooks/dialpulse_web/${conn!.id}`;
  const validBodyStr = JSON.stringify({
    eventId: 'ext-web-evt-555',
    eventType: 'web_enquiry_submitted',
    data: {
      full_name: 'Priya Deshpande (Webhook)',
      email: 'priya.webhook@example.com',
      phone: '+91 98222 11000',
      loan_product: 'Home Loan',
      externalEnquiryId: 'WEB-ENQ-555',
    },
  });

  // 1. Wrong provider mismatch -> 403
  const mismatchRes = await fetch(
    `${publicBaseUrl}/api/integrations/webhooks/client_crm/${conn!.id}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: validBodyStr,
    }
  );
  assert.equal(mismatchRes.status, 403);

  // 2. Invalid Content-Type -> 415
  const wrongCtRes = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: validBodyStr,
  });
  assert.equal(wrongCtRes.status, 415);

  // 3. Oversized payload (> 256 KB) -> 413
  const hugePayload = JSON.stringify({ eventType: 'web_enquiry_submitted', pad: 'x'.repeat(270 * 1024) });
  const oversizedRes = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: hugePayload,
  });
  assert.equal(oversizedRes.status, 413);

  // 4. Invalid signature -> 401
  const invalidSigRes = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-dialpulse-signature': 'v1=' + 'a'.repeat(64),
      'x-dialpulse-timestamp': String(fixedClockSeconds),
    },
    body: validBodyStr,
  });
  assert.equal(invalidSigRes.status, 401);

  // 5. Expired timestamp (> 300s) -> 401
  const expiredTs = fixedClockSeconds - 305;
  const expiredSig = computeWebhookHmacSignature(
    'whsec_test_dialpulse_web_secret_001',
    expiredTs,
    validBodyStr
  );
  const expiredRes = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-dialpulse-signature': expiredSig,
      'x-dialpulse-timestamp': String(expiredTs),
    },
    body: validBodyStr,
  });
  assert.equal(expiredRes.status, 401);

  // 6. Malformed JSON with valid signature -> 400
  const malformedJson = '{"eventType": "web_enquiry_submitted",';
  const malformedSig = computeWebhookHmacSignature(
    'whsec_test_dialpulse_web_secret_001',
    fixedClockSeconds,
    malformedJson
  );
  const malformedRes = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-dialpulse-signature': malformedSig,
      'x-dialpulse-timestamp': String(fixedClockSeconds),
    },
    body: malformedJson,
  });
  assert.equal(malformedRes.status, 400);

  // 7. Restricted KYC payload rejected -> 400
  const kycBody = JSON.stringify({
    eventType: 'web_enquiry_submitted',
    data: { full_name: 'KYC Test', aadhaar_number: '123456789012' },
  });
  const kycSig = computeWebhookHmacSignature(
    'whsec_test_dialpulse_web_secret_001',
    fixedClockSeconds,
    kycBody
  );
  const kycRes = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-dialpulse-signature': kycSig,
      'x-dialpulse-timestamp': String(fixedClockSeconds),
    },
    body: kycBody,
  });
  assert.equal(kycRes.status, 400);

  // 8. Valid cryptographically-signed webhook -> 202 accepted, durable inbox row created
  const validSig = computeWebhookHmacSignature(
    'whsec_test_dialpulse_web_secret_001',
    fixedClockSeconds,
    validBodyStr
  );
  const acceptedRes = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-dialpulse-signature': validSig,
      'x-dialpulse-timestamp': String(fixedClockSeconds),
      'x-dialpulse-event-id': 'ext-web-evt-555',
    },
    body: validBodyStr,
  });
  assert.equal(acceptedRes.status, 202);
  const acceptedJson = (await acceptedRes.json()) as {
    accepted: boolean;
    duplicate: boolean;
    eventId: string;
    inboxId: number;
  };
  assert.equal(acceptedJson.accepted, true);
  assert.equal(acceptedJson.duplicate, false);

  // 9. Redelivery -> 200 duplicate:true without creating a duplicate inbox row
  const duplicateRes = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-dialpulse-signature': validSig,
      'x-dialpulse-timestamp': String(fixedClockSeconds),
      'x-dialpulse-event-id': 'ext-web-evt-555',
    },
    body: validBodyStr,
  });
  assert.equal(duplicateRes.status, 200);
  const duplicateJson = (await duplicateRes.json()) as {
    accepted: boolean;
    duplicate: boolean;
    inboxId: number;
  };
  assert.equal(duplicateJson.duplicate, true);
  assert.equal(duplicateJson.inboxId, acceptedJson.inboxId);

  // 10. Process via DurableEventWorker -> creates lead_intake_record & external_id_mapping ONCE
  const worker = new DurableEventWorker({
    enabled: false,
    pollIntervalMs: 1000,
    batchSize: 10,
    maxConcurrency: 2,
    leaseDurationMs: 60_000,
  });
  await worker.runSingleCycle({ eventIdFilter: acceptedJson.eventId });
  for (let i = 0; i < 30; i += 1) {
    const [inboxCheck] = await db
      .select()
      .from(eventInbox)
      .where(eq(eventInbox.eventId, acceptedJson.eventId));
    if (inboxCheck?.status === 'succeeded') break;
    await new Promise((r) => setTimeout(r, 150));
    await worker.runSingleCycle({ eventIdFilter: acceptedJson.eventId });
  }

  const leads = await db
    .select()
    .from(leadIntakeRecords)
    .where(
      and(
        eq(leadIntakeRecords.tenantId, tenantAId),
        eq(leadIntakeRecords.idempotencyKey, `webhook:${acceptedJson.eventId}:lead`)
      )
    );
  assert.equal(leads.length, 1);
  assert.equal(leads[0]?.applicantName, 'Priya Deshpande (Webhook)');

  const extMap = await externalIdMappingService.resolveByExternal({
    tenantId: tenantAId,
    connectionId: conn!.id,
    externalEntityType: 'web_enquiry',
    externalEntityId: 'WEB-ENQ-555',
  });
  assert.equal(extMap?.internalEntityId, String(leads[0]!.id));

  // 11. Disable and revoke connection -> webhook rejected (403) & webhook logs contain zero secrets
  const revokeRes = await fetch(
    `${adminBaseUrl}/api/integrations/connections/${conn!.id}/revoke`,
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-jwt',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason: 'Security rotation test' }),
    }
  );
  assert.equal(revokeRes.status, 200);

  const rejectedAfterRevoke = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-dialpulse-signature': validSig,
      'x-dialpulse-timestamp': String(fixedClockSeconds),
    },
    body: validBodyStr,
  });
  assert.equal(rejectedAfterRevoke.status, 403);

  const logsRes = await fetch(
    `${adminBaseUrl}/api/integrations/webhooks/logs?connectionId=${conn!.id}`,
    { headers: { Authorization: 'Bearer test-jwt' } }
  );
  assert.equal(logsRes.status, 200);
  const logsText = await logsRes.text();
  assert.equal(logsText.includes('whsec_test_dialpulse_web_secret_001'), false);
  assert.equal(logsText.includes('123456789012'), false);
});

test('DLQ replay enforces auth (401), RBAC (403), cross-tenant isolation (403), concurrency safety (200+409), audit history, and worker completion', async () => {
  const brokenEmployeeId = `emp-missing-${randomUUID().slice(0, 6)}`;
  const [automation] = await db
    .insert(automations)
    .values({
      tenantId: tenantAId,
      name: 'DLQ Replay Recovery Workflow',
      triggerType: 'lead_created',
      conditions: [],
      actions: [
        {
          id: 'act-assign',
          type: 'assign_lead_employee',
          config: { employeeId: brokenEmployeeId },
        },
      ],
      active: true,
      createdByUid: 'test:admin-a',
    })
    .returning();

  const dlqEventId = `dlq-replay-evt:${randomUUID()}`;
  await enqueueOutboxEvent({
    tenantId: tenantAId,
    eventId: dlqEventId,
    eventType: 'lead_created',
    aggregateType: 'lead_intake',
    aggregateId: '501',
    correlationId: randomUUID(),
    payload: {
      sourceEntityType: 'lead_intake',
      sourceEntityId: 501,
      actorUid: 'test:admin-a',
      actorLabel: 'Test Admin',
      eventPayload: { full_name: 'DLQ Replay Lead', loan_product: 'Home Loan' },
    },
  });

  const worker = new DurableEventWorker({
    enabled: false,
    pollIntervalMs: 1000,
    batchSize: 5,
    maxConcurrency: 2,
    leaseDurationMs: 60_000,
  });

  // Trigger non-retryable dead-letter in inbox
  await worker.runSingleCycle({ eventIdFilter: dlqEventId });
  for (let i = 0; i < 30; i += 1) {
    const [inboxCheck] = await db
      .select()
      .from(eventInbox)
      .where(and(eq(eventInbox.tenantId, tenantAId), eq(eventInbox.eventId, dlqEventId)));
    if (inboxCheck?.status === 'dead_letter') break;
    await new Promise((r) => setTimeout(r, 150));
    await worker.runSingleCycle({ eventIdFilter: dlqEventId });
  }

  const [deadInbox] = await db
    .select()
    .from(eventInbox)
    .where(and(eq(eventInbox.tenantId, tenantAId), eq(eventInbox.eventId, dlqEventId)));
  assert.equal(deadInbox?.status, 'dead_letter');

  const [publishedOutbox] = await db
    .select()
    .from(eventOutbox)
    .where(and(eq(eventOutbox.tenantId, tenantAId), eq(eventOutbox.eventId, dlqEventId)));
  assert.equal(publishedOutbox?.status, 'published');

  // 1. Unauthenticated replay -> 401
  const unauthRes = await fetch(
    `${adminBaseUrl}/api/automations/events/inbox/${deadInbox!.id}/replay`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Unauthenticated attempt' }),
    }
  );
  assert.equal(unauthRes.status, 401);

  // 2. Unauthorized operator role -> 403
  activeRoleKey = 'operator';
  activeUserUid = 'test:operator-a';
  activeTenantIds = [tenantAId];
  const opRes = await fetch(
    `${adminBaseUrl}/api/automations/events/inbox/${deadInbox!.id}/replay`,
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-jwt',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason: 'Operator attempt' }),
    }
  );
  assert.equal(opRes.status, 403);

  // 3. Cross-tenant replay -> 403 (both via x-tenant-id header and cross-tenant row ID)
  activeRoleKey = 'admin';
  activeUserUid = 'test:admin-b';
  activeTenantIds = [tenantBId];
  const crossIdRes = await fetch(
    `${adminBaseUrl}/api/automations/events/inbox/${deadInbox!.id}/replay`,
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-jwt',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason: 'Cross-tenant probe' }),
    }
  );
  assert.equal(crossIdRes.status, 403);

  const crossHeaderRes = await fetch(
    `${adminBaseUrl}/api/automations/events/inbox/${deadInbox!.id}/replay`,
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-jwt',
        'x-tenant-id': String(tenantAId),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason: 'Cross-tenant header' }),
    }
  );
  assert.equal(crossHeaderRes.status, 403);

  // 4. Non-dead-letter event replay rejected -> 409
  activeRoleKey = 'admin';
  activeUserUid = 'test:admin-a';
  activeTenantIds = [tenantAId];
  const nonDlqRes = await fetch(
    `${adminBaseUrl}/api/automations/events/outbox/${publishedOutbox!.id}/replay`,
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-jwt',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason: 'Already published outbox' }),
    }
  );
  assert.equal(nonDlqRes.status, 409);

  // 5. Concurrent replay attempts by authorized admin: exactly ONE succeeds (200) and ONE gets 409
  const [replayR1, replayR2] = await Promise.all([
    fetch(`${adminBaseUrl}/api/automations/events/inbox/${deadInbox!.id}/replay`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-jwt',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason: 'Added missing employee in org config' }),
    }),
    fetch(`${adminBaseUrl}/api/automations/events/inbox/${deadInbox!.id}/replay`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-jwt',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason: 'Duplicate concurrent click' }),
    }),
  ]);
  const statuses = [replayR1.status, replayR2.status].sort((a, b) => a - b);
  assert.deepEqual(statuses, [200, 409]);

  // 6. Original eventId preserved, previous error kept in event_replay_logs, audit logged
  const [requeuedInbox] = await db
    .select()
    .from(eventInbox)
    .where(eq(eventInbox.id, deadInbox!.id));
  assert.equal(requeuedInbox?.eventId, dlqEventId);
  assert.equal(requeuedInbox?.status, 'received');
  assert.equal(requeuedInbox?.replayCount, 1);
  assert.ok(requeuedInbox?.lastError?.includes(brokenEmployeeId));

  const replayLogs = await db
    .select()
    .from(eventReplayLogs)
    .where(eq(eventReplayLogs.eventId, dlqEventId));
  assert.equal(replayLogs.length, 1);
  assert.equal(replayLogs[0]?.replayedByUid, 'test:admin-a');
  assert.equal(replayLogs[0]?.previousStatus, 'dead_letter');
  assert.equal(replayLogs[0]?.previousAttempts, 1);
  assert.ok(replayLogs[0]?.previousLastError?.includes(brokenEmployeeId));

  const auditLogs = await db
    .select()
    .from(activityLogs)
    .where(
      and(
        eq(activityLogs.tenantId, tenantAId),
        eq(activityLogs.action, 'event.dlq_replayed')
      )
    );
  assert.equal(auditLogs.length >= 1, true);

  // 7. Operational listing exposes replay metadata without raw payloads
  const listEventsRes = await fetch(
    `${adminBaseUrl}/api/automations/events?source=inbox`,
    { headers: { Authorization: 'Bearer test-jwt' } }
  );
  assert.equal(listEventsRes.status, 200);
  const listEventsJson = (await listEventsRes.json()) as {
    inbox: Array<Record<string, unknown>>;
  };
  const listed = listEventsJson.inbox.find((e) => e.eventId === dlqEventId);
  assert.ok(listed);
  assert.equal(listed.replayCount, 1);
  assert.equal('payload' in listed, false);

  // 8. Fix the org config to include the employee and run DurableEventWorker -> replayed event succeeds!
  const updatedOrgConfig = createDefaultOrgConfig();
  updatedOrgConfig.employees.push({
    id: brokenEmployeeId,
    name: 'Recovered Employee',
    email: 'recovered@dialpulse.example',
    departmentId: 'dept-acquisition',
    roleKey: 'operator',
    active: true,
  });
  await db
    .update(workspaceOrgConfigs)
    .set({ config: updatedOrgConfig })
    .where(eq(workspaceOrgConfigs.tenantId, tenantAId));

  await worker.runSingleCycle({ eventIdFilter: dlqEventId });
  for (let i = 0; i < 30; i += 1) {
    const [inboxCheck] = await db
      .select()
      .from(eventInbox)
      .where(eq(eventInbox.id, deadInbox!.id));
    if (inboxCheck?.status === 'succeeded') break;
    await new Promise((r) => setTimeout(r, 150));
    await worker.runSingleCycle({ eventIdFilter: dlqEventId });
  }

  const [finalInbox] = await db
    .select()
    .from(eventInbox)
    .where(eq(eventInbox.id, deadInbox!.id));
  assert.equal(finalInbox?.status, 'succeeded');
  assert.equal(finalInbox?.replayCount, 1);

  // Cleanup automation so subsequent tests don't trigger it
  await db.delete(automations).where(eq(automations.id, automation!.id));

  // 9. Outbox DLQ replay by authorized manager (and denial when manager lacks permission)
  const outboxDlqEventId = `dlq-outbox-replay:${randomUUID()}`;
  const enqueuedOutbox = await enqueueOutboxEvent({
    tenantId: tenantAId,
    eventId: outboxDlqEventId,
    eventType: 'task_completed',
    aggregateType: 'follow_up_task',
    aggregateId: '888',
    correlationId: randomUUID(),
    payload: {
      sourceEntityType: 'follow_up_task',
      sourceEntityId: 888,
      actorUid: 'test:admin-a',
      actorLabel: 'Test Admin',
      eventPayload: { taskId: 888, title: 'Outbox Replay Task' },
    },
  });
  await db
    .update(eventOutbox)
    .set({
      status: 'dead_letter',
      attempts: 5,
      lastError: 'Simulated outbox publish failure',
    })
    .where(eq(eventOutbox.id, enqueuedOutbox.record.id));

  activeRoleKey = 'manager';
  activeUserUid = 'test:manager-a';
  activeTenantIds = [tenantAId];
  activeManagerCanManageAutomations = false;
  const deniedMgrRes = await fetch(
    `${adminBaseUrl}/api/automations/events/outbox/${enqueuedOutbox.record.id}/replay`,
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-jwt',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason: 'Manager without permission' }),
    }
  );
  assert.equal(deniedMgrRes.status, 403);

  activeManagerCanManageAutomations = true;
  const allowedMgrRes = await fetch(
    `${adminBaseUrl}/api/automations/events/outbox/${enqueuedOutbox.record.id}/replay`,
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-jwt',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason: 'Authorized manager outbox recovery' }),
    }
  );
  assert.equal(allowedMgrRes.status, 200);

  await worker.runSingleCycle({ eventIdFilter: outboxDlqEventId });
  for (let i = 0; i < 30; i += 1) {
    const [outboxCheck] = await db
      .select()
      .from(eventOutbox)
      .where(eq(eventOutbox.id, enqueuedOutbox.record.id));
    if (outboxCheck?.status === 'published') break;
    await new Promise((r) => setTimeout(r, 150));
    await worker.runSingleCycle({ eventIdFilter: outboxDlqEventId });
  }

  const [finalOutbox] = await db
    .select()
    .from(eventOutbox)
    .where(eq(eventOutbox.id, enqueuedOutbox.record.id));
  assert.equal(finalOutbox?.status, 'published');
  assert.equal(finalOutbox?.replayCount, 1);
});

test('Stage 7 Integration Console APIs enforce RBAC (403 for operator/viewer, read-only connections for manager), pagination, filters, details, audit history, and zero secret/payload leakage', async () => {
  // 1. Operator & Viewer roles are blocked (403) from all Integrations Console endpoints
  for (const deniedRole of ['operator', 'viewer'] as RoleKey[]) {
    activeRoleKey = deniedRole;
    activeUserUid = `test:${deniedRole}-a`;
    activeTenantIds = [tenantAId];

    for (const path of [
      '/api/integrations/overview',
      '/api/integrations/providers',
      '/api/integrations/connections',
      '/api/integrations/mappings',
      '/api/integrations/webhooks/logs',
      '/api/integrations/audit',
      '/api/automations/events',
    ]) {
      const res = await fetch(`${adminBaseUrl}${path}`, {
        headers: { Authorization: 'Bearer test-jwt' },
      });
      assert.equal(res.status, 403, `${deniedRole} should get 403 on ${path}`);
    }
  }

  // 2. Manager with canManageAutomations=true can read Console endpoints, but cannot mutate connections (403)
  activeRoleKey = 'manager';
  activeUserUid = 'test:manager-a';
  activeTenantIds = [tenantAId];
  activeManagerCanManageAutomations = true;

  const mgrOverviewRes = await fetch(`${adminBaseUrl}/api/integrations/overview`, {
    headers: { Authorization: 'Bearer test-jwt' },
  });
  assert.equal(mgrOverviewRes.status, 200);

  const mgrCreateConnRes = await fetch(`${adminBaseUrl}/api/integrations/connections`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-jwt',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      providerId: 'dialpulse_web',
      connectionName: 'Blocked Manager Conn',
      authMode: 'webhook_hmac',
      secretRef: {
        provider: 'env_dev_only',
        secretName: 'TEST_DIALPULSE_WEB_WHSEC',
        version: '1',
      },
      allowedScopes: ['intake:submit'],
      config: {},
      environment: 'development',
    }),
  });
  assert.equal(mgrCreateConnRes.status, 403);

  // 3. Admin Stage 7 Console E2E: overview, providers+secretManager, connection details, filtered logs, mappings, events, combined audit
  activeRoleKey = 'admin';
  activeUserUid = 'test:admin-stage7';
  activeTenantIds = [tenantAId];

  const providersRes = await fetch(`${adminBaseUrl}/api/integrations/providers`, {
    headers: { Authorization: 'Bearer test-jwt' },
  });
  assert.equal(providersRes.status, 200);
  const providersJson = (await providersRes.json()) as {
    providers: Array<{ providerId: string }>;
    secretManager: { gcpSdkInstalled: boolean; statusLabel: string };
    ecosystemAdapters: {
      clientCrm: { contractStatus: string };
      centralCrm: { contractStatus: string };
    };
  };
  assert.equal(providersJson.providers.length, 7);
  assert.equal(providersJson.secretManager.gcpSdkInstalled, true);
  assert.ok(providersJson.secretManager.statusLabel.length > 0);
  assert.equal(
    providersJson.ecosystemAdapters.clientCrm.contractStatus,
    'blocked_pending_api_contract'
  );

  // Create + activate a fresh connection and check 9-section details endpoint
  const createRes = await fetch(`${adminBaseUrl}/api/integrations/connections`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-jwt',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      providerId: 'dialpulse_web',
      connectionName: 'Stage 7 Console Inspection Conn',
      authMode: 'webhook_hmac',
      secretRef: {
        provider: 'env_dev_only',
        secretName: 'TEST_DIALPULSE_WEB_WHSEC',
        version: '1',
      },
      allowedScopes: ['intake:submit'],
      config: { allowedOrigins: ['https://console.dialpulse.example'] },
      environment: 'development',
    }),
  });
  assert.equal(createRes.status, 201);
  const { connection: createdConn } = (await createRes.json()) as {
    connection: { id: number };
  };

  const activateRes = await fetch(
    `${adminBaseUrl}/api/integrations/connections/${createdConn.id}/activate`,
    {
      method: 'POST',
      headers: { Authorization: 'Bearer test-jwt' },
    }
  );
  assert.equal(activateRes.status, 200);

  const detailsRes = await fetch(
    `${adminBaseUrl}/api/integrations/connections/${createdConn.id}/details`,
    { headers: { Authorization: 'Bearer test-jwt' } }
  );
  assert.equal(detailsRes.status, 200);
  const detailsText = await detailsRes.text();
  assert.equal(detailsText.includes('whsec_test_dialpulse_web_secret_001'), false);
  const detailsJson = JSON.parse(detailsText) as {
    connection: { id: number; secretRef: { secretName: string } };
    provider: { providerId: string };
    recentWebhooks: unknown[];
    webhookTotal: number;
    relatedMappings: unknown[];
    auditHistory: Array<{ action: string }>;
  };
  assert.equal(detailsJson.connection.id, createdConn.id);
  assert.equal(detailsJson.provider.providerId, 'dialpulse_web');
  assert.ok(Array.isArray(detailsJson.recentWebhooks));
  assert.ok(Array.isArray(detailsJson.relatedMappings));
  assert.ok(
    detailsJson.auditHistory.some(
      (a) => a.action === 'integration.connection_activated'
    )
  );

  // Filtered webhook logs & pagination + zero raw payloads/signatures
  const webhookLogsRes = await fetch(
    `${adminBaseUrl}/api/integrations/webhooks/logs?providerId=dialpulse_web&verificationOutcome=verified&processingStatus=accepted&limit=5&offset=0`,
    { headers: { Authorization: 'Bearer test-jwt' } }
  );
  assert.equal(webhookLogsRes.status, 200);
  const webhookLogsText = await webhookLogsRes.text();
  assert.equal(webhookLogsText.includes('whsec_test_dialpulse_web_secret_001'), false);
  assert.equal(webhookLogsText.includes('rawPayload'), false);
  const webhookLogsJson = JSON.parse(webhookLogsText) as {
    logs: Array<{ verificationOutcome: string; processingStatus: string }>;
    total: number;
  };
  assert.ok(webhookLogsJson.total >= 1);
  assert.equal(webhookLogsJson.logs[0]?.verificationOutcome, 'verified');

  // Filtered external ID mappings search & pagination
  const mappingsSearchRes = await fetch(
    `${adminBaseUrl}/api/integrations/mappings?search=WEB-EXT-9001&entityType=lead_intake&limit=10&offset=0`,
    { headers: { Authorization: 'Bearer test-jwt' } }
  );
  assert.equal(mappingsSearchRes.status, 200);
  const mappingsSearchJson = (await mappingsSearchRes.json()) as {
    mappings: Array<{ externalEntityId: string }>;
    total: number;
  };
  assert.equal(mappingsSearchJson.total, 1);
  assert.equal(mappingsSearchJson.mappings[0]?.externalEntityId, 'WEB-EXT-9001');

  // Filtered durable events & combined audit history
  const eventsSearchRes = await fetch(
    `${adminBaseUrl}/api/automations/events?source=outbox&eventType=task_completed&limit=10&offset=0`,
    { headers: { Authorization: 'Bearer test-jwt' } }
  );
  assert.equal(eventsSearchRes.status, 200);
  const eventsSearchJson = (await eventsSearchRes.json()) as {
    outbox: Array<Record<string, unknown>>;
    outboxTotal: number;
  };
  assert.ok(eventsSearchJson.outboxTotal >= 1);
  assert.equal('payload' in (eventsSearchJson.outbox[0] ?? {}), false);

  const auditRes = await fetch(
    `${adminBaseUrl}/api/integrations/audit?entryType=all&limit=25&offset=0`,
    { headers: { Authorization: 'Bearer test-jwt' } }
  );
  assert.equal(auditRes.status, 200);
  const auditJson = (await auditRes.json()) as {
    entries: Array<{ entryType: string; action: string }>;
    total: number;
  };
  assert.ok(auditJson.total >= 2);
  assert.ok(auditJson.entries.some((e) => e.entryType === 'replay'));
  assert.ok(auditJson.entries.some((e) => e.entryType === 'activity'));

  const overviewRes = await fetch(`${adminBaseUrl}/api/integrations/overview`, {
    headers: { Authorization: 'Bearer test-jwt' },
  });
  assert.equal(overviewRes.status, 200);
  const overviewJson = (await overviewRes.json()) as {
    providersTotal: number;
    connections: { active: number };
    webhooks: { total: number };
    events: { totalProcessed: number };
    mappingsTotal: number;
  };
  assert.equal(overviewJson.providersTotal, 7);
  assert.ok(overviewJson.connections.active >= 1);
  assert.ok(overviewJson.webhooks.total >= 1);
  assert.ok(overviewJson.events.totalProcessed >= 1);
  assert.ok(overviewJson.mappingsTotal >= 1);
});
