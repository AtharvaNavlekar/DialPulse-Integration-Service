import React, { useState } from 'react';
import type { IntegrationAuditEntryRecord } from '../../shared/types.ts';
import {
  AlertBanner,
  Button,
  Card,
  INPUT_BASE_CLASS,
  SELECT_BASE_CLASS,
  StatusIndicator,
} from '../ui/Primitives.tsx';

export interface AuditFilterState {
  entryType: 'all' | 'activity' | 'replay';
  search: string;
  dateRange: 'all' | '24h' | '7d' | '30d';
}

interface IntegrationAuditPanelProps {
  entries: IntegrationAuditEntryRecord[];
  total: number;
  limit: number;
  offset: number;
  loading: boolean;
  error: string | null;
  filters: AuditFilterState;
  onChangeFilters: (next: Partial<AuditFilterState>) => void;
  onPageChange: (nextOffset: number) => void;
  onRetry: () => void;
  formatTimestamp: (iso: string | Date) => string;
}

export function IntegrationAuditPanel({
  entries,
  total,
  limit,
  offset,
  loading,
  error,
  filters,
  onChangeFilters,
  onPageChange,
  onRetry,
  formatTimestamp,
}: IntegrationAuditPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-4">
      <Card className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        <select
          aria-label="Filter audit entries by source"
          value={filters.entryType}
          onChange={(e) =>
            onChangeFilters({
              entryType: e.target.value as AuditFilterState['entryType'],
            })
          }
          className={SELECT_BASE_CLASS}
        >
          <option value="all">All Entries (Lifecycle + Replays)</option>
          <option value="activity">Integration Lifecycle Events</option>
          <option value="replay">DLQ Replay Logs</option>
        </select>

        <input
          type="search"
          aria-label="Search audit history"
          value={filters.search}
          onChange={(e) => onChangeFilters({ search: e.target.value })}
          placeholder="Search actor, eventId, reason, or summary..."
          className={`${INPUT_BASE_CLASS} py-1.5 text-[13px]`}
        />

        <select
          aria-label="Filter audit entries by date range"
          value={filters.dateRange}
          onChange={(e) =>
            onChangeFilters({
              dateRange: e.target.value as AuditFilterState['dateRange'],
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

      {error && <AlertBanner tone="error" message={error} />}

      <Card className="overflow-hidden">
        {loading && entries.length === 0 ? (
          <div className="p-6 text-[13px] text-[var(--dp-on-surface-variant)]">
            Loading integration audit history...
          </div>
        ) : entries.length === 0 ? (
          <div className="p-8 text-center space-y-2">
            <div className="text-[14px] font-medium text-[var(--dp-on-surface)]">
              No integration audit entries match these filters.
            </div>
            <p className="text-[12px] text-[var(--dp-on-surface-variant)]">
              Connection lifecycle changes and authorized DLQ replays are recorded here chronologically.
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
                  <th className="py-2.5 px-4 font-medium">Timestamp</th>
                  <th className="py-2.5 px-4 font-medium">Source / Action</th>
                  <th className="py-2.5 px-4 font-medium">Actor</th>
                  <th className="py-2.5 px-4 font-medium">Summary / Reason</th>
                  <th className="py-2.5 px-4 font-medium text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--dp-outline-variant)]">
                {entries.map((entry) => {
                  const isExpanded = expandedId === entry.id;
                  return (
                    <React.Fragment key={entry.id}>
                      <tr className="hover:bg-[var(--dp-surface-container-low)]/60">
                        <td className="py-2.5 px-4 font-mono tabular-nums whitespace-nowrap text-[var(--dp-on-surface-variant)]">
                          {formatTimestamp(entry.timestamp)}
                        </td>
                        <td className="py-2.5 px-4">
                          <StatusIndicator
                            tone={entry.entryType === 'replay' ? 'info' : 'neutral'}
                            label={entry.action}
                          />
                        </td>
                        <td className="py-2.5 px-4">
                          <div className="text-[var(--dp-on-surface)] font-medium">
                            {entry.actorLabel}
                          </div>
                          <div className="font-mono text-[11px] text-[var(--dp-on-surface-variant)]">
                            {entry.actorUid}
                          </div>
                        </td>
                        <td className="py-2.5 px-4 max-w-md text-[var(--dp-on-surface)]">
                          <div>{entry.summary}</div>
                          {entry.reason && (
                            <div className="text-[11px] text-[var(--dp-on-surface-variant)] mt-0.5">
                              Reason: {entry.reason}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <Button
                            variant="tertiary"
                            size="sm"
                            onClick={() =>
                              setExpandedId(isExpanded ? null : entry.id)
                            }
                          >
                            {isExpanded ? 'Hide' : 'Inspect'}
                          </Button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-[var(--dp-surface-container-low)]">
                          <td colSpan={5} className="px-4 py-3 text-[12px] space-y-1.5">
                            {entry.eventId && (
                              <div className="font-mono">
                                eventId: {entry.eventId} ({entry.source} · previous{' '}
                                {entry.previousStatus} / {entry.previousAttempts} attempts)
                              </div>
                            )}
                            {entry.previousLastError && (
                              <div className="text-[var(--dp-error)] font-mono">
                                previousLastError: {entry.previousLastError}
                              </div>
                            )}
                            <pre className="font-mono text-[11px] text-[var(--dp-on-surface-variant)] overflow-x-auto">
                              {JSON.stringify(entry.metadata ?? {}, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="px-4 py-3 border-t border-[var(--dp-outline-variant)] bg-[var(--dp-surface-container-low)] flex items-center justify-between text-[12px] text-[var(--dp-on-surface-variant)]">
          <span className="font-mono tabular-nums">
            Showing {entries.length} of {total} entries (Page {page} / {totalPages})
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
