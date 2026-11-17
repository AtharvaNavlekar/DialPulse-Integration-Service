import { buildConsoleQueryString } from '../../shared/integrations-console.ts';
import type {
  ConnectionDetailsPayload,
  DurableEventRecord,
  EcosystemAdapterStatusSummary,
  ExternalMappingRecord,
  IntegrationAuditEntryRecord,
  IntegrationConnectionRecord,
  IntegrationOverviewPayload,
  IntegrationSecretReference,
  IntegrationWorkerHealth,
  ProviderCatalogEntry,
  SecretStorageReadinessSummary,
  WebhookLogRecord,
} from '../../shared/types.ts';

export type ApiFetchFn = <T>(path: string, options?: RequestInit) => Promise<T>;

export interface ProviderCatalogResponse {
  providers: ProviderCatalogEntry[];
  ecosystemAdapters: {
    clientCrm: EcosystemAdapterStatusSummary;
    centralCrm: EcosystemAdapterStatusSummary;
  };
  secretManager: SecretStorageReadinessSummary;
}

export interface WebhookLogsResponse {
  logs: WebhookLogRecord[];
  total: number;
  limit: number;
  offset: number;
}

export interface DurableEventsResponse {
  outbox: DurableEventRecord[];
  inbox: DurableEventRecord[];
  outboxTotal: number;
  inboxTotal: number;
  limit: number;
  offset: number;
}

export interface ExternalMappingsResponse {
  mappings: ExternalMappingRecord[];
  total: number;
  limit: number;
  offset: number;
}

export interface IntegrationAuditResponse {
  entries: IntegrationAuditEntryRecord[];
  total: number;
  limit: number;
  offset: number;
}

export interface ReplayDeadLetterResponse {
  source: 'outbox' | 'inbox';
  eventId: string;
  previousStatus: string;
  newStatus: string;
  replayCount: number;
  replayedAt: string;
}

export async function fetchIntegrationOverview(
  apiFetch: ApiFetchFn
): Promise<IntegrationOverviewPayload> {
  return apiFetch<IntegrationOverviewPayload>('/api/integrations/overview');
}

export async function fetchProviderCatalog(
  apiFetch: ApiFetchFn
): Promise<ProviderCatalogResponse> {
  return apiFetch<ProviderCatalogResponse>('/api/integrations/providers');
}

export async function fetchConnections(
  apiFetch: ApiFetchFn,
  filters: {
    providerId?: string;
    status?: string;
    limit?: number;
  } = {}
): Promise<{ connections: IntegrationConnectionRecord[] }> {
  const qs = buildConsoleQueryString({
    providerId: filters.providerId,
    status: filters.status,
    limit: filters.limit ?? 100,
  });
  return apiFetch<{ connections: IntegrationConnectionRecord[] }>(
    `/api/integrations/connections${qs}`
  );
}

export async function createPendingConnectionApi(
  apiFetch: ApiFetchFn,
  payload: {
    providerId: string;
    connectionName: string;
    authMode: 'service_jwt' | 'oauth2' | 'api_key_hmac' | 'webhook_hmac';
    secretRef: IntegrationSecretReference;
    allowedScopes: string[];
    config: Record<string, unknown>;
    environment: 'development' | 'staging' | 'production';
  }
): Promise<{ connection: IntegrationConnectionRecord }> {
  return apiFetch<{ connection: IntegrationConnectionRecord }>(
    '/api/integrations/connections',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );
}

export async function activateConnectionApi(
  apiFetch: ApiFetchFn,
  connectionId: number
): Promise<{ connection: IntegrationConnectionRecord }> {
  return apiFetch<{ connection: IntegrationConnectionRecord }>(
    `/api/integrations/connections/${connectionId}/activate`,
    { method: 'POST' }
  );
}

export async function disableConnectionApi(
  apiFetch: ApiFetchFn,
  connectionId: number,
  reason?: string
): Promise<{ connection: IntegrationConnectionRecord }> {
  return apiFetch<{ connection: IntegrationConnectionRecord }>(
    `/api/integrations/connections/${connectionId}/disable`,
    {
      method: 'POST',
      body: JSON.stringify(reason ? { reason } : {}),
    }
  );
}

export async function revokeConnectionApi(
  apiFetch: ApiFetchFn,
  connectionId: number,
  reason?: string
): Promise<{ connection: IntegrationConnectionRecord }> {
  return apiFetch<{ connection: IntegrationConnectionRecord }>(
    `/api/integrations/connections/${connectionId}/revoke`,
    {
      method: 'POST',
      body: JSON.stringify(reason ? { reason } : {}),
    }
  );
}

export async function fetchConnectionDetails(
  apiFetch: ApiFetchFn,
  connectionId: number
): Promise<ConnectionDetailsPayload> {
  return apiFetch<ConnectionDetailsPayload>(
    `/api/integrations/connections/${connectionId}/details`
  );
}

export async function fetchWebhookLogs(
  apiFetch: ApiFetchFn,
  filters: {
    providerId?: string;
    connectionId?: number;
    verificationOutcome?: string;
    processingStatus?: string;
    eventType?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<WebhookLogsResponse> {
  const qs = buildConsoleQueryString({
    providerId: filters.providerId,
    connectionId: filters.connectionId,
    verificationOutcome: filters.verificationOutcome,
    processingStatus: filters.processingStatus,
    eventType: filters.eventType,
    from: filters.from,
    to: filters.to,
    limit: filters.limit ?? 25,
    offset: filters.offset ?? 0,
  });
  return apiFetch<WebhookLogsResponse>(`/api/integrations/webhooks/logs${qs}`);
}

export async function fetchDurableEvents(
  apiFetch: ApiFetchFn,
  filters: {
    source?: 'all' | 'outbox' | 'inbox';
    status?: string;
    consumerName?: string;
    eventType?: string;
    search?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<DurableEventsResponse> {
  const qs = buildConsoleQueryString({
    source: filters.source && filters.source !== 'all' ? filters.source : undefined,
    status: filters.status && filters.status !== 'all' ? filters.status : undefined,
    consumerName: filters.consumerName,
    eventType: filters.eventType,
    search: filters.search,
    from: filters.from,
    to: filters.to,
    limit: filters.limit ?? 25,
    offset: filters.offset ?? 0,
  });
  return apiFetch<DurableEventsResponse>(`/api/automations/events${qs}`);
}

export async function replayDeadLetterEventApi(
  apiFetch: ApiFetchFn,
  source: 'outbox' | 'inbox',
  rowId: number,
  reason: string
): Promise<ReplayDeadLetterResponse> {
  return apiFetch<ReplayDeadLetterResponse>(
    `/api/automations/events/${source}/${rowId}/replay`,
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }
  );
}

export async function fetchExternalMappings(
  apiFetch: ApiFetchFn,
  filters: {
    providerId?: string;
    connectionId?: number;
    entityType?: string;
    search?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<ExternalMappingsResponse> {
  const qs = buildConsoleQueryString({
    providerId: filters.providerId,
    connectionId: filters.connectionId,
    entityType: filters.entityType,
    search: filters.search,
    limit: filters.limit ?? 25,
    offset: filters.offset ?? 0,
  });
  return apiFetch<ExternalMappingsResponse>(`/api/integrations/mappings${qs}`);
}

export async function fetchIntegrationAudit(
  apiFetch: ApiFetchFn,
  filters: {
    entryType?: 'all' | 'activity' | 'replay';
    connectionId?: number;
    eventId?: string;
    search?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<IntegrationAuditResponse> {
  const qs = buildConsoleQueryString({
    entryType: filters.entryType && filters.entryType !== 'all' ? filters.entryType : undefined,
    connectionId: filters.connectionId,
    eventId: filters.eventId,
    search: filters.search,
    from: filters.from,
    to: filters.to,
    limit: filters.limit ?? 25,
    offset: filters.offset ?? 0,
  });
  return apiFetch<IntegrationAuditResponse>(`/api/integrations/audit${qs}`);
}

export async function fetchWorkerHealthPublic(): Promise<IntegrationWorkerHealth> {
  const res = await fetch('/api/health/worker');
  const body = (await res.json().catch(() => null)) as
    | { worker?: IntegrationWorkerHealth; error?: string }
    | null;
  if (!res.ok && !body?.worker) {
    throw new Error(body?.error || `Worker health unavailable (${res.status})`);
  }
  if (!body?.worker) {
    throw new Error('Malformed worker health payload.');
  }
  return body.worker;
}
