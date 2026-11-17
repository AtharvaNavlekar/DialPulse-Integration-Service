import React, { useState } from 'react';
import { Eye, X } from 'lucide-react';
import {
  mapWebhookOutcomeTone,
  mapWebhookProcessingTone,
  truncateDigest,
} from '../../shared/integrations-console.ts';
import type {
  IntegrationConnectionRecord,
  ProviderCatalogEntry,
  WebhookLogRecord,
} from '../../shared/types.ts';
import {
  AlertBanner,
  Button,
  Card,
  INPUT_BASE_CLASS,
  SELECT_BASE_CLASS,
  StatusIndicator,
} from '../ui/Primitives.tsx';

export interface WebhookFilterState {
  providerId: string;
  connectionId: string;
  verificationOutcome: string;
  processingStatus: string;
  eventType: string;
  dateRange: 'all' | '24h' | '7d' | '30d';
}

interface WebhookActivityPanelProps {
  logs: WebhookLogRecord[];
  total: number;
  limit: number;
  offset: number;
  loading: boolean;
  error: string | null;
  filters: WebhookFilterState;
  providers: ProviderCatalogEntry[];
  connections: IntegrationConnectionRecord[];
  onChangeFilters: (next: Partial<WebhookFilterState>) => void;
  onPageChange: (nextOffset: number) => void;
  onRetry: () => void;
  formatTimestamp: (iso: string | Date) => string;
}

export function WebhookActivityPanel({
  logs,
  total,
  limit,
  offset,
  loading,
  error,
  filters,
  providers,
  connections,
  onChangeFilters,
  onPageChange,
  onRetry,
  formatTimestamp,
}: WebhookActivityPanelProps) {
  const [selectedLog, setSelectedLog] = useState<WebhookLogRecord | null>(null);

  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-4">
      <Card className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
        <select
          aria-label="Filter webhooks by provider"
          value={filters.providerId}
          onChange={(e) => onChangeFilters({ providerId: e.target.value })}
          className={SELECT_BASE_CLASS}
        >
          <option value="">All Providers</option>
          {providers.map((p) => (
            <option key={p.providerId} value={p.providerId}>
              {p.providerId}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter webhooks by connection"
          value={filters.connectionId}
          onChange={(e) => onChangeFilters({ connectionId: e.target.value })}
          className={SELECT_BASE_CLASS}
        >
          <option value="">All Connections</option>
          {connections.map((c) => (
            <option key={c.id} value={String(c.id)}>
              {c.connectionName} (#{c.id})
            </option>
          ))}
        </select>

        <select
          aria-label="Filter webhooks by verification outcome"
          value={filters.verificationOutcome}
          onChange={(e) => onChangeFilters({ verificationOutcome: e.target.value })}
          className={SELECT_BASE_CLASS}
        >
          <option value="">All Outcomes</option>
          <option value="verified">verified</option>
          <option value="invalid_signature">invalid_signature</option>
          <option value="expired_timestamp">expired_timestamp</option>
          <option value="malformed_signature">malformed_signature</option>
          <option value="connection_inactive">connection_inactive</option>
          <option value="provider_mismatch">provider_mismatch</option>
          <option value="unconfigured_secret">unconfigured_secret</option>
          <option value="invalid_payload">invalid_payload</option>
        </select>

        <select
          aria-label="Filter webhooks by processing status"
          value={filters.processingStatus}
          onChange={(e) => onChangeFilters({ processingStatus: e.target.value })}
          className={SELECT_BASE_CLASS}
        >
          <option value="">All Processing</option>
          <option value="accepted">accepted</option>
          <option value="duplicate">duplicate</option>
          <option value="rejected">rejected</option>
          <option value="error">error</option>
        </select>

        <input
          type="search"
          aria-label="Filter webhooks by event type"
          value={filters.eventType}
          onChange={(e) => onChangeFilters({ eventType: e.target.value })}
          placeholder="Event type..."
          className={`${INPUT_BASE_CLASS} py-1.5 text-[13px]`}
        />

        <select
          aria-label="Filter webhooks by date range"
          value={filters.dateRange}
          onChange={(e) =>
            onChangeFilters({
              dateRange: e.target.value as WebhookFilterState['dateRange'],
            })
          }
          className={SELECT_BASE_CLASS}
        >
          <option value="all">All Time</option>
          <option value="24h">Last 24h</option>
          <option value="7d">Last 7d</option>
          <option value="30d">Last 30d</option>
        </select>
      </Card>

      {error && (
        <AlertBanner tone="error" message={error} />
      )}

      <Card className="overflow-hidden">
        {loading && logs.length === 0 ? (
          <div className="p-6 text-[13px] text-[var(--dp-on-surface-variant)]">
            Loading sanitized webhook logs...
          </div>
        ) : logs.length === 0 ? (
          <div className="p-8 text-center space-y-2">
            <div className="text-[14px] font-medium text-[var(--dp-on-surface)]">
              No webhook deliveries found for these filters.
            </div>
            <p className="text-[12px] text-[var(--dp-on-surface-variant)]">
              Inbound signed webhooks record verification outcomes and SHA-256 digests without storing raw payloads or signature headers.
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
                  <th className="py-2.5 px-4 font-medium">Received</th>
                  <th className="py-2.5 px-4 font-medium">Provider / Connection</th>
                  <th className="py-2.5 px-4 font-medium">Event / ID</th>
                  <th className="py-2.5 px-4 font-medium">Outcome</th>
                  <th className="py-2.5 px-4 font-medium">Processing</th>
                  <th className="py-2.5 px-4 font-medium">HTTP</th>
                  <th className="py-2.5 px-4 font-medium">SHA-256</th>
                  <th className="py-2.5 px-4 font-medium text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--dp-outline-variant)]">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-[var(--dp-surface-container-low)]/60">
                    <td className="py-2.5 px-4 font-mono tabular-nums whitespace-nowrap text-[var(--dp-on-surface-variant)]">
                      {formatTimestamp(log.receivedAt)}
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="font-mono text-[var(--dp-on-surface)]">{log.providerId}</div>
                      <div className="text-[11px] text-[var(--dp-on-surface-variant)] truncate max-w-44">
                        {log.connectionName || `Connection #${log.connectionId}`}
                      </div>
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="font-mono text-[var(--dp-on-surface)]">
                        {log.eventType || '—'}
                      </div>
                      <div className="font-mono text-[11px] text-[var(--dp-on-surface-variant)]">
                        {log.providerEventId || '—'}
                      </div>
                    </td>
                    <td className="py-2.5 px-4">
                      <StatusIndicator
                        tone={mapWebhookOutcomeTone(log.verificationOutcome)}
                        label={log.verificationOutcome}
                      />
                    </td>
                    <td className="py-2.5 px-4">
                      <StatusIndicator
                        tone={mapWebhookProcessingTone(log.processingStatus)}
                        label={log.processingStatus}
                      />
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-[var(--dp-on-surface)]">
                      {log.httpStatus}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-[11px] text-[var(--dp-on-surface-variant)]">
                      {truncateDigest(log.payloadSha256)}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <Button
                        variant="tertiary"
                        size="sm"
                        onClick={() => setSelectedLog(log)}
                      >
                        <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                        Metadata
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="px-4 py-3 border-t border-[var(--dp-outline-variant)] bg-[var(--dp-surface-container-low)] flex items-center justify-between text-[12px] text-[var(--dp-on-surface-variant)]">
          <span className="font-mono tabular-nums">
            Showing {logs.length} of {total} logs (Page {page} / {totalPages})
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={offset === 0 || loading}
              onClick={() => onPageChange(Math.max(0, offset - limit))}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={offset + limit >= total || loading}
              onClick={() => onPageChange(offset + limit)}
            >
              Next
            </Button>
          </div>
        </div>
      </Card>

      {selectedLog && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="webhook-meta-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={() => setSelectedLog(null)}
        >
          <div
            className="w-full max-w-lg bg-[var(--dp-surface-container-lowest)] border border-[var(--dp-outline-variant)] rounded-[var(--dp-radius-lg)] p-6 space-y-4 shadow-2xl text-[13px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <h2
                id="webhook-meta-title"
                className="text-[16px] font-semibold text-[var(--dp-on-surface)]"
              >
                Sanitized Webhook Delivery Metadata #{selectedLog.id}
              </h2>
              <button
                type="button"
                aria-label="Close modal"
                onClick={() => setSelectedLog(null)}
                className="p-1 rounded text-[var(--dp-on-surface-variant)] hover:text-[var(--dp-on-surface)] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <AlertBanner
              tone="info"
              message="Raw webhook payload bodies, HMAC signature headers, and signing secrets are never persisted or exposed in Console logs."
            />

            <dl className="grid grid-cols-2 gap-3 text-[12px]">
              <div>
                <dt className="text-[var(--dp-on-surface-variant)]">Provider</dt>
                <dd className="font-mono text-[var(--dp-on-surface)]">{selectedLog.providerId}</dd>
              </div>
              <div>
                <dt className="text-[var(--dp-on-surface-variant)]">Connection</dt>
                <dd className="text-[var(--dp-on-surface)]">
                  {selectedLog.connectionName || `#${selectedLog.connectionId}`}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--dp-on-surface-variant)]">Verification Outcome</dt>
                <dd className="font-mono text-[var(--dp-on-surface)]">
                  {selectedLog.verificationOutcome}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--dp-on-surface-variant)]">Processing / HTTP</dt>
                <dd className="font-mono tabular-nums text-[var(--dp-on-surface)]">
                  {selectedLog.processingStatus} ({selectedLog.httpStatus})
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-[var(--dp-on-surface-variant)]">Payload SHA-256 Digest</dt>
                <dd className="font-mono text-[11px] break-all text-[var(--dp-on-surface)] mt-0.5">
                  {selectedLog.payloadSha256}
                </dd>
              </div>
              {selectedLog.sanitizedFailureReason && (
                <div className="col-span-2">
                  <dt className="text-[var(--dp-on-surface-variant)]">Sanitized Failure Reason</dt>
                  <dd className="text-[var(--dp-error)] mt-0.5">
                    {selectedLog.sanitizedFailureReason}
                  </dd>
                </div>
              )}
            </dl>

            <div className="flex justify-end">
              <Button variant="secondary" size="sm" onClick={() => setSelectedLog(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
