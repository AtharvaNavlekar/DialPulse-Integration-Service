import React from 'react';
import {
  AlertBanner,
  Button,
  Card,
  INPUT_BASE_CLASS,
  SELECT_BASE_CLASS,
  StatusIndicator,
} from '../ui/Primitives.tsx';
import type {
  ExternalMappingRecord,
  IntegrationConnectionRecord,
  ProviderCatalogEntry,
} from '../../shared/types.ts';

export interface MappingsFilterState {
  providerId: string;
  connectionId: string;
  entityType: string;
  search: string;
}

interface ExternalMappingsPanelProps {
  mappings: ExternalMappingRecord[];
  total: number;
  limit: number;
  offset: number;
  loading: boolean;
  error: string | null;
  filters: MappingsFilterState;
  providers: ProviderCatalogEntry[];
  connections: IntegrationConnectionRecord[];
  onChangeFilters: (next: Partial<MappingsFilterState>) => void;
  onPageChange: (nextOffset: number) => void;
  onRetry: () => void;
  formatTimestamp: (iso: string | Date) => string;
}

export function ExternalMappingsPanel({
  mappings,
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
}: ExternalMappingsPanelProps) {
  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-4">
      <AlertBanner
        tone="info"
        message="Read-only operational explorer: external ID mappings are created and updated exclusively by idempotent integration workflows to guarantee bidirectional referential integrity."
      />

      <Card className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        <input
          type="search"
          aria-label="Search mappings by internal or external ID"
          value={filters.search}
          onChange={(e) => onChangeFilters({ search: e.target.value })}
          placeholder="Search internal or external ID..."
          className={`${INPUT_BASE_CLASS} py-1.5 text-[13px]`}
        />

        <select
          aria-label="Filter mappings by provider"
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
          aria-label="Filter mappings by connection"
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

        <input
          type="search"
          aria-label="Filter mappings by entity type"
          value={filters.entityType}
          onChange={(e) => onChangeFilters({ entityType: e.target.value })}
          placeholder="Entity type (e.g. lead_intake)..."
          className={`${INPUT_BASE_CLASS} py-1.5 text-[13px]`}
        />
      </Card>

      {error && <AlertBanner tone="error" message={error} />}

      <Card className="overflow-hidden">
        {loading && mappings.length === 0 ? (
          <div className="p-6 text-[13px] text-[var(--dp-on-surface-variant)]">
            Loading external ID mappings...
          </div>
        ) : mappings.length === 0 ? (
          <div className="p-8 text-center space-y-2">
            <div className="text-[14px] font-medium text-[var(--dp-on-surface)]">
              No external ID mappings match these filters.
            </div>
            <p className="text-[12px] text-[var(--dp-on-surface-variant)]">
              Mappings appear once inbound webhooks or outbound CRM adapters synchronize internal leads or tasks.
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
                  <th className="py-2.5 px-4 font-medium">Provider / Connection</th>
                  <th className="py-2.5 px-4 font-medium">Internal Entity</th>
                  <th className="py-2.5 px-4 font-medium">External Entity</th>
                  <th className="py-2.5 px-4 font-medium">Status</th>
                  <th className="py-2.5 px-4 font-medium">Last Synced / Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--dp-outline-variant)]">
                {mappings.map((m) => (
                  <tr key={m.id} className="hover:bg-[var(--dp-surface-container-low)]/60">
                    <td className="py-2.5 px-4">
                      <div className="font-mono text-[var(--dp-on-surface)]">{m.providerId}</div>
                      <div className="text-[11px] text-[var(--dp-on-surface-variant)]">
                        {m.connectionName || `Connection #${m.connectionId}`}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 font-mono">
                      <span className="text-[var(--dp-on-surface-variant)]">
                        {m.internalEntityType}:
                      </span>
                      <span className="text-[var(--dp-on-surface)] font-semibold">
                        {m.internalEntityId}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 font-mono">
                      <span className="text-[var(--dp-on-surface-variant)]">
                        {m.externalEntityType}:
                      </span>
                      <span className="text-[var(--dp-on-surface)] font-semibold">
                        {m.externalEntityId}
                      </span>
                    </td>
                    <td className="py-2.5 px-4">
                      <StatusIndicator
                        tone={m.mappingStatus === 'active' ? 'success' : 'neutral'}
                        label={m.mappingStatus}
                      />
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-[var(--dp-on-surface-variant)]">
                      {formatTimestamp(m.lastSyncedAt || m.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="px-4 py-3 border-t border-[var(--dp-outline-variant)] bg-[var(--dp-surface-container-low)] flex items-center justify-between text-[12px] text-[var(--dp-on-surface-variant)]">
          <span className="font-mono tabular-nums">
            Showing {mappings.length} of {total} mappings (Page {page} / {totalPages})
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
    </div>
  );
}
