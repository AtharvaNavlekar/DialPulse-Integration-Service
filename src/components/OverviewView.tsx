import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDollarSign,
  Clock,
  FileText,
  Workflow,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { useToast } from '../context/ToastContext.tsx';
import { isWorkspaceModuleEnabled } from '../shared/app-catalog.ts';
import { hasEffectivePermission } from '../shared/rbac.ts';
import {
  AlertBanner,
  Button,
  Card,
  PageHeader,
  SELECT_BASE_CLASS,
  StatusIndicator,
} from './ui/Primitives.tsx';
import type {
  ActivityLogRecord,
  FollowUpTaskRecord,
  LeadIntakeRecord,
  NavSectionId,
} from '../shared/types.ts';

interface OverviewPayload {
  stats: {
    activeMiniApps: number;
    totalMiniApps?: number;
    totalForms: number;
    publishedForms: number;
    recentSubmissionCount: number;
    pendingTasksCount: number;
    upcomingAppointmentsCount: number;
    succeededAutomationsCount: number;
    failedOperationsCount: number;
    totalLeadsCount?: number;
  };
  recentSubmissions: Array<{
    id: number;
    formId: number;
    formTitle: string;
    source: string;
    submitterSummary: string;
    createdAt: string;
  }>;
  pendingTasks: FollowUpTaskRecord[];
  recentExecutions: Array<{
    id: number;
    automationId: number;
    automationName: string;
    eventType: string;
    status: string;
    errorMessage: string | null;
    createdAt: string;
  }>;
  failedOperations: Array<{
    id: number;
    automationName: string;
    errorMessage: string | null;
    createdAt: string;
  }>;
  recentActivity: ActivityLogRecord[];
  leads: LeadIntakeRecord[];
}

export function OverviewView({
  onNavigate,
}: {
  onNavigate: (section: NavSectionId) => void;
}) {
  const { apiFetch, session } = useAuth();
  const { pushToast } = useToast();
  const [data, setData] = useState<OverviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingTaskId, setUpdatingTaskId] = useState<number | null>(null);
  const [hoveredBar, setHoveredBar] = useState<string | null>(null);
  const canManageTasks = hasEffectivePermission(
    session?.permissions,
    'canManageTasks'
  );

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await apiFetch<OverviewPayload>('/api/workspace/overview');
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load overview.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview, session?.activeTenant.tenantId]);

  const handleTaskStatus = async (
    taskId: number,
    status: 'pending' | 'in_progress' | 'completed'
  ) => {
    setUpdatingTaskId(taskId);
    try {
      await apiFetch(`/api/workspace/tasks/${taskId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      pushToast(`Task updated to ${status.replace('_', ' ')}.`);
      await loadOverview();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update task.';
      setError(msg);
      pushToast(msg, 'error');
    } finally {
      setUpdatingTaskId(null);
    }
  };

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((idx) => (
            <div
              key={idx}
              className="h-24 bg-[var(--dp-surface-container-lowest)] border border-[var(--dp-outline-variant)] rounded-[var(--dp-radius-md)] animate-pulse"
            />
          ))}
        </div>
        <div className="h-64 bg-[var(--dp-surface-container-lowest)] border border-[var(--dp-outline-variant)] rounded-[var(--dp-radius-md)] animate-pulse" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <Card className="p-6 space-y-3">
        <AlertBanner tone="error" message={error} />
        <Button variant="primary" onClick={() => void loadOverview()}>
          Retry
        </Button>
      </Card>
    );
  }

  if (!data) return null;

  const chartSeries = [
    {
      key: 'forms',
      label: 'Published Forms',
      value: data.stats.publishedForms,
      color: 'var(--dp-primary)',
    },
    {
      key: 'submissions',
      label: 'Submissions',
      value: data.stats.recentSubmissionCount,
      color: 'var(--dp-secondary)',
    },
    {
      key: 'leads',
      label: 'Routed Leads',
      value: data.stats.totalLeadsCount ?? data.leads.length,
      color: 'var(--dp-primary)',
    },
    {
      key: 'automations',
      label: 'Succeeded Runs',
      value: data.stats.succeededAutomationsCount,
      color: 'var(--dp-success)',
    },
    {
      key: 'tasks',
      label: 'Open Tasks',
      value: data.stats.pendingTasksCount,
      color: 'var(--dp-warning)',
    },
  ];
  const maxChartValue = Math.max(1, ...chartSeries.map((s) => s.value));

  const formsEnabled = isWorkspaceModuleEnabled(session?.apps, 'forms-studio');
  const automationsEnabled = isWorkspaceModuleEnabled(
    session?.apps,
    'workflow-automation'
  );
  const costCenterEnabled =
    isWorkspaceModuleEnabled(session?.apps, 'cost-control-center') &&
    hasEffectivePermission(session?.permissions, 'canViewCostCenter');
  const enabledMiniAppNames = (session?.apps ?? [])
    .filter((a) => a.status === 'available' && a.supportsTenantActivation && a.enabled)
    .map((a) => a.name);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Workspace Overview"
        description={`Operational summary for ${session?.activeTenant.tenantName} · Role: ${session?.permissions.label}`}
        actions={
          <>
            {formsEnabled && (
              <Button
                variant="primary"
                onClick={() => onNavigate('forms-studio')}
              >
                <FileText className="w-4 h-4" aria-hidden="true" />
                Open Forms Studio
              </Button>
            )}
            {automationsEnabled && (
              <Button
                variant="secondary"
                onClick={() => onNavigate('workflow-automation')}
              >
                <Workflow className="w-4 h-4" aria-hidden="true" />
                Workflow Automation
              </Button>
            )}
            {costCenterEnabled && (
              <Button
                variant="secondary"
                onClick={() => onNavigate('cost-control-center')}
              >
                <CircleDollarSign className="w-4 h-4" aria-hidden="true" />
                Cost Control
              </Button>
            )}
          </>
        }
      />

      {/* KPI Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card className="p-5">
          <div className="text-[12px] font-medium text-[var(--dp-on-surface-variant)]">
            Active Mini-Apps
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="font-heading text-[24px] font-semibold text-[var(--dp-on-surface)] tabular-nums">
              {data.stats.activeMiniApps} / {data.stats.totalMiniApps ?? 10}
            </span>
            <button
              type="button"
              onClick={() => onNavigate('my-apps')}
              className="text-[12px] font-medium text-[var(--dp-primary)] hover:underline whitespace-nowrap cursor-pointer"
            >
              App launcher
            </button>
          </div>
          <p className="text-[12px] text-[var(--dp-on-surface-variant)] mt-1">
            {enabledMiniAppNames.length > 0
              ? enabledMiniAppNames.join(' · ')
              : 'No configurable mini-apps enabled for tenant'}
          </p>
        </Card>

        <Card className="p-5">
          <div className="text-[12px] font-medium text-[var(--dp-on-surface-variant)]">
            Total Form Submissions
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="font-heading text-[24px] font-semibold text-[var(--dp-on-surface)] tabular-nums">
              {data.stats.recentSubmissionCount}
            </span>
            <span className="text-[12px] text-[var(--dp-on-surface-variant)] tabular-nums">
              {data.stats.publishedForms} published / {data.stats.totalForms} total
            </span>
          </div>
          <p className="text-[12px] text-[var(--dp-on-surface-variant)] mt-1">
            Synthetic intake records in PostgreSQL
          </p>
        </Card>

        <Card className="p-5">
          <div className="text-[12px] font-medium text-[var(--dp-on-surface-variant)]">
            Pending Follow-Up Tasks
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="font-heading text-[24px] font-semibold text-[var(--dp-on-surface)] tabular-nums">
              {data.stats.pendingTasksCount}
            </span>
            <span className="text-[12px] text-[var(--dp-on-surface-variant)]">
              Assigned across tenant team
            </span>
          </div>
          <p className="text-[12px] text-[var(--dp-on-surface-variant)] mt-1">
            Created via Automation Lite
          </p>
        </Card>

        <Card className="p-5">
          <div className="text-[12px] font-medium text-[var(--dp-on-surface-variant)]">
            Automation Executions
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="font-heading text-[24px] font-semibold text-[var(--dp-success-text)] tabular-nums">
              {data.stats.succeededAutomationsCount} succeeded
            </span>
            <button
              type="button"
              onClick={() => onNavigate('workflow-automation')}
              className="text-[12px] font-medium text-[var(--dp-primary)] hover:underline whitespace-nowrap cursor-pointer"
            >
              Inspect runs
            </button>
          </div>
          <p className="text-[12px] text-[var(--dp-on-surface-variant)] mt-1">
            Idempotent event deduplication active
          </p>
        </Card>

        <Card className="p-5">
          <div className="text-[12px] font-medium text-[var(--dp-on-surface-variant)]">
            Failed Operations
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span
              className={`font-heading text-[24px] font-semibold tabular-nums ${
                data.stats.failedOperationsCount > 0
                  ? 'text-[var(--dp-error)]'
                  : 'text-[var(--dp-on-surface)]'
              }`}
            >
              {data.stats.failedOperationsCount}
            </span>
            <StatusIndicator
              tone={data.stats.failedOperationsCount > 0 ? 'error' : 'success'}
              label={
                data.stats.failedOperationsCount > 0
                  ? 'Needs review'
                  : 'Nominal'
              }
            />
          </div>
          <p className="text-[12px] text-[var(--dp-on-surface-variant)] mt-1">
            Retry controls available in Automation Lite
          </p>
        </Card>

        <Card className="p-5">
          <div className="text-[12px] font-medium text-[var(--dp-on-surface-variant)]">
            Upcoming Appointments
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="font-heading text-[24px] font-semibold text-[var(--dp-on-surface)] tabular-nums">
              {data.stats.upcomingAppointmentsCount}
            </span>
            <button
              type="button"
              onClick={() => onNavigate('appointment-scheduler')}
              className="text-[12px] font-medium text-[var(--dp-on-surface-variant)] hover:text-[var(--dp-primary)] whitespace-nowrap cursor-pointer"
            >
              Milestone E
            </button>
          </div>
          <p className="text-[12px] text-[var(--dp-on-surface-variant)] mt-1">
            Appointment Scheduler planned next
          </p>
        </Card>
      </div>

      {/* Tenant Workflow Throughput Visualization (Real PostgreSQL Counts / Synthetic Demo Data) */}
      <Card className="p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-[16px] font-semibold text-[var(--dp-on-surface)]">
              Workflow Volume Breakdown
            </h2>
            <p className="text-[12px] text-[var(--dp-on-surface-variant)]">
              Live PostgreSQL counts for {session?.activeTenant.tenantName} · Synthetic demo metrics
            </p>
          </div>
          <span className="text-[11px] font-mono text-[var(--dp-on-surface-variant)]">
            Source: Cloud SQL PostgreSQL
          </span>
        </div>

        <div className="space-y-3 pt-1">
          {chartSeries.map((item) => {
            const pct = Math.max(4, Math.round((item.value / maxChartValue) * 100));
            const isHovered = hoveredBar === item.key;
            return (
              <div
                key={item.key}
                onMouseEnter={() => setHoveredBar(item.key)}
                onMouseLeave={() => setHoveredBar(null)}
                className="grid grid-cols-12 items-center gap-3 text-[12px]"
              >
                <div className="col-span-5 sm:col-span-3 font-medium text-[var(--dp-on-surface)] truncate">
                  {item.label}
                </div>
                <div className="col-span-5 sm:col-span-8 h-6 bg-[var(--dp-surface-container)] rounded-[var(--dp-radius-sm)] overflow-hidden relative flex items-center">
                  <div
                    style={{
                      width: `${item.value === 0 ? 0 : pct}%`,
                      backgroundColor: item.color,
                      opacity: isHovered ? 0.92 : 1,
                    }}
                    className="h-full rounded-[var(--dp-radius-sm)] transition-all duration-150"
                  />
                  {isHovered && (
                    <span className="ml-2 font-mono text-[11px] text-[var(--dp-on-surface)] tabular-nums">
                      {item.value} recorded
                    </span>
                  )}
                </div>
                <div className="col-span-2 sm:col-span-1 text-right font-mono font-semibold text-[var(--dp-on-surface)] tabular-nums">
                  {item.value}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Main Operational Grids */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Demo Lead Intake & Assignment */}
        <Card className="overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--dp-outline-variant)] flex items-center justify-between gap-4">
            <div>
              <h2 className="text-[16px] font-semibold text-[var(--dp-on-surface)]">
                Routed Lead Intake Records
              </h2>
              <p className="text-[12px] text-[var(--dp-on-surface-variant)]">
                Synthetic submissions · Client CRM Mock Adapter
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('forms-studio')}
              className="text-[12px] font-medium text-[var(--dp-primary)] hover:underline inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
            >
              Forms <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>

          {data.leads.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <p className="text-[14px] font-medium text-[var(--dp-on-surface)]">
                No lead intake records yet
              </p>
              <p className="text-[12px] text-[var(--dp-on-surface-variant)]">
                Publish a form in Forms Studio and submit a synthetic enquiry to see automated routing.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <thead className="bg-[var(--dp-surface-container-low)] border-b border-[var(--dp-outline-variant)] text-[var(--dp-on-surface-variant)]">
                  <tr>
                    <th className="py-2.5 px-4 font-medium">Applicant</th>
                    <th className="py-2.5 px-4 font-medium">Product</th>
                    <th className="py-2.5 px-4 font-medium">Assigned To</th>
                    <th className="py-2.5 px-4 font-medium">CRM Sync</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--dp-outline-variant)]">
                  {data.leads.map((lead) => (
                    <tr
                      key={lead.id}
                      className="hover:bg-[var(--dp-surface-variant)]/60 transition-colors duration-150"
                    >
                      <td className="py-2.5 px-4 font-medium text-[var(--dp-on-surface)]">
                        <div>{lead.applicantName}</div>
                        <div className="text-[var(--dp-on-surface-variant)] font-normal text-[11px]">
                          {lead.workflowStage}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 text-[var(--dp-on-surface-variant)]">
                        {lead.productInterest}
                      </td>
                      <td className="py-2.5 px-4 text-[var(--dp-on-surface)]">
                        <div>{lead.assignedEmployeeName || 'Unassigned'}</div>
                        {lead.assignedQueueName && (
                          <div className="text-[11px] text-[var(--dp-on-surface-variant)]">
                            {lead.assignedQueueName}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-[11px] text-[var(--dp-on-surface-variant)] tabular-nums">
                        {lead.externalCrmRef || 'mock_pending'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Pending Follow-up Tasks */}
        <Card className="overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--dp-outline-variant)] flex items-center justify-between gap-4">
            <div>
              <h2 className="text-[16px] font-semibold text-[var(--dp-on-surface)]">
                Follow-Up Tasks
              </h2>
              <p className="text-[12px] text-[var(--dp-on-surface-variant)]">
                Created by Automation Lite on form submission
              </p>
            </div>
          </div>

          {data.pendingTasks.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <p className="text-[14px] font-medium text-[var(--dp-on-surface)]">
                No follow-up tasks yet
              </p>
              <p className="text-[12px] text-[var(--dp-on-surface-variant)]">
                Active form-submission automations create tasks here automatically.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--dp-outline-variant)]">
              {data.pendingTasks.map((task) => (
                <div
                  key={task.id}
                  className="px-5 py-3.5 flex items-center justify-between gap-4 hover:bg-[var(--dp-surface-variant)]/50 transition-colors duration-150"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[14px] font-medium text-[var(--dp-on-surface)]">
                      {task.status === 'completed' ? (
                        <CheckCircle2 className="w-4 h-4 text-[var(--dp-success)] shrink-0" />
                      ) : (
                        <Clock className="w-4 h-4 text-[var(--dp-warning)] shrink-0" />
                      )}
                      <span className="truncate">{task.title}</span>
                    </div>
                    <p className="text-[12px] text-[var(--dp-on-surface-variant)] mt-0.5">
                      Assignee: {task.assignedEmployeeName || 'Unassigned'} ·
                      Priority: {task.priority} · Due{' '}
                      <span className="font-mono tabular-nums">
                        {new Date(task.dueAt).toLocaleDateString()}
                      </span>
                    </p>
                  </div>
                  <select
                    aria-label={`Status for ${task.title}`}
                    value={task.status}
                    disabled={!canManageTasks || updatingTaskId === task.id}
                    onChange={(e) =>
                      void handleTaskStatus(
                        task.id,
                        e.target.value as 'pending' | 'in_progress' | 'completed'
                      )
                    }
                    className={`${SELECT_BASE_CLASS} py-1.5 text-[12px]`}
                  >
                    <option value="pending">Pending</option>
                    <option value="in_progress">In Progress</option>
                    <option value="completed">Completed</option>
                  </select>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Recent Submissions & Activity Timeline */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--dp-outline-variant)] flex items-center justify-between">
            <h2 className="text-[16px] font-semibold text-[var(--dp-on-surface)]">
              Recent Form Submissions
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('forms-studio')}
              className="text-[12px] font-medium text-[var(--dp-primary)] hover:underline cursor-pointer"
            >
              Manage forms
            </button>
          </div>
          {data.recentSubmissions.length === 0 ? (
            <div className="p-8 text-center text-[13px] text-[var(--dp-on-surface-variant)]">
              No submissions recorded yet.
            </div>
          ) : (
            <div className="divide-y divide-[var(--dp-outline-variant)]">
              {data.recentSubmissions.map((sub) => (
                <div
                  key={sub.id}
                  className="px-5 py-3 flex items-center justify-between gap-4 text-[12px]"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-[var(--dp-on-surface)] truncate">
                      {sub.submitterSummary || `Submission #${sub.id}`}
                    </div>
                    <div className="text-[var(--dp-on-surface-variant)] truncate">
                      {sub.formTitle} · {sub.source}
                    </div>
                  </div>
                  <span className="font-mono text-[11px] text-[var(--dp-on-surface-variant)] tabular-nums shrink-0">
                    {new Date(sub.createdAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--dp-outline-variant)] flex items-center justify-between">
            <h2 className="text-[16px] font-semibold text-[var(--dp-on-surface)]">
              Recent Activity & Audit Trail
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('activity-logs')}
              className="text-[12px] font-medium text-[var(--dp-primary)] hover:underline cursor-pointer"
            >
              View all logs
            </button>
          </div>
          {data.recentActivity.length === 0 ? (
            <div className="p-8 text-center text-[13px] text-[var(--dp-on-surface-variant)]">
              No activity recorded yet.
            </div>
          ) : (
            <div className="divide-y divide-[var(--dp-outline-variant)]">
              {data.recentActivity.slice(0, 7).map((item) => (
                <div
                  key={item.id}
                  className="px-5 py-3 flex items-start justify-between gap-4 text-[12px]"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-[var(--dp-on-surface)]">
                      {item.summary}
                    </div>
                    <div className="text-[var(--dp-on-surface-variant)] mt-0.5">
                      {item.module} · {item.actorLabel}
                    </div>
                  </div>
                  <span className="font-mono text-[11px] text-[var(--dp-outline)] tabular-nums shrink-0">
                    {new Date(item.createdAt).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {data.failedOperations.length > 0 && (
        <Card className="p-5 space-y-3 border-[var(--dp-error)]/40">
          <div className="flex items-center gap-2 text-[var(--dp-error)]">
            <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
            <h2 className="text-[15px] font-semibold">
              Failed Automation Operations Requiring Attention
            </h2>
          </div>
          <div className="divide-y divide-[var(--dp-outline-variant)]">
            {data.failedOperations.map((fail) => (
              <div
                key={fail.id}
                className="py-2.5 flex items-center justify-between gap-4 text-[12px]"
              >
                <div>
                  <span className="font-medium text-[var(--dp-on-surface)]">
                    {fail.automationName}
                  </span>{' '}
                  —{' '}
                  <span className="text-[var(--dp-error)]">
                    {fail.errorMessage}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate('workflow-automation')}
                  className="text-[12px] font-medium text-[var(--dp-primary)] hover:underline whitespace-nowrap cursor-pointer"
                >
                  Inspect & Retry
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
