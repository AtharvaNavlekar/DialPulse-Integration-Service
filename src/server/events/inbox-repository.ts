import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { db, pool } from '../../db/index.ts';
import type * as schema from '../../db/schema.ts';
import { eventInbox } from '../../db/schema.ts';
import {
  MAX_EVENT_ATTEMPTS,
  NonRetryableEventError,
  classifyEventError,
  computeNextAttemptDate,
  type RetryBackoffOptions,
} from './retry-policy.ts';

type DbExecutor = NodePgDatabase<typeof schema>;

export type InboxStatus = 'received' | 'processing' | 'succeeded' | 'dead_letter';

export interface InboxEventRecord {
  id: number;
  tenantId: number;
  consumerName: string;
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  status: InboxStatus;
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
  processedAt: Date | null;
}

export interface DeliverInboxInput {
  tenantId: number;
  consumerName: string;
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  maxAttempts?: number;
  availableAt?: Date;
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function toNullableDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  return toDate(value);
}

function mapRawInboxRow(row: Record<string, unknown>): InboxEventRecord {
  return {
    id: Number(row.id),
    tenantId: Number(row.tenant_id),
    consumerName: String(row.consumer_name),
    eventId: String(row.event_id),
    eventType: String(row.event_type),
    payload: (row.payload as Record<string, unknown>) ?? {},
    status: String(row.status) as InboxStatus,
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
    processedAt: toNullableDate(row.processed_at),
  };
}

export async function deliverEventToInbox(
  input: DeliverInboxInput,
  executor: DbExecutor = db
): Promise<{ inserted: boolean; record: InboxEventRecord }> {
  if (!Number.isInteger(input.tenantId) || input.tenantId <= 0) {
    throw new NonRetryableEventError('Inbox event requires a valid positive tenantId.', 'INVALID_INBOX_INPUT');
  }
  if (!input.consumerName.trim() || !input.eventId.trim() || !input.eventType.trim()) {
    throw new NonRetryableEventError('Inbox event requires non-empty consumerName, eventId, and eventType.', 'INVALID_INBOX_INPUT');
  }
  if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) {
    throw new NonRetryableEventError('Inbox event payload must be a plain JSON object.', 'INVALID_EVENT_PAYLOAD');
  }

  const [inserted] = await executor
    .insert(eventInbox)
    .values({
      tenantId: input.tenantId,
      consumerName: input.consumerName,
      eventId: input.eventId,
      eventType: input.eventType,
      payload: input.payload,
      status: 'received',
      attempts: 0,
      maxAttempts: input.maxAttempts ?? MAX_EVENT_ATTEMPTS,
      availableAt: input.availableAt ?? new Date(),
    })
    .onConflictDoNothing({
      target: [eventInbox.tenantId, eventInbox.consumerName, eventInbox.eventId],
    })
    .returning();

  if (inserted) {
    return {
      inserted: true,
      record: inserted as InboxEventRecord,
    };
  }

  const existing = await executor
    .select()
    .from(eventInbox)
    .where(
      and(
        eq(eventInbox.tenantId, input.tenantId),
        eq(eventInbox.consumerName, input.consumerName),
        eq(eventInbox.eventId, input.eventId)
      )
    )
    .limit(1);

  if (!existing[0]) {
    throw new Error(
      `Failed to record or locate inbox delivery for "${input.consumerName}:${input.eventId}".`
    );
  }

  return {
    inserted: false,
    record: existing[0] as InboxEventRecord,
  };
}

export async function claimPendingInboxBatch(options: {
  consumerName: string;
  workerId: string;
  batchSize: number;
  now?: Date;
  eventIdFilter?: string;
}): Promise<InboxEventRecord[]> {
  const now = options.now ?? new Date();
  const limit = Math.max(1, Math.min(100, options.batchSize));

  if (options.eventIdFilter) {
    const result = await pool.query(
      `
      WITH claimed AS (
        SELECT id
        FROM event_inbox
        WHERE consumer_name = $1
          AND event_id = $2
          AND status = 'received'
          AND available_at <= $3
        ORDER BY available_at ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT $4
      )
      UPDATE event_inbox AS i
      SET
        status = 'processing',
        attempts = i.attempts + 1,
        locked_at = $3,
        lock_owner = $5,
        updated_at = $3
      FROM claimed
      WHERE i.id = claimed.id
      RETURNING i.*;
      `,
      [options.consumerName, options.eventIdFilter, now, limit, options.workerId]
    );
    return result.rows.map((r) => mapRawInboxRow(r as Record<string, unknown>));
  }

  const result = await pool.query(
    `
    WITH claimed AS (
      SELECT id
      FROM event_inbox
      WHERE consumer_name = $1
        AND status = 'received'
        AND available_at <= $2
      ORDER BY available_at ASC, id ASC
      FOR UPDATE SKIP LOCKED
      LIMIT $3
    )
    UPDATE event_inbox AS i
    SET
      status = 'processing',
      attempts = i.attempts + 1,
      locked_at = $2,
      lock_owner = $4,
      updated_at = $2
    FROM claimed
    WHERE i.id = claimed.id
    RETURNING i.*;
    `,
    [options.consumerName, now, limit, options.workerId]
  );

  return result.rows.map((r) => mapRawInboxRow(r as Record<string, unknown>));
}

export async function recoverExpiredInboxLeases(options: {
  leaseDurationMs: number;
  now?: Date;
}): Promise<{ requeued: InboxEventRecord[]; deadLettered: InboxEventRecord[] }> {
  const now = options.now ?? new Date();
  const expiredBefore = new Date(now.getTime() - options.leaseDurationMs);

  const result = await pool.query(
    `
    WITH expired AS (
      SELECT id, attempts, max_attempts
      FROM event_inbox
      WHERE status = 'processing'
        AND locked_at IS NOT NULL
        AND locked_at < $1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE event_inbox AS i
    SET
      status = CASE
        WHEN expired.attempts >= expired.max_attempts THEN 'dead_letter'
        ELSE 'received'
      END,
      available_at = CASE
        WHEN expired.attempts >= expired.max_attempts THEN i.available_at
        ELSE $2
      END,
      locked_at = NULL,
      lock_owner = NULL,
      last_error = COALESCE(
        i.last_error,
        'Inbox processing lease expired before consumer completed.'
      ),
      updated_at = $2
    FROM expired
    WHERE i.id = expired.id
    RETURNING i.*;
    `,
    [expiredBefore, now]
  );

  const records = result.rows.map((r) => mapRawInboxRow(r as Record<string, unknown>));
  return {
    requeued: records.filter((r) => r.status === 'received'),
    deadLettered: records.filter((r) => r.status === 'dead_letter'),
  };
}

export async function markInboxSucceeded(
  id: number,
  lockOwner: string,
  now = new Date()
): Promise<InboxEventRecord | null> {
  const [updated] = await db
    .update(eventInbox)
    .set({
      status: 'succeeded',
      lockedAt: null,
      lockOwner: null,
      lastError: null,
      processedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(eventInbox.id, id),
        eq(eventInbox.status, 'processing'),
        eq(eventInbox.lockOwner, lockOwner)
      )
    )
    .returning();

  return updated ? (updated as InboxEventRecord) : null;
}

export async function scheduleInboxRetryOrDeadLetter(options: {
  id: number;
  lockOwner: string;
  attempts: number;
  maxAttempts: number;
  error: unknown;
  now?: Date;
  backoffOptions?: RetryBackoffOptions;
}): Promise<{
  record: InboxEventRecord | null;
  status: 'received' | 'dead_letter' | 'not_owned';
  classification: ReturnType<typeof classifyEventError>;
}> {
  const now = options.now ?? new Date();
  const classification = classifyEventError(options.error);
  const exhausted =
    !classification.retryable || options.attempts >= options.maxAttempts;
  const nextStatus = exhausted ? 'dead_letter' : 'received';
  const nextAvailableAt = exhausted
    ? now
    : computeNextAttemptDate(options.attempts, now, options.backoffOptions);

  const [updated] = await db
    .update(eventInbox)
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
        eq(eventInbox.id, options.id),
        eq(eventInbox.status, 'processing'),
        eq(eventInbox.lockOwner, options.lockOwner)
      )
    )
    .returning();

  if (!updated) {
    return { record: null, status: 'not_owned', classification };
  }

  return {
    record: updated as InboxEventRecord,
    status: nextStatus,
    classification,
  };
}

export async function queryInboxEventsByTenant(
  tenantId: number,
  options: {
    statuses?: InboxStatus[];
    consumerName?: string;
    eventType?: string;
    search?: string;
    from?: Date;
    to?: Date;
    limit?: number;
    offset?: number;
  } = {}
): Promise<{ rows: InboxEventRecord[]; total: number }> {
  const limit = Math.max(1, Math.min(200, options.limit ?? 50));
  const offset = Math.max(0, options.offset ?? 0);
  const conditions = [eq(eventInbox.tenantId, tenantId)];

  if (options.statuses && options.statuses.length > 0) {
    conditions.push(inArray(eventInbox.status, options.statuses));
  }
  if (options.consumerName) {
    conditions.push(eq(eventInbox.consumerName, options.consumerName));
  }
  if (options.eventType) {
    conditions.push(eq(eventInbox.eventType, options.eventType));
  }
  if (options.from) {
    conditions.push(gte(eventInbox.createdAt, options.from));
  }
  if (options.to) {
    conditions.push(lte(eventInbox.createdAt, options.to));
  }
  if (options.search && options.search.trim()) {
    const pattern = `%${options.search.trim()}%`;
    const searchOr = or(
      ilike(eventInbox.eventId, pattern),
      ilike(eventInbox.eventType, pattern),
      ilike(eventInbox.consumerName, pattern),
      ilike(eventInbox.lastError, pattern)
    );
    if (searchOr) conditions.push(searchOr);
  }

  const whereClause = and(...conditions);

  const [countRows, rows] = await Promise.all([
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(eventInbox)
      .where(whereClause),
    db
      .select()
      .from(eventInbox)
      .where(whereClause)
      .orderBy(desc(eventInbox.createdAt))
      .limit(limit)
      .offset(offset),
  ]);

  return {
    rows: rows as InboxEventRecord[],
    total: Number(countRows[0]?.total ?? 0),
  };
}

export async function listInboxEventsByTenant(
  tenantId: number,
  options: { statuses?: InboxStatus[]; consumerName?: string; limit?: number } = {}
): Promise<InboxEventRecord[]> {
  const result = await queryInboxEventsByTenant(tenantId, options);
  return result.rows;
}
