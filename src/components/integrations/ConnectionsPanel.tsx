import React, { useEffect, useState } from 'react';
import { Eye, Plus, X } from 'lucide-react';
import {
  canManageConnections,
  classifyConnectionActionPermissions,
  mapConnectionStatusTone,
  maskSecretReferenceLabel,
  validatePendingConnectionDraft,
  type PendingConnectionDraft,
} from '../../shared/integrations-console.ts';
import type {
  IntegrationConnectionRecord,
  ProviderCatalogEntry,
  RoleConfig,
} from '../../shared/types.ts';
import {
  AlertBanner,
  Button,
  Card,
  ConfirmModal,
  INPUT_BASE_CLASS,
  SELECT_BASE_CLASS,
  StatusIndicator,
} from '../ui/Primitives.tsx';

interface ConnectionsPanelProps {
  connections: IntegrationConnectionRecord[];
  providers: ProviderCatalogEntry[];
  permissions: RoleConfig;
  loading: boolean;
  error: string | null;
  providerFilter: string;
  statusFilter: string;
  createModalProvider: ProviderCatalogEntry | null;
  createModalOpen: boolean;
  onChangeProviderFilter: (value: string) => void;
  onChangeStatusFilter: (value: string) => void;
  onOpenCreateModal: (provider?: ProviderCatalogEntry) => void;
  onCloseCreateModal: () => void;
  onCreatePending: (payload: {
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
  }) => Promise<void>;
  onActivate: (connection: IntegrationConnectionRecord) => Promise<void>;
  onDisable: (connection: IntegrationConnectionRecord, reason?: string) => Promise<void>;
  onRevoke: (connection: IntegrationConnectionRecord, reason?: string) => Promise<void>;
  onInspect: (connectionId: number) => void;
  onRetry: () => void;
  formatTimestamp: (iso: string | Date) => string;
}

function buildInitialDraft(
  providers: ProviderCatalogEntry[],
  preferred?: ProviderCatalogEntry | null
): PendingConnectionDraft {
  const selectable =
    preferred && preferred.status !== 'planned_unapproved'
      ? preferred
      : providers.find((p) => p.status !== 'planned_unapproved') ?? providers[0];

  return {
    providerId: selectable?.providerId || 'dialpulse_web',
    connectionName: selectable ? `${selectable.name} Connection` : '',
    authMode: selectable?.authMethod || 'webhook_hmac',
    secretProvider: 'gcp_secret_manager',
    secretName: selectable
      ? `${selectable.providerId}-webhook-secret`
      : 'dialpulse-web-secret',
    secretVersion: 'latest',
    allowedScopesText: selectable?.requiredScopes.join(', ') || 'intake:submit',
    configJsonText: '{}',
    environment: 'development',
  };
}

export function ConnectionsPanel({
  connections,
  providers,
  permissions,
  loading,
  error,
  providerFilter,
  statusFilter,
  createModalProvider,
  createModalOpen,
  onChangeProviderFilter,
  onChangeStatusFilter,
  onOpenCreateModal,
  onCloseCreateModal,
  onCreatePending,
  onActivate,
  onDisable,
  onRevoke,
  onInspect,
  onRetry,
  formatTimestamp,
}: ConnectionsPanelProps) {
  const canManage = canManageConnections(permissions);
  const [draft, setDraft] = useState<PendingConnectionDraft>(() =>
    buildInitialDraft(providers, createModalProvider)
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [busyConnectionId, setBusyConnectionId] = useState<number | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<{
    action: 'disable' | 'revoke';
    connection: IntegrationConnectionRecord;
  } | null>(null);

  useEffect(() => {
    if (createModalOpen) {
      setDraft(buildInitialDraft(providers, createModalProvider));
      setFormError(null);
    }
  }, [createModalOpen, createModalProvider, providers]);

  const handleProviderSelectInModal = (providerId: string) => {
    const matched = providers.find((p) => p.providerId === providerId);
    setDraft((prev) => ({
      ...prev,
      providerId,
      authMode: matched?.authMethod ?? prev.authMode,
      allowedScopesText: matched?.requiredScopes.join(', ') ?? prev.allowedScopesText,
      secretName: `${providerId}-secret`,
    }));
  };

  const handleSubmitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const validation = validatePendingConnectionDraft(draft);
    if (!validation.valid || !validation.parsedConfig) {
      setFormError(validation.error || 'Invalid connection settings.');
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      await onCreatePending({
        providerId: draft.providerId,
        connectionName: draft.connectionName.trim(),
        authMode: draft.authMode,
        secretRef: {
          provider: draft.secretProvider,
          secretName: draft.secretName.trim(),
          version: draft.secretVersion.trim() || 'latest',
        },
        allowedScopes: validation.scopes,
        config: validation.parsedConfig,
        environment: draft.environment,
      });
      onCloseCreateModal();
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Unable to create pending connection.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmTransition = async () => {
    if (!confirmTarget) return;
    setBusyConnectionId(confirmTarget.connection.id);
    try {
      if (confirmTarget.action === 'disable') {
        await onDisable(confirmTarget.connection, 'Disabled via Integration Console');
      } else {
        await onRevoke(confirmTarget.connection, 'Revoked via Integration Console');
      }
      setConfirmTarget(null);
    } finally {
      setBusyConnectionId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <select
            aria-label="Filter connections by provider"
            value={providerFilter}
            onChange={(e) => onChangeProviderFilter(e.target.value)}
            className={`${SELECT_BASE_CLASS} h-9`}
          >
            <option value="">All Providers</option>
            {providers.map((p) => (
              <option key={p.providerId} value={p.providerId}>
                {p.name} ({p.providerId})
              </option>
            ))}
          </select>

          <select
            aria-label="Filter connections by status"
            value={statusFilter}
            onChange={(e) => onChangeStatusFilter(e.target.value)}
            className={`${SELECT_BASE_CLASS} h-9`}
          >
            <option value="">All Statuses</option>
            <option value="pending">pending</option>
            <option value="active">active</option>
            <option value="disabled">disabled</option>
            <option value="error">error</option>
            <option value="revoked">revoked</option>
          </select>
        </div>

        <Button
          variant="primary"
          size="sm"
          disabled={!canManage}
          title={
            !canManage
              ? 'Creating connections requires Workspace Admin settings permission.'
              : undefined
          }
          onClick={() => onOpenCreateModal()}
        >
          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
          New Pending Connection
        </Button>
      </div>

      {error && (
        <AlertBanner tone="error" message={error} />
      )}

      <Card className="overflow-hidden">
        {loading && connections.length === 0 ? (
          <div className="p-6 text-[13px] text-[var(--dp-on-surface-variant)]">
            Loading tenant integration connections...
          </div>
        ) : connections.length === 0 ? (
          <div className="p-8 text-center space-y-2">
            <div className="text-[14px] font-medium text-[var(--dp-on-surface)]">
              No integration connections match the current filters.
            </div>
            <p className="text-[12px] text-[var(--dp-on-surface-variant)]">
              Create a pending connection with a Secret Manager reference before verifying and activating it.
            </p>
            {error && (
              <div className="pt-2">
                <Button variant="secondary" size="sm" onClick={onRetry}>
                  Retry
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead className="bg-[var(--dp-surface-container-low)] border-b border-[var(--dp-outline-variant)] text-[var(--dp-on-surface-variant)]">
                <tr>
                  <th className="py-2.5 px-4 font-medium">Connection</th>
                  <th className="py-2.5 px-4 font-medium">Provider / Env</th>
                  <th className="py-2.5 px-4 font-medium">Status</th>
                  <th className="py-2.5 px-4 font-medium">Masked Secret Ref</th>
                  <th className="py-2.5 px-4 font-medium">Updated</th>
                  <th className="py-2.5 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--dp-outline-variant)]">
                {connections.map((conn) => {
                  const providerEntry = providers.find(
                    (p) => p.providerId === conn.providerId
                  );
                  const actionPerms = classifyConnectionActionPermissions(
                    conn,
                    providerEntry,
                    canManage
                  );
                  const isBusy = busyConnectionId === conn.id;

                  return (
                    <tr key={conn.id} className="hover:bg-[var(--dp-surface-container-low)]/60">
                      <td className="py-3 px-4">
                        <div className="font-semibold text-[var(--dp-on-surface)]">
                          {conn.connectionName}
                        </div>
                        <div className="font-mono text-[11px] text-[var(--dp-on-surface-variant)]">
                          #{conn.id} · {conn.authMode} · {conn.allowedScopes.length} scopes
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono">
                        <div className="text-[var(--dp-on-surface)]">{conn.providerId}</div>
                        <div className="text-[11px] text-[var(--dp-on-surface-variant)]">
                          {conn.environment}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <StatusIndicator
                          tone={mapConnectionStatusTone(conn.status)}
                          label={conn.status}
                        />
                        {conn.lastErrorSummary && (
                          <div className="text-[11px] text-[var(--dp-error)] mt-0.5 max-w-xs truncate">
                            {conn.lastErrorSummary}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] text-[var(--dp-on-surface)]">
                        {maskSecretReferenceLabel(conn.secretRef)}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-[var(--dp-on-surface-variant)]">
                        {formatTimestamp(conn.updatedAt)}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="tertiary"
                            size="sm"
                            onClick={() => onInspect(conn.id)}
                          >
                            <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                            Inspect
                          </Button>
                          {actionPerms.canActivate && (
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={isBusy}
                              onClick={async () => {
                                setBusyConnectionId(conn.id);
                                try {
                                  await onActivate(conn);
                                } finally {
                                  setBusyConnectionId(null);
                                }
                              }}
                            >
                              Activate
                            </Button>
                          )}
                          {!actionPerms.canActivate &&
                            conn.status !== 'active' &&
                            actionPerms.activateDisabledReason && (
                              <Button
                                variant="secondary"
                                size="sm"
                                disabled
                                title={actionPerms.activateDisabledReason}
                              >
                                Activate
                              </Button>
                            )}
                          {actionPerms.canDisable && (
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={isBusy}
                              onClick={() =>
                                setConfirmTarget({ action: 'disable', connection: conn })
                              }
                            >
                              Disable
                            </Button>
                          )}
                          {actionPerms.canRevoke && (
                            <Button
                              variant="danger"
                              size="sm"
                              disabled={isBusy}
                              onClick={() =>
                                setConfirmTarget({ action: 'revoke', connection: conn })
                              }
                            >
                              Revoke
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Create Pending Connection Modal */}
      {createModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-connection-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={onCloseCreateModal}
        >
          <div
            className="w-full max-w-lg bg-[var(--dp-surface-container-lowest)] border border-[var(--dp-outline-variant)] rounded-[var(--dp-radius-lg)] shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-[var(--dp-outline-variant)] flex items-center justify-between">
              <h2
                id="create-connection-modal-title"
                className="text-[16px] font-semibold text-[var(--dp-on-surface)]"
              >
                Create Pending Integration Connection
              </h2>
              <button
                type="button"
                aria-label="Close modal"
                onClick={onCloseCreateModal}
                className="p-1 rounded text-[var(--dp-on-surface-variant)] hover:text-[var(--dp-on-surface)] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitCreate} className="p-6 space-y-4 text-[13px] max-h-[80vh] overflow-y-auto">
              {formError && <AlertBanner tone="error" message={formError} />}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="space-y-1">
                  <span className="text-[12px] font-medium text-[var(--dp-on-surface)]">
                    Provider
                  </span>
                  <select
                    value={draft.providerId}
                    onChange={(e) => handleProviderSelectInModal(e.target.value)}
                    className={`${SELECT_BASE_CLASS} w-full`}
                  >
                    {providers.map((p) => (
                      <option key={p.providerId} value={p.providerId}>
                        {p.name} ({p.status})
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-[12px] font-medium text-[var(--dp-on-surface)]">
                    Environment
                  </span>
                  <select
                    value={draft.environment}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        environment: e.target.value as PendingConnectionDraft['environment'],
                      }))
                    }
                    className={`${SELECT_BASE_CLASS} w-full`}
                  >
                    <option value="development">development</option>
                    <option value="staging">staging</option>
                    <option value="production">production</option>
                  </select>
                </label>
              </div>

              <label className="block space-y-1">
                <span className="text-[12px] font-medium text-[var(--dp-on-surface)]">
                  Connection Name
                </span>
                <input
                  type="text"
                  required
                  value={draft.connectionName}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, connectionName: e.target.value }))
                  }
                  placeholder="e.g. DialPulse Web Primary Intake"
                  className={INPUT_BASE_CLASS}
                />
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="space-y-1">
                  <span className="text-[12px] font-medium text-[var(--dp-on-surface)]">
                    Secret Provider
                  </span>
                  <select
                    value={draft.secretProvider}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        secretProvider: e.target.value as PendingConnectionDraft['secretProvider'],
                      }))
                    }
                    className={`${SELECT_BASE_CLASS} w-full`}
                  >
                    <option value="gcp_secret_manager">gcp_secret_manager</option>
                    <option value="env_dev_only">env_dev_only</option>
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-[12px] font-medium text-[var(--dp-on-surface)]">
                    Secret Reference Name
                  </span>
                  <input
                    type="text"
                    required
                    value={draft.secretName}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, secretName: e.target.value }))
                    }
                    placeholder="dialpulse-web-whsec"
                    className={`${INPUT_BASE_CLASS} font-mono text-[12px]`}
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[12px] font-medium text-[var(--dp-on-surface)]">
                    Secret Version
                  </span>
                  <input
                    type="text"
                    required
                    value={draft.secretVersion}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, secretVersion: e.target.value }))
                    }
                    placeholder="latest"
                    className={`${INPUT_BASE_CLASS} font-mono text-[12px]`}
                  />
                </label>
              </div>

              <label className="block space-y-1">
                <span className="text-[12px] font-medium text-[var(--dp-on-surface)]">
                  Allowed Scopes (comma-separated)
                </span>
                <input
                  type="text"
                  value={draft.allowedScopesText}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, allowedScopesText: e.target.value }))
                  }
                  className={`${INPUT_BASE_CLASS} font-mono text-[12px]`}
                />
              </label>

              <label className="block space-y-1">
                <span className="text-[12px] font-medium text-[var(--dp-on-surface)]">
                  Non-Sensitive Config JSON
                </span>
                <textarea
                  rows={3}
                  value={draft.configJsonText}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, configJsonText: e.target.value }))
                  }
                  className={`${INPUT_BASE_CLASS} font-mono text-[12px]`}
                />
                <span className="block text-[11px] text-[var(--dp-on-surface-variant)]">
                  Never paste API keys or webhook secrets into config JSON; reference them via Secret Manager above.
                </span>
              </label>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={onCloseCreateModal}
                  disabled={submitting}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={submitting}>
                  {submitting ? 'Creating...' : 'Create Pending Connection'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmModal
        open={Boolean(confirmTarget)}
        title={
          confirmTarget?.action === 'revoke'
            ? 'Revoke Integration Connection'
            : 'Disable Integration Connection'
        }
        description={
          confirmTarget?.action === 'revoke'
            ? `Revoking "${confirmTarget.connection.connectionName}" is permanent — revoked connections cannot be reactivated and incoming webhooks will be rejected immediately.`
            : `Disabling "${confirmTarget?.connection.connectionName}" pauses inbound webhook acceptance and outbound deliveries until reactivated by a Workspace Admin.`
        }
        confirmLabel={confirmTarget?.action === 'revoke' ? 'Revoke Connection' : 'Disable Connection'}
        destructive={confirmTarget?.action === 'revoke'}
        busy={Boolean(confirmTarget && busyConnectionId === confirmTarget.connection.id)}
        onConfirm={() => void handleConfirmTransition()}
        onCancel={() => setConfirmTarget(null)}
      />
    </div>
  );
}
