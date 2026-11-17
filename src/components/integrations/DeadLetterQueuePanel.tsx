import React, { useState } from 'react';
import { Eye, RotateCcw, X } from 'lucide-react';
import {
  canReplayDeadLetters,
  mapEventStatusTone,
  mergeSortedDurableEvents,
  validateReplaySubmission,
} from '../../shared/integrations-console.ts';
import type { DurableEventRecord, RoleConfig, RoleKey } from '../../shared/types.ts';
import {
  AlertBanner,
  Button,
  Card,
  INPUT_BASE_CLASS,
  SELECT_BASE_CLASS,
  StatusIndicator,
} from '../ui/Primitives.tsx';

export interface DlqFilterState {
  source: 'all' | 'outbox' | 'inbox';
  search: string;
}

interface DeadLetterQueuePanelProps {
  outbox: DurableEventRecord[];
  inbox: DurableEventRecord[];
  outboxTotal: number;
  inboxTotal: number;
  limit: number;
  offset: number;
  loading: boolean;
  error: string | null;
  filters: DlqFilterState;
  roleKey: RoleKey;
  permissions: RoleConfig;
  onChangeFilters: (next: Partial<DlqFilterState>) => void;
  onPageChange: (nextOffset: number) => void;
  onReplay: (event: DurableEventRecord, reason: string) => Promise<void>;
  onRetry: () => void;
  formatTimestamp: (iso: string | Date) => string;
}

export function DeadLetterQueuePanel({
  outbox,
  inbox,
  outboxTotal,
  inboxTotal,
  limit,
  offset,
  loading,
  error,
  filters,
  roleKey,
  permissions,
  onChangeFilters,
  onPageChange,
  onReplay,
  onRetry,
  formatTimestamp,
}: DeadLetterQueuePanelProps) {
  const canReplay = canReplayDeadLetters(roleKey, permissions);
  const deadLetters = mergeSortedDurableEvents(outbox, inbox);
  const maxTotal =
    filters.source === 'outbox'
      ? outboxTotal
      : filters.source === 'inbox'
        ? inboxTotal
        : Math.max(outboxTotal, inboxTotal);
  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(maxTotal / limit));

  const [inspectEvent, setInspectEvent] = useState<DurableEventRecord | null>(null);
  const [replayTarget, setReplayTarget] = useState<DurableEventRecord | null>(null);
  const [replayReason, setReplayReason] = useState('');
  const [confirmedAsync, setConfirmedAsync] = useState(false);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [replaying, setReplaying] = useState(false);

  const openReplayModal = (evt: DurableEventRecord) => {
    setReplayTarget(evt);
    setReplayReason('');
    setConfirmedAsync(false);
    setReplayError(null);
  };

  const handleSubmitReplay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replayTarget) return;

    const validation = validateReplaySubmission(replayReason, confirmedAsync);
    if (!validation.valid) {
      setReplayError(validation.error);
      return;
    }

    setReplaying(true);
    setReplayError(null);
    try {
      await onReplay(replayTarget, validation.trimmedReason);
      setReplayTarget(null);
    } catch (err) {
      setReplayError(
        err instanceof Error
          ? err.message
          : 'Unable to replay dead-letter event.'
      );
    } finally {
      setReplaying(false);
    }
  };

  return (
    <div className="space-y-4">
      {!canReplay && (
        <AlertBanner
          tone="warning"
          message={`Your current role (${roleKey}) lacks the canReplayEvents capability in this tenant and cannot trigger DLQ replay.`}
        />
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 flex-1">
          <select
            aria-label="Filter DLQ by source"
            value={filters.source}
            onChange={(e) =>
              onChangeFilters({
                source: e.target.value as DlqFilterState['source'],
              })
            }
            className={SELECT_BASE_CLASS}
          >
            <option value="all">All Sources (Outbox + Inbox)</option>
            <option value="inbox">Inbox DLQ</option>
            <option value="outbox">Outbox DLQ</option>
          </select>

          <input
            type="search"
            aria-label="Search DLQ by event ID or error"
            value={filters.search}
            onChange={(e) => onChangeFilters({ search: e.target.value })}
            placeholder="Search eventId, type, or failure error..."
            className={`${INPUT_BASE_CLASS} max-w-sm py-1.5 text-[13px]`}
          />
        </div>
        <div className="text-[12px] font-mono tabular-nums text-[var(--dp-on-surface-variant)]">
          Dead-letter totals: Outbox {outboxTotal} · Inbox {inboxTotal}
        </div>
      </div>

      {error && <AlertBanner tone="error" message={error} />}

      <Card className="overflow-hidden">
        {loading && deadLetters.length === 0 ? (
          <div className="p-6 text-[13px] text-[var(--dp-on-surface-variant)]">
            Loading dead-letter events...
          </div>
        ) : deadLetters.length === 0 ? (
          <div className="p-8 text-center space-y-2">
            <div className="text-[14px] font-medium text-[var(--dp-on-surface)]">
              Dead-letter queue is clear.
            </div>
            <p className="text-[12px] text-[var(--dp-on-surface-variant)]">
              No outbox or inbox events are currently in dead_letter state for this tenant.
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
                  <th className="py-2.5 px-4 font-medium">Event / Source</th>
                  <th className="py-2.5 px-4 font-medium">Status</th>
                  <th className="py-2.5 px-4 font-medium">Attempts / Replays</th>
                  <th className="py-2.5 px-4 font-medium">Failure Summary</th>
                  <th className="py-2.5 px-4 font-medium">Created</th>
                  <th className="py-2.5 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--dp-outline-variant)]">
                {deadLetters.map((evt) => (
                  <tr
                    key={`${evt.source}-${evt.id}`}
                    className="hover:bg-[var(--dp-surface-container-low)]/60"
                  >
                    <td className="py-3 px-4 font-mono">
                      <div className="font-semibold text-[var(--dp-on-surface)]">
                        {evt.eventType} ({evt.source})
                      </div>
                      <div className="text-[11px] text-[var(--dp-on-surface-variant)] truncate max-w-56">
                        {evt.eventId}
                        {evt.consumerName ? ` · ${evt.consumerName}` : ''}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <StatusIndicator
                        tone={mapEventStatusTone(evt.status)}
                        label={evt.status}
                      />
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-[var(--dp-on-surface)]">
                      {evt.attempts}/{evt.maxAttempts} · {evt.replayCount} replays
                    </td>
                    <td className="py-3 px-4 max-w-xs text-[var(--dp-error)] truncate">
                      {evt.lastError || 'No failure reason recorded.'}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-[var(--dp-on-surface-variant)]">
                      {formatTimestamp(evt.createdAt)}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant="tertiary"
                          size="sm"
                          onClick={() => setInspectEvent(evt)}
                        >
                          <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                          Details
                        </Button>
                        {canReplay && (
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => openReplayModal(evt)}
                          >
                            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                            Replay
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="px-4 py-3 border-t border-[var(--dp-outline-variant)] bg-[var(--dp-surface-container-low)] flex items-center justify-between text-[12px] text-[var(--dp-on-surface-variant)]">
          <span className="font-mono tabular-nums">
            Page {page} / {totalPages}
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

      {/* Failure Detail Modal */}
      {inspectEvent && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="dlq-inspect-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={() => setInspectEvent(null)}
        >
          <div
            className="w-full max-w-lg bg-[var(--dp-surface-container-lowest)] border border-[var(--dp-outline-variant)] rounded-[var(--dp-radius-lg)] p-6 space-y-4 shadow-2xl text-[13px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <h2
                id="dlq-inspect-title"
                className="text-[16px] font-semibold text-[var(--dp-on-surface)]"
              >
                Dead-Letter Failure Details ({inspectEvent.source} #{inspectEvent.id})
              </h2>
              <button
                type="button"
                aria-label="Close modal"
                onClick={() => setInspectEvent(null)}
                className="p-1 rounded text-[var(--dp-on-surface-variant)] hover:text-[var(--dp-on-surface)] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <dl className="grid grid-cols-2 gap-3 text-[12px]">
              <div className="col-span-2">
                <dt className="text-[var(--dp-on-surface-variant)]">Event ID</dt>
                <dd className="font-mono break-all text-[var(--dp-on-surface)]">
                  {inspectEvent.eventId}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--dp-on-surface-variant)]">Consumer / Aggregate</dt>
                <dd className="font-mono text-[var(--dp-on-surface)]">
                  {inspectEvent.consumerName || inspectEvent.aggregateType || '—'}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--dp-on-surface-variant)]">Attempts / Replays</dt>
                <dd className="font-mono tabular-nums text-[var(--dp-on-surface)]">
                  {inspectEvent.attempts} / {inspectEvent.maxAttempts} · replays:{' '}
                  {inspectEvent.replayCount}
                </dd>
              </div>
              {inspectEvent.lastReplayedAt && (
                <div className="col-span-2">
                  <dt className="text-[var(--dp-on-surface-variant)]">Previous Replay</dt>
                  <dd className="text-[var(--dp-on-surface)]">
                    {formatTimestamp(inspectEvent.lastReplayedAt)} by{' '}
                    <span className="font-mono">{inspectEvent.lastReplayedByUid}</span> —{' '}
                    {inspectEvent.lastReplayReason}
                  </dd>
                </div>
              )}
            </dl>

            <div className="p-3 rounded-[var(--dp-radius-sm)] bg-[var(--dp-error-container)]/35 border border-[var(--dp-error)]/30 text-[12px] text-[var(--dp-on-surface)] font-mono break-words">
              {inspectEvent.lastError || 'No lastError recorded.'}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setInspectEvent(null)}>
                Close
              </Button>
              {canReplay && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    const target = inspectEvent;
                    setInspectEvent(null);
                    openReplayModal(target);
                  }}
                >
                  Replay Event
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Authorized Replay Modal */}
      {replayTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="dlq-replay-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={() => {
            if (!replaying) setReplayTarget(null);
          }}
        >
          <div
            className="w-full max-w-lg bg-[var(--dp-surface-container-lowest)] border border-[var(--dp-outline-variant)] rounded-[var(--dp-radius-lg)] p-6 space-y-4 shadow-2xl text-[13px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <h2
                id="dlq-replay-title"
                className="text-[16px] font-semibold text-[var(--dp-on-surface)]"
              >
                Replay Dead-Letter Event
              </h2>
              <button
                type="button"
                aria-label="Close modal"
                disabled={replaying}
                onClick={() => setReplayTarget(null)}
                className="p-1 rounded text-[var(--dp-on-surface-variant)] hover:text-[var(--dp-on-surface)] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 rounded-[var(--dp-radius-sm)] bg-[var(--dp-surface-container-low)] border border-[var(--dp-outline-variant)] text-[12px] space-y-1">
              <div className="font-mono text-[var(--dp-on-surface)]">
                {replayTarget.source} #{replayTarget.id} · {replayTarget.eventType}
              </div>
              <div className="font-mono text-[11px] text-[var(--dp-on-surface-variant)] break-all">
                eventId: {replayTarget.eventId}
              </div>
              {replayTarget.lastError && (
                <div className="text-[var(--dp-error)] pt-1">
                  Last failure: {replayTarget.lastError}
                </div>
              )}
            </div>

            {replayError && <AlertBanner tone="error" message={replayError} />}

            <form onSubmit={handleSubmitReplay} className="space-y-4">
              <label className="block space-y-1">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="font-medium text-[var(--dp-on-surface)]">
                    Operational Replay Reason (3–300 chars)
                  </span>
                  <span className="font-mono tabular-nums text-[var(--dp-on-surface-variant)]">
                    {replayReason.trim().length} / 300
                  </span>
                </div>
                <textarea
                  required
                  rows={3}
                  value={replayReason}
                  onChange={(e) => setReplayReason(e.target.value)}
                  placeholder="Describe what root cause was fixed before replaying..."
                  className={INPUT_BASE_CLASS}
                />
              </label>

              <label className="flex items-start gap-2.5 text-[12px] text-[var(--dp-on-surface)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmedAsync}
                  onChange={(e) => setConfirmedAsync(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-[var(--dp-outline-variant)] accent-[var(--dp-primary)]"
                />
                <span>
                  I confirm this requeues the original dead-letter event for asynchronous worker processing and does not guarantee immediate completion.
                </span>
              </label>

              <div className="flex justify-end gap-2.5 pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={replaying}
                  onClick={() => setReplayTarget(null)}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={replaying}>
                  {replaying ? 'Requeuing...' : 'Confirm & Requeue Replay'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
