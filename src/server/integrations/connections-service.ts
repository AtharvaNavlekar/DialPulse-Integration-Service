import { and, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
  activityLogs,
  automationExecutions,
  eventInbox,
  eventOutbox,
  eventReplayLogs,
  externalIdMappings,
  integrationConnections,
  providerWebhookLogs,
} from '../../db/schema.ts';
import { HttpCentralCrmAdapter } from '../adapters/central-crm-http.ts';
import { HttpClientCrmAdapter } from '../adapters/client-crm-http.ts';
import type { WorkerHealthSnapshot } from '../events/event-worker.ts';
import type { SecretReference, SecretStore } from './contracts.ts';
import {
  PROVIDER_REGISTRY,
  getProviderRegistryEntry,
} from './provider-registry.ts';
import {
  SecretReferenceSchema,
  SecretResolutionError,
  assertNonSensitiveConfig,
  defaultSecretStore,
  getSecretStorageStatus,
  maskSecretReference,
} from './secret-store.ts';
import { getWebhookVerifier } from './webhook-verifier.ts';

export type ConnectionStatus =
  | 'pending'
  | 'verified'
  | 'active'
  | 'disabled'
  | 'error'
  | 'revoked';

export class ConnectionLifecycleError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'ConnectionLifecycleError';
    this.statusCode = statusCode;
  }
}

export interface SafeIntegrationConnectionView {
  id: number;
  tenantId: number;
  providerId: string;
  connectionName: string;
  status: ConnectionStatus;
  authMode: string;
  secretRef: SecretReference;
  allowedScopes: string[];
  config: Record<string, unknown>;
  environment: string;
  approvedByUid: string | null;
  approvedAt: Date | null;
  lastSuccessAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorSummary: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toSafeConnectionView(
  row: typeof integrationConnections.$inferSelect
): SafeIntegrationConnectionView {
  return {
    id: row.id,
    tenantId: row.tenantId,
    providerId: row.providerId,
    connectionName: row.connectionName,
    status: row.status as ConnectionStatus,
    authMode: row.authMode,
    secretRef: maskSecretReference(row.secretRef),
    allowedScopes: row.allowedScopes ?? [],
    config: row.config ?? {},
    environment: row.environment,
    approvedByUid: row.approvedByUid,
    approvedAt: row.approvedAt,
    lastSuccessAt: row.lastSuccessAt,
    lastErrorAt: row.lastErrorAt,
    lastErrorSummary: row.lastErrorSummary,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface CreatePendingConnectionInput {
  tenantId: number;
  providerId: string;
  connectionName: string;
  authMode: 'service_jwt' | 'oauth2' | 'api_key_hmac' | 'webhook_hmac';
  secretRef: SecretReference;
  allowedScopes: string[];
  config: Record<string, unknown>;
  environment: 'development' | 'staging' | 'production';
  actorUid: string;
  actorLabel: string;
}

export async function createPendingConnection(
  input: CreatePendingConnectionInput
): Promise<SafeIntegrationConnectionView> {
  const provider = getProviderRegistryEntry(input.providerId);
  if (!provider) {
    throw new ConnectionLifecycleError(
      400,
      `Unknown integration provider "${input.providerId}".`
    );
  }

  if (input.authMode !== provider.authMethod) {
    throw new ConnectionLifecycleError(
      400,
      `Provider "${provider.providerId}" requires authMode "${provider.authMethod}", not "${input.authMode}".`
    );
  }

  const parsedSecretRef = SecretReferenceSchema.safeParse(input.secretRef);
  if (!parsedSecretRef.success) {
    throw new ConnectionLifecycleError(
      400,
      parsedSecretRef.error.issues[0]?.message ?? 'Invalid secretRef format.'
    );
  }

  try {
    assertNonSensitiveConfig(input.config);
  } catch (error) {
    throw new ConnectionLifecycleError(
      400,
      error instanceof Error ? error.message : 'Config contains sensitive keys.'
    );
  }

  const normalizedName = input.connectionName.trim();
  const dedupedScopes = Array.from(
    new Set(input.allowedScopes.map((s) => s.trim()).filter(Boolean))
  );

  try {
    const [created] = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(integrationConnections)
        .values({
          tenantId: input.tenantId,
          providerId: provider.providerId,
          connectionName: normalizedName,
          status: 'pending',
          authMode: input.authMode,
          secretRef: parsedSecretRef.data,
          allowedScopes: dedupedScopes,
          config: input.config,
          environment: input.environment,
        })
        .returning();

      await tx.insert(activityLogs).values({
        tenantId: input.tenantId,
        actorUid: input.actorUid,
        actorLabel: input.actorLabel,
        module: 'integration',
        action: 'integration.connection_created',
        entityType: 'integration_connection',
        entityId: String(row!.id),
        summary: `Created pending ${provider.providerId} connection "${normalizedName}".`,
        metadata: {
          providerId: provider.providerId,
          status: 'pending',
          environment: input.environment,
        },
      });

      return [row!];
    });

    return toSafeConnectionView(created);
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      (error as { code?: string }).code === '23505'
    ) {
      throw new ConnectionLifecycleError(
        409,
        `A connection named "${normalizedName}" already exists for provider "${provider.providerId}" in this tenant.`
      );
    }
    throw error;
  }
}

export async function listConnectionsByTenant(
  tenantId: number,
  options: { providerId?: string; status?: string; limit?: number } = {}
): Promise<SafeIntegrationConnectionView[]> {
  const limit = Math.max(1, Math.min(100, options.limit ?? 50));
  const conditions = [eq(integrationConnections.tenantId, tenantId)];
  if (options.providerId) {
    conditions.push(eq(integrationConnections.providerId, options.providerId));
  }
  if (options.status) {
    conditions.push(eq(integrationConnections.status, options.status));
  }

  const rows = await db
    .select()
    .from(integrationConnections)
    .where(and(...conditions))
    .orderBy(desc(integrationConnections.updatedAt))
    .limit(limit);

  return rows.map(toSafeConnectionView);
}

export async function getConnectionByIdForTenant(
  tenantId: number,
  connectionId: number
): Promise<SafeIntegrationConnectionView | null> {
  const rows = await db
    .select()
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.id, connectionId),
        eq(integrationConnections.tenantId, tenantId)
      )
    )
    .limit(1);

  return rows[0] ? toSafeConnectionView(rows[0]) : null;
}

export async function activateConnection(options: {
  tenantId: number;
  connectionId: number;
  actorUid: string;
  actorLabel: string;
  secretStore?: SecretStore;
}): Promise<SafeIntegrationConnectionView> {
  const secretStore = options.secretStore ?? defaultSecretStore;
  const rows = await db
    .select()
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.id, options.connectionId),
        eq(integrationConnections.tenantId, options.tenantId)
      )
    )
    .limit(1);

  const conn = rows[0];
  if (!conn) {
    throw new ConnectionLifecycleError(404, 'Integration connection not found.');
  }

  if (conn.status === 'revoked') {
    throw new ConnectionLifecycleError(
      409,
      'Revoked connections cannot be reactivated. Create a new pending connection.'
    );
  }

  const provider = getProviderRegistryEntry(conn.providerId);
  if (!provider) {
    throw new ConnectionLifecycleError(
      400,
      `Unknown provider "${conn.providerId}" in connection record.`
    );
  }

  if (provider.status === 'planned_unapproved') {
    throw new ConnectionLifecycleError(
      422,
      `Provider "${provider.providerId}" is planned_unapproved and cannot be activated until vendor compliance sign-off and verified adapter/verifier protocols exist.`
    );
  }

  if (conn.authMode !== provider.authMethod) {
    throw new ConnectionLifecycleError(
      400,
      `Connection authMode "${conn.authMode}" does not match provider required method "${provider.authMethod}".`
    );
  }

  const scopeSet = new Set(conn.allowedScopes ?? []);
  const missingScopes = provider.requiredScopes.filter((s) => !scopeSet.has(s));
  if (missingScopes.length > 0) {
    throw new ConnectionLifecycleError(
      400,
      `Connection is missing required scopes: ${missingScopes.join(', ')}.`
    );
  }

  if (provider.webhookSupport && !getWebhookVerifier(provider.providerId, { secretStore })) {
    throw new ConnectionLifecycleError(
      422,
      `Provider "${provider.providerId}" declares webhook support, but no verified WebhookVerifier protocol is registered.`
    );
  }

  try {
    const resolved = await secretStore.resolveSecret(conn.secretRef);
    if (!resolved || !resolved.trim()) {
      throw new SecretResolutionError(
        'SECRET_NOT_FOUND',
        'Resolved secret was empty.'
      );
    }
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : 'Unable to resolve connection secret.';
    await db
      .update(integrationConnections)
      .set({
        status: 'error',
        lastErrorAt: new Date(),
        lastErrorSummary: reason.slice(0, 300),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(integrationConnections.id, conn.id),
          eq(integrationConnections.tenantId, options.tenantId)
        )
      );
    throw new ConnectionLifecycleError(
      422,
      `Cannot activate connection: ${reason}`
    );
  }

  const now = new Date();
  const [updated] = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(integrationConnections)
      .set({
        status: 'active',
        approvedByUid: options.actorUid,
        approvedAt: now,
        lastErrorSummary: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(integrationConnections.id, conn.id),
          eq(integrationConnections.tenantId, options.tenantId)
        )
      )
      .returning();

    await tx.insert(activityLogs).values({
      tenantId: options.tenantId,
      actorUid: options.actorUid,
      actorLabel: options.actorLabel,
      module: 'integration',
      action: 'integration.connection_activated',
      entityType: 'integration_connection',
      entityId: String(conn.id),
      summary: `Activated ${conn.providerId} connection "${conn.connectionName}".`,
      metadata: {
        providerId: conn.providerId,
        environment: conn.environment,
        maxDataClassification: provider.maxDataClassification,
      },
    });

    return [row!];
  });

  return toSafeConnectionView(updated);
}

export async function transitionConnectionStatus(options: {
  tenantId: number;
  connectionId: number;
  targetStatus: 'disabled' | 'revoked';
  actorUid: string;
  actorLabel: string;
  reason?: string;
}): Promise<SafeIntegrationConnectionView> {
  const rows = await db
    .select()
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.id, options.connectionId),
        eq(integrationConnections.tenantId, options.tenantId)
      )
    )
    .limit(1);

  const conn = rows[0];
  if (!conn) {
    throw new ConnectionLifecycleError(404, 'Integration connection not found.');
  }

  if (conn.status === 'revoked' && options.targetStatus === 'disabled') {
    throw new ConnectionLifecycleError(
      409,
      'Revoked connections cannot be transitioned to disabled.'
    );
  }

  const now = new Date();
  const [updated] = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(integrationConnections)
      .set({
        status: options.targetStatus,
        updatedAt: now,
      })
      .where(
        and(
          eq(integrationConnections.id, conn.id),
          eq(integrationConnections.tenantId, options.tenantId)
        )
      )
      .returning();

    await tx.insert(activityLogs).values({
      tenantId: options.tenantId,
      actorUid: options.actorUid,
      actorLabel: options.actorLabel,
      module: 'integration',
      action: `integration.connection_${options.targetStatus}`,
      entityType: 'integration_connection',
      entityId: String(conn.id),
      summary: `Set ${conn.providerId} connection "${conn.connectionName}" to ${options.targetStatus}.`,
      metadata: {
        providerId: conn.providerId,
        previousStatus: conn.status,
        reason: options.reason ?? null,
      },
    });

    return [row!];
  });

  return toSafeConnectionView(updated);
}

export interface WebhookLogQueryFilters {
  connectionId?: number;
  providerId?: string;
  verificationOutcome?: string;
  processingStatus?: string;
  eventType?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

export async function queryWebhookLogsByTenant(
  tenantId: number,
  options: WebhookLogQueryFilters = {}
) {
  const limit = Math.max(1, Math.min(100, options.limit ?? 25));
  const offset = Math.max(0, options.offset ?? 0);
  const conditions = [eq(providerWebhookLogs.tenantId, tenantId)];

  if (options.connectionId) {
    conditions.push(eq(providerWebhookLogs.connectionId, options.connectionId));
  }
  if (options.providerId) {
    conditions.push(eq(providerWebhookLogs.providerId, options.providerId));
  }
  if (options.verificationOutcome) {
    conditions.push(
      eq(providerWebhookLogs.verificationOutcome, options.verificationOutcome)
    );
  }
  if (options.processingStatus) {
    conditions.push(
      eq(providerWebhookLogs.processingStatus, options.processingStatus)
    );
  }
  if (options.eventType) {
    conditions.push(ilike(providerWebhookLogs.eventType, `%${options.eventType}%`));
  }
  if (options.from) {
    conditions.push(gte(providerWebhookLogs.receivedAt, options.from));
  }
  if (options.to) {
    conditions.push(lte(providerWebhookLogs.receivedAt, options.to));
  }

  const whereExpr = and(...conditions);

  const [countRows, rows] = await Promise.all([
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(providerWebhookLogs)
      .where(whereExpr),
    db
      .select({
        id: providerWebhookLogs.id,
        tenantId: providerWebhookLogs.tenantId,
        connectionId: providerWebhookLogs.connectionId,
        connectionName: integrationConnections.connectionName,
        providerId: providerWebhookLogs.providerId,
        providerEventId: providerWebhookLogs.providerEventId,
        eventType: providerWebhookLogs.eventType,
        payloadSha256: providerWebhookLogs.payloadSha256,
        verificationOutcome: providerWebhookLogs.verificationOutcome,
        processingStatus: providerWebhookLogs.processingStatus,
        httpStatus: providerWebhookLogs.httpStatus,
        sanitizedFailureReason: providerWebhookLogs.sanitizedFailureReason,
        receivedAt: providerWebhookLogs.receivedAt,
        processedAt: providerWebhookLogs.processedAt,
      })
      .from(providerWebhookLogs)
      .leftJoin(
        integrationConnections,
        and(
          eq(providerWebhookLogs.connectionId, integrationConnections.id),
          eq(providerWebhookLogs.tenantId, integrationConnections.tenantId)
        )
      )
      .where(whereExpr)
      .orderBy(desc(providerWebhookLogs.receivedAt))
      .limit(limit)
      .offset(offset),
  ]);

  return {
    logs: rows,
    total: Number(countRows[0]?.total ?? 0),
  };
}

export async function listWebhookLogsByTenant(
  tenantId: number,
  options: WebhookLogQueryFilters = {}
) {
  const result = await queryWebhookLogsByTenant(tenantId, options);
  return result.logs;
}

export async function getConnectionDetailsForTenant(
  tenantId: number,
  connectionId: number
) {
  const connection = await getConnectionByIdForTenant(tenantId, connectionId);
  if (!connection) return null;

  const provider = getProviderRegistryEntry(connection.providerId) ?? null;

  const [webhooksRes, relatedMappings, auditHistory] = await Promise.all([
    queryWebhookLogsByTenant(tenantId, { connectionId, limit: 15, offset: 0 }),
    db
      .select()
      .from(externalIdMappings)
      .where(
        and(
          eq(externalIdMappings.tenantId, tenantId),
          eq(externalIdMappings.connectionId, connectionId)
        )
      )
      .orderBy(desc(externalIdMappings.updatedAt))
      .limit(20),
    db
      .select()
      .from(activityLogs)
      .where(
        and(
          eq(activityLogs.tenantId, tenantId),
          eq(activityLogs.module, 'integration'),
          eq(activityLogs.entityType, 'integration_connection'),
          eq(activityLogs.entityId, String(connectionId))
        )
      )
      .orderBy(desc(activityLogs.createdAt))
      .limit(25),
  ]);

  return {
    connection,
    provider,
    recentWebhooks: webhooksRes.logs,
    webhookTotal: webhooksRes.total,
    relatedMappings,
    auditHistory,
  };
}

export async function getIntegrationOverview(
  tenantId: number,
  workerHealth: WorkerHealthSnapshot
) {
  const [
    connectionStatusRows,
    webhookAggRows,
    outboxStatusRows,
    inboxStatusRows,
    outboxObservabilityRows,
    inboxObservabilityRows,
    retryingExecRows,
    mappingsCountRows,
  ] = await Promise.all([
    db
      .select({
        status: integrationConnections.status,
        count: sql<number>`count(*)::int`,
      })
      .from(integrationConnections)
      .where(eq(integrationConnections.tenantId, tenantId))
      .groupBy(integrationConnections.status),
    db
      .select({
        total: sql<number>`count(*)::int`,
        verified: sql<number>`count(*) filter (where ${providerWebhookLogs.verificationOutcome} = 'verified')::int`,
        rejected: sql<number>`count(*) filter (where ${providerWebhookLogs.verificationOutcome} <> 'verified')::int`,
        processed: sql<number>`count(*) filter (where ${providerWebhookLogs.processingStatus} in ('accepted', 'enqueued', 'duplicate'))::int`,
        failed: sql<number>`count(*) filter (where ${providerWebhookLogs.processingStatus} in ('rejected', 'error'))::int`,
        lastReceivedAt: sql<Date | null>`max(${providerWebhookLogs.receivedAt})`,
      })
      .from(providerWebhookLogs)
      .where(eq(providerWebhookLogs.tenantId, tenantId)),
    db
      .select({
        status: eventOutbox.status,
        count: sql<number>`count(*)::int`,
      })
      .from(eventOutbox)
      .where(eq(eventOutbox.tenantId, tenantId))
      .groupBy(eventOutbox.status),
    db
      .select({
        status: eventInbox.status,
        count: sql<number>`count(*)::int`,
      })
      .from(eventInbox)
      .where(eq(eventInbox.tenantId, tenantId))
      .groupBy(eventInbox.status),
    db
      .select({
        retryableCount: sql<number>`count(*) filter (where ${eventOutbox.status} = 'pending' and ${eventOutbox.attempts} > 0)::int`,
        oldestPendingAt: sql<Date | string | null>`min(${eventOutbox.createdAt}) filter (where ${eventOutbox.status} = 'pending')`,
        lastPublishedAt: sql<Date | string | null>`max(${eventOutbox.publishedAt})`,
      })
      .from(eventOutbox)
      .where(eq(eventOutbox.tenantId, tenantId)),
    db
      .select({
        retryableCount: sql<number>`count(*) filter (where ${eventInbox.status} = 'received' and ${eventInbox.attempts} > 0)::int`,
        oldestReceivedAt: sql<Date | string | null>`min(${eventInbox.createdAt}) filter (where ${eventInbox.status} = 'received')`,
        lastProcessedAt: sql<Date | string | null>`max(${eventInbox.processedAt})`,
      })
      .from(eventInbox)
      .where(eq(eventInbox.tenantId, tenantId)),
    db
      .select({
        count: sql<number>`count(*)::int`,
      })
      .from(automationExecutions)
      .where(
        and(
          eq(automationExecutions.tenantId, tenantId),
          eq(automationExecutions.status, 'retrying')
        )
      ),
    db
      .select({
        total: sql<number>`count(*)::int`,
      })
      .from(externalIdMappings)
      .where(eq(externalIdMappings.tenantId, tenantId)),
  ]);

  const connCounts = {
    total: 0,
    active: 0,
    pending: 0,
    verified: 0,
    disabled: 0,
    revoked: 0,
    error: 0,
  };
  for (const row of connectionStatusRows) {
    const c = Number(row.count ?? 0);
    connCounts.total += c;
    if (row.status in connCounts) {
      connCounts[row.status as keyof typeof connCounts] += c;
    }
  }

  const outboxCounts = {
    pending: 0,
    processing: 0,
    published: 0,
    dead_letter: 0,
  };
  for (const row of outboxStatusRows) {
    if (row.status in outboxCounts) {
      outboxCounts[row.status as keyof typeof outboxCounts] = Number(row.count ?? 0);
    }
  }

  const inboxCounts = {
    received: 0,
    processing: 0,
    succeeded: 0,
    dead_letter: 0,
  };
  for (const row of inboxStatusRows) {
    if (row.status in inboxCounts) {
      inboxCounts[row.status as keyof typeof inboxCounts] = Number(row.count ?? 0);
    }
  }

  const outboxObs = outboxObservabilityRows[0];
  const inboxObs = inboxObservabilityRows[0];
  const pendingDates = [outboxObs?.oldestPendingAt, inboxObs?.oldestReceivedAt]
    .filter((v): v is Date | string => v !== null && v !== undefined)
    .map((v) => (v instanceof Date ? v : new Date(v)))
    .filter((d) => !Number.isNaN(d.getTime()));
  const oldestPendingDate =
    pendingDates.length > 0
      ? new Date(Math.min(...pendingDates.map((d) => d.getTime())))
      : null;
  const oldestPendingAgeSeconds = oldestPendingDate
    ? Math.max(0, Math.floor((Date.now() - oldestPendingDate.getTime()) / 1000))
    : null;

  const processedDates = [outboxObs?.lastPublishedAt, inboxObs?.lastProcessedAt]
    .filter((v): v is Date | string => v !== null && v !== undefined)
    .map((v) => (v instanceof Date ? v : new Date(v)))
    .filter((d) => !Number.isNaN(d.getTime()));
  const lastSuccessfulProcessedDate =
    processedDates.length > 0
      ? new Date(Math.max(...processedDates.map((d) => d.getTime())))
      : null;

  const retryableFailures =
    Number(outboxObs?.retryableCount ?? 0) +
    Number(inboxObs?.retryableCount ?? 0) +
    Number(retryingExecRows[0]?.count ?? 0);

  const webhookAgg = webhookAggRows[0];
  const clientCrm = new HttpClientCrmAdapter();
  const centralCrm = new HttpCentralCrmAdapter();

  return {
    providersTotal: PROVIDER_REGISTRY.length,
    connections: connCounts,
    webhooks: {
      total: Number(webhookAgg?.total ?? 0),
      verified: Number(webhookAgg?.verified ?? 0),
      rejected: Number(webhookAgg?.rejected ?? 0),
      processed: Number(webhookAgg?.processed ?? 0),
      failed: Number(webhookAgg?.failed ?? 0),
      lastReceivedAt: webhookAgg?.lastReceivedAt
        ? new Date(webhookAgg.lastReceivedAt).toISOString()
        : null,
    },
    events: {
      outboxPending: outboxCounts.pending,
      outboxProcessing: outboxCounts.processing,
      outboxPublished: outboxCounts.published,
      outboxDeadLetter: outboxCounts.dead_letter,
      inboxReceived: inboxCounts.received,
      inboxProcessing: inboxCounts.processing,
      inboxSucceeded: inboxCounts.succeeded,
      inboxDeadLetter: inboxCounts.dead_letter,
      totalProcessed: outboxCounts.published + inboxCounts.succeeded,
      totalDeadLetter: outboxCounts.dead_letter + inboxCounts.dead_letter,
      retryableFailures,
      oldestPendingAt: oldestPendingDate ? oldestPendingDate.toISOString() : null,
      oldestPendingAgeSeconds,
      lastSuccessfulProcessedAt: lastSuccessfulProcessedDate
        ? lastSuccessfulProcessedDate.toISOString()
        : null,
    },
    mappingsTotal: Number(mappingsCountRows[0]?.total ?? 0),
    worker: workerHealth,
    secretManager: getSecretStorageStatus(),
    ecosystemAdapters: {
      clientCrm: clientCrm.getStatusSummary(),
      centralCrm: centralCrm.getStatusSummary(),
    },
  };
}

export interface IntegrationAuditEntry {
  id: string;
  entryType: 'activity' | 'replay';
  timestamp: string;
  actorUid: string;
  actorLabel: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  reason: string | null;
  source: string | null;
  eventId: string | null;
  consumerName: string | null;
  previousStatus: string | null;
  previousAttempts: number | null;
  previousLastError: string | null;
  metadata: Record<string, unknown>;
}

export async function listIntegrationAuditHistory(
  tenantId: number,
  options: {
    entryType?: 'all' | 'activity' | 'replay';
    connectionId?: number;
    eventId?: string;
    search?: string;
    from?: Date;
    to?: Date;
    limit?: number;
    offset?: number;
  } = {}
): Promise<{ entries: IntegrationAuditEntry[]; total: number }> {
  const entryType = options.entryType ?? 'all';
  const limit = Math.max(1, Math.min(100, options.limit ?? 25));
  const offset = Math.max(0, options.offset ?? 0);
  const fetchLimit = Math.min(250, limit + offset);

  const loadActivities = async (): Promise<IntegrationAuditEntry[]> => {
    if (entryType === 'replay') return [];
    const conditions = [
      eq(activityLogs.tenantId, tenantId),
      eq(activityLogs.module, 'integration'),
    ];
    if (options.connectionId) {
      conditions.push(eq(activityLogs.entityType, 'integration_connection'));
      conditions.push(eq(activityLogs.entityId, String(options.connectionId)));
    }
    if (options.from) {
      conditions.push(gte(activityLogs.createdAt, options.from));
    }
    if (options.to) {
      conditions.push(lte(activityLogs.createdAt, options.to));
    }
    if (options.search && options.search.trim()) {
      const pattern = `%${options.search.trim()}%`;
      const sOr = or(
        ilike(activityLogs.summary, pattern),
        ilike(activityLogs.action, pattern),
        ilike(activityLogs.actorLabel, pattern),
        ilike(activityLogs.entityId, pattern)
      );
      if (sOr) conditions.push(sOr);
    }

    const rows = await db
      .select()
      .from(activityLogs)
      .where(and(...conditions))
      .orderBy(desc(activityLogs.createdAt))
      .limit(fetchLimit);

    return rows.map((row) => ({
      id: `activity-${row.id}`,
      entryType: 'activity' as const,
      timestamp: row.createdAt.toISOString(),
      actorUid: row.actorUid,
      actorLabel: row.actorLabel,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      summary: row.summary,
      reason:
        typeof row.metadata?.reason === 'string' ? row.metadata.reason : null,
      source:
        typeof row.metadata?.source === 'string' ? row.metadata.source : null,
      eventId:
        typeof row.metadata?.eventId === 'string' ? row.metadata.eventId : null,
      consumerName:
        typeof row.metadata?.consumerName === 'string'
          ? row.metadata.consumerName
          : null,
      previousStatus: null,
      previousAttempts: null,
      previousLastError: null,
      metadata: row.metadata ?? {},
    }));
  };

  const loadReplays = async (): Promise<IntegrationAuditEntry[]> => {
    if (entryType === 'activity' || options.connectionId) return [];
    const conditions = [eq(eventReplayLogs.tenantId, tenantId)];
    if (options.eventId) {
      conditions.push(eq(eventReplayLogs.eventId, options.eventId));
    }
    if (options.from) {
      conditions.push(gte(eventReplayLogs.replayedAt, options.from));
    }
    if (options.to) {
      conditions.push(lte(eventReplayLogs.replayedAt, options.to));
    }
    if (options.search && options.search.trim()) {
      const pattern = `%${options.search.trim()}%`;
      const sOr = or(
        ilike(eventReplayLogs.eventId, pattern),
        ilike(eventReplayLogs.reason, pattern),
        ilike(eventReplayLogs.replayedByLabel, pattern),
        ilike(eventReplayLogs.consumerName, pattern)
      );
      if (sOr) conditions.push(sOr);
    }

    const rows = await db
      .select()
      .from(eventReplayLogs)
      .where(and(...conditions))
      .orderBy(desc(eventReplayLogs.replayedAt))
      .limit(fetchLimit);

    return rows.map((row) => ({
      id: `replay-${row.id}`,
      entryType: 'replay' as const,
      timestamp: row.replayedAt.toISOString(),
      actorUid: row.replayedByUid,
      actorLabel: row.replayedByLabel,
      action: `event.dlq_replay_${row.source}`,
      entityType: row.source === 'outbox' ? 'event_outbox' : 'event_inbox',
      entityId: String(row.targetRowId),
      summary: `Replayed ${row.source} event "${row.eventId}" (${row.previousAttempts} prior attempt(s)). Reason: ${row.reason}`,
      reason: row.reason,
      source: row.source,
      eventId: row.eventId,
      consumerName: row.consumerName,
      previousStatus: row.previousStatus,
      previousAttempts: row.previousAttempts,
      previousLastError: row.previousLastError,
      metadata: {
        source: row.source,
        targetRowId: row.targetRowId,
        previousStatus: row.previousStatus,
        previousAttempts: row.previousAttempts,
      },
    }));
  };

  const [activities, replays] = await Promise.all([
    loadActivities(),
    loadReplays(),
  ]);

  const combined = [...activities, ...replays].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  return {
    entries: combined.slice(offset, offset + limit),
    total: combined.length,
  };
}
