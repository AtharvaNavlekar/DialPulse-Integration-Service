import React, { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { useToast } from '../context/ToastContext.tsx';
import { hasEffectivePermission } from '../shared/rbac.ts';
import type { AutomationSubTab } from '../shared/routes.ts';
import type {
  AutomationAction,
  AutomationCondition,
  AutomationDryRunResult,
  AutomationExecutionRecord,
  AutomationRecord,
  AutomationTemplateItem,
  AutomationTriggerType,
  FormRecord,
} from '../shared/types.ts';
import { AutomationListView } from './automations/AutomationListView.tsx';
import { ExecutionDetailModal } from './automations/ExecutionDetailModal.tsx';
import { ExecutionHistoryView } from './automations/ExecutionHistoryView.tsx';
import { WorkflowBuilderView } from './automations/WorkflowBuilderView.tsx';
import { WorkflowTemplatesView } from './automations/WorkflowTemplatesView.tsx';
import {
  AlertBanner,
  Button,
  ConfirmModal,
  PageHeader,
  SegmentedControl,
} from './ui/Primitives.tsx';

export function AutomationView({
  routeAutomationId,
  routeAutomationTab,
  onNavigateAutomationRoute,
}: {
  routeAutomationId: number | null;
  routeAutomationTab: AutomationSubTab;
  onNavigateAutomationRoute: (
    automationId: number | null,
    tab: AutomationSubTab
  ) => void;
}) {
  const { apiFetch, session } = useAuth();
  const { pushToast } = useToast();
  const [automationsList, setAutomationsList] = useState<AutomationRecord[]>([]);
  const [executions, setExecutions] = useState<AutomationExecutionRecord[]>([]);
  const [formsList, setFormsList] = useState<FormRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Builder draft state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [triggerType, setTriggerType] =
    useState<AutomationTriggerType>('form_submitted');
  const [triggerFormId, setTriggerFormId] = useState<number | null>(null);
  const [conditions, setConditions] = useState<AutomationCondition[]>([]);
  const [actions, setActions] = useState<AutomationAction[]>([]);
  const [active, setActive] = useState(false);
  const [saving, setSaving] = useState(false);

  // Modals
  const [deleteTarget, setDeleteTarget] = useState<AutomationRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [inspectExecution, setInspectExecution] =
    useState<AutomationExecutionRecord | null>(null);

  const canManage = hasEffectivePermission(
    session?.permissions,
    'canManageAutomations'
  );
  const orgConfig = session?.orgConfig;

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [autoRes, formsRes] = await Promise.all([
        apiFetch<{
          automations: AutomationRecord[];
          executions: AutomationExecutionRecord[];
        }>('/api/automations'),
        apiFetch<{ forms: FormRecord[] }>('/api/forms'),
      ]);
      setAutomationsList(autoRes.automations);
      setExecutions(autoRes.executions);
      setFormsList(formsRes.forms);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load automations.'
      );
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    void loadData();
  }, [loadData, session?.activeTenant.tenantId]);

  const hydrateEditorFromRecord = useCallback((auto: AutomationRecord) => {
    setEditingId(auto.id);
    setName(auto.name);
    setDescription(auto.description);
    setTriggerType(auto.triggerType);
    setTriggerFormId(auto.triggerFormId);
    setConditions(structuredClone(auto.conditions));
    setActions(structuredClone(auto.actions));
    setActive(auto.active);
    setError(null);
    setNotice(null);
  }, []);

  useEffect(() => {
    if (routeAutomationTab === 'editor' && routeAutomationId) {
      const found = automationsList.find((a) => a.id === routeAutomationId);
      if (found && editingId !== found.id) {
        hydrateEditorFromRecord(found);
      }
    }
  }, [
    automationsList,
    editingId,
    hydrateEditorFromRecord,
    routeAutomationId,
    routeAutomationTab,
  ]);

  const startNewAutomation = () => {
    setEditingId(null);
    setName('Route New Enquiry -> Assign & Follow Up');
    setDescription(
      'Assigns incoming enquiries to an employee and creates a follow-up task.'
    );
    setTriggerType('form_submitted');
    setTriggerFormId(formsList[0]?.id ?? null);
    setConditions([
      { id: 'c1', fieldKey: 'full_name', operator: 'is_present' },
    ]);
    setActions([
      {
        id: 'a1',
        type: 'assign_lead_employee',
        config: { employeeId: orgConfig?.employees[0]?.id ?? 'emp-ananya' },
      },
      {
        id: 'a2',
        type: 'create_follow_up_task',
        config: {
          taskTitle: 'Follow up with applicant',
          taskPriority: 'high',
          dueHours: 4,
        },
      },
    ]);
    setActive(false);
    setError(null);
    setNotice(null);
    onNavigateAutomationRoute(null, 'editor');
  };

  const handleUseTemplate = (tpl: AutomationTemplateItem) => {
    setEditingId(null);
    setName(tpl.name);
    setDescription(tpl.description);
    setTriggerType(tpl.triggerType);
    setTriggerFormId(
      tpl.triggerType === 'form_submitted' ? (formsList[0]?.id ?? null) : null
    );
    setConditions(structuredClone(tpl.conditions));
    setActions(structuredClone(tpl.actions));
    setActive(false);
    setError(null);
    setNotice(`Loaded template "${tpl.name}" in Draft mode.`);
    onNavigateAutomationRoute(null, 'editor');
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload = {
        name,
        description,
        triggerType,
        triggerFormId,
        conditions,
        actions,
        active,
      };
      if (editingId) {
        await apiFetch(`/api/automations/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setNotice(
          active
            ? 'Automation workflow updated and active.'
            : 'Automation workflow saved as Draft/Paused.'
        );
        pushToast('Automation workflow updated.');
      } else {
        await apiFetch('/api/automations', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setNotice(
          active
            ? 'Automation workflow created and activated.'
            : 'Automation workflow saved as Draft.'
        );
        pushToast('Automation workflow created.');
      }
      await loadData();
      onNavigateAutomationRoute(null, 'workflows');
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Unable to save automation.';
      setError(msg);
      pushToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (id: number) => {
    try {
      await apiFetch(`/api/automations/${id}/toggle`, { method: 'PATCH' });
      await loadData();
      pushToast('Workflow status updated.', 'info');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to toggle state.';
      setError(msg);
      pushToast(msg, 'error');
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiFetch(`/api/automations/${deleteTarget.id}`, {
        method: 'DELETE',
      });
      await loadData();
      pushToast(`Deleted "${deleteTarget.name}".`, 'info');
      setDeleteTarget(null);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to delete automation.';
      setError(msg);
      pushToast(msg, 'error');
    } finally {
      setDeleting(false);
    }
  };

  const handleRetryExecution = async (executionId: number) => {
    try {
      await apiFetch(`/api/automations/executions/${executionId}/retry`, {
        method: 'POST',
      });
      await loadData();
      const msg = `Execution #${executionId} retried.`;
      setNotice(msg);
      pushToast(msg);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to retry execution.';
      setError(msg);
      pushToast(msg, 'error');
    }
  };

  const handleDryRun = async (samplePayload: Record<string, unknown>) => {
    const res = await apiFetch<{ dryRun: AutomationDryRunResult }>(
      '/api/automations/dry-run',
      {
        method: 'POST',
        body: JSON.stringify({
          conditions,
          actions,
          samplePayload,
        }),
      }
    );
    return res.dryRun;
  };

  const tabOptions: Array<{ value: AutomationSubTab; label: string }> = [
    { value: 'workflows', label: `Workflows (${automationsList.length})` },
    { value: 'templates', label: 'Templates' },
    { value: 'executions', label: `Execution History (${executions.length})` },
    ...(routeAutomationTab === 'editor'
      ? [{ value: 'editor' as const, label: 'Workflow Editor' }]
      : []),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workflow Automation (Automation Lite)"
        description="Tenant-isolated event triggers, dry-run validation, templates, lead routing, and durable execution logs."
        actions={
          canManage && routeAutomationTab !== 'editor' ? (
            <Button variant="primary" onClick={startNewAutomation}>
              <Plus className="w-4 h-4" aria-hidden="true" />
              Create Automation
            </Button>
          ) : undefined
        }
      />

      <div className="overflow-x-auto pb-1">
        <SegmentedControl
          options={tabOptions}
          value={routeAutomationTab}
          onChange={(nextTab) => {
            if (nextTab === 'editor') {
              onNavigateAutomationRoute(editingId, 'editor');
            } else {
              onNavigateAutomationRoute(null, nextTab);
            }
          }}
        />
      </div>

      {notice && <AlertBanner tone="success" message={notice} />}
      {error && <AlertBanner tone="error" message={error} />}

      {routeAutomationTab === 'workflows' && (
        <AutomationListView
          automationsList={automationsList}
          loading={loading}
          canManage={canManage}
          onCreateNew={startNewAutomation}
          onOpenTemplates={() => onNavigateAutomationRoute(null, 'templates')}
          onEdit={(auto) => {
            hydrateEditorFromRecord(auto);
            onNavigateAutomationRoute(auto.id, 'editor');
          }}
          onToggle={(id) => void handleToggle(id)}
          onDeleteRequest={setDeleteTarget}
        />
      )}

      {routeAutomationTab === 'templates' && (
        <WorkflowTemplatesView
          canManage={canManage}
          onUseTemplate={handleUseTemplate}
        />
      )}

      {routeAutomationTab === 'editor' && (
        <WorkflowBuilderView
          name={name}
          setName={setName}
          description={description}
          setDescription={setDescription}
          triggerType={triggerType}
          setTriggerType={setTriggerType}
          triggerFormId={triggerFormId}
          setTriggerFormId={setTriggerFormId}
          conditions={conditions}
          setConditions={setConditions}
          actions={actions}
          setActions={setActions}
          active={active}
          setActive={setActive}
          formsList={formsList}
          orgConfig={orgConfig}
          saving={saving}
          onCancel={() => onNavigateAutomationRoute(null, 'workflows')}
          onSave={() => void handleSave()}
          onRunDryRun={handleDryRun}
        />
      )}

      {routeAutomationTab === 'executions' && (
        <ExecutionHistoryView
          executions={executions}
          canManage={canManage}
          onRetry={(id) => void handleRetryExecution(id)}
          onInspect={setInspectExecution}
        />
      )}

      <ExecutionDetailModal
        execution={inspectExecution}
        onClose={() => setInspectExecution(null)}
      />

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="Delete Automation Workflow"
        description={`Are you sure you want to delete "${deleteTarget?.name ?? ''}" and its execution history?`}
        confirmLabel="Delete Workflow"
        busy={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
