import { randomUUID } from 'node:crypto';
import { db } from '../../db/index.ts';
import { activityLogs } from '../../db/schema.ts';
import {
  createDefaultConsumers,
  publishOutboxBatch,
  type RegisteredConsumer,
} from './event-publisher.ts';
import {
  claimPendingInboxBatch,
  listInboxEventsByTenant,
  markInboxSucceeded,
  queryInboxEventsByTenant,
  recoverExpiredInboxLeases,
  scheduleInboxRetryOrDeadLetter,
  type InboxEventRecord,
  type InboxStatus,
} from './inbox-repository.ts';
import { logPipelineEvent } from './logger.ts';
import {
  listOutboxEventsByTenant,
  queryOutboxEventsByTenant,
  type OutboxEventRecord,
  type OutboxStatus,
} from './outbox-repository.ts';
import type { RetryBackoffOptions } from './retry-policy.ts';
import type { EventWorkerConfig } from './worker-config.ts';

export type WorkerRuntimeStatus = 'disabled' | 'stopped' | 'healthy' | 'unhealthy';

export interface WorkerHealthSnapshot {
  status: WorkerRuntimeStatus;
  workerId: string;
  enabled: boolean;
  running: boolean;
  stopping: boolean;
  healthy: boolean;
  pollIntervalMs: number;
  maxConcurrency: number;
  leaseDurationMs: number;
  lastPollAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
}

export interface PublicWorkerHealthSnapshot {
  status: WorkerRuntimeStatus;
  enabled: boolean;
  running: boolean;
  stopping: boolean;
  healthy: boolean;
  lastPollAt: string | null;
  lastSuccessAt: string | null;
  hasError: boolean;
}

export function toPublicWorkerHealth(
  snapshot: WorkerHealthSnapshot
): PublicWorkerHealthSnapshot {
  return {
    status: snapshot.status,
    enabled: snapshot.enabled,
    running: snapshot.running,
    stopping: snapshot.stopping,
    healthy: snapshot.healthy,
    lastPollAt: snapshot.lastPollAt,
    lastSuccessAt: snapshot.lastSuccessAt,
    hasError: snapshot.lastError !== null,
  };
}

let activeProcessWorkerId: string | null = null;

export function getActiveProcessWorkerId(): string | null {
  return activeProcessWorkerId;
}

export interface EventWorkerCycleSummary {
  outbox: {
    recovered: number;
    claimed: number;
    published: number;
    retried: number;
    deadLettered: number;
  };
  inbox: {
    recovered: number;
    claimed: number;
    succeeded: number;
    retried: number;
    deadLettered: number;
  };
}

export interface DeadLetterQueryOptions {
  source?: 'all' | 'outbox' | 'inbox';
  status?: 'dead_letter' | 'pending' | 'received' | 'processing' | 'published' | 'succeeded';
  consumerName?: string;
  eventType?: string;
  search?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

export async function queryTenantDurableEvents(
  tenantId: number,
  options: DeadLetterQueryOptions = {}
): Promise<{
  outbox: OutboxEventRecord[];
  inbox: InboxEventRecord[];
  outboxTotal: number;
  inboxTotal: number;
}> {
  const source = options.source ?? 'all';
  const limit = Math.max(1, Math.min(100, options.limit ?? 50));
  const offset = Math.max(0, options.offset ?? 0);

  let outboxStatuses: OutboxStatus[] | undefined;
  let inboxStatuses: InboxStatus[] | undefined;
  let skipOutbox = source === 'inbox';
  let skipInbox = source === 'outbox';

  if (options.consumerName && !skipInbox) {
    // Filtering by consumerName applies specifically to inbox records
    skipOutbox = true;
  }

  if (options.status === 'dead_letter') {
    outboxStatuses = ['dead_letter'];
    inboxStatuses = ['dead_letter'];
  } else if (options.status === 'pending' || options.status === 'published') {
    outboxStatuses = [options.status];
    skipInbox = true;
  } else if (options.status === 'received' || options.status === 'succeeded') {
    inboxStatuses = [options.status];
    skipOutbox = true;
  } else if (options.status === 'processing') {
    outboxStatuses = ['processing'];
    inboxStatuses = ['processing'];
  }

  const [outboxRes, inboxRes] = await Promise.all([
    skipOutbox
      ? Promise.resolve({ rows: [] as OutboxEventRecord[], total: 0 })
      : queryOutboxEventsByTenant(tenantId, {
          statuses: outboxStatuses,
          eventType: options.eventType,
          search: options.search,
          from: options.from,
          to: options.to,
          limit,
          offset,
        }),
    skipInbox
      ? Promise.resolve({ rows: [] as InboxEventRecord[], total: 0 })
      : queryInboxEventsByTenant(tenantId, {
          statuses: inboxStatuses,
          consumerName: options.consumerName,
          eventType: options.eventType,
          search: options.search,
          from: options.from,
          to: options.to,
          limit,
          offset,
        }),
  ]);

  return {
    outbox: outboxRes.rows,
    inbox: inboxRes.rows,
    outboxTotal: outboxRes.total,
    inboxTotal: inboxRes.total,
  };
}

export async function listTenantDurableEvents(
  tenantId: number,
  options: DeadLetterQueryOptions = {}
): Promise<{
  outbox: OutboxEventRecord[];
  inbox: InboxEventRecord[];
}> {
  const result = await queryTenantDurableEvents(tenantId, options);
  return { outbox: result.outbox, inbox: result.inbox };
}

export async function listDeadLetterEventsByTenant(
  tenantId: number,
  options: { source?: 'all' | 'outbox' | 'inbox'; limit?: number } = {}
) {
  return listTenantDurableEvents(tenantId, {
    source: options.source ?? 'all',
    status: 'dead_letter',
    limit: options.limit ?? 50,
  });
}

async function runWithConcurrency<T>(
  items: T[],
  maxConcurrency: number,
  workerFn: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;
  const limit = Math.max(1, Math.min(maxConcurrency, items.length));
  let cursor = 0;

  const workers = Array.from({ length: limit }, async () => {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= items.length) return;
      await workerFn(items[idx]!);
    }
  });

  await Promise.all(workers);
}

export class DurableEventWorker {
  readonly workerId: string;
  private readonly config: EventWorkerConfig;
  private readonly consumers: RegisteredConsumer[];
  private readonly backoffOptions?: RetryBackoffOptions;
  private readonly allowMultipleInProcess: boolean;

  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopping = false;
  private inFlightCycle: Promise<EventWorkerCycleSummary> | null = null;
  private lastPollAt: Date | null = null;
  private lastSuccessAt: Date | null = null;
  private lastError: string | null = null;

  constructor(
    config: EventWorkerConfig,
    options: {
      workerId?: string;
      consumers?: RegisteredConsumer[];
      backoffOptions?: RetryBackoffOptions;
      allowMultipleInProcess?: boolean;
    } = {}
  ) {
    this.config = config;
    this.workerId = options.workerId ?? `worker-${process.pid}-${randomUUID().slice(0, 8)}`;
    this.consumers = options.consumers ?? createDefaultConsumers();
    this.backoffOptions = options.backoffOptions;
    this.allowMultipleInProcess = Boolean(options.allowMultipleInProcess);
  }

  start(): void {
    if (!this.config.enabled || this.running) {
      return;
    }
    if (
      !this.allowMultipleInProcess &&
      activeProcessWorkerId !== null &&
      activeProcessWorkerId !== this.workerId
    ) {
      logPipelineEvent({
        level: 'warn',
        event: 'worker_duplicate_start_blocked',
        workerId: this.workerId,
        reason: `Active worker "${activeProcessWorkerId}" is already running in this process.`,
      });
      throw new Error(
        `Duplicate worker startup prevented: "${activeProcessWorkerId}" is already running in this process.`
      );
    }

    if (!this.allowMultipleInProcess) {
      activeProcessWorkerId = this.workerId;
    }
    this.running = true;
    this.stopping = false;

    logPipelineEvent({
      event: 'worker_started',
      workerId: this.workerId,
      pollIntervalMs: this.config.pollIntervalMs,
      batchSize: this.config.batchSize,
      maxConcurrency: this.config.maxConcurrency,
      leaseDurationMs: this.config.leaseDurationMs,
    });

    const scheduleNext = () => {
      if (!this.running || this.stopping) return;
      this.timer = setTimeout(async () => {
        try {
          await this.runSingleCycle();
        } catch (error) {
          this.lastError =
            error instanceof Error ? error.message : 'Worker cycle error.';
        } finally {
          scheduleNext();
        }
      }, this.config.pollIntervalMs);
      this.timer.unref?.();
    };

    void this.runSingleCycle()
      .catch((error) => {
        this.lastError =
          error instanceof Error ? error.message : 'Worker cycle error.';
      })
      .finally(scheduleNext);
  }

  async stop(gracefulTimeoutMs = 10_000): Promise<void> {
    this.stopping = true;
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.inFlightCycle) {
      await Promise.race([
        this.inFlightCycle,
        new Promise<void>((resolve) => setTimeout(resolve, gracefulTimeoutMs)),
      ]);
    }

    if (!this.allowMultipleInProcess && activeProcessWorkerId === this.workerId) {
      activeProcessWorkerId = null;
    }

    logPipelineEvent({
      event: 'worker_stopped',
      workerId: this.workerId,
    });
  }

  getHealthSnapshot(now = new Date()): WorkerHealthSnapshot {
    const staleThresholdMs = Math.max(
      this.config.pollIntervalMs * 5,
      this.config.leaseDurationMs
    );
    const isStale =
      this.config.enabled &&
      this.running &&
      this.lastPollAt !== null &&
      now.getTime() - this.lastPollAt.getTime() > staleThresholdMs;

    let status: WorkerRuntimeStatus;
    if (!this.config.enabled) {
      status = 'disabled';
    } else if (!this.running || this.stopping) {
      status = 'stopped';
    } else if (isStale || this.lastError !== null) {
      status = 'unhealthy';
    } else {
      status = 'healthy';
    }

    const healthy = status === 'disabled' || status === 'healthy';

    return {
      status,
      workerId: this.workerId,
      enabled: this.config.enabled,
      running: this.running,
      stopping: this.stopping,
      healthy,
      pollIntervalMs: this.config.pollIntervalMs,
      maxConcurrency: this.config.maxConcurrency,
      leaseDurationMs: this.config.leaseDurationMs,
      lastPollAt: this.lastPollAt ? this.lastPollAt.toISOString() : null,
      lastSuccessAt: this.lastSuccessAt ? this.lastSuccessAt.toISOString() : null,
      lastError: this.lastError,
    };
  }

  async runSingleCycle(options: {
    now?: Date;
    eventIdFilter?: string;
  } = {}): Promise<EventWorkerCycleSummary> {
    if (this.stopping) {
      return {
        outbox: { recovered: 0, claimed: 0, published: 0, retried: 0, deadLettered: 0 },
        inbox: { recovered: 0, claimed: 0, succeeded: 0, retried: 0, deadLettered: 0 },
      };
    }

    if (this.inFlightCycle) {
      return this.inFlightCycle;
    }

    const cyclePromise = this.executeCycleInternal(options);
    this.inFlightCycle = cyclePromise;
    try {
      return await cyclePromise;
    } finally {
      this.inFlightCycle = null;
    }
  }

  private async executeCycleInternal(options: {
    now?: Date;
    eventIdFilter?: string;
  }): Promise<EventWorkerCycleSummary> {
    const now = options.now ?? new Date();
    this.lastPollAt = now;

    try {
      const outbox = await publishOutboxBatch({
        workerId: this.workerId,
        batchSize: this.config.batchSize,
        leaseDurationMs: this.config.leaseDurationMs,
        consumers: this.consumers,
        now,
        backoffOptions: this.backoffOptions,
        eventIdFilter: options.eventIdFilter,
      });

      const inboxRecovery = await recoverExpiredInboxLeases({
        leaseDurationMs: this.config.leaseDurationMs,
        now,
      });

      let inboxClaimedTotal = 0;
      let inboxSucceeded = 0;
      let inboxRetried = 0;
      let inboxDeadLettered = inboxRecovery.deadLettered.length;

      for (const consumer of this.consumers) {
        if (this.stopping) break;

        const claimed = await claimPendingInboxBatch({
          consumerName: consumer.name,
          workerId: this.workerId,
          batchSize: this.config.batchSize,
          now,
          eventIdFilter: options.eventIdFilter,
        });
        inboxClaimedTotal += claimed.length;

        await runWithConcurrency(
          claimed,
          this.config.maxConcurrency,
          async (inboxRow) => {
            const correlationId =
              typeof inboxRow.payload?.correlationId === 'string'
                ? inboxRow.payload.correlationId
                : undefined;
            logPipelineEvent({
              event: 'event_processing_started',
              workerId: this.workerId,
              tenantId: inboxRow.tenantId,
              eventId: inboxRow.eventId,
              correlationId,
              eventType: inboxRow.eventType,
              consumerName: inboxRow.consumerName,
              inboxId: inboxRow.id,
              attempt: inboxRow.attempts,
            });

            try {
              await consumer.handler(inboxRow);
              await markInboxSucceeded(inboxRow.id, this.workerId, new Date());
              inboxSucceeded += 1;
              logPipelineEvent({
                event: 'event_processing_succeeded',
                workerId: this.workerId,
                tenantId: inboxRow.tenantId,
                eventId: inboxRow.eventId,
                correlationId,
                eventType: inboxRow.eventType,
                consumerName: inboxRow.consumerName,
                inboxId: inboxRow.id,
                attempt: inboxRow.attempts,
                status: 'succeeded',
              });
            } catch (error) {
              const outcome = await scheduleInboxRetryOrDeadLetter({
                id: inboxRow.id,
                lockOwner: this.workerId,
                attempts: inboxRow.attempts,
                maxAttempts: inboxRow.maxAttempts,
                error,
                now: new Date(),
                backoffOptions: this.backoffOptions,
              });

              if (outcome.status === 'dead_letter') {
                inboxDeadLettered += 1;
                await db
                  .insert(activityLogs)
                  .values({
                    tenantId: inboxRow.tenantId,
                    idempotencyKey: `dlq:inbox:${inboxRow.consumerName}:${inboxRow.eventId}`,
                    actorUid: 'system:event-worker',
                    actorLabel: 'Event Worker',
                    module: 'integration',
                    action: 'event.inbox_dead_lettered',
                    entityType: 'event_inbox',
                    entityId: String(inboxRow.id),
                    summary: `Inbox consumer "${inboxRow.consumerName}" dead-lettered "${inboxRow.eventId}": ${outcome.classification.sanitizedMessage}`,
                    metadata: {
                      eventId: inboxRow.eventId,
                      correlationId: correlationId ?? null,
                      consumerName: inboxRow.consumerName,
                      attempts: inboxRow.attempts,
                    },
                  })
                  .onConflictDoNothing({
                    target: [activityLogs.tenantId, activityLogs.idempotencyKey],
                  });

                logPipelineEvent({
                  level: 'error',
                  event: 'event_dead_lettered',
                  workerId: this.workerId,
                  tenantId: inboxRow.tenantId,
                  eventId: inboxRow.eventId,
                  correlationId,
                  eventType: inboxRow.eventType,
                  consumerName: inboxRow.consumerName,
                  inboxId: inboxRow.id,
                  attempt: inboxRow.attempts,
                  maxAttempts: inboxRow.maxAttempts,
                  reason: outcome.classification.sanitizedMessage,
                });
              } else if (outcome.status === 'received') {
                inboxRetried += 1;
                logPipelineEvent({
                  level: 'warn',
                  event: 'retry_scheduled',
                  workerId: this.workerId,
                  tenantId: inboxRow.tenantId,
                  eventId: inboxRow.eventId,
                  correlationId,
                  eventType: inboxRow.eventType,
                  consumerName: inboxRow.consumerName,
                  inboxId: inboxRow.id,
                  attempt: inboxRow.attempts,
                  nextAvailableAt: outcome.record?.availableAt.toISOString(),
                  reason: outcome.classification.sanitizedMessage,
                });
              }
            }
          }
        );
      }

      this.lastSuccessAt = new Date();
      this.lastError = null;

      return {
        outbox,
        inbox: {
          recovered: inboxRecovery.requeued.length,
          claimed: inboxClaimedTotal,
          succeeded: inboxSucceeded,
          retried: inboxRetried,
          deadLettered: inboxDeadLettered,
        },
      };
    } catch (error) {
      this.lastError =
        error instanceof Error ? error.message : 'Unexpected worker cycle error.';
      throw error;
    }
  }
}
