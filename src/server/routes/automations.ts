import { Router, type RequestHandler } from 'express';
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.ts';
import {
  activityLogs,
  automationActionSteps,
  automationExecutions,
  automations,
} from '../../db/schema.ts';
import type {
  AutomationAction,
  AutomationCondition,
} from '../../shared/types.ts';
import { simulateAutomationDryRun } from '../../shared/automation-engine.ts';
import { queryTenantDurableEvents } from '../events/event-worker.ts';
import {
  DeadLetterReplayError,
  replayDeadLetterEvent,
} from '../events/replay-service.ts';
import {
  requireAnyPermission,
  requireAuth,
  requirePermission,
  type AuthRequest,
} from '../middleware/auth.ts';
import { requireAppEnabled } from '../services/app-management-service.ts';
import {
  getTenantOrgConfig,
  retryAutomationExecution,
} from '../services/automation-runner.ts';

export function createAutomationsRouter(
  authMiddleware: RequestHandler = requireAuth
): Router {
  const router = Router();
  router.use(authMiddleware);
  router.use(requireAppEnabled('workflow-automation'));

const ConditionSchema = z.object({
  id: z.string().min(1),
  fieldKey: z.string().min(1),
  operator: z.enum(['equals', 'contains', 'is_present', 'is_empty']),
  value: z.string().optional(),
});

const ActionSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    'assign_lead_employee',
    'assign_lead_queue',
    'create_follow_up_task',
    'change_status',
    'send_notification',
    'record_activity',
  ]),
  config: z.object({
    employeeId: z.string().optional(),
    queueId: z.string().optional(),
    taskTitle: z.string().optional(),
    taskPriority: z.enum(['low', 'normal', 'high']).optional(),
    dueHours: z.number().int().min(1).max(720).optional(),
    targetStatus: z.string().optional(),
    notificationTitle: z.string().optional(),
    notificationMessage: z.string().optional(),
    activitySummary: z.string().optional(),
  }),
});

const AutomationUpsertSchema = z.object({
  name: z.string().min(2).max(140),
  description: z.string().max(500).default(''),
  triggerType: z.enum([
    'form_submitted',
    'lead_created',
    'task_completed',
    'appointment_booked',
    'status_changed',
  ]),
  triggerFormId: z.number().int().positive().nullable().optional(),
  conditions: z.array(ConditionSchema).default([]),
  actions: z.array(ActionSchema).min(1),
  active: z.boolean().default(true),
});

router.get('/', requirePermission('canViewAutomations'), async (req: AuthRequest, res) => {
  try {
    const tenantId = req.authContext!.activeMembership.tenantId;
    const rows = await db
      .select()
      .from(automations)
      .where(eq(automations.tenantId, tenantId))
      .orderBy(desc(automations.updatedAt));

    const executions = await db
      .select({
        id: automationExecutions.id,
        tenantId: automationExecutions.tenantId,
        automationId: automationExecutions.automationId,
        automationName: automations.name,
        eventId: automationExecutions.eventId,
        eventType: automationExecutions.eventType,
        sourceEntityType: automationExecutions.sourceEntityType,
        sourceEntityId: automationExecutions.sourceEntityId,
        status: automationExecutions.status,
        attempts: automationExecutions.attempts,
        errorMessage: automationExecutions.errorMessage,
        actionResults: automationExecutions.actionResults,
        eventPayload: automationExecutions.eventPayload,
        createdAt: automationExecutions.createdAt,
      })
      .from(automationExecutions)
      .innerJoin(
        automations,
        eq(automationExecutions.automationId, automations.id)
      )
      .where(eq(automationExecutions.tenantId, tenantId))
      .orderBy(desc(automationExecutions.createdAt))
      .limit(100);

    res.json({ automations: rows, executions });
  } catch (error) {
    console.error('Failed to load automations:', error);
    res.status(500).json({ error: 'Failed to load automations.' });
  }
});

router.post(
  '/',
  requirePermission('canManageAutomations'),
  async (req: AuthRequest, res) => {
    const parsed = AutomationUpsertSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid automation workflow definition.' });
      return;
    }

    try {
      const ctx = req.authContext!;
      const tenantId = ctx.activeMembership.tenantId;
      const [created] = await db
        .insert(automations)
        .values({
          tenantId,
          name: parsed.data.name.trim(),
          description: parsed.data.description.trim(),
          triggerType: parsed.data.triggerType,
          triggerFormId: parsed.data.triggerFormId ?? null,
          conditions: parsed.data.conditions as AutomationCondition[],
          actions: parsed.data.actions as AutomationAction[],
          active: parsed.data.active,
          createdByUid: ctx.user.uid,
        })
        .returning();

      await db.insert(activityLogs).values({
        tenantId,
        actorUid: ctx.user.uid,
        actorLabel: ctx.user.displayName,
        module: 'automation',
        action: 'automation.created',
        entityType: 'automation',
        entityId: String(created!.id),
        summary: `Created automation "${created!.name}" (${created!.triggerType}).`,
        metadata: { actionCount: created!.actions.length },
      });

      res.status(201).json({ automation: created });
    } catch (error) {
      console.error('Automation creation failed:', error);
      res.status(500).json({ error: 'Failed to create automation.' });
    }
  }
);

router.put(
  '/:id',
  requirePermission('canManageAutomations'),
  async (req: AuthRequest, res) => {
    const id = Number(req.params.id);
    const parsed = AutomationUpsertSchema.safeParse(req.body);
    if (!Number.isInteger(id) || !parsed.success) {
      res.status(400).json({ error: 'Invalid automation update payload.' });
      return;
    }

    try {
      const ctx = req.authContext!;
      const tenantId = ctx.activeMembership.tenantId;
      const [updated] = await db
        .update(automations)
        .set({
          name: parsed.data.name.trim(),
          description: parsed.data.description.trim(),
          triggerType: parsed.data.triggerType,
          triggerFormId: parsed.data.triggerFormId ?? null,
          conditions: parsed.data.conditions as AutomationCondition[],
          actions: parsed.data.actions as AutomationAction[],
          active: parsed.data.active,
          updatedAt: new Date(),
        })
        .where(and(eq(automations.id, id), eq(automations.tenantId, tenantId)))
        .returning();

      if (!updated) {
        res.status(404).json({ error: 'Automation not found.' });
        return;
      }

      await db.insert(activityLogs).values({
        tenantId,
        actorUid: ctx.user.uid,
        actorLabel: ctx.user.displayName,
        module: 'automation',
        action: 'automation.updated',
        entityType: 'automation',
        entityId: String(updated.id),
        summary: `Updated automation "${updated.name}".`,
        metadata: { active: updated.active },
      });

      res.json({ automation: updated });
    } catch (error) {
      console.error('Automation update failed:', error);
      res.status(500).json({ error: 'Failed to update automation.' });
    }
  }
);

router.patch(
  '/:id/toggle',
  requirePermission('canManageAutomations'),
  async (req: AuthRequest, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'Invalid automation ID.' });
      return;
    }

    try {
      const ctx = req.authContext!;
      const tenantId = ctx.activeMembership.tenantId;
      const existing = await db
        .select()
        .from(automations)
        .where(and(eq(automations.id, id), eq(automations.tenantId, tenantId)))
        .limit(1);

      if (!existing[0]) {
        res.status(404).json({ error: 'Automation not found.' });
        return;
      }

      const [updated] = await db
        .update(automations)
        .set({ active: !existing[0].active, updatedAt: new Date() })
        .where(and(eq(automations.id, id), eq(automations.tenantId, tenantId)))
        .returning();

      await db.insert(activityLogs).values({
        tenantId,
        actorUid: ctx.user.uid,
        actorLabel: ctx.user.displayName,
        module: 'automation',
        action: updated!.active ? 'automation.enabled' : 'automation.paused',
        entityType: 'automation',
        entityId: String(updated!.id),
        summary: `${updated!.active ? 'Activated' : 'Paused'} automation "${updated!.name}".`,
        metadata: {},
      });

      res.json({ automation: updated });
    } catch (error) {
      console.error('Automation toggle failed:', error);
      res.status(500).json({ error: 'Failed to toggle automation state.' });
    }
  }
);

router.post(
  '/executions/:executionId/retry',
  requirePermission('canManageAutomations'),
  async (req: AuthRequest, res) => {
    const executionId = Number(req.params.executionId);
    if (!Number.isInteger(executionId)) {
      res.status(400).json({ error: 'Invalid execution ID.' });
      return;
    }

    try {
      const ctx = req.authContext!;
      const result = await retryAutomationExecution(
        ctx.activeMembership.tenantId,
        executionId,
        ctx.user.uid,
        ctx.user.displayName
      );

      if ('notFound' in result) {
        res.status(404).json({ error: 'Execution record not found.' });
        return;
      }
      if ('invalidState' in result) {
        res.status(400).json({ error: result.message });
        return;
      }
      res.json({ execution: result.execution });
    } catch (error) {
      console.error('Execution retry failed:', error);
      res.status(500).json({ error: 'Failed to retry execution.' });
    }
  }
);

router.get(
  '/executions/:executionId/steps',
  requirePermission('canViewAutomations'),
  async (req: AuthRequest, res) => {
    const executionId = Number(req.params.executionId);
    if (!Number.isInteger(executionId)) {
      res.status(400).json({ error: 'Invalid execution ID.' });
      return;
    }

    try {
      const tenantId = req.authContext!.activeMembership.tenantId;
      const steps = await db
        .select()
        .from(automationActionSteps)
        .where(
          and(
            eq(automationActionSteps.tenantId, tenantId),
            eq(automationActionSteps.automationExecutionId, executionId)
          )
        )
        .orderBy(asc(automationActionSteps.id));

      res.json({ steps });
    } catch (error) {
      console.error('Failed to load action steps:', error);
      res.status(500).json({ error: 'Failed to load action steps.' });
    }
  }
);

router.get(
  '/events',
  requireAnyPermission(['canManageAutomations', 'canManageIntegrations', 'canReplayEvents']),
  async (req: AuthRequest, res) => {
    try {
      const tenantId = req.authContext!.activeMembership.tenantId;
      const sourceRaw = String(req.query.source ?? 'all');
      const source =
        sourceRaw === 'outbox' || sourceRaw === 'inbox' ? sourceRaw : 'all';
      const statusRaw =
        typeof req.query.status === 'string' ? req.query.status.trim() : '';
      const allowedStatuses = new Set([
        'dead_letter',
        'pending',
        'received',
        'processing',
        'published',
        'succeeded',
      ]);
      const status = allowedStatuses.has(statusRaw)
        ? (statusRaw as
            | 'dead_letter'
            | 'pending'
            | 'received'
            | 'processing'
            | 'published'
            | 'succeeded')
        : undefined;

      const fromRaw =
        typeof req.query.from === 'string' && req.query.from.trim()
          ? new Date(req.query.from.trim())
          : undefined;
      const toRaw =
        typeof req.query.to === 'string' && req.query.to.trim()
          ? new Date(req.query.to.trim())
          : undefined;
      if (
        (fromRaw && Number.isNaN(fromRaw.getTime())) ||
        (toRaw && Number.isNaN(toRaw.getTime()))
      ) {
        res.status(400).json({ error: 'Invalid date range filter.' });
        return;
      }

      const limitNum = Number(req.query.limit ?? 50);
      const offsetNum = Number(req.query.offset ?? 0);
      const limit = Number.isFinite(limitNum)
        ? Math.max(1, Math.min(100, Math.trunc(limitNum)))
        : 50;
      const offset = Number.isFinite(offsetNum)
        ? Math.max(0, Math.trunc(offsetNum))
        : 0;

      const events = await queryTenantDurableEvents(tenantId, {
        source,
        status,
        consumerName:
          typeof req.query.consumerName === 'string' && req.query.consumerName.trim()
            ? req.query.consumerName.trim()
            : undefined,
        eventType:
          typeof req.query.eventType === 'string' && req.query.eventType.trim()
            ? req.query.eventType.trim()
            : undefined,
        search:
          typeof req.query.search === 'string' && req.query.search.trim()
            ? req.query.search.trim()
            : undefined,
        from: fromRaw,
        to: toRaw,
        limit,
        offset,
      });

      res.json({
        outbox: events.outbox.map((row) => ({
          id: row.id,
          source: 'outbox' as const,
          status: row.status,
          eventType: row.eventType,
          eventId: row.eventId,
          aggregateType: row.aggregateType,
          aggregateId: row.aggregateId,
          createdAt: row.createdAt,
          availableAt: row.availableAt,
          attempts: row.attempts,
          maxAttempts: row.maxAttempts,
          lastError: row.lastError,
          replayCount: row.replayCount,
          lastReplayedAt: row.lastReplayedAt,
          lastReplayedByUid: row.lastReplayedByUid,
          lastReplayReason: row.lastReplayReason,
          publishedAt: row.publishedAt,
        })),
        inbox: events.inbox.map((row) => ({
          id: row.id,
          source: 'inbox' as const,
          consumerName: row.consumerName,
          status: row.status,
          eventType: row.eventType,
          eventId: row.eventId,
          createdAt: row.createdAt,
          availableAt: row.availableAt,
          attempts: row.attempts,
          maxAttempts: row.maxAttempts,
          lastError: row.lastError,
          replayCount: row.replayCount,
          lastReplayedAt: row.lastReplayedAt,
          lastReplayedByUid: row.lastReplayedByUid,
          lastReplayReason: row.lastReplayReason,
          processedAt: row.processedAt,
        })),
        outboxTotal: events.outboxTotal,
        inboxTotal: events.inboxTotal,
        limit,
        offset,
      });
    } catch (error) {
      console.error('Failed to load durable event logs:', error);
      res.status(500).json({ error: 'Failed to load durable event logs.' });
    }
  }
);

const ReplayEventBodySchema = z.object({
  reason: z.string().trim().min(3).max(300),
});

router.post(
  '/events/:source/:id/replay',
  requirePermission('canReplayEvents'),
  async (req: AuthRequest, res) => {
    const sourceRaw = String(req.params.source ?? '').trim();
    if (sourceRaw !== 'outbox' && sourceRaw !== 'inbox') {
      res.status(400).json({ error: 'Invalid event source; must be "outbox" or "inbox".' });
      return;
    }

    const rowId = Number(req.params.id);
    if (!Number.isInteger(rowId) || rowId <= 0) {
      res.status(400).json({ error: 'Invalid event record ID.' });
      return;
    }

    const parsedBody = ReplayEventBodySchema.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({
        error:
          parsedBody.error.issues[0]?.message ??
          'A replay reason between 3 and 300 characters is required.',
      });
      return;
    }

    try {
      const ctx = req.authContext!;
      const result = await replayDeadLetterEvent({
        source: sourceRaw,
        rowId,
        tenantId: ctx.activeMembership.tenantId,
        actorUid: ctx.user.uid,
        actorLabel: ctx.user.displayName,
        reason: parsedBody.data.reason,
      });
      res.json(result);
    } catch (error) {
      if (error instanceof DeadLetterReplayError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      console.error('DLQ replay failed:', error);
      res.status(500).json({ error: 'Failed to replay dead-letter event.' });
    }
  }
);

const DryRunSchema = z.object({
  conditions: z.array(ConditionSchema).default([]),
  actions: z.array(ActionSchema).min(1),
  samplePayload: z.record(z.string(), z.unknown()).default({}),
});

router.post(
  '/dry-run',
  requirePermission('canManageAutomations'),
  async (req: AuthRequest, res) => {
    const parsed = DryRunSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid dry-run workflow definition.' });
      return;
    }

    try {
      const tenantId = req.authContext!.activeMembership.tenantId;
      const orgConfig = await getTenantOrgConfig(tenantId);
      const dryRun = simulateAutomationDryRun(
        parsed.data.conditions as AutomationCondition[],
        parsed.data.actions as AutomationAction[],
        orgConfig,
        parsed.data.samplePayload
      );
      res.json({ dryRun });
    } catch (error) {
      console.error('Automation dry-run failed:', error);
      res.status(500).json({ error: 'Failed to evaluate dry-run.' });
    }
  }
);

router.delete(
  '/:id',
  requirePermission('canManageAutomations'),
  async (req: AuthRequest, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'Invalid automation ID.' });
      return;
    }

    try {
      const ctx = req.authContext!;
      const tenantId = ctx.activeMembership.tenantId;
      const [deleted] = await db
        .delete(automations)
        .where(and(eq(automations.id, id), eq(automations.tenantId, tenantId)))
        .returning();

      if (!deleted) {
        res.status(404).json({ error: 'Automation not found.' });
        return;
      }

      await db.insert(activityLogs).values({
        tenantId,
        actorUid: ctx.user.uid,
        actorLabel: ctx.user.displayName,
        module: 'automation',
        action: 'automation.deleted',
        entityType: 'automation',
        entityId: String(deleted.id),
        summary: `Deleted automation "${deleted.name}".`,
        metadata: {},
      });

      res.json({ deletedId: deleted.id });
    } catch (error) {
      console.error('Automation deletion failed:', error);
      res.status(500).json({ error: 'Failed to delete automation.' });
    }
  }
);

  return router;
}

export default createAutomationsRouter();
