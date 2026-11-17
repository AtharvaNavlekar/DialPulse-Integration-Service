import { and, eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
  activityLogs,
  automationActionSteps,
  automationExecutions,
  automations,
  followUpTasks,
  internalNotifications,
  leadIntakeRecords,
  workspaceOrgConfigs,
} from '../../db/schema.ts';
import {
  MAX_AUTOMATION_RETRY_ATTEMPTS,
  buildAutomationEventId,
  evaluateAllAutomationConditions,
} from '../../shared/automation-engine.ts';
import { createDefaultOrgConfig } from '../../shared/defaults.ts';
import type {
  AutomationAction,
  AutomationTriggerType,
  WorkspaceOrgConfigData,
} from '../../shared/types.ts';
import {
  dispatchMockIntegrationEvent,
  syncLeadIntakeViaMockClientCrm,
} from '../adapters/ecosystem-mock.ts';
import { logPipelineEvent } from '../events/logger.ts';
import {
  NonRetryableEventError,
  classifyEventError,
  sanitizeEventError,
} from '../events/retry-policy.ts';

export interface TriggerEventInput {
  tenantId: number;
  eventId?: string;
  correlationId?: string;
  triggerType: AutomationTriggerType;
  sourceEntityType: string;
  sourceEntityId: number;
  formId?: number;
  actorUid: string;
  actorLabel: string;
  payload: Record<string, unknown>;
}

export interface ActionExecutionHookContext {
  tenantId: number;
  executionId: number;
  automationId: number;
  actionKey: string;
  actionType: AutomationAction['type'];
  stepIndex: number;
  attempt: number;
}

export interface ProcessAutomationEventOptions {
  consumerName?: string;
  beforeActionExecute?: (ctx: ActionExecutionHookContext) => Promise<void> | void;
}

export function buildDeterministicActionKey(
  stepIndex: number,
  action: AutomationAction
): string {
  return `step_${stepIndex}:${action.id}`;
}

export function buildActionStepIdempotencyKey(
  executionId: number,
  actionKey: string
): string {
  return `exec:${executionId}:action:${actionKey}`;
}

function extractLeadFields(payload: Record<string, unknown>) {
  const answers =
    payload.answers && typeof payload.answers === 'object' && !Array.isArray(payload.answers)
      ? (payload.answers as Record<string, unknown>)
      : payload;

  const applicantName =
    String(
      answers.full_name ||
        answers.name ||
        answers.applicant_name ||
        payload.applicantName ||
        'Synthetic Applicant'
    ).trim() || 'Synthetic Applicant';

  const contactEmail = answers.email ? String(answers.email).trim() : null;
  const contactPhone = answers.phone ? String(answers.phone).trim() : null;
  const productInterest =
    String(
      answers.loan_product ||
        answers.product ||
        payload.productInterest ||
        'General Enquiry'
    ).trim() || 'General Enquiry';

  return { applicantName, contactEmail, contactPhone, productInterest };
}

export async function getTenantOrgConfig(tenantId: number): Promise<WorkspaceOrgConfigData> {
  const rows = await db
    .select()
    .from(workspaceOrgConfigs)
    .where(eq(workspaceOrgConfigs.tenantId, tenantId))
    .limit(1);

  return rows[0]?.config ?? createDefaultOrgConfig();
}

async function ensureOrGetExecutionRecord(
  tenantId: number,
  automation: typeof automations.$inferSelect,
  eventId: string,
  input: TriggerEventInput,
  initialStatus: 'running' | 'skipped'
): Promise<typeof automationExecutions.$inferSelect> {
  const [inserted] = await db
    .insert(automationExecutions)
    .values({
      tenantId,
      automationId: automation.id,
      eventId,
      eventType: input.triggerType,
      sourceEntityType: input.sourceEntityType,
      sourceEntityId: input.sourceEntityId,
      status: initialStatus,
      attempts: 1,
      actionResults: [],
      eventPayload: input.payload,
    })
    .onConflictDoNothing({
      target: [automationExecutions.automationId, automationExecutions.eventId],
    })
    .returning();

  if (inserted) return inserted;

  const existing = await db
    .select()
    .from(automationExecutions)
    .where(
      and(
        eq(automationExecutions.automationId, automation.id),
        eq(automationExecutions.eventId, eventId)
      )
    )
    .limit(1);

  if (!existing[0]) {
    throw new Error(
      `Failed to resolve automation execution record for automation=${automation.id}, event=${eventId}.`
    );
  }
  return existing[0];
}

async function ensureOrGetActionStep(options: {
  tenantId: number;
  executionId: number;
  eventId: string;
  actionKey: string;
  actionType: string;
}): Promise<typeof automationActionSteps.$inferSelect> {
  const idempotencyKey = buildActionStepIdempotencyKey(
    options.executionId,
    options.actionKey
  );

  const [inserted] = await db
    .insert(automationActionSteps)
    .values({
      tenantId: options.tenantId,
      automationExecutionId: options.executionId,
      eventId: options.eventId,
      actionKey: options.actionKey,
      actionType: options.actionType,
      status: 'pending',
      idempotencyKey,
      attempts: 0,
    })
    .onConflictDoNothing({
      target: [
        automationActionSteps.automationExecutionId,
        automationActionSteps.actionKey,
      ],
    })
    .returning();

  if (inserted) return inserted;

  const existing = await db
    .select()
    .from(automationActionSteps)
    .where(
      and(
        eq(automationActionSteps.automationExecutionId, options.executionId),
        eq(automationActionSteps.actionKey, options.actionKey)
      )
    )
    .limit(1);

  if (!existing[0]) {
    throw new Error(
      `Failed to resolve action step "${options.actionKey}" on execution #${options.executionId}.`
    );
  }
  return existing[0];
}

async function runActionsForAutomation(
  tenantId: number,
  execution: typeof automationExecutions.$inferSelect,
  automation: typeof automations.$inferSelect,
  orgConfig: WorkspaceOrgConfigData,
  input: TriggerEventInput,
  options: ProcessAutomationEventOptions = {}
): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let currentLeadId: number | null =
    typeof input.payload.leadIntakeId === 'number' ? input.payload.leadIntakeId : null;

  const leadIdempotencyKey = `exec:${execution.id}:lead`;

  const ensureLeadRecord = async () => {
    if (currentLeadId) {
      const existingById = await db
        .select()
        .from(leadIntakeRecords)
        .where(
          and(
            eq(leadIntakeRecords.id, currentLeadId),
            eq(leadIntakeRecords.tenantId, tenantId)
          )
        )
        .limit(1);
      if (existingById[0]) return existingById[0];
    }

    const existingByKey = await db
      .select()
      .from(leadIntakeRecords)
      .where(
        and(
          eq(leadIntakeRecords.tenantId, tenantId),
          eq(leadIntakeRecords.idempotencyKey, leadIdempotencyKey)
        )
      )
      .limit(1);
    if (existingByKey[0]) {
      currentLeadId = existingByKey[0].id;
      return existingByKey[0];
    }

    const extracted = extractLeadFields(input.payload);
    const [insertedLead] = await db
      .insert(leadIntakeRecords)
      .values({
        tenantId,
        sourceFormId: input.formId ?? null,
        sourceSubmissionId:
          input.sourceEntityType === 'form_submission' ? input.sourceEntityId : null,
        idempotencyKey: leadIdempotencyKey,
        applicantName: extracted.applicantName,
        contactEmail: extracted.contactEmail,
        contactPhone: extracted.contactPhone,
        productInterest: extracted.productInterest,
        workflowStage: orgConfig.workflowStages[0]?.name ?? 'Lead acquisition',
        crmSyncStatus: 'pending',
      })
      .onConflictDoNothing({
        target: [leadIntakeRecords.tenantId, leadIntakeRecords.idempotencyKey],
      })
      .returning();

    let createdLead = insertedLead;
    if (!createdLead) {
      const refetched = await db
        .select()
        .from(leadIntakeRecords)
        .where(
          and(
            eq(leadIntakeRecords.tenantId, tenantId),
            eq(leadIntakeRecords.idempotencyKey, leadIdempotencyKey)
          )
        )
        .limit(1);
      createdLead = refetched[0]!;
    }

    if (createdLead.externalCrmRef) {
      currentLeadId = createdLead.id;
      return createdLead;
    }

    const syncResult = syncLeadIntakeViaMockClientCrm({
      tenantId,
      leadIntakeId: createdLead.id,
      applicantName: createdLead.applicantName,
      productInterest: createdLead.productInterest,
    });

    const [updated] = await db
      .update(leadIntakeRecords)
      .set({
        crmSyncStatus: 'mock_synced',
        externalCrmRef: syncResult.externalCrmRef,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(leadIntakeRecords.id, createdLead.id),
          eq(leadIntakeRecords.tenantId, tenantId)
        )
      )
      .returning();

    const resolvedLead = updated ?? createdLead;
    currentLeadId = resolvedLead.id;
    return resolvedLead;
  };

  const actions = automation.actions as AutomationAction[];

  for (let stepIndex = 0; stepIndex < actions.length; stepIndex++) {
    const action = actions[stepIndex]!;
    const actionKey = buildDeterministicActionKey(stepIndex, action);
    const step = await ensureOrGetActionStep({
      tenantId,
      executionId: execution.id,
      eventId: execution.eventId,
      actionKey,
      actionType: action.type,
    });

    if (step.status === 'succeeded') {
      const priorMetadata = step.resultMetadata ?? { action: action.type };
      if (typeof priorMetadata.leadIntakeId === 'number') {
        currentLeadId = priorMetadata.leadIntakeId;
      }
      results.push(priorMetadata);
      continue;
    }

    if (step.status === 'processing') {
      logPipelineEvent({
        level: 'warn',
        event: 'action_step_abandoned_recovered',
        tenantId,
        eventId: execution.eventId,
        correlationId: input.correlationId,
        consumerName: options.consumerName,
        automationId: automation.id,
        automationExecutionId: execution.id,
        actionKey,
        actionType: action.type,
        attempt: step.attempts,
        reason: 'Recovering abandoned action step left in processing state before completion.',
      });
    }

    const nextAttempt = step.attempts + 1;
    const now = new Date();
    await db
      .update(automationActionSteps)
      .set({
        status: 'processing',
        attempts: nextAttempt,
        startedAt: step.startedAt ?? now,
        errorMessage: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(automationActionSteps.id, step.id),
          eq(automationActionSteps.tenantId, tenantId)
        )
      );

    try {
      if (options.beforeActionExecute) {
        await options.beforeActionExecute({
          tenantId,
          executionId: execution.id,
          automationId: automation.id,
          actionKey,
          actionType: action.type,
          stepIndex,
          attempt: nextAttempt,
        });
      }

      let stepResult: Record<string, unknown>;

      if (action.type === 'assign_lead_employee') {
        const empId = action.config.employeeId;
        const emp = orgConfig.employees.find((e) => e.id === empId);
        if (!emp) {
          throw new NonRetryableEventError(
            `Configured employee "${empId ?? 'unknown'}" does not exist in tenant org config.`,
            'INVALID_EMPLOYEE_CONFIG'
          );
        }
        const lead = await ensureLeadRecord();
        await db
          .update(leadIntakeRecords)
          .set({
            assignedEmployeeId: emp.id,
            assignedEmployeeName: emp.name,
            workflowStage: 'Lead assignment',
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(leadIntakeRecords.id, lead.id),
              eq(leadIntakeRecords.tenantId, tenantId)
            )
          );
        stepResult = {
          action: action.type,
          actionKey,
          leadIntakeId: lead.id,
          assignedEmployeeName: emp.name,
        };
      } else if (action.type === 'assign_lead_queue') {
        const queueId = action.config.queueId;
        const queue = orgConfig.queues.find((q) => q.id === queueId);
        if (!queue) {
          throw new NonRetryableEventError(
            `Configured queue "${queueId ?? 'unknown'}" does not exist in tenant org config.`,
            'INVALID_QUEUE_CONFIG'
          );
        }
        const lead = await ensureLeadRecord();
        await db
          .update(leadIntakeRecords)
          .set({
            assignedQueueId: queue.id,
            assignedQueueName: queue.name,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(leadIntakeRecords.id, lead.id),
              eq(leadIntakeRecords.tenantId, tenantId)
            )
          );
        stepResult = {
          action: action.type,
          actionKey,
          leadIntakeId: lead.id,
          assignedQueueName: queue.name,
        };
      } else if (action.type === 'create_follow_up_task') {
        const lead = await ensureLeadRecord();
        const dueHours = Number(action.config.dueHours ?? 4);
        const dueAt = new Date(Date.now() + Math.max(1, dueHours) * 3600 * 1000);
        const assignee =
          (action.config.employeeId &&
            orgConfig.employees.find((e) => e.id === action.config.employeeId)) ||
          (lead.assignedEmployeeId &&
            orgConfig.employees.find((e) => e.id === lead.assignedEmployeeId)) ||
          orgConfig.employees[0];

        const [insertedTask] = await db
          .insert(followUpTasks)
          .values({
            tenantId,
            leadIntakeId: lead.id,
            idempotencyKey: step.idempotencyKey,
            title: action.config.taskTitle?.trim() || `Follow up with ${lead.applicantName}`,
            description: `Generated by automation "${automation.name}" for ${lead.productInterest}.`,
            assignedEmployeeId: assignee?.id ?? null,
            assignedEmployeeName: assignee?.name ?? lead.assignedEmployeeName ?? null,
            priority: action.config.taskPriority ?? 'normal',
            status: 'pending',
            dueAt,
          })
          .onConflictDoNothing({
            target: [followUpTasks.tenantId, followUpTasks.idempotencyKey],
          })
          .returning();

        const task =
          insertedTask ??
          (
            await db
              .select()
              .from(followUpTasks)
              .where(
                and(
                  eq(followUpTasks.tenantId, tenantId),
                  eq(followUpTasks.idempotencyKey, step.idempotencyKey)
                )
              )
              .limit(1)
          )[0]!;

        stepResult = {
          action: action.type,
          actionKey,
          leadIntakeId: lead.id,
          taskId: task.id,
          title: task.title,
          assignedEmployeeName: task.assignedEmployeeName,
        };
      } else if (action.type === 'change_status') {
        const targetStage = action.config.targetStatus?.trim();
        const permittedStage = orgConfig.workflowStages.find(
          (s) => s.name.toLowerCase() === (targetStage ?? '').toLowerCase()
        );
        if (!permittedStage) {
          throw new NonRetryableEventError(
            `Target workflow stage "${targetStage ?? ''}" is not permitted in tenant config.`,
            'INVALID_WORKFLOW_STAGE'
          );
        }
        const lead = await ensureLeadRecord();
        await db
          .update(leadIntakeRecords)
          .set({
            workflowStage: permittedStage.name,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(leadIntakeRecords.id, lead.id),
              eq(leadIntakeRecords.tenantId, tenantId)
            )
          );
        stepResult = {
          action: action.type,
          actionKey,
          leadIntakeId: lead.id,
          workflowStage: permittedStage.name,
        };
      } else if (action.type === 'send_notification') {
        const [insertedNotif] = await db
          .insert(internalNotifications)
          .values({
            tenantId,
            idempotencyKey: step.idempotencyKey,
            recipientEmployeeId: action.config.employeeId ?? null,
            title: action.config.notificationTitle?.trim() || automation.name,
            message:
              action.config.notificationMessage?.trim() ||
              `Automation triggered on ${input.sourceEntityType} #${input.sourceEntityId}.`,
          })
          .onConflictDoNothing({
            target: [internalNotifications.tenantId, internalNotifications.idempotencyKey],
          })
          .returning();

        const notif =
          insertedNotif ??
          (
            await db
              .select()
              .from(internalNotifications)
              .where(
                and(
                  eq(internalNotifications.tenantId, tenantId),
                  eq(internalNotifications.idempotencyKey, step.idempotencyKey)
                )
              )
              .limit(1)
          )[0]!;

        stepResult = {
          action: action.type,
          actionKey,
          notificationId: notif.id,
        };
      } else if (action.type === 'record_activity') {
        const summary =
          action.config.activitySummary?.trim() ||
          `Automation "${automation.name}" completed actions for ${input.sourceEntityType} #${input.sourceEntityId}.`;
        await db
          .insert(activityLogs)
          .values({
            tenantId,
            idempotencyKey: step.idempotencyKey,
            actorUid: 'system:automation-lite',
            actorLabel: 'Automation Lite',
            module: 'automation',
            action: 'automation.action_recorded',
            entityType: input.sourceEntityType,
            entityId: String(input.sourceEntityId),
            summary,
            metadata: {
              automationId: automation.id,
              executionId: execution.id,
              actionKey,
              leadIntakeId: currentLeadId,
            },
          })
          .onConflictDoNothing({
            target: [activityLogs.tenantId, activityLogs.idempotencyKey],
          });

        stepResult = {
          action: action.type,
          actionKey,
          summary,
        };
      } else {
        throw new NonRetryableEventError(
          `Unsupported automation action type "${String((action as { type: unknown }).type)}".`,
          'UNSUPPORTED_ACTION_TYPE'
        );
      }

      const completedAt = new Date();
      await db
        .update(automationActionSteps)
        .set({
          status: 'succeeded',
          resultMetadata: stepResult,
          errorMessage: null,
          completedAt,
          updatedAt: completedAt,
        })
        .where(
          and(
            eq(automationActionSteps.id, step.id),
            eq(automationActionSteps.tenantId, tenantId)
          )
        );

      logPipelineEvent({
        event: 'action_step_succeeded',
        tenantId,
        eventId: execution.eventId,
        correlationId: input.correlationId,
        consumerName: options.consumerName,
        automationId: automation.id,
        automationExecutionId: execution.id,
        actionKey,
        actionType: action.type,
        attempt: nextAttempt,
      });

      results.push(stepResult);
    } catch (error) {
      const sanitizedError = sanitizeEventError(error);
      const completedAt = new Date();
      await db
        .update(automationActionSteps)
        .set({
          status: 'failed',
          errorMessage: sanitizedError,
          completedAt,
          updatedAt: completedAt,
        })
        .where(
          and(
            eq(automationActionSteps.id, step.id),
            eq(automationActionSteps.tenantId, tenantId)
          )
        );

      logPipelineEvent({
        level: 'error',
        event: 'action_step_failed',
        tenantId,
        eventId: execution.eventId,
        correlationId: input.correlationId,
        consumerName: options.consumerName,
        automationId: automation.id,
        automationExecutionId: execution.id,
        actionKey,
        actionType: action.type,
        attempt: nextAttempt,
        reason: sanitizedError,
      });

      throw new ActionStepFailureError(error, results);
    }
  }

  return results;
}

class ActionStepFailureError extends Error {
  readonly causeError: unknown;
  readonly partialResults: Record<string, unknown>[];

  constructor(causeError: unknown, partialResults: Record<string, unknown>[]) {
    super(sanitizeEventError(causeError));
    this.name = 'ActionStepFailureError';
    this.causeError = causeError;
    this.partialResults = partialResults;
  }
}

export async function processAutomationTriggerEvent(
  input: TriggerEventInput,
  options: ProcessAutomationEventOptions = {}
): Promise<
  Array<{
    automationId: number;
    executionId: number;
    status: string;
  }>
> {
  const eventId =
    input.eventId ||
    buildAutomationEventId(
      input.triggerType,
      input.sourceEntityType,
      input.sourceEntityId
    );

  dispatchMockIntegrationEvent({
    tenantId: input.tenantId,
    eventId,
    eventType: input.triggerType,
  });

  const matchingAutomations = await db
    .select()
    .from(automations)
    .where(
      and(
        eq(automations.tenantId, input.tenantId),
        eq(automations.triggerType, input.triggerType),
        eq(automations.active, true)
      )
    );

  const orgConfig = await getTenantOrgConfig(input.tenantId);
  const executionSummaries: Array<{
    automationId: number;
    executionId: number;
    status: string;
  }> = [];

  for (const automation of matchingAutomations) {
    if (
      automation.triggerFormId !== null &&
      input.formId !== undefined &&
      automation.triggerFormId !== input.formId
    ) {
      continue;
    }

    const existingRows = await db
      .select()
      .from(automationExecutions)
      .where(
        and(
          eq(automationExecutions.automationId, automation.id),
          eq(automationExecutions.eventId, eventId)
        )
      )
      .limit(1);

    const existingExecution = existingRows[0];
    if (
      existingExecution &&
      (existingExecution.status === 'succeeded' ||
        existingExecution.status === 'skipped')
    ) {
      executionSummaries.push({
        automationId: automation.id,
        executionId: existingExecution.id,
        status: existingExecution.status,
      });
      continue;
    }

    const conditionsMatch = evaluateAllAutomationConditions(
      automation.conditions,
      input.payload
    );

    if (!conditionsMatch) {
      const skippedRow = existingExecution
        ? (
            await db
              .update(automationExecutions)
              .set({ status: 'skipped', errorMessage: null })
              .where(
                and(
                  eq(automationExecutions.id, existingExecution.id),
                  eq(automationExecutions.tenantId, input.tenantId)
                )
              )
              .returning()
          )[0]!
        : await ensureOrGetExecutionRecord(
            input.tenantId,
            automation,
            eventId,
            input,
            'skipped'
          );

      executionSummaries.push({
        automationId: automation.id,
        executionId: skippedRow.id,
        status: 'skipped',
      });
      continue;
    }

    const execution = existingExecution
      ? (
          await db
            .update(automationExecutions)
            .set({
              status: 'retrying',
              attempts: existingExecution.attempts + 1,
            })
            .where(
              and(
                eq(automationExecutions.id, existingExecution.id),
                eq(automationExecutions.tenantId, input.tenantId)
              )
            )
            .returning()
        )[0]!
      : await ensureOrGetExecutionRecord(
          input.tenantId,
          automation,
          eventId,
          input,
          'running'
        );

    logPipelineEvent({
      event: 'automation_execution_started',
      tenantId: input.tenantId,
      eventId,
      correlationId: input.correlationId,
      consumerName: options.consumerName,
      automationId: automation.id,
      automationExecutionId: execution.id,
      attempt: execution.attempts,
    });

    try {
      const actionResults = await runActionsForAutomation(
        input.tenantId,
        execution,
        automation,
        orgConfig,
        input,
        options
      );

      await db
        .update(automationExecutions)
        .set({
          status: 'succeeded',
          errorMessage: null,
          actionResults,
        })
        .where(
          and(
            eq(automationExecutions.id, execution.id),
            eq(automationExecutions.tenantId, input.tenantId)
          )
        );

      await db
        .insert(activityLogs)
        .values({
          tenantId: input.tenantId,
          idempotencyKey: `exec:${execution.id}:completed`,
          actorUid: input.actorUid,
          actorLabel: input.actorLabel,
          module: 'automation',
          action: 'automation.executed',
          entityType: 'automation',
          entityId: String(automation.id),
          summary: `Automation "${automation.name}" succeeded on ${input.triggerType}.`,
          metadata: { eventId, executionId: execution.id, actionResults },
        })
        .onConflictDoNothing({
          target: [activityLogs.tenantId, activityLogs.idempotencyKey],
        });

      executionSummaries.push({
        automationId: automation.id,
        executionId: execution.id,
        status: 'succeeded',
      });
    } catch (error) {
      const underlyingError =
        error instanceof ActionStepFailureError ? error.causeError : error;
      const partialResults =
        error instanceof ActionStepFailureError ? error.partialResults : [];
      const classification = classifyEventError(underlyingError);
      const willExhaust =
        !classification.retryable ||
        execution.attempts >= MAX_AUTOMATION_RETRY_ATTEMPTS;

      await db
        .update(automationExecutions)
        .set({
          status: willExhaust ? 'failed' : 'retrying',
          errorMessage: classification.sanitizedMessage,
          actionResults: partialResults,
        })
        .where(
          and(
            eq(automationExecutions.id, execution.id),
            eq(automationExecutions.tenantId, input.tenantId)
          )
        );

      await db
        .insert(activityLogs)
        .values({
          tenantId: input.tenantId,
          idempotencyKey: `exec:${execution.id}:attempt:${execution.attempts}:failed`,
          actorUid: input.actorUid,
          actorLabel: input.actorLabel,
          module: 'automation',
          action: 'automation.failed',
          entityType: 'automation',
          entityId: String(automation.id),
          summary: `Automation "${automation.name}" failed: ${classification.sanitizedMessage}`,
          metadata: {
            eventId,
            executionId: execution.id,
            attempt: execution.attempts,
            retryable: classification.retryable,
          },
        })
        .onConflictDoNothing({
          target: [activityLogs.tenantId, activityLogs.idempotencyKey],
        });

      throw underlyingError;
    }
  }

  return executionSummaries;
}

export async function dispatchWorkspaceTriggerEvent(input: TriggerEventInput) {
  try {
    return await processAutomationTriggerEvent(input);
  } catch {
    return [];
  }
}

export async function retryAutomationExecution(
  tenantId: number,
  executionId: number,
  actorUid: string,
  actorLabel: string,
  options: ProcessAutomationEventOptions = {}
) {
  const rows = await db
    .select()
    .from(automationExecutions)
    .where(
      and(
        eq(automationExecutions.id, executionId),
        eq(automationExecutions.tenantId, tenantId)
      )
    )
    .limit(1);

  const execution = rows[0];
  if (!execution) {
    return { notFound: true as const };
  }
  if (execution.status !== 'failed' && execution.status !== 'retrying') {
    return {
      invalidState: true as const,
      message: 'Only failed or retrying executions can be retried.',
    };
  }
  if (execution.attempts >= MAX_AUTOMATION_RETRY_ATTEMPTS) {
    return {
      invalidState: true as const,
      message: `Maximum retry limit (${MAX_AUTOMATION_RETRY_ATTEMPTS} attempts) reached for this execution.`,
    };
  }

  const autoRows = await db
    .select()
    .from(automations)
    .where(
      and(
        eq(automations.id, execution.automationId),
        eq(automations.tenantId, tenantId)
      )
    )
    .limit(1);

  const automation = autoRows[0];
  if (!automation) {
    return { notFound: true as const };
  }

  const orgConfig = await getTenantOrgConfig(tenantId);
  const nextAttempts = execution.attempts + 1;

  try {
    const actionResults = await runActionsForAutomation(
      tenantId,
      execution,
      automation,
      orgConfig,
      {
        tenantId,
        eventId: execution.eventId,
        triggerType: execution.eventType as AutomationTriggerType,
        sourceEntityType: execution.sourceEntityType,
        sourceEntityId: execution.sourceEntityId,
        formId:
          typeof execution.eventPayload.formId === 'number'
            ? execution.eventPayload.formId
            : undefined,
        actorUid,
        actorLabel,
        payload: execution.eventPayload,
      },
      options
    );

    const [updated] = await db
      .update(automationExecutions)
      .set({
        status: 'succeeded',
        attempts: nextAttempts,
        errorMessage: null,
        actionResults,
      })
      .where(
        and(
          eq(automationExecutions.id, execution.id),
          eq(automationExecutions.tenantId, tenantId)
        )
      )
      .returning();

    await db.insert(activityLogs).values({
      tenantId,
      actorUid,
      actorLabel,
      module: 'automation',
      action: 'automation.retried',
      entityType: 'automation_execution',
      entityId: String(execution.id),
      summary: `Retried execution #${execution.id} for "${automation.name}" succeeded.`,
      metadata: { attempts: updated!.attempts },
    });

    return { execution: updated! };
  } catch (error) {
    const underlyingError =
      error instanceof ActionStepFailureError ? error.causeError : error;
    const partialResults =
      error instanceof ActionStepFailureError ? error.partialResults : execution.actionResults;
    const message = sanitizeEventError(underlyingError);
    const [updated] = await db
      .update(automationExecutions)
      .set({
        status: 'failed',
        attempts: nextAttempts,
        errorMessage: message,
        actionResults: partialResults,
      })
      .where(
        and(
          eq(automationExecutions.id, execution.id),
          eq(automationExecutions.tenantId, tenantId)
        )
      )
      .returning();

    return { execution: updated! };
  }
}
