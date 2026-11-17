import React, { useMemo, useState } from 'react';
import { Pause, Play, Plus, Trash2 } from 'lucide-react';
import type { AutomationRecord } from '../../shared/types.ts';
import {
  Button,
  Card,
  INPUT_BASE_CLASS,
  SegmentedControl,
  StatusIndicator,
} from '../ui/Primitives.tsx';

export function AutomationListView({
  automationsList,
  loading,
  canManage,
  onCreateNew,
  onOpenTemplates,
  onEdit,
  onToggle,
  onDeleteRequest,
}: {
  automationsList: AutomationRecord[];
  loading: boolean;
  canManage: boolean;
  onCreateNew: () => void;
  onOpenTemplates: () => void;
  onEdit: (auto: AutomationRecord) => void;
  onToggle: (id: number) => void;
  onDeleteRequest: (auto: AutomationRecord) => void;
}) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'paused'>('all');

  const filtered = useMemo(() => {
    return automationsList.filter((auto) => {
      if (statusFilter === 'active' && !auto.active) return false;
      if (statusFilter === 'paused' && auto.active) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        auto.name.toLowerCase().includes(q) ||
        auto.description.toLowerCase().includes(q) ||
        auto.triggerType.toLowerCase().includes(q)
      );
    });
  }, [automationsList, search, statusFilter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <SegmentedControl
          options={[
            { value: 'all', label: 'All Workflows' },
            { value: 'active', label: 'Active' },
            { value: 'paused', label: 'Paused / Draft' },
          ]}
          value={statusFilter}
          onChange={setStatusFilter}
        />

        <input
          type="search"
          aria-label="Search workflows"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search workflows..."
          className={`${INPUT_BASE_CLASS} w-full sm:w-72 py-1.5 text-[13px]`}
        />
      </div>

      {loading ? (
        <Card className="p-8 text-[13px] text-[var(--dp-on-surface-variant)]">
          Loading automations...
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="p-10 text-center space-y-3">
          <p className="text-[14px] font-medium text-[var(--dp-on-surface)]">
            No matching workflows found
          </p>
          {canManage && (
            <div className="flex items-center justify-center gap-2.5">
              <Button variant="primary" onClick={onCreateNew}>
                <Plus className="w-4 h-4" aria-hidden="true" />
                Create Automation
              </Button>
              <Button variant="secondary" onClick={onOpenTemplates}>
                Browse Templates
              </Button>
            </div>
          )}
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filtered.map((auto) => (
            <Card
              key={auto.id}
              className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4"
            >
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-[16px] font-semibold text-[var(--dp-on-surface)]">
                    {auto.name}
                  </h2>
                  <StatusIndicator
                    tone={auto.active ? 'success' : 'neutral'}
                    label={auto.active ? 'Active' : 'Paused / Draft'}
                  />
                </div>
                {auto.description && (
                  <p className="text-[13px] text-[var(--dp-on-surface-variant)]">
                    {auto.description}
                  </p>
                )}
                <div className="text-[12px] text-[var(--dp-on-surface-variant)] font-mono">
                  Trigger: {auto.triggerType} · Conditions: {auto.conditions.length} · Actions: {auto.actions.length}
                </div>
              </div>

              {canManage && (
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onToggle(auto.id)}
                  >
                    {auto.active ? (
                      <>
                        <Pause className="w-3.5 h-3.5" aria-hidden="true" />
                        Pause
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5" aria-hidden="true" />
                        Activate
                      </>
                    )}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onEdit(auto)}
                  >
                    Edit Workflow
                  </Button>
                  <button
                    type="button"
                    aria-label={`Delete ${auto.name}`}
                    title={`Delete ${auto.name}`}
                    onClick={() => onDeleteRequest(auto)}
                    className="h-8 w-8 inline-flex items-center justify-center text-[var(--dp-on-surface-variant)] hover:text-[var(--dp-error)] hover:bg-[var(--dp-error-container)]/50 border border-[var(--dp-outline-variant)] rounded-[var(--dp-radius-sm)] transition-colors duration-150 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
