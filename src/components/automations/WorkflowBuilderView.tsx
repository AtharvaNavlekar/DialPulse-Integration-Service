import React, { useState } from 'react';
import { FlaskConical, Save, Trash2 } from 'lucide-react';
import type {
  AutomationAction,
  AutomationActionType,
  AutomationCondition,
  AutomationDryRunResult,
  AutomationTriggerType,
  ConditionOperator,
  FormRecord,
  WorkspaceOrgConfigData,
} from '../../shared/types.ts';
import {
  AlertBanner,
  Button,
  Card,
  INPUT_BASE_CLASS,
  SELECT_BASE_CLASS,
  SegmentedControl,
  StatusIndicator,
} from '../ui/Primitives.tsx';

const TRIGGERS: Array<{ value: AutomationTriggerType; label: string }> = [
  { value: 'form_submitted', label: 'Form submitted' },
  { value: 'lead_created', label: 'Lead created' },
  { value: 'task_completed', label: 'Task completed' },
  { value: 'appointment_booked', label: 'Appointment booked' },
  { value: 'status_changed', label: 'Status changed' },
];

const OPERATORS: Array<{ value: ConditionOperator; label: string }> = [
  { value: 'equals', label: 'Equals' },
  { value: 'contains', label: 'Contains' },
  { value: 'is_present', label: 'Is present' },
  { value: 'is_empty', label: 'Is empty' },
];

const ACTIONS: Array<{ value: AutomationActionType; label: string }> = [
  { value: 'assign_lead_employee', label: 'Assign lead to employee' },
  { value: 'assign_lead_queue', label: 'Assign lead to queue' },
  { value: 'create_follow_up_task', label: 'Create follow-up task' },
  { value: 'change_status', label: 'Change permitted workflow status' },
  { value: 'send_notification', label: 'Send internal notification' },
  { value: 'record_activity', label: 'Record activity event' },
];

export function WorkflowBuilderView({
  name,
  setName,
  description,
  setDescription,
  triggerType,
  setTriggerType,
  triggerFormId,
  setTriggerFormId,
  conditions,
  setConditions,
  actions,
  setActions,
  active,
  setActive,
  formsList,
  orgConfig,
  saving,
  onCancel,
  onSave,
  onRunDryRun,
}: {
  name: string;
  setName: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  triggerType: AutomationTriggerType;
  setTriggerType: (v: AutomationTriggerType) => void;
  triggerFormId: number | null;
  setTriggerFormId: (v: number | null) => void;
  conditions: AutomationCondition[];
  setConditions: React.Dispatch<React.SetStateAction<AutomationCondition[]>>;
  actions: AutomationAction[];
  setActions: React.Dispatch<React.SetStateAction<AutomationAction[]>>;
  active: boolean;
  setActive: (v: boolean) => void;
  formsList: FormRecord[];
  orgConfig: WorkspaceOrgConfigData | undefined;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
  onRunDryRun: (samplePayload: Record<string, unknown>) => Promise<AutomationDryRunResult>;
}) {
  const [sampleJson, setSampleJson] = useState(
    JSON.stringify(
      {
        answers: {
          full_name: 'Aarav Sharma (Dry-Run)',
          loan_product: 'Home Loan',
          email: 'aarav.demo@example.com',
        },
      },
      null,
      2
    )
  );
  const [dryRunResult, setDryRunResult] = useState<AutomationDryRunResult | null>(null);
  const [dryRunError, setDryRunError] = useState<string | null>(null);
  const [dryRunBusy, setDryRunBusy] = useState(false);

  const handleDryRun = async () => {
    setDryRunError(null);
    setDryRunBusy(true);
    try {
      const parsed = JSON.parse(sampleJson) as Record<string, unknown>;
      const result = await onRunDryRun(parsed);
      setDryRunResult(result);
    } catch (err) {
      setDryRunError(
        err instanceof Error ? err.message : 'Invalid sample JSON payload.'
      );
    } finally {
      setDryRunBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      <Card className="lg:col-span-8 p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-[12px] font-medium text-[var(--dp-on-surface-variant)] mb-1">
              Automation Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={`${INPUT_BASE_CLASS} py-1.5 text-[13px]`}
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[var(--dp-on-surface-variant)] mb-1">
              Description
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={`${INPUT_BASE_CLASS} py-1.5 text-[13px]`}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-[var(--dp-radius-sm)] bg-[var(--dp-surface-container-low)] border border-[var(--dp-outline-variant)]">
          <div>
            <div className="text-[13px] font-semibold text-[var(--dp-on-surface)]">
              Workflow Publish State
            </div>
            <div className="text-[12px] text-[var(--dp-on-surface-variant)]">
              Save as Draft/Paused while testing conditions, or Active to run on live triggers.
            </div>
          </div>
          <SegmentedControl
            options={[
              { value: 'draft', label: 'Draft / Paused' },
              { value: 'active', label: 'Active' },
            ]}
            value={active ? 'active' : 'draft'}
            onChange={(val) => setActive(val === 'active')}
          />
        </div>

        <div className="p-4 rounded-[var(--dp-radius-sm)] bg-[var(--dp-surface-container-low)] border border-[var(--dp-outline-variant)] space-y-3">
          <h3 className="text-[12px] font-semibold text-[var(--dp-on-surface)] uppercase tracking-wider">
            1. Trigger
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <select
              value={triggerType}
              onChange={(e) =>
                setTriggerType(e.target.value as AutomationTriggerType)
              }
              className={`${SELECT_BASE_CLASS} w-full`}
            >
              {TRIGGERS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>

            {triggerType === 'form_submitted' && (
              <select
                value={triggerFormId ?? ''}
                onChange={(e) =>
                  setTriggerFormId(
                    e.target.value ? Number(e.target.value) : null
                  )
                }
                className={`${SELECT_BASE_CLASS} w-full`}
              >
                <option value="">Any form in this tenant</option>
                {formsList.map((f) => (
                  <option key={f.id} value={f.id}>
                    Form: {f.title}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        <div className="p-4 rounded-[var(--dp-radius-sm)] bg-[var(--dp-surface-container-low)] border border-[var(--dp-outline-variant)] space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[12px] font-semibold text-[var(--dp-on-surface)] uppercase tracking-wider">
              2. Conditions (All must match)
            </h3>
            <button
              type="button"
              onClick={() =>
                setConditions((prev) => [
                  ...prev,
                  {
                    id: `c-${Date.now()}`,
                    fieldKey: 'loan_product',
                    operator: 'equals',
                    value: 'Home Loan',
                  },
                ])
              }
              className="text-[12px] font-medium text-[var(--dp-primary)] hover:underline cursor-pointer"
            >
              + Add Condition
            </button>
          </div>

          {conditions.length === 0 ? (
            <p className="text-[12px] text-[var(--dp-on-surface-variant)]">
              No conditions configured — runs on every matching trigger.
            </p>
          ) : (
            <div className="space-y-2">
              {conditions.map((cond, idx) => (
                <div key={cond.id} className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={cond.fieldKey}
                    onChange={(e) => {
                      const next = [...conditions];
                      next[idx] = { ...cond, fieldKey: e.target.value };
                      setConditions(next);
                    }}
                    placeholder="Field key (e.g. loan_product)"
                    className={`${INPUT_BASE_CLASS} w-44 py-1.5 text-[12px] font-mono`}
                  />
                  <select
                    value={cond.operator}
                    onChange={(e) => {
                      const next = [...conditions];
                      next[idx] = {
                        ...cond,
                        operator: e.target.value as ConditionOperator,
                      };
                      setConditions(next);
                    }}
                    className={`${SELECT_BASE_CLASS} py-1.5 text-[12px]`}
                  >
                    {OPERATORS.map((op) => (
                      <option key={op.value} value={op.value}>
                        {op.label}
                      </option>
                    ))}
                  </select>
                  {(cond.operator === 'equals' ||
                    cond.operator === 'contains') && (
                    <input
                      type="text"
                      value={cond.value ?? ''}
                      onChange={(e) => {
                        const next = [...conditions];
                        next[idx] = { ...cond, value: e.target.value };
                        setConditions(next);
                      }}
                      placeholder="Comparison value"
                      className={`${INPUT_BASE_CLASS} flex-1 min-w-36 py-1.5 text-[12px]`}
                    />
                  )}
                  <button
                    type="button"
                    aria-label="Remove condition"
                    onClick={() =>
                      setConditions(conditions.filter((c) => c.id !== cond.id))
                    }
                    className="p-1.5 text-[var(--dp-on-surface-variant)] hover:text-[var(--dp-error)] cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 rounded-[var(--dp-radius-sm)] bg-[var(--dp-surface-container-low)] border border-[var(--dp-outline-variant)] space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[12px] font-semibold text-[var(--dp-on-surface)] uppercase tracking-wider">
              3. Actions (Executed in sequence)
            </h3>
            <button
              type="button"
              onClick={() =>
                setActions((prev) => [
                  ...prev,
                  {
                    id: `a-${Date.now()}`,
                    type: 'record_activity',
                    config: { activitySummary: 'Workflow step recorded.' },
                  },
                ])
              }
              className="text-[12px] font-medium text-[var(--dp-primary)] hover:underline cursor-pointer"
            >
              + Add Action
            </button>
          </div>

          <div className="space-y-2.5">
            {actions.map((act, idx) => (
              <div
                key={act.id}
                className="p-3 bg-[var(--dp-surface-container-lowest)] border border-[var(--dp-outline-variant)] rounded-[var(--dp-radius-sm)] flex flex-wrap items-center gap-2.5"
              >
                <select
                  value={act.type}
                  onChange={(e) => {
                    const next = [...actions];
                    next[idx] = {
                      ...act,
                      type: e.target.value as AutomationActionType,
                      config: {},
                    };
                    setActions(next);
                  }}
                  className={`${SELECT_BASE_CLASS} py-1.5 text-[12px] font-medium`}
                >
                  {ACTIONS.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </select>

                {act.type === 'assign_lead_employee' && (
                  <select
                    value={act.config.employeeId ?? ''}
                    onChange={(e) => {
                      const next = [...actions];
                      next[idx] = {
                        ...act,
                        config: { ...act.config, employeeId: e.target.value },
                      };
                      setActions(next);
                    }}
                    className={`${SELECT_BASE_CLASS} py-1.5 text-[12px]`}
                  >
                    <option value="">Select employee</option>
                    {(orgConfig?.employees ?? []).map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.name}
                      </option>
                    ))}
                  </select>
                )}

                {act.type === 'assign_lead_queue' && (
                  <select
                    value={act.config.queueId ?? ''}
                    onChange={(e) => {
                      const next = [...actions];
                      next[idx] = {
                        ...act,
                        config: { ...act.config, queueId: e.target.value },
                      };
                      setActions(next);
                    }}
                    className={`${SELECT_BASE_CLASS} py-1.5 text-[12px]`}
                  >
                    <option value="">Select queue</option>
                    {(orgConfig?.queues ?? []).map((q) => (
                      <option key={q.id} value={q.id}>
                        {q.name}
                      </option>
                    ))}
                  </select>
                )}

                {act.type === 'create_follow_up_task' && (
                  <>
                    <input
                      type="text"
                      value={act.config.taskTitle ?? ''}
                      onChange={(e) => {
                        const next = [...actions];
                        next[idx] = {
                          ...act,
                          config: {
                            ...act.config,
                            taskTitle: e.target.value,
                          },
                        };
                        setActions(next);
                      }}
                      placeholder="Task title"
                      className={`${INPUT_BASE_CLASS} flex-1 min-w-40 py-1.5 text-[12px]`}
                    />
                    <select
                      value={act.config.taskPriority ?? 'normal'}
                      onChange={(e) => {
                        const next = [...actions];
                        next[idx] = {
                          ...act,
                          config: {
                            ...act.config,
                            taskPriority: e.target.value as
                              | 'low'
                              | 'normal'
                              | 'high',
                          },
                        };
                        setActions(next);
                      }}
                      className={`${SELECT_BASE_CLASS} py-1.5 text-[12px]`}
                    >
                      <option value="low">Low</option>
                      <option value="normal">Normal</option>
                      <option value="high">High</option>
                    </select>
                  </>
                )}

                {act.type === 'change_status' && (
                  <select
                    value={act.config.targetStatus ?? ''}
                    onChange={(e) => {
                      const next = [...actions];
                      next[idx] = {
                        ...act,
                        config: {
                          ...act.config,
                          targetStatus: e.target.value,
                        },
                      };
                      setActions(next);
                    }}
                    className={`${SELECT_BASE_CLASS} py-1.5 text-[12px]`}
                  >
                    <option value="">Select workflow stage</option>
                    {(orgConfig?.workflowStages ?? []).map((st) => (
                      <option key={st.id} value={st.name}>
                        {st.name}
                      </option>
                    ))}
                  </select>
                )}

                {act.type === 'send_notification' && (
                  <input
                    type="text"
                    value={act.config.notificationMessage ?? ''}
                    onChange={(e) => {
                      const next = [...actions];
                      next[idx] = {
                        ...act,
                        config: {
                          ...act.config,
                          notificationMessage: e.target.value,
                        },
                      };
                      setActions(next);
                    }}
                    placeholder="Notification message"
                    className={`${INPUT_BASE_CLASS} flex-1 py-1.5 text-[12px]`}
                  />
                )}

                {act.type === 'record_activity' && (
                  <input
                    type="text"
                    value={act.config.activitySummary ?? ''}
                    onChange={(e) => {
                      const next = [...actions];
                      next[idx] = {
                        ...act,
                        config: {
                          ...act.config,
                          activitySummary: e.target.value,
                        },
                      };
                      setActions(next);
                    }}
                    placeholder="Activity log summary"
                    className={`${INPUT_BASE_CLASS} flex-1 py-1.5 text-[12px]`}
                  />
                )}

                {actions.length > 1 && (
                  <button
                    type="button"
                    aria-label="Remove action"
                    onClick={() =>
                      setActions(actions.filter((a) => a.id !== act.id))
                    }
                    className="p-1.5 text-[var(--dp-on-surface-variant)] hover:text-[var(--dp-error)] cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onSave} disabled={saving}>
            <Save className="w-4 h-4" aria-hidden="true" />
            {saving
              ? 'Saving...'
              : active
                ? 'Save & Activate'
                : 'Save as Draft'}
          </Button>
        </div>
      </Card>

      {/* Dry-Run Simulator */}
      <Card className="lg:col-span-4 p-5 space-y-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-[var(--dp-primary)]">
            <FlaskConical className="w-4 h-4 shrink-0" aria-hidden="true" />
            <h2 className="text-[16px] font-semibold text-[var(--dp-on-surface)]">
              Dry-Run Simulator
            </h2>
          </div>
          <p className="text-[12px] text-[var(--dp-on-surface-variant)]">
            Evaluate conditions and validate org references against a synthetic event payload without creating leads or tasks.
          </p>
        </div>

        <div>
          <label className="block text-[12px] font-medium text-[var(--dp-on-surface-variant)] mb-1">
            Sample Event Payload (JSON)
          </label>
          <textarea
            rows={7}
            value={sampleJson}
            onChange={(e) => setSampleJson(e.target.value)}
            className={`${INPUT_BASE_CLASS} py-2 text-[11px] font-mono`}
          />
        </div>

        <Button
          variant="secondary"
          onClick={() => void handleDryRun()}
          disabled={dryRunBusy}
          className="w-full"
        >
          <FlaskConical className="w-4 h-4" aria-hidden="true" />
          {dryRunBusy ? 'Evaluating...' : 'Run Dry-Run Simulation'}
        </Button>

        {dryRunError && <AlertBanner tone="error" message={dryRunError} />}

        {dryRunResult && (
          <div className="space-y-3 pt-2 border-t border-[var(--dp-outline-variant)] text-[12px]">
            <div className="flex items-center justify-between">
              <span className="font-medium text-[var(--dp-on-surface)]">
                Outcome
              </span>
              <StatusIndicator
                tone={dryRunResult.wouldExecute ? 'success' : 'neutral'}
                label={
                  dryRunResult.wouldExecute
                    ? 'Conditions matched — would run'
                    : 'Skipped — condition mismatch'
                }
              />
            </div>

            {dryRunResult.conditionResults.length > 0 && (
              <div className="space-y-1">
                <div className="font-medium text-[var(--dp-on-surface-variant)]">
                  Conditions
                </div>
                {dryRunResult.conditionResults.map((c) => (
                  <div
                    key={c.conditionId}
                    className="flex items-center justify-between gap-2 font-mono text-[11px]"
                  >
                    <span className="truncate text-[var(--dp-on-surface)]">
                      {c.fieldKey} {c.operator} {c.expectedValue ?? ''}
                    </span>
                    <span
                      className={
                        c.passed
                          ? 'text-[var(--dp-success-text)]'
                          : 'text-[var(--dp-error)]'
                      }
                    >
                      {c.passed ? 'PASS' : 'FAIL'}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-1.5">
              <div className="font-medium text-[var(--dp-on-surface-variant)]">
                Planned Actions
              </div>
              {dryRunResult.plannedActions.map((act) => (
                <div
                  key={act.actionId}
                  className="p-2 rounded-[var(--dp-radius-sm)] bg-[var(--dp-surface-container-low)] border border-[var(--dp-outline-variant)]"
                >
                  <div
                    className={
                      act.valid
                        ? 'text-[var(--dp-on-surface)]'
                        : 'text-[var(--dp-error)] font-medium'
                    }
                  >
                    {act.summary}
                  </div>
                  {act.warning && (
                    <div className="text-[11px] text-[var(--dp-error)] mt-0.5">
                      {act.warning}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
