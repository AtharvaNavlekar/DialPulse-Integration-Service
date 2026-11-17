import type {
  AutomationAction,
  AutomationCondition,
  AutomationDryRunActionPreview,
  AutomationDryRunConditionResult,
  AutomationDryRunResult,
  AutomationTriggerType,
  WorkspaceOrgConfigData,
} from './types.ts';

export const MAX_AUTOMATION_RETRY_ATTEMPTS = 5;

export function buildAutomationEventId(
  triggerType: AutomationTriggerType,
  sourceEntityType: string,
  sourceEntityId: number
): string {
  return `${triggerType}:${sourceEntityType}:${sourceEntityId}`;
}

function readNestedValue(payload: Record<string, unknown>, fieldKey: string): unknown {
  if (fieldKey in payload) return payload[fieldKey];
  const answers = payload.answers;
  if (answers && typeof answers === 'object' && !Array.isArray(answers)) {
    const answerRecord = answers as Record<string, unknown>;
    if (fieldKey in answerRecord) return answerRecord[fieldKey];
  }
  return undefined;
}

export function evaluateAutomationCondition(
  condition: AutomationCondition,
  payload: Record<string, unknown>
): boolean {
  const rawValue = readNestedValue(payload, condition.fieldKey);
  const stringValue =
    rawValue === undefined || rawValue === null
      ? ''
      : Array.isArray(rawValue)
        ? rawValue.join(', ')
        : String(rawValue).trim();

  switch (condition.operator) {
    case 'is_present':
      return stringValue.length > 0 && stringValue !== 'false';
    case 'is_empty':
      return stringValue.length === 0 || stringValue === 'false';
    case 'equals':
      return (
        stringValue.toLowerCase() === (condition.value ?? '').trim().toLowerCase()
      );
    case 'contains':
      return stringValue
        .toLowerCase()
        .includes((condition.value ?? '').trim().toLowerCase());
    default:
      return false;
  }
}

export function evaluateAllAutomationConditions(
  conditions: AutomationCondition[],
  payload: Record<string, unknown>
): boolean {
  if (conditions.length === 0) return true;
  return conditions.every((condition) =>
    evaluateAutomationCondition(condition, payload)
  );
}

export function isRetryableAutomationError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes('timeout') ||
    msg.includes('temporarily unavailable') ||
    msg.includes('econnreset')
  );
}

export function simulateAutomationDryRun(
  conditions: AutomationCondition[],
  actions: AutomationAction[],
  orgConfig: WorkspaceOrgConfigData,
  samplePayload: Record<string, unknown>
): AutomationDryRunResult {
  const conditionResults: AutomationDryRunConditionResult[] = conditions.map(
    (cond) => ({
      conditionId: cond.id,
      fieldKey: cond.fieldKey,
      operator: cond.operator,
      expectedValue: cond.value,
      passed: evaluateAutomationCondition(cond, samplePayload),
    })
  );

  const wouldExecute =
    conditionResults.length === 0 || conditionResults.every((c) => c.passed);

  const warnings: string[] = [];
  const plannedActions: AutomationDryRunActionPreview[] = actions.map((action) => {
    if (action.type === 'assign_lead_employee') {
      const emp = orgConfig.employees.find((e) => e.id === action.config.employeeId);
      if (!emp) {
        const warning = `Employee "${action.config.employeeId ?? 'unselected'}" not found in tenant org config.`;
        warnings.push(warning);
        return {
          actionId: action.id,
          type: action.type,
          valid: false,
          summary: 'Assign lead to employee (invalid reference)',
          warning,
        };
      }
      return {
        actionId: action.id,
        type: action.type,
        valid: true,
        summary: `Would assign lead intake record to ${emp.name} (${emp.roleKey}).`,
      };
    }

    if (action.type === 'assign_lead_queue') {
      const queue = orgConfig.queues.find((q) => q.id === action.config.queueId);
      if (!queue) {
        const warning = `Queue "${action.config.queueId ?? 'unselected'}" not found in tenant org config.`;
        warnings.push(warning);
        return {
          actionId: action.id,
          type: action.type,
          valid: false,
          summary: 'Assign lead to queue (invalid reference)',
          warning,
        };
      }
      return {
        actionId: action.id,
        type: action.type,
        valid: true,
        summary: `Would route lead to "${queue.name}" (SLA ${queue.slaMinutes} min).`,
      };
    }

    if (action.type === 'create_follow_up_task') {
      const title = action.config.taskTitle?.trim() || 'Follow up with applicant';
      const priority = action.config.taskPriority ?? 'normal';
      const dueHours = Number(action.config.dueHours ?? 4);
      return {
        actionId: action.id,
        type: action.type,
        valid: true,
        summary: `Would create ${priority}-priority task "${title}" due in ${dueHours}h.`,
      };
    }

    if (action.type === 'change_status') {
      const target = action.config.targetStatus?.trim() ?? '';
      const stage = orgConfig.workflowStages.find(
        (s) => s.name.toLowerCase() === target.toLowerCase()
      );
      if (!stage) {
        const warning = `Workflow stage "${target || 'unselected'}" is not defined in tenant settings.`;
        warnings.push(warning);
        return {
          actionId: action.id,
          type: action.type,
          valid: false,
          summary: 'Change workflow stage (invalid stage)',
          warning,
        };
      }
      return {
        actionId: action.id,
        type: action.type,
        valid: true,
        summary: `Would advance lead workflow stage to "${stage.name}".`,
      };
    }

    if (action.type === 'send_notification') {
      return {
        actionId: action.id,
        type: action.type,
        valid: true,
        summary: `Would send internal notification: "${
          action.config.notificationMessage?.trim() || 'Automation triggered'
        }".`,
      };
    }

    return {
      actionId: action.id,
      type: action.type,
      valid: true,
      summary: `Would log audit activity: "${
        action.config.activitySummary?.trim() || 'Automation step recorded'
      }".`,
    };
  });

  return {
    wouldExecute,
    conditionResults,
    plannedActions,
    warnings,
  };
}
