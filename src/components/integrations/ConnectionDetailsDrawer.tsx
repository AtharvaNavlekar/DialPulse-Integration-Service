import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import {
  mapConnectionStatusTone,
  mapWebhookOutcomeTone,
  maskSecretReferenceLabel,
  truncateDigest,
} from '../../shared/integrations-console.ts';
import type { ConnectionDetailsPayload } from '../../shared/types.ts';
import { AlertBanner, Button, StatusIndicator } from '../ui/Primitives.tsx';

interface ConnectionDetailsDrawerProps {
  open: boolean;
  details: ConnectionDetailsPayload | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  formatTimestamp: (iso: string | Date) => string;
}

export function ConnectionDetailsDrawer({
  open,
  details,
  loading,
  error,
  onClose,
  formatTimestamp,
}: ConnectionDetailsDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="connection-details-title"
      className="fixed inset-0 z-50 flex justify-end bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-[var(--dp-background)] border-l border-[var(--dp-outline-variant)] h-full flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-[var(--dp-outline-variant)] flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h2
              id="connection-details-title"
              className="text-[17px] font-semibold text-[var(--dp-on-surface)] truncate"
            >
              {details?.connection.connectionName || 'Connection Details'}
            </h2>
            <p className="text-[12px] font-mono text-[var(--dp-on-surface-variant)]">
              {details ? `${details.connection.providerId} · #${details.connection.id}` : 'Inspecting connection...'}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close connection details"
            onClick={onClose}
            className="p-1.5 rounded-[var(--dp-radius-sm)] text-[var(--dp-on-surface-variant)] hover:text-[var(--dp-on-surface)] hover:bg-[var(--dp-surface-variant)] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-[13px]">
          {loading && !details && (
            <div className="text-[var(--dp-on-surface-variant)]">
              Loading connection sections...
            </div>
          )}

          {error && <AlertBanner tone="error" message={error} />}

          {details && (
            <>
              {/* 1. Overview */}
              <section className="space-y-2.5">
                <h3 className="text-[12px] font-semibold uppercase tracking-wider text-[var(--dp-on-surface-variant)]">
                  1. Overview
                </h3>
                <div className="p-4 rounded-[var(--dp-radius-sm)] border border-[var(--dp-outline-variant)] bg-[var(--dp-surface-container-low)] grid grid-cols-2 gap-3 text-[12px]">
                  <div>
                    <div className="text-[var(--dp-on-surface-variant)]">Status</div>
                    <div className="mt-1">
                      <StatusIndicator
                        tone={mapConnectionStatusTone(details.connection.status)}
                        label={details.connection.status}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="text-[var(--dp-on-surface-variant)]">Environment</div>
                    <div className="font-mono text-[var(--dp-on-surface)] mt-1">
                      {details.connection.environment}
                    </div>
                  </div>
                  <div>
                    <div className="text-[var(--dp-on-surface-variant)]">Created</div>
                    <div className="font-mono tabular-nums text-[var(--dp-on-surface)] mt-0.5">
                      {formatTimestamp(details.connection.createdAt)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[var(--dp-on-surface-variant)]">Updated</div>
                    <div className="font-mono tabular-nums text-[var(--dp-on-surface)] mt-0.5">
                      {formatTimestamp(details.connection.updatedAt)}
                    </div>
                  </div>
                </div>
              </section>

              {/* 2. Non-sensitive Provider Config */}
              <section className="space-y-2">
                <h3 className="text-[12px] font-semibold uppercase tracking-wider text-[var(--dp-on-surface-variant)]">
                  2. Non-Sensitive Provider Config
                </h3>
                <pre className="p-3.5 rounded-[var(--dp-radius-sm)] border border-[var(--dp-outline-variant)] bg-[var(--dp-surface-container-low)] font-mono text-[12px] overflow-x-auto text-[var(--dp-on-surface)]">
                  {JSON.stringify(details.connection.config ?? {}, null, 2)}
                </pre>
              </section>

              {/* 3. Authentication */}
              <section className="space-y-2">
                <h3 className="text-[12px] font-semibold uppercase tracking-wider text-[var(--dp-on-surface-variant)]">
                  3. Authentication & Approval
                </h3>
                <div className="p-4 rounded-[var(--dp-radius-sm)] border border-[var(--dp-outline-variant)] bg-[var(--dp-surface-container-low)] grid grid-cols-2 gap-3 text-[12px]">
                  <div>
                    <div className="text-[var(--dp-on-surface-variant)]">Auth Mode</div>
                    <div className="font-mono text-[var(--dp-on-surface)]">
                      {details.connection.authMode}
                    </div>
                  </div>
                  <div>
                    <div className="text-[var(--dp-on-surface-variant)]">Approved By</div>
                    <div className="font-mono text-[var(--dp-on-surface)]">
                      {details.connection.approvedByUid || 'Pending approval'}
                    </div>
                  </div>
                </div>
              </section>

              {/* 4. Granted Scopes */}
              <section className="space-y-2">
                <h3 className="text-[12px] font-semibold uppercase tracking-wider text-[var(--dp-on-surface-variant)]">
                  4. Granted Scopes
                </h3>
                <div className="p-3.5 rounded-[var(--dp-radius-sm)] border border-[var(--dp-outline-variant)] bg-[var(--dp-surface-container-low)] font-mono text-[12px] text-[var(--dp-on-surface)]">
                  {details.connection.allowedScopes.length > 0
                    ? details.connection.allowedScopes.join(', ')
                    : 'No explicit scopes granted.'}
                </div>
              </section>

              {/* 5. Masked Secret Reference */}
              <section className="space-y-2">
                <h3 className="text-[12px] font-semibold uppercase tracking-wider text-[var(--dp-on-surface-variant)]">
                  5. Masked Secret Reference
                </h3>
                <div className="p-3.5 rounded-[var(--dp-radius-sm)] border border-[var(--dp-outline-variant)] bg-[var(--dp-surface-container-low)] space-y-1">
                  <div className="font-mono text-[12px] text-[var(--dp-on-surface)]">
                    {maskSecretReferenceLabel(details.connection.secretRef)}
                  </div>
                  <div className="text-[11px] text-[var(--dp-on-surface-variant)]">
                    Plaintext secret values are never stored in PostgreSQL or returned to the browser.
                  </div>
                </div>
              </section>

              {/* 6. Webhook Activity */}
              <section className="space-y-2">
                <h3 className="text-[12px] font-semibold uppercase tracking-wider text-[var(--dp-on-surface-variant)]">
                  6. Webhook Activity ({details.webhookTotal})
                </h3>
                {details.recentWebhooks.length === 0 ? (
                  <div className="p-3.5 rounded-[var(--dp-radius-sm)] border border-[var(--dp-outline-variant)] text-[12px] text-[var(--dp-on-surface-variant)]">
                    No inbound webhook deliveries recorded for this connection yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto border border-[var(--dp-outline-variant)] rounded-[var(--dp-radius-sm)]">
                    <table className="w-full text-left text-[12px]">
                      <thead className="bg-[var(--dp-surface-container-low)] border-b border-[var(--dp-outline-variant)] text-[var(--dp-on-surface-variant)]">
                        <tr>
                          <th className="py-2 px-3 font-medium">Received</th>
                          <th className="py-2 px-3 font-medium">Outcome</th>
                          <th className="py-2 px-3 font-medium">SHA-256</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--dp-outline-variant)]">
                        {details.recentWebhooks.map((log) => (
                          <tr key={log.id}>
                            <td className="py-2 px-3 font-mono tabular-nums">
                              {formatTimestamp(log.receivedAt)}
                            </td>
                            <td className="py-2 px-3">
                              <StatusIndicator
                                tone={mapWebhookOutcomeTone(log.verificationOutcome)}
                                label={log.verificationOutcome}
                              />
                            </td>
                            <td className="py-2 px-3 font-mono">
                              {truncateDigest(log.payloadSha256)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* 7. Related External Mappings */}
              <section className="space-y-2">
                <h3 className="text-[12px] font-semibold uppercase tracking-wider text-[var(--dp-on-surface-variant)]">
                  7. Related External Mappings ({details.relatedMappings.length})
                </h3>
                {details.relatedMappings.length === 0 ? (
                  <div className="p-3.5 rounded-[var(--dp-radius-sm)] border border-[var(--dp-outline-variant)] text-[12px] text-[var(--dp-on-surface-variant)]">
                    No external ID mappings linked to this connection.
                  </div>
                ) : (
                  <div className="overflow-x-auto border border-[var(--dp-outline-variant)] rounded-[var(--dp-radius-sm)]">
                    <table className="w-full text-left text-[12px]">
                      <thead className="bg-[var(--dp-surface-container-low)] border-b border-[var(--dp-outline-variant)] text-[var(--dp-on-surface-variant)]">
                        <tr>
                          <th className="py-2 px-3 font-medium">Internal</th>
                          <th className="py-2 px-3 font-medium">External</th>
                          <th className="py-2 px-3 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--dp-outline-variant)]">
                        {details.relatedMappings.map((m) => (
                          <tr key={m.id}>
                            <td className="py-2 px-3 font-mono">
                              {m.internalEntityType}:{m.internalEntityId}
                            </td>
                            <td className="py-2 px-3 font-mono">
                              {m.externalEntityType}:{m.externalEntityId}
                            </td>
                            <td className="py-2 px-3 font-mono">{m.mappingStatus}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* 8. Health & Errors */}
              <section className="space-y-2">
                <h3 className="text-[12px] font-semibold uppercase tracking-wider text-[var(--dp-on-surface-variant)]">
                  8. Health & Recent Errors
                </h3>
                <div className="p-4 rounded-[var(--dp-radius-sm)] border border-[var(--dp-outline-variant)] bg-[var(--dp-surface-container-low)] space-y-2 text-[12px]">
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--dp-on-surface-variant)]">Last Success</span>
                    <span className="font-mono tabular-nums">
                      {details.connection.lastSuccessAt
                        ? formatTimestamp(details.connection.lastSuccessAt)
                        : '—'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--dp-on-surface-variant)]">Last Error</span>
                    <span className="font-mono tabular-nums">
                      {details.connection.lastErrorAt
                        ? formatTimestamp(details.connection.lastErrorAt)
                        : '—'}
                    </span>
                  </div>
                  {details.connection.lastErrorSummary && (
                    <AlertBanner tone="error" message={details.connection.lastErrorSummary} />
                  )}
                </div>
              </section>

              {/* 9. Audit History */}
              <section className="space-y-2">
                <h3 className="text-[12px] font-semibold uppercase tracking-wider text-[var(--dp-on-surface-variant)]">
                  9. Audit History ({details.auditHistory.length})
                </h3>
                {details.auditHistory.length === 0 ? (
                  <div className="p-3.5 rounded-[var(--dp-radius-sm)] border border-[var(--dp-outline-variant)] text-[12px] text-[var(--dp-on-surface-variant)]">
                    No connection lifecycle audit events recorded yet.
                  </div>
                ) : (
                  <div className="divide-y divide-[var(--dp-outline-variant)] border border-[var(--dp-outline-variant)] rounded-[var(--dp-radius-sm)]">
                    {details.auditHistory.map((entry) => (
                      <div key={entry.id} className="p-3 space-y-1 text-[12px]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono font-semibold text-[var(--dp-on-surface)]">
                            {entry.action}
                          </span>
                          <span className="font-mono tabular-nums text-[11px] text-[var(--dp-on-surface-variant)]">
                            {formatTimestamp(entry.createdAt)}
                          </span>
                        </div>
                        <div className="text-[var(--dp-on-surface-variant)]">{entry.summary}</div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>

        <div className="px-6 py-3.5 border-t border-[var(--dp-outline-variant)] flex justify-end">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
