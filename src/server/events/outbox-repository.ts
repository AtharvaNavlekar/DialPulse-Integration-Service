import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { db, pool } from '../../db/index.ts';
import type * as schema from '../../db/schema.ts';
import { eventOutbox } from '../../db/schema.ts';
import {
  MAX_EVENT_ATTEMPTS,
  NonRetryableEventError,
  classifyEventError,
  computeNextAttemptDate,
  type RetryBackoffOptions,
} from './retry-policy.ts';

export type OutboxStatus = 'pending' | 'processing' | 'published' | 'dead_letter';

export interface OutboxEventRecord {
  id: number;
  tenantId: number;
  eventId: string;
  schemaVersion: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  correlationId: string;
  payload: Record<string, unknown>;
  status: OutboxStatus;
  attempts: number;
  maxAttempts: number;
  availableAt: Date;
  lockedAt: Date | null;
  lockOwner: string | null;
  lastError: string | null;
  replayCount: number;
  lastReplayedAt: Date | null;
  lastReplayedByUid: string | null;
  lastReplayReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
}

export interface EnqueueOutboxInput {
  tenantId: number;
  eventId: string;
  schemaVersion?: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  correlationId: string;
  payload: Record<string, unknown>;
  maxAttempts?: number;
  availableAt?: Date;
}

type DbExecutor = NodePgDatabase<typeof schema>;

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function toNullableDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  return toDate(value);
}

function mapRawOutboxRow(row: Record<string, unknown>): OutboxEventRecord {
  return {
    id: Number(row.id),
    tenantId: Number(row.tenant_id),
    eventId: String(row.event_id),
    schemaVersion: String(row.schema_version ?? '1.0'),
    eventType: String(row.event_type),
    aggregateType: String(row.aggregate_type),
    aggregateId: String(row.aggregate_id),
    correlationId: String(row.correlation_id),
    payload: (row.payload as Record<string, unknown>) ?? {},
    status: String(row.status) as OutboxStatus,
    attempts: Number(row.attempts ?? 0),
    maxAttempts: Number(row.max_attempts ?? MAX_EVENT_ATTEMPTS),
    availableAt: toDate(row.available_at),
    lockedAt: toNullableDate(row.locked_at),
    lockOwner: row.lock_owner ? String(row.lock_owner) : null,
    lastError: row.last_error ? String(row.last_error) : null,
    replayCount: Number(row.replay_count ?? 0),
    lastReplayedAt: toNullableDate(row.last_replayed_at),
    lastReplayedByUid: row.last_replayed_by_uid
      ? String(row.last_replayed_by_uid)
      : null,
    lastReplayReason: row.last_replay_reason
      ? String(row.last_replay_reason)
      : null,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
    publishedAt: toNullableDate(row.published_at),
  };
}

export async function enqueueOutboxEvent(
  input: EnqueueOutboxInput,
  executor: DbExecutor = db
): Promise<{ inserted: boolean; record: OutboxEventRecord }> {
  if (!Number.isInteger(input.tenantId) || input.tenantId <= 0) {
    throw new NonRetryableEventError('Outbox event requires a valid positive tenantId.', 'INVALID_OUTBOX_INPUT');
  }
  if (!input.eventId.trim() || !input.eventType.trim() || !input.aggregateType.trim() || !input.aggregateId.trim() || !input.correlationId.trim()) {
    throw new NonRetryableEventError('Outbox event is missing required identity metadata.', 'INVALID_OUTBOX_INPUT');
  }
  if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) {
    throw new NonRetryableEventError('Outbox event payload must be a plain JSON object.', 'INVALID_EVENT_PAYLOAD');
  }

  const [inserted] = await executor
    .insert(eventOutbox)
    .values({
      tenantId: input.tenantId,
      eventId: input.eventId,
      schemaVersion: input.schemaVersion ?? '1.0',
      eventType: input.eventType,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      correlationId: input.correlationId,
      payload: input.payload,
      status: 'pending',
      attempts: 0,
      maxAttempts: input.maxAttempts ?? MAX_EVENT_ATTEMPTS,
      availableAt: input.availableAt ?? new Date(),
    })
    .onConflictDoNothing({ target: eventOutbox.eventId })
    .returning();

  if (inserted) {
    return {
      inserted: true,
      record: inserted as OutboxEventRecord,
    };
  }

  const existing = await executor
    .select()
    .from(eventOutbox)
    .where(eq(eventOutbox.eventId, input.eventId))
    .limit(1);

  if (!existing[0]) {
    throw new Error(`Failed to enqueue or retrieve outbox event "${input.eventId}".`);
  }

  if (existing[0].tenantId !== input.tenantId) {
    throw new NonRetryableEventError(
      `Cross-tenant outbox eventId collision rejected for "${input.eventId}".`,
      'CROSS_TENANT_EVENT_ID_COLLISION'
    );
  }

  return {
    inserted: false,
    record: existing[0] as OutboxEventRecord,
  };
}

export async function claimPendingOutboxBatch(options: {
  workerId: string;
  batchSize: number;
  now?: Date;
  eventIdFilter?: string;
}): Promise<OutboxEventRecord[]> {
  const now = options.now ?? new Date();
  const limit = Math.max(1, Math.min(100, options.batchSize));

  if (options.eventIdFilter) {
    const result = await pool.query(
      `
      WITH claimed AS (
        SELECT id
        FROM event_outbox
        WHERE event_id = $1
          AND status = 'pending'
          AND available_at <= $2
        ORDER BY available_at ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT $3
      )
      UPDATE event_outbox AS o
      SET
        status = 'processing',
        attempts = o.attempts + 1,
        locked_at = $2,
        lock_owner = $4,
        updated_at = $2
      FROM claimed
      WHERE o.id = claimed.id
      RETURNING o.*;
      `,
      [options.eventIdFilter, now, limit, options.workerId]
    );
    return result.rows.map((r) => mapRawOutboxRow(r as Record<string, unknown>));
  }

  const result = await pool.query(
    `
    WITH claimed AS (
      SELECT id
      FROM event_outbox
      WHERE status = 'pending'
        AND available_at <= $1
      ORDER BY available_at ASC, id ASC
      FOR UPDATE SKIP LOCKED
      LIMIT $2
    )
    UPDATE event_outbox AS o
    SET
      status = 'processing',
      attempts = o.attempts + 1,
      locked_at = $1,
      lock_owner = $3,
      updated_at = $1
    FROM claimed
    WHERE o.id = claimed.id
    RETURNING o.*;
    `,
    [now, limit, options.workerId]
  );

  return result.rows.map((r) => mapRawOutboxRow(r as Record<string, unknown>));
}

export async function recoverExpiredOutboxLeases(options: {
  leaseDurationMs: number;
  now?: Date;
}): Promise<{ requeued: OutboxEventRecord[]; deadLettered: OutboxEventRecord[] }> {
  const now = options.now ?? new Date();
  const expiredBefore = new Date(now.getTime() - options.leaseDurationMs);

  const result = await pool.query(
    `
    WITH expired AS (
      SELECT id, attempts, max_attempts
      FROM event_outbox
      WHERE status = 'processing'
        AND locked_at IS NOT NULL
        AND locked_at < $1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE event_outbox AS o
    SET
      status = CASE
        WHEN expired.attempts >= expired.max_attempts THEN 'dead_letter'
        ELSE 'pending'
      END,
      available_at = CASE
        WHEN expired.attempts >= expired.max_attempts THEN o.available_at
        ELSE $2
      END,
      locked_at = NULL,
      lock_owner = NULL,
      last_error = COALESCE(
        o.last_error,
        'Outbox processing lease expired before worker completed delivery.'
      ),
      updated_at = $2
    FROM expired
    WHERE o.id = expired.id
    RETURNING o.*;
    `,
    [expiredBefore, now]
  );

  const records = result.rows.map((r) => mapRawOutboxRow(r as Record<string, unknown>));
  return {
    requeued: records.filter((r) => r.status === 'pending'),
    deadLettered: records.filter((r) => r.status === 'dead_letter'),
  };
}

export async function markOutboxPublished(
  id: number,
  lockOwner: string,
  now = new Date()
): Promise<OutboxEventRecord | null> {
  const [updated] = await db
    .update(eventOutbox)
    .set({
      status: 'published',
      lockedAt: null,
      lockOwner: null,
      lastError: null,
      publishedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(eventOutbox.id, id),
        eq(eventOutbox.status, 'processing'),
        eq(eventOutbox.lockOwner, lockOwner)
      )
    )
    .returning();

  return updated ? (updated as OutboxEventRecord) : null;
}

export async function scheduleOutboxRetryOrDeadLetter(options: {
  id: number;
  lockOwner: string;
  attempts: number;
  maxAttempts: number;
  error: unknown;
  now?: Date;
  backoffOptions?: RetryBackoffOptions;
}): Promise<{
  record: OutboxEventRecord | null;
  status: 'pending' | 'dead_letter' | 'not_owned';
  classification: ReturnType<typeof classifyEventError>;
}> {
  const now = options.now ?? new Date();
  const classification = classifyEventError(options.error);
  const exhausted =
    !classification.retryable || options.attempts >= options.maxAttempts;
  const nextStatus = exhausted ? 'dead_letter' : 'pending';
  const nextAvailableAt = exhausted
    ? now
    : computeNextAttemptDate(options.attempts, now, options.backoffOptions);

  const [updated] = await db
    .update(eventOutbox)
    .set({
      status: nextStatus,
      availableAt: nextAvailableAt,
      lockedAt: null,
      lockOwner: null,
      lastError: classification.sanitizedMessage,
      updatedAt: now,
    })
    .where(
      and(
        eq(eventOutbox.id, options.id),
        eq(eventOutbox.status, 'processing'),
        eq(eventOutbox.lockOwner, options.lockOwner)
      )
    )
    .returning();

  if (!updated) {
    return { record: null, status: 'not_owned', classification };
  }

  return {
    record: updated as OutboxEventRecord,
    status: nextStatus,
    classification,
  };
}

export async function queryOutboxEventsByTenant(
  tenantId: number,
  options: {
    statuses?: OutboxStatus[];
    eventType?: string;
    search?: string;
    from?: Date;
    to?: Date;
    limit?: number;
    offset?: number;
  } = {}
): Promise<{ rows: OutboxEventRecord[]; total: number }> {
  const limit = Math.max(1, Math.min(200, options.limit ?? 50));
  const offset = Math.max(0, options.offset ?? 0);
  const conditions = [eq(eventOutbox.tenantId, tenantId)];

  if (options.statuses && options.statuses.length > 0) {
    conditions.push(inArray(eventOutbox.status, options.statuses));
  }
  if (options.eventType) {
    conditions.push(eq(eventOutbox.eventType, options.eventType));
  }
  if (options.from) {
    conditions.push(gte(eventOutbox.createdAt, options.from));
  }
  if (options.to) {
    conditions.push(lte(eventOutbox.createdAt, options.to));
  }
  if (options.search && options.search.trim()) {
    const pattern = `%${options.search.trim()}%`;
    const searchOr = or(
      ilike(eventOutbox.eventId, pattern),
      ilike(eventOutbox.eventType, pattern),
      ilike(eventOutbox.aggregateId, pattern),
      ilike(eventOutbox.lastError, pattern)
    );
    if (searchOr) conditions.push(searchOr);
  }

  const whereClause = and(...conditions);

  const [countRows, rows] = await Promise.all([
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(eventOutbox)
      .where(whereClause),
    db
      .select()
      .from(eventOutbox)
      .where(whereClause)
      .orderBy(desc(eventOutbox.createdAt))
      .limit(limit)
      .offset(offset),
  ]);

  return {
    rows: rows as OutboxEventRecord[],
    total: Number(countRows[0]?.total ?? 0),
  };
}

export async function listOutboxEventsByTenant(
  tenantId: number,
  options: { statuses?: OutboxStatus[]; limit?: number } = {}
): Promise<OutboxEventRecord[]> {
  const result = await queryOutboxEventsByTenant(tenantId, options);
  return result.rows;
}
