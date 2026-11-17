import React from 'react';
import { RefreshCw } from 'lucide-react';
import {
  mapEventStatusTone,
  mergeSortedDurableEvents,
} from '../../shared/integrations-console.ts';
import type {
  DurableEventRecord,
  IntegrationWorkerHealth,
} from '../../shared/types.ts';
import {
  AlertBanner,
  Button,
  Card,
  INPUT_BASE_CLASS,
  SELECT_BASE_CLASS,
  StatusIndicator,
} from '../ui/Primitives.tsx';

export interface EventMonitorFilterState {
  source: 'all' | 'outbox' | 'inbox';
  status: string;
  consumerName: string;
  eventType: string;
  search: string;
  dateRange: 'all' | '24h' | '7d' | '30d';
}

interface EventProcessingPanelProps {
  outbox: DurableEventRecord[];
  inbox: DurableEventRecord[];
  outboxTotal: number;
  inboxTotal: number;
  limit: number;
  offset: number;
  workerHealth: IntegrationWorkerHealth | null;
  loading: boolean;
  error: string | null;
  filters: EventMonitorFilterState;
  onChangeFilters: (next: Partial<EventMonitorFilterState>) => void;
  onPageChange: (nextOffset: number) => void;
  onRefreshWorker: () => void;
  onRetry: () => void;
  formatTimestamp: (iso: string | Date) => string;
}

export function EventProcessingPanel({
  outbox,
  inbox,
  outboxTotal,
  inboxTotal,
  limit,
  offset,
  workerHealth,
  loading,
  error,
  filters,
  onChangeFilters,
  onPageChange,
  onRefreshWorker,
  onRetry,
  formatTimestamp,
}: EventProcessingPanelProps) {
  const combined = mergeSortedDurableEvents(outbox, inbox);
  const maxTotal =
    filters.source === 'outbox'
      ? outboxTotal
      : filters.source === 'inbox'
        ? inboxTotal
        : Math.max(outboxTotal, inboxTotal);
  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(maxTotal / limit));

  return (
    <div className="space-y-4">
      {/* Worker Health Bar */}
      <Card className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-1 text-[12px]">
          <div className="flex items-center gap-2.5">
            <span className="font-semibold text-[var(--dp-on-surface)]">
              Durable Outbox / Inbox Worker
            </span>
            {workerHealth ? (
              <StatusIndicator
                tone={
                  (workerHealth.status ??
                    (!workerHealth.enabled
                      ? 'disabled'
                      : !workerHealth.running || workerHealth.stopping
                        ? 'stopped'
                        : workerHealth.healthy
                          ? 'healthy'
                          : 'unhealthy')) === 'disabled'
                    ? 'neutral'
                    : (workerHealth.status ??
                          (workerHealth.healthy ? 'healthy' : 'unhealthy')) === 'healthy'
                      ? 'success'
                      : workerHealth.status === 'stopped'
                        ? 'warning'
                        : 'error'
                }
                label={
                  !workerHealth.enabled
                    ? 'Disabled'
                    : workerHealth.status === 'stopped' || !workerHealth.running
                      ? 'Stopped'
                      : workerHealth.healthy
                        ? 'Healthy'
                        : 'Error'
                }
              />
            ) : (
              <StatusIndicator tone="neutral" label="Checking..." />
            )}
          </div>
          {workerHealth && (
            <div className="text-[var(--dp-on-surface-variant)] font-mono tabular-nums">
              {workerHealth.workerId ? `${workerHealth.workerId} · ` : ''}Last poll:{' '}
              {workerHealth.lastPollAt ? formatTimestamp(workerHealth.lastPollAt) : 'never'} · Outbox{' '}
              {outboxTotal} · Inbox {inboxTotal}
            </div>
          )}
        </div>
        <Button variant="secondary" size="sm" onClick={onRefreshWorker}>
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
          Check Worker
        </Button>
      </Card>

      {/* Filters */}
      <Card className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
        <select
          aria-label="Filter events by source"
          value={filters.source}
          onChange={(e) =>
            onChangeFilters({
              source: e.target.value as EventMonitorFilterState['source'],
            })
          }
          className={SELECT_BASE_CLASS}
        >
          <option value="all">All Sources (Outbox + Inbox)</option>
          <option value="outbox">Outbox Only</option>
          <option value="inbox">Inbox Only</option>
        </select>

        <select
          aria-label="Filter events by status"
          value={filters.status}
          onChange={(e) => onChangeFilters({ status: e.target.value })}
          className={SELECT_BASE_CLASS}
        >
          <option value="all">All Statuses</option>
          <option value="pending">pending</option>
          <option value="received">received</option>
          <option value="processing">processing</option>
          <option value="published">published</option>
          <option value="succeeded">succeeded</option>
          <option value="dead_letter">dead_letter</option>
        </select>

        <input
          type="search"
          aria-label="Filter events by consumer name"
          value={filters.consumerName}
          onChange={(e) => onChangeFilters({ consumerName: e.target.value })}
          placeholder="Consumer name..."
          className={`${INPUT_BASE_CLASS} py-1.5 text-[13px]`}
        />

        <input
          type="search"
          aria-label="Filter events by event type"
          value={filters.eventType}
          onChange={(e) => onChangeFilters({ eventType: e.target.value })}
          placeholder="Event type..."
          className={`${INPUT_BASE_CLASS} py-1.5 text-[13px]`}
        />

        <input
          type="search"
          aria-label="Search events by event ID or error"
          value={filters.search}
          onChange={(e) => onChangeFilters({ search: e.target.value })}
          placeholder="Event ID or error..."
          className={`${INPUT_BASE_CLASS} py-1.5 text-[13px]`}
        />

        <select
          aria-label="Filter events by date range"
          value={filters.dateRange}
          onChange={(e) =>
            onChangeFilters({
              dateRange: e.target.value as EventMonitorFilterState['dateRange'],
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
        {loading && combined.length === 0 ? (
          <div className="p-6 text-[13px] text-[var(--dp-on-surface-variant)]">
            Loading outbox and inbox events...
          </div>
        ) : combined.length === 0 ? (
          <div className="p-8 text-center space-y-2">
            <div className="text-[14px] font-medium text-[var(--dp-on-surface)]">
              No durable events match the selected filters.
            </div>
            <p className="text-[12px] text-[var(--dp-on-surface-variant)]">
              Event payloads are intentionally omitted from operational listings for tenant data minimization.
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
                  <th className="py-2.5 px-4 font-medium">Created</th>
                  <th className="py-2.5 px-4 font-medium">Source / Consumer</th>
                  <th className="py-2.5 px-4 font-medium">Event Type / ID</th>
                  <th className="py-2.5 px-4 font-medium">Status</th>
                  <th className="py-2.5 px-4 font-medium">Attempts / Replays</th>
                  <th className="py-2.5 px-4 font-medium">Last Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--dp-outline-variant)]">
                {combined.map((evt) => (
                  <tr
                    key={`${evt.source}-${evt.id}`}
                    className="hover:bg-[var(--dp-surface-container-low)]/60"
                  >
                    <td className="py-2.5 px-4 font-mono tabular-nums whitespace-nowrap text-[var(--dp-on-surface-variant)]">
                      {formatTimestamp(evt.createdAt)}
                    </td>
                    <td className="py-2.5 px-4 font-mono">
                      <div className="text-[var(--dp-on-surface)]">{evt.source}</div>
                      <div className="text-[11px] text-[var(--dp-on-surface-variant)]">
                        {evt.consumerName || evt.aggregateType || '—'}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 font-mono">
                      <div className="text-[var(--dp-on-surface)]">{evt.eventType}</div>
                      <div className="text-[11px] text-[var(--dp-on-surface-variant)] truncate max-w-52">
                        {evt.eventId}
                      </div>
                    </td>
                    <td className="py-2.5 px-4">
                      <StatusIndicator
                        tone={mapEventStatusTone(evt.status)}
                        label={evt.status}
                      />
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-[var(--dp-on-surface)]">
                      {evt.attempts} / {evt.maxAttempts} · replays: {evt.replayCount}
                    </td>
                    <td className="py-2.5 px-4 max-w-xs truncate text-[var(--dp-error)]">
                      {evt.lastError || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="px-4 py-3 border-t border-[var(--dp-outline-variant)] bg-[var(--dp-surface-container-low)] flex items-center justify-between text-[12px] text-[var(--dp-on-surface-variant)]">
          <span className="font-mono tabular-nums">
            Outbox {outboxTotal} · Inbox {inboxTotal} (Page {page} / {totalPages})
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
              disabled={offset + limit >= maxTotal || loading}
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
