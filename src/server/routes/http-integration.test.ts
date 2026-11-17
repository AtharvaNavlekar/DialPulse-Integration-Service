import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { and, eq } from 'drizzle-orm';
import { createApp } from '../../../server.ts';
import { closePool, db } from '../../db/index.ts';
import {
  automationActionSteps,
  automationExecutions,
  automations,
  eventInbox,
  eventOutbox,
  followUpTasks,
  formSubmissions,
  forms,
  leadIntakeRecords,
  tenants,
  workspaceOrgConfigs,
} from '../../db/schema.ts';
import { createDefaultOrgConfig, STARTER_ENQUIRY_FIELDS } from '../../shared/defaults.ts';
import { createRequireAuth, requirePermission } from '../middleware/auth.ts';
import { DurableEventWorker } from '../events/event-worker.ts';

let server: Server;
let baseUrl = '';
let testTenantId = 0;
let otherTenantId = 0;
let testFormId = 0;
let testFormSlug = '';

test.before(async () => {
  const uniqueSuffix = randomUUID().slice(0, 8);

  const [tenant] = await db
    .insert(tenants)
    .values({
      slug: `test-http-tenant-${uniqueSuffix}`,
      name: `HTTP Integration Tenant (${uniqueSuffix})`,
      industry: 'Financial Services & Loan DSA',
    })
    .returning();
  testTenantId = tenant!.id;

  const [otherTenant] = await db
    .insert(tenants)
    .values({
      slug: `test-http-other-${uniqueSuffix}`,
      name: `HTTP Other Tenant (${uniqueSuffix})`,
      industry: 'Financial Services & Loan DSA',
    })
    .returning();
  otherTenantId = otherTenant!.id;

  await db.insert(workspaceOrgConfigs).values({
    tenantId: testTenantId,
    config: createDefaultOrgConfig(),
  });

  testFormSlug = `test-http-form-${uniqueSuffix}`;
  const [form] = await db
    .insert(forms)
    .values({
      tenantId: testTenantId,
      slug: testFormSlug,
      title: 'HTTP Integration Enquiry',
      status: 'published',
      fields: STARTER_ENQUIRY_FIELDS,
      createdByUid: 'test:http',
      publishedAt: new Date(),
    })
    .returning();
  testFormId = form!.id;

  await db.insert(automations).values({
    tenantId: testTenantId,
    name: 'HTTP Integration Auto-Route',
    triggerType: 'form_submitted',
    triggerFormId: testFormId,
    conditions: [{ id: 'c1', fieldKey: 'full_name', operator: 'is_present' }],
    actions: [
      { id: 'act-q', type: 'assign_lead_queue', config: { queueId: 'queue-inbound-dsa' } },
      { id: 'act-e', type: 'assign_lead_employee', config: { employeeId: 'emp-ananya' } },
      { id: 'act-t', type: 'create_follow_up_task', config: { taskTitle: 'HTTP QA Callback', dueHours: 4 } },
    ],
    active: true,
    createdByUid: 'test:http',
  });

  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

test.after(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  if (testTenantId > 0) {
    await db.delete(tenants).where(eq(tenants.id, testTenantId));
  }
  if (otherTenantId > 0) {
    await db.delete(tenants).where(eq(tenants.id, otherTenantId));
  }
  await closePool();
});

test('health endpoints report liveness, database readiness, and honest worker state', async () => {
  const liveRes = await fetch(`${baseUrl}/api/health/live`);
  assert.equal(liveRes.status, 200);

  const readyRes = await fetch(`${baseUrl}/api/health/ready`);
  assert.equal(readyRes.status, 200);
  const readyJson = (await readyRes.json()) as { status: string; database: string };
  assert.equal(readyJson.database, 'reachable');

  const workerRes = await fetch(`${baseUrl}/api/health/worker`);
  assert.equal(workerRes.status, 200);
  const workerJson = (await workerRes.json()) as {
    status: string;
    worker: Record<string, unknown>;
  };
  assert.equal(workerJson.status, 'disabled');
  assert.equal('workerId' in workerJson.worker, false);
  assert.equal('lastError' in workerJson.worker, false);

  // Verify stopped, healthy, unhealthy (sanitized), and unreachable DB 503 states
  const stoppedApp = createApp({
    getWorkerHealth: () => ({
      status: 'stopped',
      workerId: 'secret-pid-123',
      enabled: true,
      running: false,
      stopping: false,
      healthy: false,
      pollIntervalMs: 2000,
      maxConcurrency: 3,
      leaseDurationMs: 60000,
      lastPollAt: null,
      lastSuccessAt: null,
      lastError: null,
    }),
    checkDatabase: async () => {
      throw new Error('DB connection refused');
    },
  });
  const stoppedServer = await new Promise<Server>((resolve) => {
    const s = stoppedApp.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const addr = stoppedServer.address() as AddressInfo;
    const readyFailRes = await fetch(`http://127.0.0.1:${addr.port}/api/health/ready`);
    assert.equal(readyFailRes.status, 503);
    const readyFailJson = (await readyFailRes.json()) as { status: string; database: string };
    assert.equal(readyFailJson.database, 'unreachable');

    const stoppedRes = await fetch(`http://127.0.0.1:${addr.port}/api/health/worker`);
    assert.equal(stoppedRes.status, 503);
    const stoppedJson = (await stoppedRes.json()) as { status: string; worker: Record<string, unknown> };
    assert.equal(stoppedJson.status, 'stopped');
    assert.equal('workerId' in stoppedJson.worker, false);
  } finally {
    await new Promise<void>((resolve) => stoppedServer.close(() => resolve()));
  }

  const unhealthyApp = createApp({
    getWorkerHealth: () => ({
      status: 'unhealthy',
      workerId: 'worker-pid-999',
      enabled: true,
      running: true,
      stopping: false,
      healthy: false,
      pollIntervalMs: 2000,
      maxConcurrency: 3,
      leaseDurationMs: 60000,
      lastPollAt: '2026-01-10T10:00:00.000Z',
      lastSuccessAt: null,
      lastError: 'Bearer raw-secret-token postgres://admin:pw@db/prod',
    }),
  });
  const unhealthyServer = await new Promise<Server>((resolve) => {
    const s = unhealthyApp.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const addr = unhealthyServer.address() as AddressInfo;
    const unhealthyRes = await fetch(`http://127.0.0.1:${addr.port}/api/health/worker`);
    assert.equal(unhealthyRes.status, 503);
    const rawText = await unhealthyRes.text();
    const parsed = JSON.parse(rawText) as { status: string; worker: { hasError: boolean } };
    assert.equal(parsed.status, 'unhealthy');
    assert.equal(parsed.worker.hasError, true);
    assert.equal(rawText.includes('worker-pid-999'), false);
    assert.equal(rawText.includes('raw-secret-token'), false);
    assert.equal(rawText.includes('postgres://'), false);
  } finally {
    await new Promise<void>((resolve) => unhealthyServer.close(() => resolve()));
  }
});

test('public submission validates input (400/404), enforces auth (401/403), decouples HTTP 201 from worker, and replays idempotently', async () => {
  // 1. Invalid form payload -> 400
  const invalidRes = await fetch(`${baseUrl}/api/public/forms/${testFormSlug}/submissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers: { full_name: '', email: 'bad' } }),
  });
  assert.equal(invalidRes.status, 400);

  // 2. Non-existent form slug -> 404
  const missingRes = await fetch(`${baseUrl}/api/public/forms/missing-slug-xyz/submissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers: { full_name: 'Missing' } }),
  });
  assert.equal(missingRes.status, 404);

  // 3. Unauthenticated protected workspace / dead-letter routes -> 401
  const unauthOverview = await fetch(`${baseUrl}/api/workspace/overview`);
  assert.equal(unauthOverview.status, 401);
  const unauthEvents = await fetch(`${baseUrl}/api/automations/events`);
  assert.equal(unauthEvents.status, 401);
  const unauthReplay = await fetch(`${baseUrl}/api/automations/events/inbox/1/replay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'Unauthorized attempt' }),
  });
  assert.equal(unauthReplay.status, 401);

  // 4. Tenant boundary violation -> 403
  const guardedApp = express();
  guardedApp.use(
    createRequireAuth({
      verifyIdToken: async () => ({ uid: 'u-http-1', email: 'u@example.com' }) as never,
      ensureMemberships: async () => ({
        user: {
          id: 1,
          uid: 'u-http-1',
          email: 'u@example.com',
          displayName: 'User One',
          activeTenantId: testTenantId,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        memberships: [
          {
            tenantId: testTenantId,
            tenantSlug: 'test',
            tenantName: 'Test',
            industry: 'Financial Services',
            roleKey: 'operator',
            departmentName: 'Ops',
          },
        ],
        activeTenantId: testTenantId,
      }),
    })
  );
  guardedApp.get('/guarded', requirePermission('canManageAutomations'), (_req, res) => {
    res.json({ ok: true });
  });
  const guardedServer = await new Promise<Server>((resolve) => {
    const s = guardedApp.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const gAddr = guardedServer.address() as AddressInfo;
    const crossTenantRes = await fetch(`http://127.0.0.1:${gAddr.port}/guarded`, {
      headers: {
        Authorization: 'Bearer mock-jwt',
        'x-tenant-id': String(otherTenantId),
      },
    });
    assert.equal(crossTenantRes.status, 403);
  } finally {
    await new Promise<void>((resolve) => guardedServer.close(() => resolve()));
  }

  // 5. Valid public submission commits form_submissions + event_outbox BEFORE any worker runs
  const idemKey = `http-idem-${randomUUID()}`;
  const validPayload = {
    idempotencyKey: idemKey,
    answers: {
      full_name: 'Neha Kulkarni (HTTP Test)',
      email: 'neha.http@example.com',
      phone: '+91 98111 22334',
      loan_product: 'Home Loan',
      requested_amount_lakhs: 35,
      callback_consent: true,
    },
  };

  const acceptRes = await fetch(`${baseUrl}/api/public/forms/${testFormSlug}/submissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(validPayload),
  });
  assert.equal(acceptRes.status, 201);
  const acceptJson = (await acceptRes.json()) as {
    submissionId: number;
    accepted: boolean;
    eventId: string;
  };
  assert.equal(acceptJson.accepted, true);

  // Before worker finishes (or if background dev worker is running), verify outbox exists and HTTP 201 did not execute synchronously when still pending
  const [outboxAfterPost] = await db
    .select()
    .from(eventOutbox)
    .where(eq(eventOutbox.eventId, acceptJson.eventId));
  assert.ok(outboxAfterPost);
  if (outboxAfterPost.status === 'pending') {
    const execBeforeWorker = await db
      .select()
      .from(automationExecutions)
      .where(eq(automationExecutions.eventId, acceptJson.eventId));
    assert.equal(execBeforeWorker.length, 0);
  }

  // 6. Replay exact same idempotencyKey -> 200 duplicate:true without creating new outbox/submission rows
  const replayRes = await fetch(`${baseUrl}/api/public/forms/${testFormSlug}/submissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(validPayload),
  });
  assert.equal(replayRes.status, 200);
  const replayJson = (await replayRes.json()) as { duplicate: boolean };
  assert.equal(replayJson.duplicate, true);

  const subRows = await db
    .select()
    .from(formSubmissions)
    .where(
      and(
        eq(formSubmissions.formId, testFormId),
        eq(formSubmissions.idempotencyKey, idemKey)
      )
    );
  assert.equal(subRows.length, 1);

  // 7. Run worker asynchronously after HTTP 201 -> event publishes -> inbox succeeds -> steps/lead/task created once
  const worker = new DurableEventWorker({
    enabled: false,
    pollIntervalMs: 1000,
    batchSize: 5,
    maxConcurrency: 2,
    leaseDurationMs: 60_000,
  });
  await worker.runSingleCycle({ eventIdFilter: acceptJson.eventId });

  // Wait briefly in case a concurrent background dev worker was mid-lease on the same event
  for (let i = 0; i < 30; i += 1) {
    const [inboxCheck] = await db
      .select()
      .from(eventInbox)
      .where(eq(eventInbox.eventId, acceptJson.eventId));
    if (inboxCheck?.status === 'succeeded') break;
    await new Promise((r) => setTimeout(r, 150));
    await worker.runSingleCycle({ eventIdFilter: acceptJson.eventId });
  }

  const [publishedOutbox] = await db
    .select()
    .from(eventOutbox)
    .where(eq(eventOutbox.eventId, acceptJson.eventId));
  const [succeededInbox] = await db
    .select()
    .from(eventInbox)
    .where(eq(eventInbox.eventId, acceptJson.eventId));
  const [execution] = await db
    .select()
    .from(automationExecutions)
    .where(eq(automationExecutions.eventId, acceptJson.eventId));
  const steps = await db
    .select()
    .from(automationActionSteps)
    .where(eq(automationActionSteps.automationExecutionId, execution!.id));
  const leads = await db
    .select()
    .from(leadIntakeRecords)
    .where(eq(leadIntakeRecords.sourceSubmissionId, acceptJson.submissionId));
  const tasks = await db
    .select()
    .from(followUpTasks)
    .where(eq(followUpTasks.leadIntakeId, leads[0]!.id));

  assert.equal(publishedOutbox?.status, 'published');
  assert.equal(succeededInbox?.status, 'succeeded');
  assert.equal(execution?.status, 'succeeded');
  assert.equal(steps.length, 3);
  assert.equal(steps.every((s) => s.status === 'succeeded'), true);
  assert.equal(leads.length, 1);
  assert.equal(tasks.length, 1);
});

test('HTTP DLQ listing, replay RBAC (403), cross-tenant isolation (403), safe replay, and PostgreSQL overview metrics', async () => {
  const { createAutomationsRouter } = await import('./automations.ts');
  const { createIntegrationsRouter } = await import('./integrations.ts');
  const { AUTOMATION_CONSUMER_NAME } = await import('../events/event-publisher.ts');

  // Seed:
  // 1) A real form submission + dead-letter inbox event on testTenantId that can be replayed cleanly
  const [replaySub] = await db
    .insert(formSubmissions)
    .values({
      tenantId: testTenantId,
      formId: testFormId,
      idempotencyKey: `http-dlq-sub-${randomUUID()}`,
      source: 'public_form',
      answers: { full_name: 'Replay Applicant', loan_product: 'Home Loan' },
      submitterSummary: 'Replay Applicant',
    })
    .returning();

  const replayableEventId = `http-dlq-replay:${randomUUID()}`;
  const [replayableInbox] = await db
    .insert(eventInbox)
    .values({
      tenantId: testTenantId,
      consumerName: AUTOMATION_CONSUMER_NAME,
      eventId: replayableEventId,
      eventType: 'form_submitted',
      status: 'dead_letter',
      attempts: 5,
      maxAttempts: 5,
      availableAt: new Date(),
      lastError: 'Simulated transient exhaustion before fix',
      payload: {
        correlationId: `corr-replay-${randomUUID()}`,
        sourceEntityType: 'form_submission',
        sourceEntityId: replaySub!.id,
        formId: testFormId,
        actorUid: 'public:customer',
        actorLabel: 'Replay Applicant',
        eventPayload: {
          formId: testFormId,
          answers: { full_name: 'Replay Applicant', loan_product: 'Home Loan' },
        },
      },
    })
    .returning();

  // 2) A retryable outbox event on testTenantId (pending with attempts = 2)
  const retryableOutboxId = `http-retryable:${randomUUID()}`;
  await db.insert(eventOutbox).values({
    tenantId: testTenantId,
    eventId: retryableOutboxId,
    eventType: 'form_submitted',
    aggregateType: 'form_submission',
    aggregateId: '999222',
    correlationId: `corr-ret-${randomUUID()}`,
    payload: { sourceEntityType: 'form_submission', sourceEntityId: 999222 },
    status: 'pending',
    attempts: 2,
    maxAttempts: 5,
    availableAt: new Date(Date.now() + 600_000),
    createdAt: new Date(Date.now() - 45_000),
  });

  // 3) A dead-letter inbox event on otherTenantId (must NEVER leak or be replayable by testTenantId)
  const otherTenantEventId = `http-other-dlq:${randomUUID()}`;
  const [otherInbox] = await db
    .insert(eventInbox)
    .values({
      tenantId: otherTenantId,
      consumerName: AUTOMATION_CONSUMER_NAME,
      eventId: otherTenantEventId,
      eventType: 'form_submitted',
      status: 'dead_letter',
      attempts: 3,
      maxAttempts: 5,
      availableAt: new Date(),
      lastError: 'Other tenant error',
      payload: {},
    })
    .returning();

  const buildAuthStub =
    (roleKey: 'admin' | 'operator'): express.RequestHandler =>
    async (req, _res, next) => {
      const authReq = req as unknown as { authContext: unknown };
      authReq.authContext = {
        user: {
          id: 1,
          uid: `uid-${roleKey}`,
          email: `${roleKey}@example.com`,
          displayName: `HTTP ${roleKey}`,
          activeTenantId: testTenantId,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        activeMembership: {
          tenantId: testTenantId,
          tenantSlug: 'test-http',
          tenantName: 'Test HTTP Tenant',
          industry: 'Financial Services',
          roleKey,
          departmentName: 'Operations',
        },
        memberships: [],
        permissions: createDefaultOrgConfig().roles.find((r) => r.key === roleKey)!,
      };
      next();
    };

  const operatorApp = express();
  operatorApp.use(express.json());
  operatorApp.use('/api/automations', createAutomationsRouter(buildAuthStub('operator')));

  const adminApp = express();
  adminApp.use(express.json());
  adminApp.use('/api/automations', createAutomationsRouter(buildAuthStub('admin')));
  adminApp.use('/api/integrations', createIntegrationsRouter({ authMiddleware: buildAuthStub('admin') }));

  const opServer = await new Promise<Server>((resolve) => {
    const s = operatorApp.listen(0, '127.0.0.1', () => resolve(s));
  });
  const adServer = await new Promise<Server>((resolve) => {
    const s = adminApp.listen(0, '127.0.0.1', () => resolve(s));
  });

  try {
    const opAddr = opServer.address() as AddressInfo;
    const adAddr = adServer.address() as AddressInfo;

    // Operator (without canReplayEvents) gets 403 on replay
    const opReplayRes = await fetch(
      `http://127.0.0.1:${opAddr.port}/api/automations/events/inbox/${replayableInbox!.id}/replay`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Operator replay forbidden' }),
      }
    );
    assert.equal(opReplayRes.status, 403);

    // Admin listing returns testTenantId events only (never otherTenantId)
    const listRes = await fetch(
      `http://127.0.0.1:${adAddr.port}/api/automations/events?status=dead_letter`
    );
    assert.equal(listRes.status, 200);
    const listJson = (await listRes.json()) as {
      inbox: Array<{ id: number; eventId: string }>;
    };
    assert.equal(listJson.inbox.some((e) => e.id === replayableInbox!.id), true);
    assert.equal(listJson.inbox.some((e) => e.id === otherInbox!.id), false);

    // Cross-tenant replay attempt returns 403
    const crossReplayRes = await fetch(
      `http://127.0.0.1:${adAddr.port}/api/automations/events/inbox/${otherInbox!.id}/replay`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Cross tenant replay attempt' }),
      }
    );
    assert.equal(crossReplayRes.status, 403);

    // Authorized admin replay succeeds (200), writes audit log, and re-enqueues safely
    const replayOkRes = await fetch(
      `http://127.0.0.1:${adAddr.port}/api/automations/events/inbox/${replayableInbox!.id}/replay`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Recovered downstream config and replayed cleanly' }),
      }
    );
    assert.equal(replayOkRes.status, 200);
    const replayOkJson = (await replayOkRes.json()) as {
      requeued: boolean;
      status: string;
      replayCount: number;
      replayLogId: number;
    };
    assert.equal(replayOkJson.requeued, true);
    assert.equal(replayOkJson.status, 'received');
    assert.equal(replayOkJson.replayCount, 1);
    assert.ok(replayOkJson.replayLogId > 0);

    // Duplicate replay on non-dead_letter event returns 409
    const duplicateReplayRes = await fetch(
      `http://127.0.0.1:${adAddr.port}/api/automations/events/inbox/${replayableInbox!.id}/replay`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Double replay should conflict' }),
      }
    );
    assert.equal(duplicateReplayRes.status, 409);

    // Worker (or concurrent background dev worker) processes the replayed inbox event cleanly to succeeded
    const worker = new DurableEventWorker({
      enabled: false,
      pollIntervalMs: 1000,
      batchSize: 5,
      maxConcurrency: 1,
      leaseDurationMs: 60_000,
    });
    let replayedRowStatus: string | undefined;
    for (let i = 0; i < 20; i += 1) {
      const [check] = await db
        .select()
        .from(eventInbox)
        .where(eq(eventInbox.id, replayableInbox!.id));
      replayedRowStatus = check?.status;
      if (replayedRowStatus === 'succeeded') break;
      await worker.runSingleCycle({ eventIdFilter: replayableEventId });
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(replayedRowStatus, 'succeeded');

    // Real PostgreSQL observability overview endpoint includes retryableFailures, oldestPendingAgeSeconds, lastSuccessfulProcessedAt
    const overviewRes = await fetch(`http://127.0.0.1:${adAddr.port}/api/integrations/overview`);
    assert.equal(overviewRes.status, 200);
    const overviewJson = (await overviewRes.json()) as {
      events: {
        retryableFailures: number;
        oldestPendingAgeSeconds: number | null;
        lastSuccessfulProcessedAt: string | null;
        totalProcessed: number;
      };
    };
    assert.ok(overviewJson.events.retryableFailures >= 1);
    assert.ok(
      overviewJson.events.oldestPendingAgeSeconds !== null &&
        overviewJson.events.oldestPendingAgeSeconds >= 40
    );
    assert.ok(overviewJson.events.lastSuccessfulProcessedAt !== null);
    assert.ok(overviewJson.events.totalProcessed >= 2);
  } finally {
    await Promise.all([
      new Promise<void>((resolve) => opServer.close(() => resolve())),
      new Promise<void>((resolve) => adServer.close(() => resolve())),
    ]);
  }
});
