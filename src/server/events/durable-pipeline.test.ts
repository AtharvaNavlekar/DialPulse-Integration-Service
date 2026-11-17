import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { closePool, db } from '../../db/index.ts';
import {
  activityLogs,
  automationActionSteps,
  automationExecutions,
  automations,
  eventInbox,
  eventOutbox,
  followUpTasks,
  formSubmissions,
  forms,
  internalNotifications,
  leadIntakeRecords,
  tenants,
  workspaceOrgConfigs,
} from '../../db/schema.ts';
import { createDefaultOrgConfig, STARTER_ENQUIRY_FIELDS } from '../../shared/defaults.ts';
import { processAutomationTriggerEvent } from '../services/automation-runner.ts';
import { publishOutboxBatch } from './event-publisher.ts';
import {
  DurableEventWorker,
  listDeadLetterEventsByTenant,
} from './event-worker.ts';
import {
  claimPendingInboxBatch,
  deliverEventToInbox,
  recoverExpiredInboxLeases,
  scheduleInboxRetryOrDeadLetter,
} from './inbox-repository.ts';
import {
  claimPendingOutboxBatch,
  enqueueOutboxEvent,
  recoverExpiredOutboxLeases,
} from './outbox-repository.ts';

let testTenantId = 0;
let testFormId = 0;

test.before(async () => {
  const uniqueSuffix = randomUUID().slice(0, 8);
  const [tenant] = await db
    .insert(tenants)
    .values({
      slug: `test-wsp-int-007-${uniqueSuffix}`,
      name: `Synthetic Event Test Tenant (${uniqueSuffix})`,
      industry: 'Financial Services & Loan DSA',
    })
    .returning();
  testTenantId = tenant!.id;

  await db.insert(workspaceOrgConfigs).values({
    tenantId: testTenantId,
    config: createDefaultOrgConfig(),
  });

  const [form] = await db
    .insert(forms)
    .values({
      tenantId: testTenantId,
      slug: `test-form-${uniqueSuffix}`,
      title: 'Test Loan Intake Form',
      status: 'published',
      fields: STARTER_ENQUIRY_FIELDS,
      createdByUid: 'test:suite',
      publishedAt: new Date(),
    })
    .returning();
  testFormId = form!.id;
});

test.after(async () => {
  if (testTenantId > 0) {
    await db.delete(tenants).where(eq(tenants.id, testTenantId));
  }
  await closePool();
});

test('outbox transaction commits submission + event atomically, rolls back together, and dedupes concurrent duplicates', async () => {
  const eventId = `test-atomic:${randomUUID()}`;
  const idemKey = `idem-atomic-${randomUUID()}`;

  // 1. Atomic commit succeeds for both records
  const committed = await db.transaction(async (tx) => {
    const [sub] = await tx
      .insert(formSubmissions)
      .values({
        tenantId: testTenantId,
        formId: testFormId,
        idempotencyKey: idemKey,
        source: 'public_form',
        answers: { full_name: 'Test Atomic Applicant' },
        submitterSummary: 'Test Atomic Applicant',
      })
      .returning();

    const outbox = await enqueueOutboxEvent(
      {
        tenantId: testTenantId,
        eventId,
        eventType: 'form_submitted',
        aggregateType: 'form_submission',
        aggregateId: String(sub!.id),
        correlationId: randomUUID(),
        payload: { sourceEntityType: 'form_submission', sourceEntityId: sub!.id },
      },
      tx
    );
    return { subId: sub!.id, outboxId: outbox.record.id };
  });

  assert.ok(committed.subId > 0);
  assert.ok(committed.outboxId > 0);

  // 2. Failed transaction rolls back both submission and outbox event
  const rollbackEventId = `test-rollback:${randomUUID()}`;
  const rollbackIdemKey = `idem-rollback-${randomUUID()}`;
  await assert.rejects(
    db.transaction(async (tx) => {
      const [sub] = await tx
        .insert(formSubmissions)
        .values({
          tenantId: testTenantId,
          formId: testFormId,
          idempotencyKey: rollbackIdemKey,
          source: 'public_form',
          answers: { full_name: 'Rollback Applicant' },
          submitterSummary: 'Rollback Applicant',
        })
        .returning();

      await enqueueOutboxEvent(
        {
          tenantId: testTenantId,
          eventId: rollbackEventId,
          eventType: 'form_submitted',
          aggregateType: 'form_submission',
          aggregateId: String(sub!.id),
          correlationId: randomUUID(),
          payload: {},
        },
        tx
      );
      throw new Error('Simulated crash before commit');
    }),
    /Simulated crash before commit/
  );

  const rolledBackSubs = await db
    .select()
    .from(formSubmissions)
    .where(eq(formSubmissions.idempotencyKey, rollbackIdemKey));
  const rolledBackOutbox = await db
    .select()
    .from(eventOutbox)
    .where(eq(eventOutbox.eventId, rollbackEventId));
  assert.equal(rolledBackSubs.length, 0);
  assert.equal(rolledBackOutbox.length, 0);

  // 3. Concurrent duplicate submissions insert exactly one submission and one outbox event
  const concurrentIdemKey = `idem-concurrent-${randomUUID()}`;
  const results = await Promise.all(
    [1, 2, 3].map(() =>
      db.transaction(async (tx) => {
        const [sub] = await tx
          .insert(formSubmissions)
          .values({
            tenantId: testTenantId,
            formId: testFormId,
            idempotencyKey: concurrentIdemKey,
            source: 'public_form',
            answers: { full_name: 'Concurrent Applicant' },
            submitterSummary: 'Concurrent Applicant',
          })
          .onConflictDoNothing({
            target: [formSubmissions.formId, formSubmissions.idempotencyKey],
          })
          .returning();

        if (!sub) return null;
        await enqueueOutboxEvent(
          {
            tenantId: testTenantId,
            eventId: `concurrent-evt:${sub.id}`,
            eventType: 'form_submitted',
            aggregateType: 'form_submission',
            aggregateId: String(sub.id),
            correlationId: randomUUID(),
            payload: {},
          },
          tx
        );
        return sub.id;
      })
    )
  );

  const winners = results.filter((id) => id !== null);
  assert.equal(winners.length, 1);

  const concSubs = await db
    .select()
    .from(formSubmissions)
    .where(eq(formSubmissions.idempotencyKey, concurrentIdemKey));
  const concOutbox = await db
    .select()
    .from(eventOutbox)
    .where(eq(eventOutbox.eventId, `concurrent-evt:${winners[0]}`));
  assert.equal(concSubs.length, 1);
  assert.equal(concOutbox.length, 1);
});

test('outbox publisher enforces SKIP LOCKED exclusivity, future availability, lease recovery, and single publish', async () => {
  const readyEventId = `test-claim-ready:${randomUUID()}`;
  const futureEventId = `test-claim-future:${randomUUID()}`;
  const now = new Date();
  const future = new Date(now.getTime() + 60_000);

  await enqueueOutboxEvent({
    tenantId: testTenantId,
    eventId: readyEventId,
    eventType: 'form_submitted',
    aggregateType: 'form_submission',
    aggregateId: '101',
    correlationId: randomUUID(),
    payload: { sourceEntityType: 'form_submission', sourceEntityId: 101 },
    availableAt: now,
  });
  await enqueueOutboxEvent({
    tenantId: testTenantId,
    eventId: futureEventId,
    eventType: 'form_submitted',
    aggregateType: 'form_submission',
    aggregateId: '102',
    correlationId: randomUUID(),
    payload: { sourceEntityType: 'form_submission', sourceEntityId: 102 },
    availableAt: future,
  });

  // Future event is NOT eligible yet
  const futureClaim = await claimPendingOutboxBatch({
    workerId: 'worker-A',
    batchSize: 5,
    now,
    eventIdFilter: futureEventId,
  });
  assert.equal(futureClaim.length, 0);

  // Concurrent workers racing to claim readyEventId: only 1 wins
  const [claimA, claimB] = await Promise.all([
    claimPendingOutboxBatch({
      workerId: 'worker-A',
      batchSize: 5,
      now,
      eventIdFilter: readyEventId,
    }),
    claimPendingOutboxBatch({
      workerId: 'worker-B',
      batchSize: 5,
      now,
      eventIdFilter: readyEventId,
    }),
  ]);
  assert.equal(claimA.length + claimB.length, 1);

  // Backdate locked_at to simulate a crashed worker and recover expired lease
  const staleTime = new Date(now.getTime() - 120_000);
  await db
    .update(eventOutbox)
    .set({ lockedAt: staleTime })
    .where(eq(eventOutbox.eventId, readyEventId));

  const recovered = await recoverExpiredOutboxLeases({
    leaseDurationMs: 60_000,
    now,
  });
  assert.equal(recovered.requeued.some((r) => r.eventId === readyEventId), true);

  // Publish readyEventId with a custom no-op consumer and verify status becomes published and never republishes
  let deliveredCount = 0;
  const pub1 = await publishOutboxBatch({
    workerId: 'worker-publisher',
    batchSize: 10,
    leaseDurationMs: 60_000,
    eventIdFilter: readyEventId,
    consumers: [
      {
        name: 'test-noop-consumer',
        eventTypes: ['form_submitted'],
        handler: async () => {
          deliveredCount += 1;
        },
      },
    ],
  });
  assert.equal(pub1.claimed, 1);
  assert.equal(pub1.published, 1);

  const pub2 = await publishOutboxBatch({
    workerId: 'worker-publisher-2',
    batchSize: 10,
    leaseDurationMs: 60_000,
    eventIdFilter: readyEventId,
    consumers: [
      {
        name: 'test-noop-consumer',
        eventTypes: ['form_submitted'],
        handler: async () => {
          deliveredCount += 1;
        },
      },
    ],
  });
  assert.equal(pub2.claimed, 0);
  assert.equal(deliveredCount, 0);
});

test('inbox deduplicates per consumer, allows separate consumers, retries, dead-letters, and recovers expired leases', async () => {
  const eventId = `test-inbox:${randomUUID()}`;

  const d1 = await deliverEventToInbox({
    tenantId: testTenantId,
    consumerName: 'consumer-alpha',
    eventId,
    eventType: 'form_submitted',
    payload: { test: true },
    maxAttempts: 2,
  });
  const d2 = await deliverEventToInbox({
    tenantId: testTenantId,
    consumerName: 'consumer-alpha',
    eventId,
    eventType: 'form_submitted',
    payload: { test: true },
    maxAttempts: 2,
  });
  const dBeta = await deliverEventToInbox({
    tenantId: testTenantId,
    consumerName: 'consumer-beta',
    eventId,
    eventType: 'form_submitted',
    payload: { test: true },
    maxAttempts: 2,
  });

  assert.equal(d1.inserted, true);
  assert.equal(d2.inserted, false);
  assert.equal(d2.record.id, d1.record.id);
  assert.equal(dBeta.inserted, true);
  assert.notEqual(dBeta.record.id, d1.record.id);

  // Attempt 1 fails with retryable error -> returns to 'received'
  const claim1 = await claimPendingInboxBatch({
    consumerName: 'consumer-alpha',
    workerId: 'w1',
    batchSize: 5,
    eventIdFilter: eventId,
  });
  assert.equal(claim1.length, 1);
  const retryOutcome = await scheduleInboxRetryOrDeadLetter({
    id: claim1[0]!.id,
    lockOwner: 'w1',
    attempts: claim1[0]!.attempts,
    maxAttempts: 2,
    error: new Error('Database timeout ECONNRESET'),
    backoffOptions: { baseDelayMs: 50, maxDelayMs: 100, jitterRatio: 0 },
  });
  assert.equal(retryOutcome.status, 'received');

  // Make row immediately available and crash Attempt 2 mid-processing -> lease recovery moves to dead_letter because attempts == maxAttempts (2)
  const futureReady = new Date(Date.now() + 500);
  const claim2 = await claimPendingInboxBatch({
    consumerName: 'consumer-alpha',
    workerId: 'w2',
    batchSize: 5,
    now: futureReady,
    eventIdFilter: eventId,
  });
  assert.equal(claim2.length, 1);
  await db
    .update(eventInbox)
    .set({ lockedAt: new Date(futureReady.getTime() - 120_000) })
    .where(eq(eventInbox.id, claim2[0]!.id));

  const rec = await recoverExpiredInboxLeases({
    leaseDurationMs: 60_000,
    now: futureReady,
  });
  assert.equal(rec.deadLettered.some((r) => r.id === claim2[0]!.id), true);

  const dlq = await listDeadLetterEventsByTenant(testTenantId, { source: 'inbox' });
  assert.equal(dlq.inbox.some((r) => r.eventId === eventId), true);
});

test('automation action steps resume after step 3 failure without repeating steps 1-2 or creating duplicate tasks/notifications', async () => {
  const [automation] = await db
    .insert(automations)
    .values({
      tenantId: testTenantId,
      name: 'Step Idempotency Resume Workflow',
      triggerType: 'form_submitted',
      triggerFormId: testFormId,
      conditions: [{ id: 'c1', fieldKey: 'loan_product', operator: 'equals', value: 'Home Loan' }],
      actions: [
        { id: 'act-q', type: 'assign_lead_queue', config: { queueId: 'queue-inbound-dsa' } },
        { id: 'act-e', type: 'assign_lead_employee', config: { employeeId: 'emp-ananya' } },
        {
          id: 'act-t',
          type: 'create_follow_up_task',
          config: { taskTitle: 'Resume Callback Task', taskPriority: 'high', dueHours: 4 },
        },
        {
          id: 'act-n',
          type: 'send_notification',
          config: { notificationTitle: 'Step Resume Alert', notificationMessage: 'Lead ready' },
        },
      ],
      active: true,
      createdByUid: 'test:suite',
    })
    .returning();

  const [sub1] = await db
    .insert(formSubmissions)
    .values({
      tenantId: testTenantId,
      formId: testFormId,
      idempotencyKey: `step-sub-${randomUUID()}`,
      source: 'public_form',
      answers: {
        full_name: 'Step Test Lead',
        email: 'step.test@example.com',
        phone: '+91 98000 44556',
        loan_product: 'Home Loan',
      },
      submitterSummary: 'Step Test Lead',
    })
    .returning();

  const eventId = `test-step-resume:${randomUUID()}`;
  const baseEvent = {
    tenantId: testTenantId,
    eventId,
    triggerType: 'form_submitted' as const,
    sourceEntityType: 'form_submission',
    sourceEntityId: sub1!.id,
    formId: testFormId,
    actorUid: 'public:customer',
    actorLabel: 'Step Test Lead',
    payload: {
      formId: testFormId,
      answers: {
        full_name: 'Step Test Lead',
        email: 'step.test@example.com',
        phone: '+91 98000 44556',
        loan_product: 'Home Loan',
      },
    },
  };

  // Run 1: fail transiently inside action 3 (stepIndex === 2)
  const executedStepIndicesRun1: number[] = [];
  await assert.rejects(
    processAutomationTriggerEvent(baseEvent, {
      consumerName: 'test-consumer',
      beforeActionExecute: (ctx) => {
        executedStepIndicesRun1.push(ctx.stepIndex);
        if (ctx.stepIndex === 2) {
          throw new Error('Database timeout temporarily unavailable on task step');
        }
      },
    }),
    /temporarily unavailable/
  );
  assert.deepEqual(executedStepIndicesRun1, [0, 1, 2]);

  // Verify execution is marked retrying, steps 0 & 1 are succeeded, step 2 is failed
  const [execAfterRun1] = await db
    .select()
    .from(automationExecutions)
    .where(
      and(
        eq(automationExecutions.automationId, automation!.id),
        eq(automationExecutions.eventId, eventId)
      )
    );
  assert.equal(execAfterRun1!.status, 'retrying');

  const stepsRun1 = await db
    .select()
    .from(automationActionSteps)
    .where(eq(automationActionSteps.automationExecutionId, execAfterRun1!.id));
  assert.equal(stepsRun1.find((s) => s.actionKey === 'step_0:act-q')?.status, 'succeeded');
  assert.equal(stepsRun1.find((s) => s.actionKey === 'step_1:act-e')?.status, 'succeeded');
  const failedStepBeforeRetry = stepsRun1.find((s) => s.actionKey === 'step_2:act-t');
  assert.equal(failedStepBeforeRetry?.status, 'failed');

  // Run 2: resume cleanly — steps 0 and 1 MUST NOT execute again!
  const executedStepIndicesRun2: number[] = [];
  const summary2 = await processAutomationTriggerEvent(baseEvent, {
    consumerName: 'test-consumer',
    beforeActionExecute: (ctx) => {
      executedStepIndicesRun2.push(ctx.stepIndex);
    },
  });
  assert.deepEqual(executedStepIndicesRun2, [2, 3]);
  assert.equal(summary2[0]?.status, 'succeeded');

  // Verify step 2 kept the exact same idempotencyKey and only 1 lead, 1 task, 1 notification exist
  const stepsRun2 = await db
    .select()
    .from(automationActionSteps)
    .where(eq(automationActionSteps.automationExecutionId, execAfterRun1!.id));
  const resumedStep = stepsRun2.find((s) => s.actionKey === 'step_2:act-t');
  assert.equal(resumedStep?.idempotencyKey, failedStepBeforeRetry?.idempotencyKey);
  assert.equal(resumedStep?.attempts, 2);
  assert.equal(stepsRun2.every((s) => s.status === 'succeeded'), true);

  const leads = await db
    .select()
    .from(leadIntakeRecords)
    .where(eq(leadIntakeRecords.idempotencyKey, `exec:${execAfterRun1!.id}:lead`));
  const tasks = await db
    .select()
    .from(followUpTasks)
    .where(eq(followUpTasks.idempotencyKey, failedStepBeforeRetry!.idempotencyKey));
  const notifications = await db
    .select()
    .from(internalNotifications)
    .where(
      eq(
        internalNotifications.idempotencyKey,
        stepsRun2.find((s) => s.actionKey === 'step_3:act-n')!.idempotencyKey
      )
    );
  assert.equal(leads.length, 1);
  assert.equal(tasks.length, 1);
  assert.equal(notifications.length, 1);

  // Condition unmet event creates skipped execution with zero steps/side effects
  const unmetEventId = `test-unmet:${randomUUID()}`;
  const unmetSummary = await processAutomationTriggerEvent({
    ...baseEvent,
    eventId: unmetEventId,
    sourceEntityId: baseEvent.sourceEntityId + 1,
    payload: {
      formId: testFormId,
      answers: { full_name: 'Unmet Lead', loan_product: 'Personal Loan' },
    },
  });
  assert.equal(unmetSummary[0]?.status, 'skipped');

  // Non-retryable bad employee config dead-letters inside DurableEventWorker without 5 retries
  await db.insert(automations).values({
    tenantId: testTenantId,
    name: 'Broken Non-Retryable Workflow',
    triggerType: 'form_submitted',
    triggerFormId: testFormId,
    conditions: [],
    actions: [{ id: 'bad-emp', type: 'assign_lead_employee', config: { employeeId: 'emp-missing' } }],
    active: true,
    createdByUid: 'test:suite',
  });

  const nonRetryableEventId = `test-nonretry:${randomUUID()}`;
  await enqueueOutboxEvent({
    tenantId: testTenantId,
    eventId: nonRetryableEventId,
    eventType: 'form_submitted',
    aggregateType: 'form_submission',
    aggregateId: '888888',
    correlationId: randomUUID(),
    payload: {
      sourceEntityType: 'form_submission',
      sourceEntityId: 888888,
      formId: testFormId,
      actorUid: 'public:customer',
      actorLabel: 'Bad Config Lead',
      eventPayload: {
        formId: testFormId,
        answers: { full_name: 'Bad Config Lead', loan_product: 'Personal Loan' },
      },
    },
  });

  const worker = new DurableEventWorker({
    enabled: false,
    pollIntervalMs: 1000,
    batchSize: 5,
    maxConcurrency: 2,
    leaseDurationMs: 60_000,
  });
  const cycle = await worker.runSingleCycle({ eventIdFilter: nonRetryableEventId });
  assert.ok(cycle.outbox.published <= 1);
  assert.ok(cycle.inbox.deadLettered <= 1);

  for (let i = 0; i < 25; i += 1) {
    const [check] = await db
      .select()
      .from(eventInbox)
      .where(
        and(
          eq(eventInbox.tenantId, testTenantId),
          eq(eventInbox.eventId, nonRetryableEventId)
        )
      );
    if (check?.status === 'dead_letter') break;
    await new Promise((r) => setTimeout(r, 150));
    await worker.runSingleCycle({ eventIdFilter: nonRetryableEventId });
  }

  const [deadInbox] = await db
    .select()
    .from(eventInbox)
    .where(
      and(
        eq(eventInbox.tenantId, testTenantId),
        eq(eventInbox.eventId, nonRetryableEventId)
      )
    );
  assert.equal(deadInbox?.status, 'dead_letter');
  assert.equal(deadInbox?.attempts, 1);

  await db
    .update(automations)
    .set({ active: false })
    .where(
      and(
        eq(automations.tenantId, testTenantId),
        eq(automations.name, 'Broken Non-Retryable Workflow')
      )
    );
});

test('two concurrent DurableEventWorker instances process shared outbox/inbox batch with zero duplicate executions or side effects', async () => {
  const [sub] = await db
    .insert(formSubmissions)
    .values({
      tenantId: testTenantId,
      formId: testFormId,
      idempotencyKey: `multi-worker-sub-${randomUUID()}`,
      source: 'public_form',
      answers: {
        full_name: 'Concurrent Worker Applicant',
        email: 'concurrent.worker@example.com',
        loan_product: 'Home Loan',
      },
      submitterSummary: 'Concurrent Worker Applicant',
    })
    .returning();

  const [workflow] = await db
    .insert(automations)
    .values({
      tenantId: testTenantId,
      name: 'Multi Worker Exclusivity Workflow',
      triggerType: 'form_submitted',
      triggerFormId: testFormId,
      conditions: [{ id: 'c1', fieldKey: 'full_name', operator: 'equals', value: 'Concurrent Worker Applicant' }],
      actions: [
        { id: 'mw-q', type: 'assign_lead_queue', config: { queueId: 'queue-inbound-dsa' } },
        { id: 'mw-t', type: 'create_follow_up_task', config: { taskTitle: 'Multi-worker unique task', dueHours: 2 } },
      ],
      active: true,
      createdByUid: 'test:multiworker',
    })
    .returning();

  const eventId = `test-multiworker:${randomUUID()}`;
  await enqueueOutboxEvent({
    tenantId: testTenantId,
    eventId,
    eventType: 'form_submitted',
    aggregateType: 'form_submission',
    aggregateId: String(sub!.id),
    correlationId: `corr-mw-${randomUUID()}`,
    payload: {
      sourceEntityType: 'form_submission',
      sourceEntityId: sub!.id,
      formId: testFormId,
      actorUid: 'public:customer',
      actorLabel: 'Concurrent Worker Applicant',
      eventPayload: {
        formId: testFormId,
        answers: {
          full_name: 'Concurrent Worker Applicant',
          email: 'concurrent.worker@example.com',
          loan_product: 'Home Loan',
        },
      },
    },
  });

  const workerA = new DurableEventWorker(
    {
      enabled: false,
      pollIntervalMs: 1000,
      batchSize: 5,
      maxConcurrency: 2,
      leaseDurationMs: 60_000,
    },
    { workerId: 'sim-worker-a', allowMultipleInProcess: true }
  );
  const workerB = new DurableEventWorker(
    {
      enabled: false,
      pollIntervalMs: 1000,
      batchSize: 5,
      maxConcurrency: 2,
      leaseDurationMs: 60_000,
    },
    { workerId: 'sim-worker-b', allowMultipleInProcess: true }
  );

  // Two workers race concurrently on the exact same eventIdFilter across cycles (outbox + inbox)
  const [c1A, c1B] = await Promise.all([
    workerA.runSingleCycle({ eventIdFilter: eventId }),
    workerB.runSingleCycle({ eventIdFilter: eventId }),
  ]);
  await Promise.all([
    workerA.runSingleCycle({ eventIdFilter: eventId }),
    workerB.runSingleCycle({ eventIdFilter: eventId }),
  ]);

  assert.ok(c1A.outbox.published + c1B.outbox.published <= 1);

  for (let i = 0; i < 25; i += 1) {
    const [execCheck] = await db
      .select()
      .from(automationExecutions)
      .where(
        and(
          eq(automationExecutions.tenantId, testTenantId),
          eq(automationExecutions.automationId, workflow!.id),
          eq(automationExecutions.eventId, eventId)
        )
      );
    if (execCheck?.status === 'succeeded') break;
    await new Promise((r) => setTimeout(r, 150));
    await workerA.runSingleCycle({ eventIdFilter: eventId });
  }

  const execRows = await db
    .select()
    .from(automationExecutions)
    .where(
      and(
        eq(automationExecutions.tenantId, testTenantId),
        eq(automationExecutions.automationId, workflow!.id),
        eq(automationExecutions.eventId, eventId)
      )
    );
  assert.equal(execRows.length, 1);
  assert.equal(execRows[0]?.status, 'succeeded');

  const leadRows = await db
    .select()
    .from(leadIntakeRecords)
    .where(eq(leadIntakeRecords.idempotencyKey, `exec:${execRows[0]!.id}:lead`));
  const taskRows = await db
    .select()
    .from(followUpTasks)
    .where(eq(followUpTasks.leadIntakeId, leadRows[0]!.id));
  assert.equal(leadRows.length, 1);
  assert.equal(taskRows.length, 1);
});

test('abandoned processing action step recovers cleanly on retry without duplicating prior steps', async () => {
  const [workflow] = await db
    .insert(automations)
    .values({
      tenantId: testTenantId,
      name: 'Abandoned Step Crash Recovery',
      triggerType: 'form_submitted',
      triggerFormId: testFormId,
      conditions: [{ id: 'c1', fieldKey: 'full_name', operator: 'equals', value: 'Crash Step Applicant' }],
      actions: [
        { id: 'cr-0', type: 'assign_lead_queue', config: { queueId: 'queue-inbound-dsa' } },
        { id: 'cr-1', type: 'create_follow_up_task', config: { taskTitle: 'Crash Recovery Task', dueHours: 3 } },
      ],
      active: true,
      createdByUid: 'test:crash',
    })
    .returning();

  const [crashSub] = await db
    .insert(formSubmissions)
    .values({
      tenantId: testTenantId,
      formId: testFormId,
      idempotencyKey: `crash-sub-${randomUUID()}`,
      source: 'public_form',
      answers: { full_name: 'Crash Step Applicant', loan_product: 'Home Loan' },
      submitterSummary: 'Crash Step Applicant',
    })
    .returning();

  const eventId = `test-abandoned-step:${randomUUID()}`;
  const [execution] = await db
    .insert(automationExecutions)
    .values({
      tenantId: testTenantId,
      automationId: workflow!.id,
      eventId,
      eventType: 'form_submitted',
      sourceEntityType: 'form_submission',
      sourceEntityId: crashSub!.id,
      status: 'running',
      attempts: 1,
      actionResults: [],
      eventPayload: {
        formId: testFormId,
        answers: { full_name: 'Crash Step Applicant', loan_product: 'Home Loan' },
      },
    })
    .returning();

  // Seed step 0 as succeeded and step 1 as abandoned mid-processing
  await db.insert(automationActionSteps).values([
    {
      tenantId: testTenantId,
      automationExecutionId: execution!.id,
      eventId,
      actionKey: 'step_0:cr-0',
      actionType: 'assign_lead_queue',
      status: 'succeeded',
      idempotencyKey: `exec:${execution!.id}:action:step_0:cr-0`,
      attempts: 1,
      resultMetadata: { action: 'assign_lead_queue', actionKey: 'step_0:cr-0' },
    },
    {
      tenantId: testTenantId,
      automationExecutionId: execution!.id,
      eventId,
      actionKey: 'step_1:cr-1',
      actionType: 'create_follow_up_task',
      status: 'processing',
      idempotencyKey: `exec:${execution!.id}:action:step_1:cr-1`,
      attempts: 1,
    },
  ]);

  const executedIndices: number[] = [];
  const res = await processAutomationTriggerEvent(
    {
      tenantId: testTenantId,
      eventId,
      correlationId: `corr-abandoned-${randomUUID()}`,
      triggerType: 'form_submitted',
      sourceEntityType: 'form_submission',
      sourceEntityId: crashSub!.id,
      formId: testFormId,
      actorUid: 'system:worker',
      actorLabel: 'Recovery Worker',
      payload: {
        formId: testFormId,
        answers: { full_name: 'Crash Step Applicant', loan_product: 'Home Loan' },
      },
    },
    {
      consumerName: 'test-crash-consumer',
      beforeActionExecute: (ctx) => {
        if (ctx.automationId === workflow!.id) {
          executedIndices.push(ctx.stepIndex);
        }
      },
    }
  );

  assert.deepEqual(executedIndices, [1]);
  assert.equal(res.find((r) => r.automationId === workflow!.id)?.status, 'succeeded');

  const recoveredSteps = await db
    .select()
    .from(automationActionSteps)
    .where(eq(automationActionSteps.automationExecutionId, execution!.id));
  const step1 = recoveredSteps.find((s) => s.actionKey === 'step_1:cr-1');
  assert.equal(step1?.status, 'succeeded');
  assert.equal(step1?.attempts, 2);

  const tasks = await db
    .select()
    .from(followUpTasks)
    .where(eq(followUpTasks.idempotencyKey, step1!.idempotencyKey));
  assert.equal(tasks.length, 1);
});

test('retry backoff advances availableAt with secret redaction, cross-tenant outbox collision fails closed, and invalid payloads dead-letter immediately', async () => {
  const secretToken = 'Bearer super-secret-jwt-value postgres://user:pass@db/prod';
  const backoffEventId = `test-backoff:${randomUUID()}`;
  const before = new Date(Date.now() + 300_000);
  await enqueueOutboxEvent({
    tenantId: testTenantId,
    eventId: backoffEventId,
    eventType: 'form_submitted',
    aggregateType: 'form_submission',
    aggregateId: '501',
    correlationId: `corr-backoff-${randomUUID()}`,
    availableAt: before,
    payload: { sourceEntityType: 'form_submission', sourceEntityId: 501 },
    maxAttempts: 2,
  });

  // Cross-tenant collision on existing eventId must throw NonRetryableEventError
  await assert.rejects(
    enqueueOutboxEvent({
      tenantId: testTenantId + 9999,
      eventId: backoffEventId,
      eventType: 'form_submitted',
      aggregateType: 'form_submission',
      aggregateId: '501',
      correlationId: randomUUID(),
      payload: { sourceEntityType: 'form_submission', sourceEntityId: 501 },
    }),
    /Cross-tenant outbox eventId collision/
  );

  // Claim + schedule retry with deterministic backoff
  const [claimed1] = await claimPendingOutboxBatch({
    workerId: 'w-backoff',
    batchSize: 5,
    now: before,
    eventIdFilter: backoffEventId,
  });
  assert.ok(claimed1);

  const retryOut = await import('./outbox-repository.ts').then((m) =>
    m.scheduleOutboxRetryOrDeadLetter({
      id: claimed1.id,
      lockOwner: 'w-backoff',
      attempts: claimed1.attempts,
      maxAttempts: 2,
      error: new Error(`Upstream timeout: ${secretToken}`),
      now: before,
      backoffOptions: { baseDelayMs: 500, maxDelayMs: 5000, jitterRatio: 0 },
    })
  );
  assert.equal(retryOut.status, 'pending');
  assert.ok(retryOut.record!.availableAt.getTime() >= before.getTime() + 500);
  assert.equal(retryOut.record!.lastError?.includes('super-secret-jwt-value'), false);
  assert.equal(retryOut.record!.lastError?.includes('postgres://'), false);

  // Attempt 2 exhausts maxAttempts (2) -> dead_letter
  const afterBackoff = new Date(before.getTime() + 1000);
  const [claimed2] = await claimPendingOutboxBatch({
    workerId: 'w-backoff',
    batchSize: 5,
    now: afterBackoff,
    eventIdFilter: backoffEventId,
  });
  assert.ok(claimed2);
  const dlqOut = await import('./outbox-repository.ts').then((m) =>
    m.scheduleOutboxRetryOrDeadLetter({
      id: claimed2.id,
      lockOwner: 'w-backoff',
      attempts: claimed2.attempts,
      maxAttempts: 2,
      error: new Error('Still timing out ECONNRESET'),
      now: afterBackoff,
    })
  );
  assert.equal(dlqOut.status, 'dead_letter');

  // Invalid consumer payload (non-numeric sourceEntityId) throws NonRetryableEventError & dead-letters on attempt 1
  const badPayloadEventId = `test-bad-payload:${randomUUID()}`;
  await enqueueOutboxEvent({
    tenantId: testTenantId,
    eventId: badPayloadEventId,
    eventType: 'form_submitted',
    aggregateType: 'form_submission',
    aggregateId: 'bad',
    correlationId: `corr-bad-${randomUUID()}`,
    payload: { sourceEntityId: 'not-a-number' },
  });
  const payloadWorker = new DurableEventWorker(
    {
      enabled: false,
      pollIntervalMs: 1000,
      batchSize: 5,
      maxConcurrency: 1,
      leaseDurationMs: 60_000,
    },
    { allowMultipleInProcess: true }
  );
  const badCycle = await payloadWorker.runSingleCycle({
    eventIdFilter: badPayloadEventId,
  });
  assert.ok(badCycle.inbox.deadLettered <= 1);
  for (let i = 0; i < 25; i += 1) {
    const [check] = await db
      .select()
      .from(eventInbox)
      .where(and(eq(eventInbox.tenantId, testTenantId), eq(eventInbox.eventId, badPayloadEventId)));
    if (check?.status === 'dead_letter') break;
    await new Promise((r) => setTimeout(r, 150));
    await payloadWorker.runSingleCycle({ eventIdFilter: badPayloadEventId });
  }
  const [badInbox] = await db
    .select()
    .from(eventInbox)
    .where(and(eq(eventInbox.tenantId, testTenantId), eq(eventInbox.eventId, badPayloadEventId)));
  assert.equal(badInbox?.status, 'dead_letter');
  assert.equal(badInbox?.attempts, 1);
  assert.match(badInbox?.lastError ?? '', /Invalid automation event payload/);
});

test('DurableEventWorker enforces single in-process worker startup guard and clean stopped transition', async () => {
  const cfg = {
    enabled: true,
    pollIntervalMs: 60_000,
    batchSize: 5,
    maxConcurrency: 1,
    leaseDurationMs: 60_000,
  };

  const primary = new DurableEventWorker(cfg, {
    workerId: 'guard-primary',
    consumers: [],
  });
  const duplicate = new DurableEventWorker(cfg, {
    workerId: 'guard-duplicate',
    consumers: [],
  });

  assert.equal(primary.getHealthSnapshot().status, 'stopped');
  primary.start();
  assert.equal(primary.getHealthSnapshot().status, 'healthy');

  // Calling start() again on the same instance is idempotent
  primary.start();
  assert.equal(primary.getHealthSnapshot().status, 'healthy');

  // Starting a second distinct worker in the same process must fail closed
  assert.throws(() => duplicate.start(), /Duplicate worker startup prevented/);

  await primary.stop(2000);
  assert.equal(primary.getHealthSnapshot().status, 'stopped');

  // After stopping primary, another worker can start cleanly and stop cleanly
  duplicate.start();
  assert.equal(duplicate.getHealthSnapshot().status, 'healthy');
  await duplicate.stop(2000);
  assert.equal(duplicate.getHealthSnapshot().status, 'stopped');
});
