import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { usePreferences } from '../../context/PreferencesContext.tsx';
import { useToast } from '../../context/ToastContext.tsx';
import { describeDateRangeWindow } from '../../shared/integrations-console.ts';
import type { IntegrationsSubTab } from '../../shared/routes.ts';
import type {
  ConnectionDetailsPayload,
  DurableEventRecord,
  EcosystemAdapterStatusSummary,
  ExternalMappingRecord,
  IntegrationAuditEntryRecord,
  IntegrationConnectionRecord,
  IntegrationOverviewPayload,
  IntegrationWorkerHealth,
  ProviderCatalogEntry,
  SecretStorageReadinessSummary,
  WebhookLogRecord,
} from '../../shared/types.ts';
import { Button, SegmentedControl } from '../ui/Primitives.tsx';
import { ConnectionDetailsDrawer } from './ConnectionDetailsDrawer.tsx';
import { ConnectionsPanel } from './ConnectionsPanel.tsx';
import {
  DeadLetterQueuePanel,
  type DlqFilterState,
} from './DeadLetterQueuePanel.tsx';
import {
  EventProcessingPanel,
  type EventMonitorFilterState,
} from './EventProcessingPanel.tsx';
import {
  ExternalMappingsPanel,
  type MappingsFilterState,
} from './ExternalMappingsPanel.tsx';
import {
  IntegrationAuditPanel,
  type AuditFilterState,
} from './IntegrationAuditPanel.tsx';
import { IntegrationOverviewPanel } from './IntegrationOverviewPanel.tsx';
import { ProviderCatalogPanel } from './ProviderCatalogPanel.tsx';
import {
  WebhookActivityPanel,
  type WebhookFilterState,
} from './WebhookActivityPanel.tsx';
import {
  activateConnectionApi,
  createPendingConnectionApi,
  disableConnectionApi,
  fetchConnectionDetails,
  fetchConnections,
  fetchDurableEvents,
  fetchExternalMappings,
  fetchIntegrationAudit,
  fetchIntegrationOverview,
  fetchProviderCatalog,
  fetchWebhookLogs,
  fetchWorkerHealthPublic,
  replayDeadLetterEventApi,
  revokeConnectionApi,
} from './integrations-api.ts';

interface IntegrationsConsoleViewProps {
  activeTab: IntegrationsSubTab;
  onTabChange: (tab: IntegrationsSubTab) => void;
}

const CONSOLE_TABS: Array<{ value: IntegrationsSubTab; label: string }> = [
  { value: 'overview', label: 'Overview' },
  { value: 'providers', label: 'Providers' },
  { value: 'connections', label: 'Connections' },
  { value: 'webhooks', label: 'Webhooks' },
  { value: 'events', label: 'Events' },
  { value: 'dlq', label: 'DLQ' },
  { value: 'mappings', label: 'Mappings' },
  { value: 'audit', label: 'Audit' },
];

const PAGE_SIZE = 25;

export function IntegrationsConsoleView({
  activeTab,
  onTabChange,
}: IntegrationsConsoleViewProps) {
  const { session, apiFetch } = useAuth();
  const { formatTimestamp } = usePreferences();
  const { pushToast } = useToast();

  const tenantId = session?.activeTenant.tenantId ?? 0;

  // Overview + Providers + Connections shared baseline
  const [overview, setOverview] = useState<IntegrationOverviewPayload | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  const [providers, setProviders] = useState<ProviderCatalogEntry[]>([]);
  const [ecosystemAdapters, setEcosystemAdapters] = useState<{
    clientCrm: EcosystemAdapterStatusSummary;
    centralCrm: EcosystemAdapterStatusSummary;
  } | null>(null);
  const [secretManager, setSecretManager] =
    useState<SecretStorageReadinessSummary | null>(null);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [providersError, setProvidersError] = useState<string | null>(null);

  // Connections
  const [connections, setConnections] = useState<IntegrationConnectionRecord[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(false);
  const [connectionsError, setConnectionsError] = useState<string | null>(null);
  const [connProviderFilter, setConnProviderFilter] = useState('');
  const [connStatusFilter, setConnStatusFilter] = useState('');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createModalProvider, setCreateModalProvider] =
    useState<ProviderCatalogEntry | null>(null);

  // Connection Details Drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerDetails, setDrawerDetails] =
    useState<ConnectionDetailsPayload | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);

  // Webhooks
  const [webhookLogs, setWebhookLogs] = useState<WebhookLogRecord[]>([]);
  const [webhookTotal, setWebhookTotal] = useState(0);
  const [webhookOffset, setWebhookOffset] = useState(0);
  const [webhookLoading, setWebhookLoading] = useState(false);
  const [webhookError, setWebhookError] = useState<string | null>(null);
  const [webhookFilters, setWebhookFilters] = useState<WebhookFilterState>({
    providerId: '',
    connectionId: '',
    verificationOutcome: '',
    processingStatus: '',
    eventType: '',
    dateRange: 'all',
  });

  // Durable Events Monitor
  const [eventsOutbox, setEventsOutbox] = useState<DurableEventRecord[]>([]);
  const [eventsInbox, setEventsInbox] = useState<DurableEventRecord[]>([]);
  const [eventsOutboxTotal, setEventsOutboxTotal] = useState(0);
  const [eventsInboxTotal, setEventsInboxTotal] = useState(0);
  const [eventsOffset, setEventsOffset] = useState(0);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [workerHealth, setWorkerHealth] = useState<IntegrationWorkerHealth | null>(
    null
  );
  const [eventsFilters, setEventsFilters] = useState<EventMonitorFilterState>({
    source: 'all',
    status: 'all',
    consumerName: '',
    eventType: '',
    search: '',
    dateRange: 'all',
  });

  // Dead-Letter Queue
  const [dlqOutbox, setDlqOutbox] = useState<DurableEventRecord[]>([]);
  const [dlqInbox, setDlqInbox] = useState<DurableEventRecord[]>([]);
  const [dlqOutboxTotal, setDlqOutboxTotal] = useState(0);
  const [dlqInboxTotal, setDlqInboxTotal] = useState(0);
  const [dlqOffset, setDlqOffset] = useState(0);
  const [dlqLoading, setDlqLoading] = useState(false);
  const [dlqError, setDlqError] = useState<string | null>(null);
  const [dlqFilters, setDlqFilters] = useState<DlqFilterState>({
    source: 'all',
    search: '',
  });

  // Mappings Explorer
  const [mappings, setMappings] = useState<ExternalMappingRecord[]>([]);
  const [mappingsTotal, setMappingsTotal] = useState(0);
  const [mappingsOffset, setMappingsOffset] = useState(0);
  const [mappingsLoading, setMappingsLoading] = useState(false);
  const [mappingsError, setMappingsError] = useState<string | null>(null);
  const [mappingsFilters, setMappingsFilters] = useState<MappingsFilterState>({
    providerId: '',
    connectionId: '',
    entityType: '',
    search: '',
  });

  // Audit History
  const [auditEntries, setAuditEntries] = useState<IntegrationAuditEntryRecord[]>(
    []
  );
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditOffset, setAuditOffset] = useState(0);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditFilters, setAuditFilters] = useState<AuditFilterState>({
    entryType: 'all',
    search: '',
    dateRange: 'all',
  });

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    setOverviewError(null);
    try {
      const data = await fetchIntegrationOverview(apiFetch);
      setOverview(data);
      setWorkerHealth(data.worker);
    } catch (err) {
      setOverviewError(
        err instanceof Error ? err.message : 'Unable to load integration overview.'
      );
    } finally {
      setOverviewLoading(false);
    }
  }, [apiFetch]);

  const loadProviders = useCallback(async () => {
    setProvidersLoading(true);
    setProvidersError(null);
    try {
      const data = await fetchProviderCatalog(apiFetch);
      setProviders(data.providers);
      setEcosystemAdapters(data.ecosystemAdapters);
      setSecretManager(data.secretManager);
    } catch (err) {
      setProvidersError(
        err instanceof Error ? err.message : 'Unable to load provider catalog.'
      );
    } finally {
      setProvidersLoading(false);
    }
  }, [apiFetch]);

  const loadConnections = useCallback(async () => {
    setConnectionsLoading(true);
    setConnectionsError(null);
    try {
      const data = await fetchConnections(apiFetch, {
        providerId: connProviderFilter || undefined,
        status: connStatusFilter || undefined,
      });
      setConnections(data.connections);
    } catch (err) {
      setConnectionsError(
        err instanceof Error ? err.message : 'Unable to load integration connections.'
      );
    } finally {
      setConnectionsLoading(false);
    }
  }, [apiFetch, connProviderFilter, connStatusFilter]);

  const loadWebhooks = useCallback(async () => {
    setWebhookLoading(true);
    setWebhookError(null);
    try {
      const dateWin = describeDateRangeWindow(webhookFilters.dateRange);
      const data = await fetchWebhookLogs(apiFetch, {
        providerId: webhookFilters.providerId || undefined,
        connectionId: webhookFilters.connectionId
          ? Number(webhookFilters.connectionId)
          : undefined,
        verificationOutcome: webhookFilters.verificationOutcome || undefined,
        processingStatus: webhookFilters.processingStatus || undefined,
        eventType: webhookFilters.eventType || undefined,
        from: dateWin.from,
        to: dateWin.to,
        limit: PAGE_SIZE,
        offset: webhookOffset,
      });
      setWebhookLogs(data.logs);
      setWebhookTotal(data.total);
    } catch (err) {
      setWebhookError(
        err instanceof Error ? err.message : 'Unable to load webhook logs.'
      );
    } finally {
      setWebhookLoading(false);
    }
  }, [apiFetch, webhookFilters, webhookOffset]);

  const loadDurableEvents = useCallback(async () => {
    setEventsLoading(true);
    setEventsError(null);
    try {
      const dateWin = describeDateRangeWindow(eventsFilters.dateRange);
      const data = await fetchDurableEvents(apiFetch, {
        source: eventsFilters.source,
        status: eventsFilters.status,
        consumerName: eventsFilters.consumerName || undefined,
        eventType: eventsFilters.eventType || undefined,
        search: eventsFilters.search || undefined,
        from: dateWin.from,
        to: dateWin.to,
        limit: PAGE_SIZE,
        offset: eventsOffset,
      });
      setEventsOutbox(data.outbox);
      setEventsInbox(data.inbox);
      setEventsOutboxTotal(data.outboxTotal);
      setEventsInboxTotal(data.inboxTotal);
    } catch (err) {
      setEventsError(
        err instanceof Error ? err.message : 'Unable to load durable event stream.'
      );
    } finally {
      setEventsLoading(false);
    }
  }, [apiFetch, eventsFilters, eventsOffset]);

  const loadDlq = useCallback(async () => {
    setDlqLoading(true);
    setDlqError(null);
    try {
      const data = await fetchDurableEvents(apiFetch, {
        source: dlqFilters.source,
        status: 'dead_letter',
        search: dlqFilters.search || undefined,
        limit: PAGE_SIZE,
        offset: dlqOffset,
      });
      setDlqOutbox(data.outbox);
      setDlqInbox(data.inbox);
      setDlqOutboxTotal(data.outboxTotal);
      setDlqInboxTotal(data.inboxTotal);
    } catch (err) {
      setDlqError(
        err instanceof Error ? err.message : 'Unable to load dead-letter queue.'
      );
    } finally {
      setDlqLoading(false);
    }
  }, [apiFetch, dlqFilters, dlqOffset]);

  const loadMappings = useCallback(async () => {
    setMappingsLoading(true);
    setMappingsError(null);
    try {
      const data = await fetchExternalMappings(apiFetch, {
        providerId: mappingsFilters.providerId || undefined,
        connectionId: mappingsFilters.connectionId
          ? Number(mappingsFilters.connectionId)
          : undefined,
        entityType: mappingsFilters.entityType || undefined,
        search: mappingsFilters.search || undefined,
        limit: PAGE_SIZE,
        offset: mappingsOffset,
      });
      setMappings(data.mappings);
      setMappingsTotal(data.total);
    } catch (err) {
      setMappingsError(
        err instanceof Error ? err.message : 'Unable to load external ID mappings.'
      );
    } finally {
      setMappingsLoading(false);
    }
  }, [apiFetch, mappingsFilters, mappingsOffset]);

  const loadAudit = useCallback(async () => {
    setAuditLoading(true);
    setAuditError(null);
    try {
      const dateWin = describeDateRangeWindow(auditFilters.dateRange);
      const data = await fetchIntegrationAudit(apiFetch, {
        entryType: auditFilters.entryType,
        search: auditFilters.search || undefined,
        from: dateWin.from,
        to: dateWin.to,
        limit: PAGE_SIZE,
        offset: auditOffset,
      });
      setAuditEntries(data.entries);
      setAuditTotal(data.total);
    } catch (err) {
      setAuditError(
        err instanceof Error ? err.message : 'Unable to load integration audit history.'
      );
    } finally {
      setAuditLoading(false);
    }
  }, [apiFetch, auditFilters, auditOffset]);

  const refreshWorkerHealth = useCallback(async () => {
    try {
      const health = await fetchWorkerHealthPublic();
      setWorkerHealth(health);
      pushToast('Worker health status refreshed.', 'info');
    } catch (err) {
      pushToast(
        err instanceof Error ? err.message : 'Worker health check failed.',
        'error'
      );
    }
  }, [pushToast]);

  // Baseline load on mount or tenant switch
  useEffect(() => {
    if (!tenantId) return;
    setDrawerOpen(false);
    setDrawerDetails(null);
    void loadOverview();
    void loadProviders();
    void loadConnections();
  }, [tenantId, loadOverview, loadProviders, loadConnections]);

  // Tab-specific reloads
  useEffect(() => {
    if (!tenantId) return;
    if (activeTab === 'overview') void loadOverview();
    if (activeTab === 'providers') {
      void loadProviders();
      void loadConnections();
    }
    if (activeTab === 'connections') void loadConnections();
    if (activeTab === 'webhooks') void loadWebhooks();
    if (activeTab === 'events') void loadDurableEvents();
    if (activeTab === 'dlq') void loadDlq();
    if (activeTab === 'mappings') void loadMappings();
    if (activeTab === 'audit') void loadAudit();
  }, [
    tenantId,
    activeTab,
    loadOverview,
    loadProviders,
    loadConnections,
    loadWebhooks,
    loadDurableEvents,
    loadDlq,
    loadMappings,
    loadAudit,
  ]);

  if (!session) return null;

  const handleOpenInspectDrawer = async (connectionId: number) => {
    setDrawerOpen(true);
    setDrawerDetails(null);
    setDrawerError(null);
    setDrawerLoading(true);
    try {
      const details = await fetchConnectionDetails(apiFetch, connectionId);
      setDrawerDetails(details);
    } catch (err) {
      setDrawerError(
        err instanceof Error ? err.message : 'Unable to load connection details.'
      );
    } finally {
      setDrawerLoading(false);
    }
  };

  const handleCreatePending = async (payload: {
    providerId: string;
    connectionName: string;
    authMode: 'service_jwt' | 'oauth2' | 'api_key_hmac' | 'webhook_hmac';
    secretRef: {
      provider: 'gcp_secret_manager' | 'env_dev_only';
      secretName: string;
      version: string;
    };
    allowedScopes: string[];
    config: Record<string, unknown>;
    environment: 'development' | 'staging' | 'production';
  }) => {
    const res = await createPendingConnectionApi(apiFetch, payload);
    pushToast(`Created pending connection "${res.connection.connectionName}".`);
    await Promise.all([loadConnections(), loadOverview()]);
  };

  const handleActivate = async (conn: IntegrationConnectionRecord) => {
    try {
      const res = await activateConnectionApi(apiFetch, conn.id);
      pushToast(`Activated connection "${res.connection.connectionName}".`);
      await Promise.all([loadConnections(), loadOverview()]);
    } catch (err) {
      pushToast(
        err instanceof Error ? err.message : 'Activation failed.',
        'error'
      );
    }
  };

  const handleDisable = async (
    conn: IntegrationConnectionRecord,
    reason?: string
  ) => {
    try {
      const res = await disableConnectionApi(apiFetch, conn.id, reason);
      pushToast(`Disabled connection "${res.connection.connectionName}".`, 'info');
      await Promise.all([loadConnections(), loadOverview()]);
    } catch (err) {
      pushToast(
        err instanceof Error ? err.message : 'Unable to disable connection.',
        'error'
      );
    }
  };

  const handleRevoke = async (
    conn: IntegrationConnectionRecord,
    reason?: string
  ) => {
    try {
      const res = await revokeConnectionApi(apiFetch, conn.id, reason);
      pushToast(`Revoked connection "${res.connection.connectionName}".`, 'info');
      await Promise.all([loadConnections(), loadOverview()]);
    } catch (err) {
      pushToast(
        err instanceof Error ? err.message : 'Unable to revoke connection.',
        'error'
      );
    }
  };

  const handleReplayDlq = async (evt: DurableEventRecord, reason: string) => {
    const res = await replayDeadLetterEventApi(apiFetch, evt.source, evt.id, reason);
    pushToast(
      `Requeued ${res.source} event "${res.eventId}" (${res.previousStatus} → ${res.newStatus}) for async worker execution.`
    );
    await Promise.all([loadDlq(), loadOverview(), loadAudit()]);
  };

  const handleRefreshActiveTab = () => {
    void loadOverview();
    if (activeTab === 'providers') void loadProviders();
    if (activeTab === 'connections') void loadConnections();
    if (activeTab === 'webhooks') void loadWebhooks();
    if (activeTab === 'events') void loadDurableEvents();
    if (activeTab === 'dlq') void loadDlq();
    if (activeTab === 'mappings') void loadMappings();
    if (activeTab === 'audit') void loadAudit();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="overflow-x-auto pb-1 lg:pb-0">
          <SegmentedControl
            options={CONSOLE_TABS}
            value={activeTab}
            onChange={onTabChange}
          />
        </div>
        <Button variant="secondary" size="sm" onClick={handleRefreshActiveTab}>
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
          Refresh Console
        </Button>
      </div>

      {activeTab === 'overview' && (
        <IntegrationOverviewPanel
          overview={overview}
          loading={overviewLoading}
          error={overviewError}
          onRetry={() => void loadOverview()}
          onNavigateTab={onTabChange}
          formatTimestamp={formatTimestamp}
        />
      )}

      {activeTab === 'providers' && (
        <ProviderCatalogPanel
          providers={providers}
          connections={connections}
          ecosystemAdapters={ecosystemAdapters}
          secretManager={secretManager}
          permissions={session.permissions}
          loading={providersLoading}
          error={providersError}
          onRetry={() => void loadProviders()}
          onCreatePendingForProvider={(provider) => {
            setCreateModalProvider(provider);
            setCreateModalOpen(true);
            onTabChange('connections');
          }}
        />
      )}

      {activeTab === 'connections' && (
        <ConnectionsPanel
          connections={connections}
          providers={providers}
          permissions={session.permissions}
          loading={connectionsLoading}
          error={connectionsError}
          providerFilter={connProviderFilter}
          statusFilter={connStatusFilter}
          createModalProvider={createModalProvider}
          createModalOpen={createModalOpen}
          onChangeProviderFilter={setConnProviderFilter}
          onChangeStatusFilter={setConnStatusFilter}
          onOpenCreateModal={(provider) => {
            setCreateModalProvider(provider ?? null);
            setCreateModalOpen(true);
          }}
          onCloseCreateModal={() => {
            setCreateModalOpen(false);
            setCreateModalProvider(null);
          }}
          onCreatePending={handleCreatePending}
          onActivate={handleActivate}
          onDisable={handleDisable}
          onRevoke={handleRevoke}
          onInspect={(id) => void handleOpenInspectDrawer(id)}
          onRetry={() => void loadConnections()}
          formatTimestamp={formatTimestamp}
        />
      )}

      {activeTab === 'webhooks' && (
        <WebhookActivityPanel
          logs={webhookLogs}
          total={webhookTotal}
          limit={PAGE_SIZE}
          offset={webhookOffset}
          loading={webhookLoading}
          error={webhookError}
          filters={webhookFilters}
          providers={providers}
          connections={connections}
          onChangeFilters={(patch) => {
            setWebhookOffset(0);
            setWebhookFilters((prev) => ({ ...prev, ...patch }));
          }}
          onPageChange={setWebhookOffset}
          onRetry={() => void loadWebhooks()}
          formatTimestamp={formatTimestamp}
        />
      )}

      {activeTab === 'events' && (
        <EventProcessingPanel
          outbox={eventsOutbox}
          inbox={eventsInbox}
          outboxTotal={eventsOutboxTotal}
          inboxTotal={eventsInboxTotal}
          limit={PAGE_SIZE}
          offset={eventsOffset}
          workerHealth={workerHealth}
          loading={eventsLoading}
          error={eventsError}
          filters={eventsFilters}
          onChangeFilters={(patch) => {
            setEventsOffset(0);
            setEventsFilters((prev) => ({ ...prev, ...patch }));
          }}
          onPageChange={setEventsOffset}
          onRefreshWorker={() => void refreshWorkerHealth()}
          onRetry={() => void loadDurableEvents()}
          formatTimestamp={formatTimestamp}
        />
      )}

      {activeTab === 'dlq' && (
        <DeadLetterQueuePanel
          outbox={dlqOutbox}
          inbox={dlqInbox}
          outboxTotal={dlqOutboxTotal}
          inboxTotal={dlqInboxTotal}
          limit={PAGE_SIZE}
          offset={dlqOffset}
          loading={dlqLoading}
          error={dlqError}
          filters={dlqFilters}
          roleKey={session.activeTenant.roleKey}
          permissions={session.permissions}
          onChangeFilters={(patch) => {
            setDlqOffset(0);
            setDlqFilters((prev) => ({ ...prev, ...patch }));
          }}
          onPageChange={setDlqOffset}
          onReplay={handleReplayDlq}
          onRetry={() => void loadDlq()}
          formatTimestamp={formatTimestamp}
        />
      )}

      {activeTab === 'mappings' && (
        <ExternalMappingsPanel
          mappings={mappings}
          total={mappingsTotal}
          limit={PAGE_SIZE}
          offset={mappingsOffset}
          loading={mappingsLoading}
          error={mappingsError}
          filters={mappingsFilters}
          providers={providers}
          connections={connections}
          onChangeFilters={(patch) => {
            setMappingsOffset(0);
            setMappingsFilters((prev) => ({ ...prev, ...patch }));
          }}
          onPageChange={setMappingsOffset}
          onRetry={() => void loadMappings()}
          formatTimestamp={formatTimestamp}
        />
      )}

      {activeTab === 'audit' && (
        <IntegrationAuditPanel
          entries={auditEntries}
          total={auditTotal}
          limit={PAGE_SIZE}
          offset={auditOffset}
          loading={auditLoading}
          error={auditError}
          filters={auditFilters}
          onChangeFilters={(patch) => {
            setAuditOffset(0);
            setAuditFilters((prev) => ({ ...prev, ...patch }));
          }}
          onPageChange={setAuditOffset}
          onRetry={() => void loadAudit()}
          formatTimestamp={formatTimestamp}
        />
      )}

      <ConnectionDetailsDrawer
        open={drawerOpen}
        details={drawerDetails}
        loading={drawerLoading}
        error={drawerError}
        onClose={() => setDrawerOpen(false)}
        formatTimestamp={formatTimestamp}
      />
    </div>
  );
}
