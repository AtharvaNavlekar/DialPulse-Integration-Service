import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext.tsx';
import { usePreferences } from '../context/PreferencesContext.tsx';
import type { ActivityLogRecord } from '../shared/types.ts';
import {
  AlertBanner,
  Button,
  Card,
  INPUT_BASE_CLASS,
  PageHeader,
  SELECT_BASE_CLASS,
  SegmentedControl,
} from './ui/Primitives.tsx';

const MODULES = [
  { value: 'all', label: 'All' },
  { value: 'forms', label: 'Forms' },
  { value: 'automation', label: 'Automation' },
  { value: 'tasks', label: 'Tasks' },
  { value: 'settings', label: 'Settings' },
  { value: 'workspace', label: 'Workspace' },
] as const;

const PAGE_SIZE = 25;

export function ActivityLogsView() {
  const { apiFetch, session } = useAuth();
  const { formatTimestamp, preferences } = usePreferences();
  const [logs, setLogs] = useState<ActivityLogRecord[]>([]);
  const [moduleFilter, setModuleFilter] = useState<string>('all');
  const [dateRange, setDateRange] = useState<'all' | '24h' | '7d'>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = moduleFilter === 'all' ? '' : `?module=${moduleFilter}`;
      const res = await apiFetch<{ logs: ActivityLogRecord[] }>(
        `/api/workspace/activity${qs}`
      );
      setLogs(res.logs);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to load activity logs.'
      );
    } finally {
      setLoading(false);
    }
  }, [apiFetch, moduleFilter]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs, session?.activeTenant.tenantId]);

  useEffect(() => {
    setPage(1);
  }, [moduleFilter, dateRange, search]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const cutoff =
      dateRange === '24h'
        ? now - 24 * 60 * 60 * 1000
        : dateRange === '7d'
          ? now - 7 * 24 * 60 * 60 * 1000
          : 0;

    return logs.filter((log) => {
      if (cutoff > 0 && new Date(log.createdAt).getTime() < cutoff) {
        return false;
      }
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        log.summary.toLowerCase().includes(q) ||
        log.actorLabel.toLowerCase().includes(q) ||
        log.action.toLowerCase().includes(q) ||
        log.entityId.toLowerCase().includes(q)
      );
    });
  }, [logs, dateRange, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pagedLogs = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const cellPad = preferences.density === 'compact' ? 'py-2 px-3.5' : 'py-2.5 px-4';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Activity Logs"
        description="Tenant-scoped audit trail for form publishing, submissions, automation runs, and settings changes."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Date range filter"
              value={dateRange}
              onChange={(e) =>
                setDateRange(e.target.value as 'all' | '24h' | '7d')
              }
              className={`${SELECT_BASE_CLASS} py-1.5 text-[13px]`}
            >
              <option value="all">All Dates</option>
              <option value="24h">Last 24 Hours</option>
              <option value="7d">Last 7 Days</option>
            </select>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search actor, action, summary..."
              className={`${INPUT_BASE_CLASS} w-full sm:w-72 py-1.5 text-[13px]`}
            />
          </div>
        }
      />

      <div className="overflow-x-auto pb-1">
        <SegmentedControl
          options={[...MODULES]}
          value={moduleFilter}
          onChange={setModuleFilter}
        />
      </div>

      {error && <AlertBanner tone="error" message={error} />}

      <Card className="overflow-hidden">
        {loading ? (
          <div className="p-8 text-[13px] text-[var(--dp-on-surface-variant)]">
            Loading audit history...
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-[13px] text-[var(--dp-on-surface-variant)]">
            No matching activity events found for this tenant.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <thead className="bg-[var(--dp-surface-container-low)] border-b border-[var(--dp-outline-variant)] text-[var(--dp-on-surface-variant)]">
                  <tr>
                    <th className={`${cellPad} font-medium`}>Timestamp</th>
                    <th className={`${cellPad} font-medium`}>Module</th>
                    <th className={`${cellPad} font-medium`}>Action</th>
                    <th className={`${cellPad} font-medium`}>Actor</th>
                    <th className={`${cellPad} font-medium`}>Summary</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--dp-outline-variant)]">
                  {pagedLogs.map((item) => (
                    <tr
                      key={item.id}
                      className="hover:bg-[var(--dp-surface-variant)]/50 transition-colors duration-150"
                    >
                      <td
                        className={`${cellPad} font-mono text-[var(--dp-on-surface-variant)] tabular-nums whitespace-nowrap`}
                      >
                        {formatTimestamp(item.createdAt)}
                      </td>
                      <td
                        className={`${cellPad} font-medium text-[var(--dp-on-surface)] capitalize`}
                      >
                        {item.module}
                      </td>
                      <td
                        className={`${cellPad} font-mono text-[11px] text-[var(--dp-on-surface-variant)]`}
                      >
                        {item.action}
                      </td>
                      <td className={`${cellPad} text-[var(--dp-on-surface)]`}>
                        {item.actorLabel}
                      </td>
                      <td className={`${cellPad} text-[var(--dp-on-surface)]`}>
                        {item.summary}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="px-4 py-3 border-t border-[var(--dp-outline-variant)] flex items-center justify-between text-[12px] text-[var(--dp-on-surface-variant)]">
                <span>
                  Showing {(page - 1) * PAGE_SIZE + 1}–
                  {Math.min(page * PAGE_SIZE, filtered.length)} of{' '}
                  {filtered.length} events
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
