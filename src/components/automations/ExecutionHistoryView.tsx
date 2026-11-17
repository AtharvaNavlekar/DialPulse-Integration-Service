import React, { useMemo, useState } from 'react';
import { Eye, RefreshCw } from 'lucide-react';
import { usePreferences } from '../../context/PreferencesContext.tsx';
import { MAX_AUTOMATION_RETRY_ATTEMPTS } from '../../shared/automation-engine.ts';
import type { AutomationExecutionRecord } from '../../shared/types.ts';
import {
  Button,
  Card,
  INPUT_BASE_CLASS,
  SegmentedControl,
  StatusIndicator,
} from '../ui/Primitives.tsx';

export function ExecutionHistoryView({
  executions,
  canManage,
  onRetry,
  onInspect,
}: {
  executions: AutomationExecutionRecord[];
  canManage: boolean;
  onRetry: (executionId: number) => void;
  onInspect: (execution: AutomationExecutionRecord) => void;
}) {
  const { formatTimestamp } = usePreferences();
  const [statusFilter, setStatusFilter] = useState<'all' | 'succeeded' | 'skipped' | 'failed'>('all');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    return executions.filter((exec) => {
      if (statusFilter !== 'all' && exec.status !== statusFilter) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        (exec.automationName || '').toLowerCase().includes(q) ||
        exec.eventId.toLowerCase().includes(q) ||
        (exec.errorMessage || '').toLowerCase().includes(q)
      );
    });
  }, [executions, search, statusFilter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <SegmentedControl
          options={[
            { value: 'all', label: 'All Runs' },
            { value: 'succeeded', label: 'Succeeded' },
            { value: 'skipped', label: 'Skipped' },
            { value: 'failed', label: 'Failed' },
          ]}
          value={statusFilter}
          onChange={setStatusFilter}
        />

        <input
          type="search"
          aria-label="Filter execution runs"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search workflow or event ID..."
          className={`${INPUT_BASE_CLASS} w-full sm:w-72 py-1.5 text-[13px]`}
        />
      </div>

      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-[13px] text-[var(--dp-on-surface-variant)]">
            No matching automation executions recorded.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead className="bg-[var(--dp-surface-container-low)] border-b border-[var(--dp-outline-variant)] text-[var(--dp-on-surface-variant)]">
                <tr>
                  <th className="py-2.5 px-4 font-medium">Run ID</th>
                  <th className="py-2.5 px-4 font-medium">Workflow</th>
                  <th className="py-2.5 px-4 font-medium">Event</th>
                  <th className="py-2.5 px-4 font-medium">Status</th>
                  <th className="py-2.5 px-4 font-medium">Attempts</th>
                  <th className="py-2.5 px-4 font-medium">Timestamp</th>
                  <th className="py-2.5 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--dp-outline-variant)]">
                {filtered.map((exec) => (
                  <tr
                    key={exec.id}
                    className="hover:bg-[var(--dp-surface-variant)]/50 transition-colors duration-150"
                  >
                    <td className="py-2.5 px-4 font-mono tabular-nums text-[var(--dp-on-surface-variant)]">
                      #{exec.id}
                    </td>
                    <td className="py-2.5 px-4 font-medium text-[var(--dp-on-surface)]">
                      <div>
                        {exec.automationName || `Automation #${exec.automationId}`}
                      </div>
                      {exec.errorMessage && (
                        <div className="text-[var(--dp-error)] font-normal mt-0.5">
                          {exec.errorMessage}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-[11px] text-[var(--dp-on-surface-variant)]">
                      {exec.eventId}
                    </td>
                    <td className="py-2.5 px-4">
                      <StatusIndicator
                        tone={
                          exec.status === 'succeeded'
                            ? 'success'
                            : exec.status === 'failed'
                              ? 'error'
                              : 'neutral'
                        }
                        label={exec.status}
                      />
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-[var(--dp-on-surface-variant)]">
                      {exec.attempts} / {MAX_AUTOMATION_RETRY_ATTEMPTS}
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-[var(--dp-on-surface-variant)] whitespace-nowrap">
                      {formatTimestamp(exec.createdAt)}
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => onInspect(exec)}
                        >
                          <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                          Inspect
                        </Button>
                        {exec.status === 'failed' &&
                          canManage &&
                          exec.attempts < MAX_AUTOMATION_RETRY_ATTEMPTS && (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => onRetry(exec.id)}
                            >
                              <RefreshCw className="w-3 h-3" aria-hidden="true" />
                              Retry
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
      </Card>
    </div>
  );
}
