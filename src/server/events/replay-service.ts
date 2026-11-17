import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
  activityLogs,
  eventInbox,
  eventOutbox,
  eventReplayLogs,
} from '../../db/schema.ts';
import { logPipelineEvent } from './logger.ts';

export type ReplaySource = 'outbox' | 'inbox';

export class DeadLetterReplayError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'DeadLetterReplayError';
    this.statusCode = statusCode;
  }
}

export interface ReplayDeadLetterInput {
  source: ReplaySource;
  rowId: number;
  tenantId: number;
  actorUid: string;
  actorLabel: string;
  reason: string;
}

export interface ReplayDeadLetterResult {
  requeued: true;
  source: ReplaySource;
  rowId: number;
  eventId: string;
  status: 'pending' | 'received';
  replayCount: number;
  replayedAt: string;
  replayLogId: number;
}

export async function replayDeadLetterEvent(
  input: ReplayDeadLetterInput
): Promise<ReplayDeadLetterResult> {
  const normalizedReason = input.reason.trim();
  if (normalizedReason.length < 3 || normalizedReason.length > 300) {
    throw new DeadLetterReplayError(
      400,
      'Replay reason must be between 3 and 300 characters.'
    );
  }

  const now = new Date();

  const result = await db.transaction(async (tx) => {
    if (input.source === 'outbox') {
      const lockedRes = await tx.execute<{
        id: number;
        tenant_id: number;
        event_id: string;
        status: string;
        attempts: number;
        last_error: string | null;
        replay_count: number;
      }>(
        sql`SELECT id, tenant_id, event_id, status, attempts, last_error, replay_count FROM event_outbox WHERE id = ${input.rowId} FOR UPDATE`
      );
      const row = lockedRes.rows[0];
      if (!row) {
        throw new DeadLetterReplayError(404, 'Outbox event record not found.');
      }
      if (Number(row.tenant_id) !== input.tenantId) {
        throw new DeadLetterReplayError(
          403,
          'Access denied: event does not belong to the active tenant.'
        );
      }
      if (row.status !== 'dead_letter') {
        throw new DeadLetterReplayError(
          409,
          `Outbox event #${row.id} is in status "${row.status}" and cannot be replayed (must be dead_letter).`
        );
      }

      const nextReplayCount = Number(row.replay_count ?? 0) + 1;
      await tx
        .update(eventOutbox)
        .set({
          status: 'pending',
          attempts: 0,
          availableAt: now,
          lockedAt: null,
          lockOwner: null,
          replayCount: nextReplayCount,
          lastReplayedAt: now,
          lastReplayedByUid: input.actorUid,
          lastReplayReason: normalizedReason,
          updatedAt: now,
        })
        .where(
          and(
            eq(eventOutbox.id, row.id),
            eq(eventOutbox.tenantId, input.tenantId)
          )
        );

      const [replayLog] = await tx
        .insert(eventReplayLogs)
        .values({
          tenantId: input.tenantId,
          source: 'outbox',
          targetRowId: row.id,
          eventId: row.event_id,
          consumerName: null,
          replayedByUid: input.actorUid,
          replayedByLabel: input.actorLabel,
          reason: normalizedReason,
          previousStatus: row.status,
          previousAttempts: Number(row.attempts ?? 0),
          previousLastError: row.last_error,
          replayedAt: now,
        })
        .returning();

      await tx.insert(activityLogs).values({
        tenantId: input.tenantId,
        idempotencyKey: `dlq:replay:outbox:${row.id}:${nextReplayCount}`,
        actorUid: input.actorUid,
        actorLabel: input.actorLabel,
        module: 'integration',
        action: 'event.dlq_replayed',
        entityType: 'event_outbox',
        entityId: String(row.id),
        summary: `Replayed dead-letter outbox event "${row.event_id}" (replay #${nextReplayCount}).`,
        metadata: {
          source: 'outbox',
          eventId: row.event_id,
          replayCount: nextReplayCount,
          reason: normalizedReason,
        },
      });

      return {
        requeued: true as const,
        source: 'outbox' as const,
        rowId: row.id,
        eventId: row.event_id,
        status: 'pending' as const,
        replayCount: nextReplayCount,
        replayedAt: now.toISOString(),
        replayLogId: replayLog!.id,
      };
    }

    const lockedRes = await tx.execute<{
      id: number;
      tenant_id: number;
      consumer_name: string;
      event_id: string;
      status: string;
      attempts: number;
      last_error: string | null;
      replay_count: number;
    }>(
      sql`SELECT id, tenant_id, consumer_name, event_id, status, attempts, last_error, replay_count FROM event_inbox WHERE id = ${input.rowId} FOR UPDATE`
    );
    const row = lockedRes.rows[0];
    if (!row) {
      throw new DeadLetterReplayError(404, 'Inbox event record not found.');
    }
    if (Number(row.tenant_id) !== input.tenantId) {
      throw new DeadLetterReplayError(
        403,
        'Access denied: event does not belong to the active tenant.'
      );
    }
    if (row.status !== 'dead_letter') {
      throw new DeadLetterReplayError(
        409,
        `Inbox event #${row.id} is in status "${row.status}" and cannot be replayed (must be dead_letter).`
      );
    }

    const nextReplayCount = Number(row.replay_count ?? 0) + 1;
    await tx
      .update(eventInbox)
      .set({
        status: 'received',
        attempts: 0,
        availableAt: now,
        lockedAt: null,
        lockOwner: null,
        replayCount: nextReplayCount,
        lastReplayedAt: now,
        lastReplayedByUid: input.actorUid,
        lastReplayReason: normalizedReason,
        updatedAt: now,
      })
      .where(
        and(
          eq(eventInbox.id, row.id),
          eq(eventInbox.tenantId, input.tenantId)
        )
      );

    const [replayLog] = await tx
      .insert(eventReplayLogs)
      .values({
        tenantId: input.tenantId,
        source: 'inbox',
        targetRowId: row.id,
        eventId: row.event_id,
        consumerName: row.consumer_name,
        replayedByUid: input.actorUid,
        replayedByLabel: input.actorLabel,
        reason: normalizedReason,
        previousStatus: row.status,
        previousAttempts: Number(row.attempts ?? 0),
        previousLastError: row.last_error,
        replayedAt: now,
      })
      .returning();

    await tx.insert(activityLogs).values({
      tenantId: input.tenantId,
      idempotencyKey: `dlq:replay:inbox:${row.id}:${nextReplayCount}`,
      actorUid: input.actorUid,
      actorLabel: input.actorLabel,
      module: 'integration',
      action: 'event.dlq_replayed',
      entityType: 'event_inbox',
      entityId: String(row.id),
      summary: `Replayed dead-letter inbox event "${row.event_id}" (${row.consumer_name}, replay #${nextReplayCount}).`,
      metadata: {
        source: 'inbox',
        consumerName: row.consumer_name,
        eventId: row.event_id,
        replayCount: nextReplayCount,
        reason: normalizedReason,
      },
    });

    return {
      requeued: true as const,
      source: 'inbox' as const,
      rowId: row.id,
      eventId: row.event_id,
      status: 'received' as const,
      replayCount: nextReplayCount,
      replayedAt: now.toISOString(),
      replayLogId: replayLog!.id,
    };
  });

  logPipelineEvent({
    event: 'dlq_event_replayed',
    tenantId: input.tenantId,
    source: result.source,
    eventId: result.eventId,
    replayCount: result.replayCount,
    actorUid: input.actorUid,
  });

  return result;
}

export async function listReplayLogsByTenant(
  tenantId: number,
  options: { source?: ReplaySource; rowId?: number; limit?: number } = {}
) {
  const limit = Math.max(1, Math.min(100, options.limit ?? 50));
  const conditions = [eq(eventReplayLogs.tenantId, tenantId)];
  if (options.source) {
    conditions.push(eq(eventReplayLogs.source, options.source));
  }
  if (options.rowId) {
    conditions.push(eq(eventReplayLogs.targetRowId, options.rowId));
  }

  return db
    .select()
    .from(eventReplayLogs)
    .where(and(...conditions))
    .orderBy(desc(eventReplayLogs.replayedAt))
    .limit(limit);
}
