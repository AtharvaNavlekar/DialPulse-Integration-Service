import React, { useEffect, useState } from 'react';
import { ArrowRight, Plus, Save, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { useToast } from '../context/ToastContext.tsx';
import { canViewIntegrationsConsole } from '../shared/integrations-console.ts';
import { hasEffectivePermission } from '../shared/rbac.ts';
import type { IntegrationsSubTab, SettingsSubTab } from '../shared/routes.ts';
import type { NavSectionId, RoleKey, WorkspaceOrgConfigData } from '../shared/types.ts';
import { IntegrationsConsoleView } from './integrations/IntegrationsConsoleView.tsx';
import { AppManagementView } from './settings/AppManagementView.tsx';
import { RolesPermissionsMatrix } from './settings/RolesPermissionsMatrix.tsx';
import {
  AlertBanner,
  Button,
  Card,
  INPUT_BASE_CLASS,
  PageHeader,
  SELECT_BASE_CLASS,
  SegmentedControl,
} from './ui/Primitives.tsx';

interface SettingsViewProps {
  routeSettingsTab?: SettingsSubTab;
  routeIntegrationsTab?: IntegrationsSubTab;
  onNavigateSettingsRoute?: (
    settingsTab: SettingsSubTab,
    integrationsTab?: IntegrationsSubTab
  ) => void;
  onNavigateSection?: (section: NavSectionId) => void;
}

export function SettingsView({
  routeSettingsTab = 'organization',
  routeIntegrationsTab = 'overview',
  onNavigateSettingsRoute,
  onNavigateSection,
}: SettingsViewProps = {}) {
  const { session, apiFetch, refreshSession } = useAuth();
  const { pushToast } = useToast();
  const [config, setConfig] = useState<WorkspaceOrgConfigData | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session?.orgConfig) {
      setConfig(structuredClone(session.orgConfig));
    }
  }, [session?.orgConfig, session?.activeTenant.tenantId]);

  if (!session || !config) return null;

  const canEditSettings = hasEffectivePermission(
    session.permissions,
    'canManageSettings'
  );
  const canEditEmployees =
    canEditSettings ||
    hasEffectivePermission(session.permissions, 'canManageEmployees');
  const canEditQueues =
    canEditSettings ||
    hasEffectivePermission(session.permissions, 'canManageQueues');
  const canEditRoles = hasEffectivePermission(
    session.permissions,
    'canManageRoles'
  );
  const canEditAnyOrgSection =
    canEditSettings || canEditEmployees || canEditQueues;
  const canOpenIntegrations = canViewIntegrationsConsole(session.permissions);
  const navigateSettings = (
    settingsTab: SettingsSubTab,
    integrationsTab?: IntegrationsSubTab
  ) => {
    onNavigateSettingsRoute?.(settingsTab, integrationsTab);
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      await apiFetch('/api/workspace/settings/org-config', {
        method: 'PUT',
        body: JSON.stringify(config),
      });
      await refreshSession();
      const msg = 'Tenant workflow configuration saved to PostgreSQL.';
      setMessage(msg);
      pushToast(msg);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Unable to save configuration.';
      setError(msg);
      pushToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  };

  const addDepartment = () => {
    setConfig((prev) =>
      prev
        ? {
            ...prev,
            departments: [
              ...prev.departments,
              {
                id: `dept-${Date.now()}`,
                name: 'New Department',
                leadRoleKey: 'manager',
              },
            ],
          }
        : prev
    );
  };

  const addQueue = () => {
    setConfig((prev) =>
      prev
        ? {
            ...prev,
            queues: [
              ...prev.queues,
              {
                id: `queue-${Date.now()}`,
                name: 'New Operations Queue',
                departmentId: prev.departments[0]?.id || 'dept-acquisition',
                slaMinutes: 60,
              },
            ],
          }
        : prev
    );
  };

  const addStage = () => {
    setConfig((prev) =>
      prev
        ? {
            ...prev,
            workflowStages: [
              ...prev.workflowStages,
              {
                id: `stage-${Date.now()}`,
                name: 'Custom Review Stage',
                order: prev.workflowStages.length + 1,
                ownerRoleKey: 'manager',
                escalationHours: 24,
              },
            ],
          }
        : prev
    );
  };

  const addEmployee = () => {
    setConfig((prev) =>
      prev
        ? {
            ...prev,
            employees: [
              ...prev.employees,
              {
                id: `emp-${Date.now()}`,
                name: 'New Executive (Demo)',
                email: `exec.${prev.employees.length + 1}@dialpulse.example`,
                departmentId: prev.departments[0]?.id || 'dept-acquisition',
                roleKey: 'operator',
                active: true,
              },
            ],
          }
        : prev
    );
  };

  const addAssignmentRule = () => {
    setConfig((prev) =>
      prev
        ? {
            ...prev,
            assignmentRules: [
              ...prev.assignmentRules,
              {
                id: `rule-${Date.now()}`,
                name: 'New Product Routing Rule',
                productMatch: 'Personal Loan',
                targetQueueId: prev.queues[0]?.id || 'queue-inbound-dsa',
                targetEmployeeId: prev.employees[0]?.id || 'emp-ananya',
              },
            ],
          }
        : prev
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          routeSettingsTab === 'integrations'
            ? 'Integrations & DLQ Operations Console'
            : routeSettingsTab === 'apps'
              ? 'App Management'
              : 'Workspace Settings'
        }
        description={
          routeSettingsTab === 'integrations'
            ? 'Inspect approved providers, manage connection lifecycles, monitor signed webhooks, supervise outbox/inbox workers, replay dead-letter events, and audit integration activity.'
            : routeSettingsTab === 'apps'
              ? 'Inspect the DialPulse application catalogue, verify module dependencies and blockers, and enable or disable tenant-configurable modules.'
              : 'Configure Loan-DSA departments, queues, employees, assignment rules, workflow stages, and review ecosystem boundaries.'
        }
        actions={
          <div className="flex flex-wrap items-center gap-2.5">
            <SegmentedControl
              options={[
                { value: 'organization', label: 'Organization Settings' },
                { value: 'apps', label: 'App Management' },
                ...(canOpenIntegrations
                  ? [{ value: 'integrations' as const, label: 'Integrations & DLQ Console' }]
                  : []),
              ]}
              value={routeSettingsTab}
              onChange={(nextTab) =>
                navigateSettings(
                  nextTab,
                  nextTab === 'integrations' ? routeIntegrationsTab : undefined
                )
              }
            />
            {routeSettingsTab === 'organization' && canEditAnyOrgSection && (
              <Button
                variant="primary"
                onClick={() => void handleSave()}
                disabled={saving}
              >
                <Save className="w-4 h-4" aria-hidden="true" />
                {saving ? 'Saving...' : 'Save Configuration'}
              </Button>
            )}
          </div>
        }
      />

      {routeSettingsTab === 'apps' ? (
        <AppManagementView
          onLaunchApp={(app) => {
            if (app.navSectionId && app.id !== 'app-management') {
              onNavigateSection?.(app.navSectionId);
            }
          }}
        />
      ) : routeSettingsTab === 'integrations' ? (
        canOpenIntegrations ? (
          <IntegrationsConsoleView
            activeTab={routeIntegrationsTab}
            onTabChange={(subTab) => navigateSettings('integrations', subTab)}
          />
        ) : (
          <Card className="p-6 space-y-4">
            <AlertBanner
              tone="error"
              message={`Access restricted: your current role (${session.permissions.label}) on ${session.activeTenant.tenantName} does not have permission to view the Integrations & DLQ Operations Console.`}
            />
            <div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigateSettings('organization')}
              >
                Back to Organization Settings
              </Button>
            </div>
          </Card>
        )
      ) : (
        <>
          {!canEditAnyOrgSection && !canEditRoles && (
            <AlertBanner
              tone="warning"
              message={`Read-only mode: your role (${session.permissions.label}) on ${session.activeTenant.tenantName} does not have settings management permission.`}
            />
          )}

          {message && <AlertBanner tone="success" message={message} />}
          {error && <AlertBanner tone="error" message={error} />}

          {/* Ecosystem Mock Adapter Disclosure */}
          <Card className="p-5 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <h2 className="text-[16px] font-semibold text-[var(--dp-on-surface)]">
                Ecosystem Integration Boundaries
              </h2>
              {canOpenIntegrations && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => navigateSettings('integrations', 'overview')}
                >
                  Open Integrations Console
                  <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                </Button>
              )}
            </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-[12px]">
          <div className="p-3.5 rounded-[var(--dp-radius-sm)] bg-[var(--dp-surface-container-low)] border border-[var(--dp-outline-variant)]">
            <div className="font-semibold text-[var(--dp-on-surface)]">
              Client CRM
            </div>
            <div className="text-[var(--dp-on-surface-variant)] mt-1">
              {session.ecosystemAdapters.clientCrm.status}
            </div>
          </div>
          <div className="p-3.5 rounded-[var(--dp-radius-sm)] bg-[var(--dp-surface-container-low)] border border-[var(--dp-outline-variant)]">
            <div className="font-semibold text-[var(--dp-on-surface)]">
              Central CRM
            </div>
            <div className="text-[var(--dp-on-surface-variant)] mt-1">
              {session.ecosystemAdapters.centralCrm.status}
            </div>
          </div>
          <div className="p-3.5 rounded-[var(--dp-radius-sm)] bg-[var(--dp-surface-container-low)] border border-[var(--dp-outline-variant)]">
            <div className="font-semibold text-[var(--dp-on-surface)]">
              Integration Service
            </div>
            <div className="text-[var(--dp-on-surface-variant)] mt-1">
              {session.ecosystemAdapters.integrationService.status}
            </div>
          </div>
        </div>
      </Card>

      {/* Configurable Departments & Queues */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[16px] font-semibold text-[var(--dp-on-surface)]">
              Departments ({config.departments.length})
            </h2>
            {canEditSettings && (
              <button
                type="button"
                onClick={addDepartment}
                className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--dp-primary)] hover:underline cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Add Department
              </button>
            )}
          </div>
          <div className="space-y-2.5">
            {config.departments.map((dept, idx) => (
              <div key={dept.id} className="flex items-center gap-2">
                <input
                  type="text"
                  disabled={!canEditSettings}
                  value={dept.name}
                  onChange={(e) => {
                    const next = [...config.departments];
                    next[idx] = { ...dept, name: e.target.value };
                    setConfig({ ...config, departments: next });
                  }}
                  className={`${INPUT_BASE_CLASS} flex-1 py-1.5 text-[13px]`}
                />
                <select
                  disabled={!canEditSettings}
                  value={dept.leadRoleKey}
                  onChange={(e) => {
                    const next = [...config.departments];
                    next[idx] = {
                      ...dept,
                      leadRoleKey: e.target.value as RoleKey,
                    };
                    setConfig({ ...config, departments: next });
                  }}
                  className={`${SELECT_BASE_CLASS} py-1.5 text-[12px]`}
                >
                  <option value="admin">Admin</option>
                  <option value="manager">Manager</option>
                  <option value="operator">Operator</option>
                </select>
                {canEditSettings && config.departments.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Remove ${dept.name}`}
                    onClick={() =>
                      setConfig({
                        ...config,
                        departments: config.departments.filter(
                          (d) => d.id !== dept.id
                        ),
                      })
                    }
                    className="p-1.5 text-[var(--dp-on-surface-variant)] hover:text-[var(--dp-error)] cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[16px] font-semibold text-[var(--dp-on-surface)]">
              Operations Queues & SLAs ({config.queues.length})
            </h2>
            {canEditQueues && (
              <button
                type="button"
                onClick={addQueue}
                className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--dp-primary)] hover:underline cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Add Queue
              </button>
            )}
          </div>
          <div className="space-y-2.5">
            {config.queues.map((queue, idx) => (
              <div key={queue.id} className="flex items-center gap-2">
                <input
                  type="text"
                  disabled={!canEditQueues}
                  value={queue.name}
                  onChange={(e) => {
                    const next = [...config.queues];
                    next[idx] = { ...queue, name: e.target.value };
                    setConfig({ ...config, queues: next });
                  }}
                  className={`${INPUT_BASE_CLASS} flex-1 py-1.5 text-[13px]`}
                />
                <input
                  type="number"
                  min={5}
                  disabled={!canEditQueues}
                  value={queue.slaMinutes}
                  onChange={(e) => {
                    const next = [...config.queues];
                    next[idx] = {
                      ...queue,
                      slaMinutes: Math.max(5, Number(e.target.value) || 30),
                    };
                    setConfig({ ...config, queues: next });
                  }}
                  className={`${INPUT_BASE_CLASS} w-20 py-1.5 text-[13px] tabular-nums`}
                />
                <span className="text-[12px] text-[var(--dp-on-surface-variant)]">
                  min
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Employees & Assignment Rules */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[16px] font-semibold text-[var(--dp-on-surface)]">
              Tenant Team Members ({config.employees.length})
            </h2>
            {canEditEmployees && (
              <button
                type="button"
                onClick={addEmployee}
                className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--dp-primary)] hover:underline cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Add Member
              </button>
            )}
          </div>
          <div className="space-y-3">
            {config.employees.map((emp, idx) => (
              <div
                key={emp.id}
                className="p-3 rounded-[var(--dp-radius-sm)] bg-[var(--dp-surface-container-low)] border border-[var(--dp-outline-variant)] space-y-2"
              >
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    disabled={!canEditEmployees}
                    value={emp.name}
                    onChange={(e) => {
                      const next = [...config.employees];
                      next[idx] = { ...emp, name: e.target.value };
                      setConfig({ ...config, employees: next });
                    }}
                    placeholder="Full name"
                    className={`${INPUT_BASE_CLASS} flex-1 py-1 text-[13px]`}
                  />
                  <select
                    disabled={!canEditEmployees}
                    value={emp.roleKey}
                    onChange={(e) => {
                      const next = [...config.employees];
                      next[idx] = { ...emp, roleKey: e.target.value as RoleKey };
                      setConfig({ ...config, employees: next });
                    }}
                    className={`${SELECT_BASE_CLASS} py-1 text-[12px]`}
                  >
                    <option value="admin">Admin</option>
                    <option value="manager">Manager</option>
                    <option value="operator">Operator</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  {canEditEmployees && config.employees.length > 1 && (
                    <button
                      type="button"
                      aria-label={`Remove ${emp.name}`}
                      onClick={() =>
                        setConfig({
                          ...config,
                          employees: config.employees.filter((e) => e.id !== emp.id),
                        })
                      }
                      className="p-1 text-[var(--dp-on-surface-variant)] hover:text-[var(--dp-error)] cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="email"
                    disabled={!canEditEmployees}
                    value={emp.email}
                    onChange={(e) => {
                      const next = [...config.employees];
                      next[idx] = { ...emp, email: e.target.value };
                      setConfig({ ...config, employees: next });
                    }}
                    placeholder="Email address"
                    className={`${INPUT_BASE_CLASS} flex-1 py-1 text-[12px] font-mono`}
                  />
                  <select
                    disabled={!canEditEmployees}
                    value={emp.departmentId}
                    onChange={(e) => {
                      const next = [...config.employees];
                      next[idx] = { ...emp, departmentId: e.target.value };
                      setConfig({ ...config, employees: next });
                    }}
                    className={`${SELECT_BASE_CLASS} py-1 text-[12px] max-w-44`}
                  >
                    {config.departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[16px] font-semibold text-[var(--dp-on-surface)]">
              Product Assignment Rules ({config.assignmentRules.length})
            </h2>
            {canEditQueues && (
              <button
                type="button"
                onClick={addAssignmentRule}
                className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--dp-primary)] hover:underline cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Add Rule
              </button>
            )}
          </div>
          <div className="space-y-3">
            {config.assignmentRules.map((rule, idx) => (
              <div
                key={rule.id}
                className="p-3 rounded-[var(--dp-radius-sm)] bg-[var(--dp-surface-container-low)] border border-[var(--dp-outline-variant)] space-y-2"
              >
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    disabled={!canEditQueues}
                    value={rule.name}
                    onChange={(e) => {
                      const next = [...config.assignmentRules];
                      next[idx] = { ...rule, name: e.target.value };
                      setConfig({ ...config, assignmentRules: next });
                    }}
                    placeholder="Rule name"
                    className={`${INPUT_BASE_CLASS} flex-1 py-1 text-[13px]`}
                  />
                  {canEditQueues && (
                    <button
                      type="button"
                      aria-label={`Remove ${rule.name}`}
                      onClick={() =>
                        setConfig({
                          ...config,
                          assignmentRules: config.assignmentRules.filter(
                            (r) => r.id !== rule.id
                          ),
                        })
                      }
                      className="p-1 text-[var(--dp-on-surface-variant)] hover:text-[var(--dp-error)] cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input
                    type="text"
                    disabled={!canEditQueues}
                    value={rule.productMatch}
                    onChange={(e) => {
                      const next = [...config.assignmentRules];
                      next[idx] = { ...rule, productMatch: e.target.value };
                      setConfig({ ...config, assignmentRules: next });
                    }}
                    placeholder="Product match"
                    className={`${INPUT_BASE_CLASS} py-1 text-[12px]`}
                  />
                  <select
                    disabled={!canEditQueues}
                    value={rule.targetQueueId}
                    onChange={(e) => {
                      const next = [...config.assignmentRules];
                      next[idx] = { ...rule, targetQueueId: e.target.value };
                      setConfig({ ...config, assignmentRules: next });
                    }}
                    className={`${SELECT_BASE_CLASS} py-1 text-[12px]`}
                  >
                    {config.queues.map((q) => (
                      <option key={q.id} value={q.id}>
                        {q.name}
                      </option>
                    ))}
                  </select>
                  <select
                    disabled={!canEditQueues}
                    value={rule.targetEmployeeId}
                    onChange={(e) => {
                      const next = [...config.assignmentRules];
                      next[idx] = { ...rule, targetEmployeeId: e.target.value };
                      setConfig({ ...config, assignmentRules: next });
                    }}
                    className={`${SELECT_BASE_CLASS} py-1 text-[12px]`}
                  >
                    {config.employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Dynamic Role Permissions Matrix (View #42) */}
      <RolesPermissionsMatrix
        actorRoleKey={session.activeTenant.roleKey}
        actorPermissions={session.permissions}
      />

      {/* Configurable Workflow Stages */}
      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-[16px] font-semibold text-[var(--dp-on-surface)]">
              Configurable Business Workflow Stages ({config.workflowStages.length})
            </h2>
            <p className="text-[12px] text-[var(--dp-on-surface-variant)]">
              Ordered Loan-DSA lifecycle stages, stage owners, and escalation thresholds.
            </p>
          </div>
          {canEditSettings && (
            <button
              type="button"
              onClick={addStage}
              className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--dp-primary)] hover:underline whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Add Stage
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-[var(--dp-surface-container-low)] border-b border-[var(--dp-outline-variant)] text-[var(--dp-on-surface-variant)]">
              <tr>
                <th className="py-2.5 px-3 font-medium">Order</th>
                <th className="py-2.5 px-3 font-medium">Stage Name</th>
                <th className="py-2.5 px-3 font-medium">Owner Role</th>
                <th className="py-2.5 px-3 font-medium">Escalation (hrs)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--dp-outline-variant)]">
              {config.workflowStages.map((stage, idx) => (
                <tr key={stage.id}>
                  <td className="py-2 px-3 font-mono tabular-nums text-[var(--dp-on-surface-variant)]">
                    {idx + 1}
                  </td>
                  <td className="py-2 px-3">
                    <input
                      type="text"
                      disabled={!canEditSettings}
                      value={stage.name}
                      onChange={(e) => {
                        const next = [...config.workflowStages];
                        next[idx] = { ...stage, name: e.target.value };
                        setConfig({ ...config, workflowStages: next });
                      }}
                      className={`${INPUT_BASE_CLASS} py-1 text-[13px]`}
                    />
                  </td>
                  <td className="py-2 px-3">
                    <select
                      disabled={!canEditSettings}
                      value={stage.ownerRoleKey}
                      onChange={(e) => {
                        const next = [...config.workflowStages];
                        next[idx] = {
                          ...stage,
                          ownerRoleKey: e.target.value as RoleKey,
                        };
                        setConfig({ ...config, workflowStages: next });
                      }}
                      className={`${SELECT_BASE_CLASS} py-1 text-[12px]`}
                    >
                      <option value="admin">Admin</option>
                      <option value="manager">Manager</option>
                      <option value="operator">Operator</option>
                    </select>
                  </td>
                  <td className="py-2 px-3">
                    <input
                      type="number"
                      min={1}
                      disabled={!canEditSettings}
                      value={stage.escalationHours}
                      onChange={(e) => {
                        const next = [...config.workflowStages];
                        next[idx] = {
                          ...stage,
                          escalationHours: Math.max(
                            1,
                            Number(e.target.value) || 24
                          ),
                        };
                        setConfig({ ...config, workflowStages: next });
                      }}
                      className={`${INPUT_BASE_CLASS} w-20 py-1 text-[13px] tabular-nums`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
        </>
      )}
    </div>
  );
}
