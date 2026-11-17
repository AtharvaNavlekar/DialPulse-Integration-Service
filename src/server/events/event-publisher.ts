import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.ts';
import { activityLogs, leadIntakeRecords } from '../../db/schema.ts';
import type { AutomationTriggerType } from '../../shared/types.ts';
import { externalIdMappingService } from '../integrations/external-mappings.ts';
import { processAutomationTriggerEvent } from '../services/automation-runner.ts';
import { deliverEventToInbox, type InboxEventRecord } from './inbox-repository.ts';
import { logPipelineEvent } from './logger.ts';
import {
  claimPendingOutboxBatch,
  markOutboxPublished,
  recoverExpiredOutboxLeases,
  scheduleOutboxRetryOrDeadLetter,
  type OutboxEventRecord,
} from './outbox-repository.ts';
import { NonRetryableEventError, type RetryBackoffOptions } from './retry-policy.ts';

export const AUTOMATION_CONSUMER_NAME = 'automation-consumer';
export const WEBHOOK_CONSUMER_PREFIX = 'webhook:';

export function buildWebhookConsumerName(providerId: string): string {
  return `${WEBHOOK_CONSUMER_PREFIX}${providerId}`;
}

export type InboxEventHandler = (event: InboxEventRecord) => Promise<void>;

export interface RegisteredConsumer {
  name: string;
  eventTypes: string[];
  handler: InboxEventHandler;
}

const AutomationConsumerPayloadSchema = z
  .object({
    correlationId: z.string().trim().min(1).optional(),
    sourceEntityType: z.string().trim().min(1).default('form_submission'),
    sourceEntityId: z.coerce.number().int().min(0).default(0),
    formId: z.number().int().positive().optional(),
    actorUid: z.string().trim().min(1).default('system:event-worker'),
    actorLabel: z.string().trim().min(1).default('System Worker'),
    eventPayload: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export function createDefaultConsumers(): RegisteredConsumer[] {
  return [
    {
      name: AUTOMATION_CONSUMER_NAME,
      eventTypes: [
        'form_submitted',
        'lead_created',
        'task_completed',
        'appointment_booked',
        'status_changed',
      ],
      handler: async (inboxEvent) => {
        const parsed = AutomationConsumerPayloadSchema.safeParse(
          inboxEvent.payload ?? {}
        );
        if (!parsed.success) {
          throw new NonRetryableEventError(
            `Invalid automation event payload: ${parsed.error.issues[0]?.message ?? 'malformed payload'}`,
            'INVALID_EVENT_PAYLOAD'
          );
        }

        const payload = parsed.data;
        const domainPayload = payload.eventPayload ?? (inboxEvent.payload ?? {});

        await processAutomationTriggerEvent(
          {
            tenantId: inboxEvent.tenantId,
            eventId: inboxEvent.eventId,
            correlationId: payload.correlationId,
            triggerType: inboxEvent.eventType as AutomationTriggerType,
            sourceEntityType: payload.sourceEntityType,
            sourceEntityId: payload.sourceEntityId,
            formId: payload.formId,
            actorUid: payload.actorUid,
            actorLabel: payload.actorLabel,
            payload: domainPayload,
          },
          { consumerName: inboxEvent.consumerName }
        );
      },
    },
    {
      name: buildWebhookConsumerName('dialpulse_web'),
      eventTypes: ['web_enquiry_submitted', 'callback_requested'],
      handler: async (inboxEvent) => {
        const payload = inboxEvent.payload ?? {};
        const data =
          payload.data &&
          typeof payload.data === 'object' &&
          !Array.isArray(payload.data)
            ? (payload.data as Record<string, unknown>)
            : {};

        const applicantName = String(
          data.applicantName ?? data.full_name ?? ''
        ).trim();
        if (!applicantName) {
          throw new NonRetryableEventError(
            'Inbound dialpulse_web webhook requires applicantName or full_name.',
            'WEBHOOK_MISSING_APPLICANT_NAME'
          );
        }

        const productInterest =
          String(data.productInterest ?? data.loan_product ?? 'General Enquiry').trim() ||
          'General Enquiry';
        const connectionId = Number(payload.connectionId ?? 0);
        const externalEnquiryId = data.externalEnquiryId
          ? String(data.externalEnquiryId).trim()
          : null;

        const leadIdempotencyKey = `webhook:${inboxEvent.eventId}:lead`;
        const [insertedLead] = await db
          .insert(leadIntakeRecords)
          .values({
            tenantId: inboxEvent.tenantId,
            idempotencyKey: leadIdempotencyKey,
            applicantName: applicantName.slice(0, 140),
            contactEmail: data.email ? String(data.email).trim().slice(0, 140) : null,
            contactPhone: data.phone ? String(data.phone).trim().slice(0, 40) : null,
            productInterest: productInterest.slice(0, 100),
            workflowStage: 'Lead acquisition',
            crmSyncStatus: 'pending',
          })
          .onConflictDoNothing({
            target: [leadIntakeRecords.tenantId, leadIntakeRecords.idempotencyKey],
          })
          .returning();

        const leadRow =
          insertedLead ??
          (
            await db
              .select()
              .from(leadIntakeRecords)
              .where(
                and(
                  eq(leadIntakeRecords.tenantId, inboxEvent.tenantId),
                  eq(leadIntakeRecords.idempotencyKey, leadIdempotencyKey)
                )
              )
              .limit(1)
          )[0];

        if (leadRow && connectionId > 0 && externalEnquiryId) {
          await externalIdMappingService.upsertConnectionMapping({
            tenantId: inboxEvent.tenantId,
            connectionId,
            providerId: 'dialpulse_web',
            internalEntityType: 'lead_intake',
            internalEntityId: String(leadRow.id),
            externalEntityType: 'web_enquiry',
            externalEntityId: externalEnquiryId,
          });
        }

        await db
          .insert(activityLogs)
          .values({
            tenantId: inboxEvent.tenantId,
            idempotencyKey: `webhook:${inboxEvent.eventId}:activity`,
            actorUid: 'webhook:dialpulse_web',
            actorLabel: 'DialPulse Web Webhook',
            module: 'integration',
            action: `webhook.${inboxEvent.eventType}`,
            entityType: 'lead_intake',
            entityId: String(leadRow?.id ?? inboxEvent.eventId),
            summary: `Processed verified dialpulse_web webhook (${inboxEvent.eventType}).`,
            metadata: {
              eventId: inboxEvent.eventId,
              connectionId: connectionId || null,
            },
          })
          .onConflictDoNothing({
            target: [activityLogs.tenantId, activityLogs.idempotencyKey],
          });
      },
    },
    {
      name: buildWebhookConsumerName('client_crm'),
      eventTypes: ['lead_stage_changed', 'lead_assigned', 'lead_synced_ack'],
      handler: async (inboxEvent) => {
        const payload = inboxEvent.payload ?? {};
        const data =
          payload.data &&
          typeof payload.data === 'object' &&
          !Array.isArray(payload.data)
            ? (payload.data as Record<string, unknown>)
            : {};
        const connectionId = Number(payload.connectionId ?? 0);
        const externalLeadId = data.externalLeadId
          ? String(data.externalLeadId).trim()
          : null;

        let internalLeadId =
          data.internalLeadId !== undefined ? Number(data.internalLeadId) : 0;

        if ((!internalLeadId || !Number.isInteger(internalLeadId)) && connectionId > 0 && externalLeadId) {
          const mapping = await externalIdMappingService.resolveByExternal({
            tenantId: inboxEvent.tenantId,
            connectionId,
            externalEntityType: 'client_crm_lead',
            externalEntityId: externalLeadId,
          });
          if (mapping) {
            internalLeadId = Number(mapping.internalEntityId);
          }
        }

        if (internalLeadId > 0 && typeof data.workflowStage === 'string' && data.workflowStage.trim()) {
          await db
            .update(leadIntakeRecords)
            .set({
              workflowStage: data.workflowStage.trim().slice(0, 80),
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(leadIntakeRecords.id, internalLeadId),
                eq(leadIntakeRecords.tenantId, inboxEvent.tenantId)
              )
            );
        }

        await db
          .insert(activityLogs)
          .values({
            tenantId: inboxEvent.tenantId,
            idempotencyKey: `webhook:${inboxEvent.eventId}:activity`,
            actorUid: 'webhook:client_crm',
            actorLabel: 'Client CRM Webhook',
            module: 'integration',
            action: `webhook.${inboxEvent.eventType}`,
            entityType: 'lead_intake',
            entityId: String(internalLeadId || externalLeadId || inboxEvent.eventId),
            summary: `Processed verified client_crm webhook (${inboxEvent.eventType}).`,
            metadata: {
              eventId: inboxEvent.eventId,
              connectionId: connectionId || null,
            },
          })
          .onConflictDoNothing({
            target: [activityLogs.tenantId, activityLogs.idempotencyKey],
          });
      },
    },
    {
      name: buildWebhookConsumerName('central_crm'),
      eventTypes: ['tenant_status_updated', 'membership_changed'],
      handler: async (inboxEvent) => {
        const payload = inboxEvent.payload ?? {};
        const connectionId = Number(payload.connectionId ?? 0);

        await db
          .insert(activityLogs)
          .values({
            tenantId: inboxEvent.tenantId,
            idempotencyKey: `webhook:${inboxEvent.eventId}:activity`,
            actorUid: 'webhook:central_crm',
            actorLabel: 'Central CRM Webhook',
            module: 'integration',
            action: `webhook.${inboxEvent.eventType}`,
            entityType: 'tenant',
            entityId: String(inboxEvent.tenantId),
            summary: `Processed verified central_crm webhook (${inboxEvent.eventType}).`,
            metadata: {
              eventId: inboxEvent.eventId,
              connectionId: connectionId || null,
            },
          })
          .onConflictDoNothing({
            target: [activityLogs.tenantId, activityLogs.idempotencyKey],
          });
      },
    },
  ];
}

export async function publishOutboxBatch(options: {
  workerId: string;
  batchSize: number;
  leaseDurationMs: number;
  consumers?: RegisteredConsumer[];
  now?: Date;
  backoffOptions?: RetryBackoffOptions;
  eventIdFilter?: string;
}): Promise<{
  recovered: number;
  claimed: number;
  published: number;
  retried: number;
  deadLettered: number;
}> {
  const now = options.now ?? new Date();
  const consumers = options.consumers ?? createDefaultConsumers();

  const recovery = await recoverExpiredOutboxLeases({
    leaseDurationMs: options.leaseDurationMs,
    now,
  });

  const claimed = await claimPendingOutboxBatch({
    workerId: options.workerId,
    batchSize: options.batchSize,
    now,
    eventIdFilter: options.eventIdFilter,
  });

  let published = 0;
  let retried = 0;
  let deadLettered = recovery.deadLettered.length;

  for (const outboxRow of claimed) {
    try {
      await publishSingleOutboxRecord(outboxRow, consumers, options.workerId, now);
      published += 1;
    } catch (error) {
      const outcome = await scheduleOutboxRetryOrDeadLetter({
        id: outboxRow.id,
        lockOwner: options.workerId,
        attempts: outboxRow.attempts,
        maxAttempts: outboxRow.maxAttempts,
        error,
        now,
        backoffOptions: options.backoffOptions,
      });

      if (outcome.status === 'dead_letter') {
        deadLettered += 1;
        await recordDeadLetterActivity(outboxRow, 'outbox', outcome.classification.sanitizedMessage);
        logPipelineEvent({
          level: 'error',
          event: 'event_dead_lettered',
          workerId: options.workerId,
          tenantId: outboxRow.tenantId,
          eventId: outboxRow.eventId,
          correlationId: outboxRow.correlationId,
          eventType: outboxRow.eventType,
          outboxId: outboxRow.id,
          attempt: outboxRow.attempts,
          maxAttempts: outboxRow.maxAttempts,
          reason: outcome.classification.sanitizedMessage,
        });
      } else if (outcome.status === 'pending') {
        retried += 1;
        logPipelineEvent({
          level: 'warn',
          event: 'retry_scheduled',
          workerId: options.workerId,
          tenantId: outboxRow.tenantId,
          eventId: outboxRow.eventId,
          correlationId: outboxRow.correlationId,
          eventType: outboxRow.eventType,
          outboxId: outboxRow.id,
          attempt: outboxRow.attempts,
          nextAvailableAt: outcome.record?.availableAt.toISOString(),
          reason: outcome.classification.sanitizedMessage,
        });
      }
    }
  }

  return {
    recovered: recovery.requeued.length,
    claimed: claimed.length,
    published,
    retried,
    deadLettered,
  };
}

async function publishSingleOutboxRecord(
  outboxRow: OutboxEventRecord,
  consumers: RegisteredConsumer[],
  workerId: string,
  now: Date
): Promise<void> {
  const matchingConsumers = consumers.filter((c) =>
    c.eventTypes.includes(outboxRow.eventType)
  );

  const enrichedPayload = {
    ...outboxRow.payload,
    correlationId:
      typeof outboxRow.payload?.correlationId === 'string' &&
      outboxRow.payload.correlationId.trim()
        ? outboxRow.payload.correlationId
        : outboxRow.correlationId,
  };

  for (const consumer of matchingConsumers) {
    const delivery = await deliverEventToInbox({
      tenantId: outboxRow.tenantId,
      consumerName: consumer.name,
      eventId: outboxRow.eventId,
      eventType: outboxRow.eventType,
      payload: enrichedPayload,
      maxAttempts: outboxRow.maxAttempts,
      availableAt: now,
    });

    logPipelineEvent({
      event: 'event_published_to_inbox',
      workerId,
      tenantId: outboxRow.tenantId,
      eventId: outboxRow.eventId,
      correlationId: outboxRow.correlationId,
      eventType: outboxRow.eventType,
      consumerName: consumer.name,
      outboxId: outboxRow.id,
      inboxId: delivery.record.id,
      status: delivery.inserted ? 'delivered' : 'duplicate_ignored',
    });
  }

  await markOutboxPublished(outboxRow.id, workerId, now);
}

async function recordDeadLetterActivity(
  outboxRow: OutboxEventRecord,
  stage: 'outbox' | 'inbox',
  reason: string
): Promise<void> {
  await db
    .insert(activityLogs)
    .values({
      tenantId: outboxRow.tenantId,
      idempotencyKey: `dlq:${stage}:${outboxRow.eventId}`,
      actorUid: 'system:event-worker',
      actorLabel: 'Event Worker',
      module: 'integration',
      action: `event.${stage}_dead_lettered`,
      entityType: outboxRow.aggregateType,
      entityId: outboxRow.aggregateId,
      summary: `Event "${outboxRow.eventId}" entered ${stage} dead-letter queue: ${reason}`,
      metadata: {
        eventId: outboxRow.eventId,
        eventType: outboxRow.eventType,
        stage,
      },
    })
    .onConflictDoNothing({
      target: [activityLogs.tenantId, activityLogs.idempotencyKey],
    });
}
