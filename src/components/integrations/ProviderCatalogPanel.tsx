import React from 'react';
import { Lock, Plus, ShieldAlert } from 'lucide-react';
import {
  canManageConnections,
  mapProviderStatusLabel,
} from '../../shared/integrations-console.ts';
import type {
  EcosystemAdapterStatusSummary,
  IntegrationConnectionRecord,
  ProviderCatalogEntry,
  RoleConfig,
  SecretStorageReadinessSummary,
} from '../../shared/types.ts';
import { AlertBanner, Button, Card, StatusIndicator } from '../ui/Primitives.tsx';

interface ProviderCatalogPanelProps {
  providers: ProviderCatalogEntry[];
  connections: IntegrationConnectionRecord[];
  ecosystemAdapters: {
    clientCrm: EcosystemAdapterStatusSummary;
    centralCrm: EcosystemAdapterStatusSummary;
  } | null;
  secretManager: SecretStorageReadinessSummary | null;
  permissions: RoleConfig;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onCreatePendingForProvider: (provider: ProviderCatalogEntry) => void;
}

export function ProviderCatalogPanel({
  providers,
  connections,
  ecosystemAdapters,
  secretManager,
  permissions,
  loading,
  error,
  onRetry,
  onCreatePendingForProvider,
}: ProviderCatalogPanelProps) {
  const canCreate = canManageConnections(permissions);

  if (error && providers.length === 0) {
    return (
      <Card className="p-6 space-y-3">
        <AlertBanner tone="error" message={error} />
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Retry Catalog
        </Button>
      </Card>
    );
  }

  if (loading && providers.length === 0) {
    return (
      <Card className="p-6 text-[13px] text-[var(--dp-on-surface-variant)]">
        Loading approved provider registry...
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {secretManager?.blockerReason && (
        <AlertBanner
          tone="warning"
          message={`Secret Storage Readiness: ${secretManager.blockerReason}`}
        />
      )}

      {!canCreate && (
        <AlertBanner
          tone="info"
          message="Read-only view: creating or activating tenant integration connections requires Workspace Admin settings management permission."
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {providers.map((provider) => {
          const statusMeta = mapProviderStatusLabel(provider.status);
          const providerConnections = connections.filter(
            (c) => c.providerId === provider.providerId
          );
          const activeCount = providerConnections.filter((c) => c.status === 'active').length;
          const isPlanned = provider.status === 'planned_unapproved';

          const adapterInfo =
            provider.providerId === 'client_crm'
              ? ecosystemAdapters?.clientCrm
              : provider.providerId === 'central_crm'
                ? ecosystemAdapters?.centralCrm
                : null;

          return (
            <Card key={provider.providerId} className="p-5 flex flex-col justify-between gap-4">
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-[15px] font-semibold text-[var(--dp-on-surface)]">
                      {provider.name}
                    </h3>
                    <div className="text-[11px] font-mono text-[var(--dp-on-surface-variant)] mt-0.5">
                      {provider.providerId} · {provider.category}
                    </div>
                  </div>
                  <StatusIndicator tone={statusMeta.tone} label={statusMeta.label} />
                </div>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
                  <div>
                    <dt className="text-[var(--dp-on-surface-variant)]">Auth Mode</dt>
                    <dd className="font-mono text-[var(--dp-on-surface)]">{provider.authMethod}</dd>
                  </div>
                  <div>
                    <dt className="text-[var(--dp-on-surface-variant)]">Rate Limit / Class</dt>
                    <dd className="font-mono tabular-nums text-[var(--dp-on-surface)]">
                      {provider.rateLimitPerMinute}/min · {provider.maxDataClassification}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--dp-on-surface-variant)]">Webhooks</dt>
                    <dd className="text-[var(--dp-on-surface)]">
                      {provider.webhookSupport ? 'HMAC-SHA256 Supported' : 'Outbound Only'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--dp-on-surface-variant)]">Tenant Connections</dt>
                    <dd className="font-mono tabular-nums text-[var(--dp-on-surface)]">
                      {activeCount} active / {providerConnections.length} total
                    </dd>
                  </div>
                </dl>

                <div className="text-[12px] space-y-1">
                  <div className="text-[var(--dp-on-surface-variant)]">
                    Required Scopes:{' '}
                    <span className="font-mono text-[var(--dp-on-surface)]">
                      {provider.requiredScopes.join(', ')}
                    </span>
                  </div>
                  <div className="text-[var(--dp-on-surface-variant)]">
                    Capabilities:{' '}
                    <span className="font-mono text-[var(--dp-on-surface)]">
                      {provider.capabilities.join(', ')}
                    </span>
                  </div>
                </div>

                {isPlanned && (
                  <div className="p-3 rounded-[var(--dp-radius-sm)] bg-[var(--dp-warning-container)]/40 border border-[var(--dp-warning)]/30 text-[12px] text-[var(--dp-on-warning-container)] flex items-start gap-2">
                    <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                    <span>
                      Activation blocked: {provider.costModelNote}
                    </span>
                  </div>
                )}

                {adapterInfo && adapterInfo.contractStatus === 'blocked_pending_api_contract' && (
                  <div className="p-3 rounded-[var(--dp-radius-sm)] bg-[var(--dp-surface-container-low)] border border-[var(--dp-outline-variant)] text-[12px] text-[var(--dp-on-surface-variant)] flex items-start gap-2">
                    <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[var(--dp-warning-text)]" aria-hidden="true" />
                    <span>
                      Live outbound calls blocked pending confirmed REST API contract & credentials ({adapterInfo.missingContractDetails[0]}).
                    </span>
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-[var(--dp-outline-variant)] flex items-center justify-between gap-3">
                <span className="text-[11px] text-[var(--dp-on-surface-variant)] truncate">
                  {provider.costModelNote}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!canCreate || isPlanned}
                  title={
                    isPlanned
                      ? 'Planned unapproved providers cannot be provisioned until approved.'
                      : !canCreate
                        ? 'Requires Workspace Admin permission'
                        : undefined
                  }
                  onClick={() => onCreatePendingForProvider(provider)}
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  Create Pending Connection
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
