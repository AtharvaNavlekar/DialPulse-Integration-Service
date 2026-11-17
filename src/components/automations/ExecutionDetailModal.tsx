import React from 'react';
import { X } from 'lucide-react';
import { usePreferences } from '../../context/PreferencesContext.tsx';
import type { AutomationExecutionRecord } from '../../shared/types.ts';
import { Button, StatusIndicator } from '../ui/Primitives.tsx';

export function ExecutionDetailModal({
  execution,
  onClose,
}: {
  execution: AutomationExecutionRecord | null;
  onClose: () => void;
}) {
  const { formatTimestamp } = usePreferences();

  if (!execution) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="exec-detail-title"
    >
      <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-[var(--dp-radius-md)] bg-[var(--dp-surface-container-lowest)] border border-[var(--dp-outline-variant)] shadow-xl p-6 space-y-5">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--dp-outline-variant)] pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <h2
                id="exec-detail-title"
                className="text-[16px] font-semibold text-[var(--dp-on-surface)]"
              >
                Execution Run #{execution.id}
              </h2>
              <StatusIndicator
                tone={
                  execution.status === 'succeeded'
                    ? 'success'
                    : execution.status === 'failed'
                      ? 'error'
                      : 'neutral'
                }
                label={execution.status}
              />
            </div>
            <p className="text-[12px] text-[var(--dp-on-surface-variant)]">
              {execution.automationName || `Automation #${execution.automationId}`} ·{' '}
              <span className="font-mono tabular-nums">
                {formatTimestamp(execution.createdAt)}
              </span>
            </p>
          </div>

          <button
            type="button"
            aria-label="Close execution details"
            onClick={onClose}
            className="p-1.5 rounded-[var(--dp-radius-sm)] text-[var(--dp-on-surface-variant)] hover:text-[var(--dp-on-surface)] hover:bg-[var(--dp-surface-variant)] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[12px]">
          <div className="p-3 rounded-[var(--dp-radius-sm)] bg-[var(--dp-surface-container-low)] border border-[var(--dp-outline-variant)]">
            <div className="text-[var(--dp-on-surface-variant)]">Event ID</div>
            <div className="font-mono text-[var(--dp-on-surface)] mt-0.5 break-all">
              {execution.eventId}
            </div>
          </div>
          <div className="p-3 rounded-[var(--dp-radius-sm)] bg-[var(--dp-surface-container-low)] border border-[var(--dp-outline-variant)]">
            <div className="text-[var(--dp-on-surface-variant)]">Attempts & Source</div>
            <div className="font-mono text-[var(--dp-on-surface)] mt-0.5">
              {execution.attempts} attempt(s) · {execution.sourceEntityType} #{execution.sourceEntityId}
            </div>
          </div>
        </div>

        {execution.errorMessage && (
          <div className="p-3 rounded-[var(--dp-radius-sm)] bg-[var(--dp-error-container)]/40 border border-[var(--dp-error)]/40 text-[12px] text-[var(--dp-error)]">
            <span className="font-semibold">Error: </span>
            {execution.errorMessage}
          </div>
        )}

        <div className="space-y-2">
          <h3 className="text-[12px] font-semibold text-[var(--dp-on-surface-variant)] uppercase tracking-wider">
            Action Results ({execution.actionResults.length})
          </h3>
          {execution.actionResults.length === 0 ? (
            <p className="text-[12px] text-[var(--dp-on-surface-variant)]">
              No actions executed for this run.
            </p>
          ) : (
            <pre className="p-3 rounded-[var(--dp-radius-sm)] bg-[var(--dp-surface-container-low)] border border-[var(--dp-outline-variant)] text-[11px] font-mono text-[var(--dp-on-surface)] overflow-x-auto">
              {JSON.stringify(execution.actionResults, null, 2)}
            </pre>
          )}
        </div>

        <div className="space-y-2">
          <h3 className="text-[12px] font-semibold text-[var(--dp-on-surface-variant)] uppercase tracking-wider">
            Trigger Event Payload
          </h3>
          <pre className="p-3 rounded-[var(--dp-radius-sm)] bg-[var(--dp-surface-container-low)] border border-[var(--dp-outline-variant)] text-[11px] font-mono text-[var(--dp-on-surface)] overflow-x-auto">
            {JSON.stringify(execution.eventPayload, null, 2)}
          </pre>
        </div>

        <div className="flex justify-end pt-2">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
