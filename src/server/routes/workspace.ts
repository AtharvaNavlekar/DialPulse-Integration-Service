import { Router, type RequestHandler } from 'express';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.ts';
import {
  activityLogs,
  automationExecutions,
  automations,
  followUpTasks,
  formSubmissions,
  forms,
  internalNotifications,
  leadIntakeRecords,
  users,
  workspaceOrgConfigs,
} from '../../db/schema.ts';
import { createDefaultOrgConfig } from '../../shared/defaults.ts';
import { matchesSearchTerms, rankSearchResults } from '../../shared/search-utils.ts';
import type { GlobalSearchResultItem } from '../../shared/types.ts';
import { randomUUID } from 'node:crypto';
import { buildAutomationEventId } from '../../shared/automation-engine.ts';
import { getEcosystemAdapterStatus } from '../adapters/ecosystem-mock.ts';
import { enqueueOutboxEvent } from '../events/outbox-repository.ts';
import {
  PERMISSION_CATALOG,
  PERMISSION_CATEGORIES,
  ROLE_LABELS,
  VALID_ROLE_KEYS,
  hasEffectivePermission,
  normalizeProposedChanges,
  validateRoleMatrixGovernance,
} from '../../shared/rbac.ts';
import {
  RbacGovernanceError,
  buildRolesConfigArrayFromMatrix,
  getTenantRoleMatrix,
  updateTenantRolePermissions,
} from '../services/rbac-service.ts';
import {
  requireAnyPermission,
  requireAuth,
  requirePermission,
  type AuthRequest,
} from '../middleware/auth.ts';
import {
  PreferencesValidationError,
  createPreferencesService,
  preferencesService,
} from '../services/preferences-service.ts';
import {
  AppManagementError,
  getAppCatalogPayload,
  getTenantAppsState,
  updateTenantAppActivation,
} from '../services/app-management-service.ts';

export interface WorkspaceRouterDeps {
  preferencesService?: ReturnType<typeof createPreferencesService>;
}

export function createWorkspaceRouter(
  authMiddleware: RequestHandler = requireAuth,
  deps: WorkspaceRouterDeps = {}
) {
  const router = Router();
  const activePreferencesService = deps.preferencesService ?? preferencesService;
  router.use(authMiddleware);

router.get('/session', async (req: AuthRequest, res) => {
  try {
    const ctx = req.authContext!;
    const tenantId = ctx.activeMembership.tenantId;
    const [orgRows, matrixState, appsState] = await Promise.all([
      db
        .select()
        .from(workspaceOrgConfigs)
        .where(eq(workspaceOrgConfigs.tenantId, tenantId))
        .limit(1),
      getTenantRoleMatrix(tenantId),
      getTenantAppsState({
        tenantId,
        permissions: ctx.permissions,
      }),
    ]);

    const baseConfig = orgRows[0]?.config ?? createDefaultOrgConfig();
    const orgConfig = {
      ...baseConfig,
      roles: buildRolesConfigArrayFromMatrix(matrixState.matrix),
    };

    res.json({
      user: ctx.user,
      activeTenant: ctx.activeMembership,
      memberships: ctx.memberships,
      orgConfig,
      permissions: ctx.permissions,
      apps: appsState.apps,
      ecosystemAdapters: getEcosystemAdapterStatus(),
    });
  } catch (error) {
    console.error('Session load failed:', error);
    res.status(500).json({ error: 'Failed to load workspace session.' });
  }
});

const SwitchTenantSchema = z.object({
  tenantId: z.number().int().positive(),
});

router.post('/tenant/switch', async (req: AuthRequest, res) => {
  const parsed = SwitchTenantSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid tenant selection.' });
    return;
  }

  const ctx = req.authContext!;
  const membership = ctx.memberships.find(
    (m) => m.tenantId === parsed.data.tenantId
  );
  if (!membership) {
    res.status(403).json({
      error: 'Access denied: you are not a member of that tenant.',
    });
    return;
  }

  try {
    await db
      .update(users)
      .set({ activeTenantId: membership.tenantId, updatedAt: new Date() })
      .where(eq(users.uid, ctx.user.uid));

    res.json({ activeTenant: membership });
  } catch (error) {
    console.error('Tenant switch failed:', error);
    res.status(500).json({ error: 'Failed to switch tenant.' });
  }
});

router.get('/overview', requirePermission('canViewWorkspace'), async (req: AuthRequest, res) => {
  try {
    const tenantId = req.authContext!.activeMembership.tenantId;

    const [
      tenantForms,
      recentSubmissions,
      pendingTasks,
      recentExecutions,
      recentActivity,
      notifications,
      leads,
      submissionsCountRow,
      openTasksCountRow,
      succeededExecCountRow,
      failedExecCountRow,
      leadsCountRow,
      appsState,
    ] = await Promise.all([
      db.select().from(forms).where(eq(forms.tenantId, tenantId)),
      db
        .select({
          id: formSubmissions.id,
          formId: formSubmissions.formId,
          formTitle: forms.title,
          source: formSubmissions.source,
          submitterSummary: formSubmissions.submitterSummary,
          createdAt: formSubmissions.createdAt,
        })
        .from(formSubmissions)
        .innerJoin(forms, eq(formSubmissions.formId, forms.id))
        .where(eq(formSubmissions.tenantId, tenantId))
        .orderBy(desc(formSubmissions.createdAt))
        .limit(8),
      db
        .select()
        .from(followUpTasks)
        .where(eq(followUpTasks.tenantId, tenantId))
        .orderBy(desc(followUpTasks.createdAt))
        .limit(10),
      db
        .select({
          id: automationExecutions.id,
          automationId: automationExecutions.automationId,
          automationName: automations.name,
          eventType: automationExecutions.eventType,
          status: automationExecutions.status,
          errorMessage: automationExecutions.errorMessage,
          createdAt: automationExecutions.createdAt,
        })
        .from(automationExecutions)
        .innerJoin(
          automations,
          eq(automationExecutions.automationId, automations.id)
        )
        .where(eq(automationExecutions.tenantId, tenantId))
        .orderBy(desc(automationExecutions.createdAt))
        .limit(12),
      db
        .select()
        .from(activityLogs)
        .where(eq(activityLogs.tenantId, tenantId))
        .orderBy(desc(activityLogs.createdAt))
        .limit(15),
      db
        .select()
        .from(internalNotifications)
        .where(eq(internalNotifications.tenantId, tenantId))
        .orderBy(desc(internalNotifications.createdAt))
        .limit(8),
      db
        .select()
        .from(leadIntakeRecords)
        .where(eq(leadIntakeRecords.tenantId, tenantId))
        .orderBy(desc(leadIntakeRecords.createdAt))
        .limit(10),
      db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(formSubmissions)
        .where(eq(formSubmissions.tenantId, tenantId)),
      db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(followUpTasks)
        .where(
          and(
            eq(followUpTasks.tenantId, tenantId),
            ne(followUpTasks.status, 'completed')
          )
        ),
      db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(automationExecutions)
        .where(
          and(
            eq(automationExecutions.tenantId, tenantId),
            eq(automationExecutions.status, 'succeeded')
          )
        ),
      db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(automationExecutions)
        .where(
          and(
            eq(automationExecutions.tenantId, tenantId),
            eq(automationExecutions.status, 'failed')
          )
        ),
      db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(leadIntakeRecords)
        .where(eq(leadIntakeRecords.tenantId, tenantId)),
      getTenantAppsState({
        tenantId,
        permissions: req.authContext!.permissions,
      }),
    ]);

    const activeMiniApps = appsState.overview.activeMiniAppsCount;
    const totalMiniApps = appsState.overview.totalCatalogApps;
    const failedExecutions = recentExecutions.filter(
      (e) => e.status === 'failed'
    );

    res.json({
      stats: {
        activeMiniApps,
        totalMiniApps,
        totalForms: tenantForms.length,
        publishedForms: tenantForms.filter((f) => f.status === 'published').length,
        recentSubmissionCount: Number(submissionsCountRow[0]?.count ?? 0),
        pendingTasksCount: Number(openTasksCountRow[0]?.count ?? 0),
        upcomingAppointmentsCount: 0, // Appointment Scheduler planned for Stage 2 / Milestone E
        succeededAutomationsCount: Number(succeededExecCountRow[0]?.count ?? 0),
        failedOperationsCount: Number(failedExecCountRow[0]?.count ?? 0),
        totalLeadsCount: Number(leadsCountRow[0]?.count ?? 0),
      },
      recentSubmissions,
      pendingTasks,
      recentExecutions,
      failedOperations: failedExecutions,
      recentActivity,
      notifications,
      leads,
    });
  } catch (error) {
    console.error('Overview load failed:', error);
    res.status(500).json({ error: 'Failed to load workspace overview.' });
  }
});

router.get('/search', requirePermission('canViewWorkspace'), async (req: AuthRequest, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!q) {
    res.json({ results: [] });
    return;
  }

  try {
    const tenantId = req.authContext!.activeMembership.tenantId;
    const [
      tenantForms,
      tenantSubmissions,
      tenantAutomations,
      tenantLeads,
      tenantTasks,
      tenantActivity,
    ] = await Promise.all([
      db
        .select()
        .from(forms)
        .where(eq(forms.tenantId, tenantId))
        .orderBy(desc(forms.updatedAt))
        .limit(40),
      db
        .select({
          id: formSubmissions.id,
          formId: formSubmissions.formId,
          formTitle: forms.title,
          submitterSummary: formSubmissions.submitterSummary,
          source: formSubmissions.source,
        })
        .from(formSubmissions)
        .innerJoin(forms, eq(formSubmissions.formId, forms.id))
        .where(eq(formSubmissions.tenantId, tenantId))
        .orderBy(desc(formSubmissions.createdAt))
        .limit(40),
      db
        .select()
        .from(automations)
        .where(eq(automations.tenantId, tenantId))
        .orderBy(desc(automations.updatedAt))
        .limit(40),
      db
        .select()
        .from(leadIntakeRecords)
        .where(eq(leadIntakeRecords.tenantId, tenantId))
        .orderBy(desc(leadIntakeRecords.createdAt))
        .limit(40),
      db
        .select()
        .from(followUpTasks)
        .where(eq(followUpTasks.tenantId, tenantId))
        .orderBy(desc(followUpTasks.createdAt))
        .limit(40),
      db
        .select()
        .from(activityLogs)
        .where(eq(activityLogs.tenantId, tenantId))
        .orderBy(desc(activityLogs.createdAt))
        .limit(40),
    ]);

    const hits: GlobalSearchResultItem[] = [];

    for (const f of tenantForms) {
      if (matchesSearchTerms(q, f.title, f.category, f.slug, f.status)) {
        hits.push({
          id: `form-${f.id}`,
          entityType: 'form',
          title: f.title,
          subtitle: `Form · ${f.status} · /f/${f.slug}`,
          routePath: `/forms/${f.id}/builder`,
        });
      }
    }

    for (const sub of tenantSubmissions) {
      if (matchesSearchTerms(q, sub.submitterSummary, sub.formTitle, sub.source, sub.id)) {
        hits.push({
          id: `submission-${sub.id}`,
          entityType: 'submission',
          title: sub.submitterSummary || `Submission #${sub.id}`,
          subtitle: `Submission · ${sub.formTitle} (${sub.source})`,
          routePath: `/forms/${sub.formId}/submissions`,
        });
      }
    }

    for (const auto of tenantAutomations) {
      if (matchesSearchTerms(q, auto.name, auto.description, auto.triggerType)) {
        hits.push({
          id: `automation-${auto.id}`,
          entityType: 'automation',
          title: auto.name,
          subtitle: `Automation · ${auto.active ? 'Active' : 'Paused'} · ${auto.triggerType}`,
          routePath: `/automations/${auto.id}`,
        });
      }
    }

    for (const lead of tenantLeads) {
      if (
        matchesSearchTerms(
          q,
          lead.applicantName,
          lead.productInterest,
          lead.assignedEmployeeName,
          lead.assignedQueueName,
          lead.externalCrmRef
        )
      ) {
        hits.push({
          id: `lead-${lead.id}`,
          entityType: 'lead',
          title: lead.applicantName,
          subtitle: `Lead · ${lead.productInterest} · ${lead.assignedEmployeeName || 'Unassigned'}`,
          routePath: '/overview',
        });
      }
    }

    for (const task of tenantTasks) {
      if (matchesSearchTerms(q, task.title, task.assignedEmployeeName, task.status, task.priority)) {
        hits.push({
          id: `task-${task.id}`,
          entityType: 'task',
          title: task.title,
          subtitle: `Task · ${task.status} · ${task.assignedEmployeeName || 'Unassigned'}`,
          routePath: '/overview',
        });
      }
    }

    for (const log of tenantActivity) {
      if (matchesSearchTerms(q, log.summary, log.action, log.actorLabel, log.module)) {
        hits.push({
          id: `activity-${log.id}`,
          entityType: 'activity',
          title: log.summary,
          subtitle: `Audit · ${log.module} · ${log.actorLabel}`,
          routePath: '/activity',
        });
      }
    }

    res.json({ results: rankSearchResults(q, hits, 15) });
  } catch (error) {
    console.error('Global search failed:', error);
    res.status(500).json({ error: 'Search failed.' });
  }
});

router.get('/activity', requirePermission('canViewActivityLogs'), async (req: AuthRequest, res) => {
  try {
    const tenantId = req.authContext!.activeMembership.tenantId;
    const moduleFilter =
      typeof req.query.module === 'string' ? req.query.module.trim() : '';

    const rows = await db
      .select()
      .from(activityLogs)
      .where(
        moduleFilter
          ? and(
              eq(activityLogs.tenantId, tenantId),
              eq(activityLogs.module, moduleFilter)
            )
          : eq(activityLogs.tenantId, tenantId)
      )
      .orderBy(desc(activityLogs.createdAt))
      .limit(150);

    res.json({ logs: rows });
  } catch (error) {
    console.error('Activity logs query failed:', error);
    res.status(500).json({ error: 'Failed to load activity logs.' });
  }
});

router.get('/notifications', requirePermission('canViewWorkspace'), async (req: AuthRequest, res) => {
  try {
    const tenantId = req.authContext!.activeMembership.tenantId;
    const filter = req.query.filter === 'unread' ? 'unread' : 'all';
    const rows = await db
      .select()
      .from(internalNotifications)
      .where(
        filter === 'unread'
          ? and(
              eq(internalNotifications.tenantId, tenantId),
              eq(internalNotifications.read, false)
            )
          : eq(internalNotifications.tenantId, tenantId)
      )
      .orderBy(desc(internalNotifications.createdAt))
      .limit(100);
    res.json({ notifications: rows });
  } catch (error) {
    console.error('Notifications query failed:', error);
    res.status(500).json({ error: 'Failed to load notifications.' });
  }
});

const MarkNotificationReadSchema = z.object({
  notificationId: z.number().int().positive().optional(),
});

router.post('/notifications/mark-read', requirePermission('canViewWorkspace'), async (req: AuthRequest, res) => {
  const parsed = MarkNotificationReadSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid notification read request.' });
    return;
  }

  try {
    const tenantId = req.authContext!.activeMembership.tenantId;
    if (parsed.data.notificationId) {
      await db
        .update(internalNotifications)
        .set({ read: true })
        .where(
          and(
            eq(internalNotifications.id, parsed.data.notificationId),
            eq(internalNotifications.tenantId, tenantId)
          )
        );
    } else {
      await db
        .update(internalNotifications)
        .set({ read: true })
        .where(eq(internalNotifications.tenantId, tenantId));
    }

    const updated = await db
      .select()
      .from(internalNotifications)
      .where(eq(internalNotifications.tenantId, tenantId))
      .orderBy(desc(internalNotifications.createdAt))
      .limit(20);
    res.json({ notifications: updated });
  } catch (error) {
    console.error('Mark notification read failed:', error);
    res.status(500).json({ error: 'Failed to mark notifications read.' });
  }
});

router.get('/leads', requirePermission('canViewTasks'), async (req: AuthRequest, res) => {
  try {
    const tenantId = req.authContext!.activeMembership.tenantId;
    const rows = await db
      .select()
      .from(leadIntakeRecords)
      .where(eq(leadIntakeRecords.tenantId, tenantId))
      .orderBy(desc(leadIntakeRecords.createdAt))
      .limit(50);
    res.json({ leads: rows });
  } catch (error) {
    console.error('Leads query failed:', error);
    res.status(500).json({ error: 'Failed to load lead intake records.' });
  }
});

router.get('/tasks', requirePermission('canViewTasks'), async (req: AuthRequest, res) => {
  try {
    const tenantId = req.authContext!.activeMembership.tenantId;
    const rows = await db
      .select()
      .from(followUpTasks)
      .where(eq(followUpTasks.tenantId, tenantId))
      .orderBy(desc(followUpTasks.createdAt))
      .limit(50);
    res.json({ tasks: rows });
  } catch (error) {
    console.error('Tasks query failed:', error);
    res.status(500).json({ error: 'Failed to load follow-up tasks.' });
  }
});

const TaskStatusSchema = z.object({
  status: z.enum(['pending', 'in_progress', 'completed']),
});

router.patch('/tasks/:id/status', requirePermission('canManageTasks'), async (req: AuthRequest, res) => {
  const taskId = Number(req.params.id);
  const parsed = TaskStatusSchema.safeParse(req.body);
  if (!Number.isInteger(taskId) || !parsed.success) {
    res.status(400).json({ error: 'Invalid task status update.' });
    return;
  }

  try {
    const ctx = req.authContext!;
    const tenantId = ctx.activeMembership.tenantId;

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(followUpTasks)
        .set({ status: parsed.data.status })
        .where(
          and(
            eq(followUpTasks.id, taskId),
            eq(followUpTasks.tenantId, tenantId)
          )
        )
        .returning();

      if (!row) {
        return null;
      }

      await tx.insert(activityLogs).values({
        tenantId,
        actorUid: ctx.user.uid,
        actorLabel: ctx.user.displayName,
        module: 'tasks',
        action: `task.${parsed.data.status}`,
        entityType: 'follow_up_task',
        entityId: String(row.id),
        summary: `Task "${row.title}" updated to ${parsed.data.status}.`,
        metadata: { leadIntakeId: row.leadIntakeId },
      });

      if (parsed.data.status === 'completed') {
        const eventId = buildAutomationEventId(
          'task_completed',
          'follow_up_task',
          row.id
        );
        await enqueueOutboxEvent(
          {
            tenantId,
            eventId,
            schemaVersion: '1.0',
            eventType: 'task_completed',
            aggregateType: 'follow_up_task',
            aggregateId: String(row.id),
            correlationId: randomUUID(),
            payload: {
              sourceEntityType: 'follow_up_task',
              sourceEntityId: row.id,
              actorUid: ctx.user.uid,
              actorLabel: ctx.user.displayName,
              eventPayload: {
                taskId: row.id,
                title: row.title,
                leadIntakeId: row.leadIntakeId,
              },
            },
          },
          tx
        );
      }

      return row;
    });

    if (!updated) {
      res.status(404).json({ error: 'Task not found.' });
      return;
    }

    res.json({ task: updated });
  } catch (error) {
    console.error('Task update failed:', error);
    res.status(500).json({ error: 'Failed to update task status.' });
  }
});

const OrgConfigSchema = z.object({
  departments: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      leadRoleKey: z.enum(['admin', 'manager', 'operator', 'viewer']),
    })
  ),
  roles: z.array(
    z.object({
      key: z.enum(['admin', 'manager', 'operator', 'viewer']),
      label: z.string().min(1),
      canManageForms: z.boolean(),
      canManageAutomations: z.boolean(),
      canManageSettings: z.boolean(),
      canExportSubmissions: z.boolean(),
    })
  ),
  employees: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      email: z.string().email(),
      departmentId: z.string().min(1),
      roleKey: z.enum(['admin', 'manager', 'operator', 'viewer']),
      active: z.boolean(),
    })
  ),
  queues: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      departmentId: z.string().min(1),
      slaMinutes: z.number().int().min(1),
    })
  ),
  workflowStages: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      order: z.number().int().min(1),
      ownerRoleKey: z.enum(['admin', 'manager', 'operator', 'viewer']),
      escalationHours: z.number().int().min(1),
    })
  ),
  assignmentRules: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      productMatch: z.string().min(1),
      targetQueueId: z.string().min(1),
      targetEmployeeId: z.string().min(1),
    })
  ),
});

// --- Dynamic Tenant RBAC Governance Endpoints ---

router.get(
  '/rbac/catalog',
  requirePermission('canViewWorkspace'),
  (_req: AuthRequest, res) => {
    res.json({
      catalog: PERMISSION_CATALOG,
      categories: PERMISSION_CATEGORIES,
      roles: VALID_ROLE_KEYS,
      roleLabels: ROLE_LABELS,
    });
  }
);

router.get(
  '/rbac/matrix',
  requirePermission('canViewWorkspace'),
  async (req: AuthRequest, res) => {
    try {
      const ctx = req.authContext!;
      const tenantId = ctx.activeMembership.tenantId;
      const state = await getTenantRoleMatrix(tenantId);
      res.json({
        tenantId,
        initialized: state.initialized,
        matrix: state.matrix,
        metadata: state.metadata,
        canEdit: hasEffectivePermission(ctx.permissions, 'canManageRoles'),
      });
    } catch (error) {
      console.error('Failed to load RBAC matrix:', error);
      res.status(500).json({ error: 'Failed to load tenant role permission matrix.' });
    }
  }
);

router.get('/rbac/effective', (req: AuthRequest, res) => {
  const ctx = req.authContext!;
  res.json({
    tenantId: ctx.activeMembership.tenantId,
    roleKey: ctx.activeMembership.roleKey,
    permissions: ctx.permissions,
  });
});

router.post(
  '/rbac/validate',
  requirePermission('canManageRoles'),
  async (req: AuthRequest, res) => {
    try {
      const ctx = req.authContext!;
      const tenantId = ctx.activeMembership.tenantId;
      const state = await getTenantRoleMatrix(tenantId);
      if (!state.initialized) {
        res.status(403).json({
          error: 'Tenant role permissions are not initialized; failing closed.',
        });
        return;
      }

      const normalized = normalizeProposedChanges(
        (req.body ?? {}) as
          | { changes: Array<{ roleKey: string; permissionKey: string; enabled: boolean }> }
          | { matrix: Record<string, Record<string, unknown>> },
        state.matrix
      );

      if (!normalized.validFormat) {
        res.status(400).json({
          error: normalized.errors[0] || 'Invalid permission validation payload.',
          details: normalized.errors,
        });
        return;
      }

      const validation = validateRoleMatrixGovernance({
        actorRoleKey: ctx.activeMembership.roleKey,
        actorPermissions: ctx.permissions,
        currentMatrix: state.matrix,
        changes: normalized.changes,
      });

      if (!validation.valid) {
        res.status(validation.statusCode).json({
          error: validation.errors[0] || 'Governance validation failed.',
          details: validation.errors,
        });
        return;
      }

      res.json({
        valid: true,
        diffCount: validation.diffs.length,
        diffs: validation.diffs,
        highRiskChanges: validation.highRiskChanges,
        warnings: validation.warnings,
      });
    } catch (error) {
      console.error('RBAC validation error:', error);
      res.status(500).json({ error: 'Failed to validate permission matrix changes.' });
    }
  }
);

router.put(
  '/rbac/matrix',
  requirePermission('canManageRoles'),
  async (req: AuthRequest, res) => {
    try {
      const ctx = req.authContext!;
      const tenantId = ctx.activeMembership.tenantId;
      const current = await getTenantRoleMatrix(tenantId);

      const normalized = normalizeProposedChanges(
        (req.body ?? {}) as
          | { changes: Array<{ roleKey: string; permissionKey: string; enabled: boolean }> }
          | { matrix: Record<string, Record<string, unknown>> },
        current.matrix
      );

      if (!normalized.validFormat) {
        res.status(400).json({
          error: normalized.errors[0] || 'Invalid permission matrix update payload.',
          details: normalized.errors,
        });
        return;
      }

      const result = await updateTenantRolePermissions({
        tenantId,
        actorUid: ctx.user.uid,
        actorLabel: ctx.user.displayName,
        actorRoleKey: ctx.activeMembership.roleKey,
        actorPermissions: ctx.permissions,
        changes: normalized.changes,
      });

      res.json({
        matrix: result.matrix,
        metadata: result.metadata,
        updatedCount: result.updatedCount,
        diffs: result.diffs,
        highRiskChanges: result.highRiskChanges,
        warnings: result.warnings,
        correlationId: result.correlationId,
      });
    } catch (error) {
      if (error instanceof RbacGovernanceError) {
        res.status(error.statusCode).json({
          error: error.message,
          details: error.details,
        });
        return;
      }
      console.error('Failed to update RBAC matrix:', error);
      res.status(500).json({ error: 'Failed to update role permissions matrix.' });
    }
  }
);

router.put(
  '/settings/org-config',
  requireAnyPermission(['canManageSettings', 'canManageEmployees', 'canManageQueues']),
  async (req: AuthRequest, res) => {
    const parsed = OrgConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid organization configuration payload.' });
      return;
    }

    try {
      const ctx = req.authContext!;
      const tenantId = ctx.activeMembership.tenantId;

      const [existingOrgRows, matrixState] = await Promise.all([
        db
          .select()
          .from(workspaceOrgConfigs)
          .where(eq(workspaceOrgConfigs.tenantId, tenantId))
          .limit(1),
        getTenantRoleMatrix(tenantId),
      ]);

      const existingConfig = existingOrgRows[0]?.config ?? createDefaultOrgConfig();

      const canonicalEqual = (a: unknown, b: unknown): boolean => {
        if (Object.is(a, b)) return true;
        if (typeof a !== typeof b || a === null || b === null) return false;
        if (Array.isArray(a)) {
          if (!Array.isArray(b) || a.length !== b.length) return false;
          return a.every((item, idx) => canonicalEqual(item, b[idx]));
        }
        if (typeof a === 'object') {
          const objA = a as Record<string, unknown>;
          const objB = b as Record<string, unknown>;
          const keysA = Object.keys(objA).filter((k) => objA[k] !== undefined);
          const keysB = Object.keys(objB).filter((k) => objB[k] !== undefined);
          if (keysA.length !== keysB.length) return false;
          return keysA.every(
            (key) =>
              Object.prototype.hasOwnProperty.call(objB, key) &&
              canonicalEqual(objA[key], objB[key])
          );
        }
        return false;
      };

      const employeesChanged = !canonicalEqual(
        parsed.data.employees,
        existingConfig.employees
      );
      const queuesChanged =
        !canonicalEqual(parsed.data.queues, existingConfig.queues) ||
        !canonicalEqual(parsed.data.assignmentRules, existingConfig.assignmentRules);
      const settingsChanged =
        !canonicalEqual(parsed.data.departments, existingConfig.departments) ||
        !canonicalEqual(parsed.data.workflowStages, existingConfig.workflowStages);

      if (
        employeesChanged &&
        !hasEffectivePermission(ctx.permissions, 'canManageEmployees') &&
        !hasEffectivePermission(ctx.permissions, 'canManageSettings')
      ) {
        res.status(403).json({
          error: 'Forbidden: missing "canManageEmployees" permission to modify team members.',
        });
        return;
      }

      if (
        queuesChanged &&
        !hasEffectivePermission(ctx.permissions, 'canManageQueues') &&
        !hasEffectivePermission(ctx.permissions, 'canManageSettings')
      ) {
        res.status(403).json({
          error: 'Forbidden: missing "canManageQueues" permission to modify queues or routing rules.',
        });
        return;
      }

      if (settingsChanged && !hasEffectivePermission(ctx.permissions, 'canManageSettings')) {
        res.status(403).json({
          error: 'Forbidden: missing "canManageSettings" permission to modify departments or workflow stages.',
        });
        return;
      }

      // Role permissions are governed solely by tenant_role_permissions via /api/workspace/rbac/matrix.
      const authoritativeRoles = buildRolesConfigArrayFromMatrix(matrixState.matrix);
      const sanitizedOrgConfig = {
        ...parsed.data,
        roles: authoritativeRoles,
      };

      const [saved] = await db
        .insert(workspaceOrgConfigs)
        .values({
          tenantId,
          config: sanitizedOrgConfig,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: workspaceOrgConfigs.tenantId,
          set: {
            config: sanitizedOrgConfig,
            updatedAt: new Date(),
          },
        })
        .returning();

      await db.insert(activityLogs).values({
        tenantId,
        actorUid: ctx.user.uid,
        actorLabel: ctx.user.displayName,
        module: 'settings',
        action: 'settings.org_config_updated',
        entityType: 'workspace_org_config',
        entityId: String(tenantId),
        summary: 'Updated configurable departments, queues, employees, and workflow stages.',
        metadata: {
          departmentCount: sanitizedOrgConfig.departments.length,
          stageCount: sanitizedOrgConfig.workflowStages.length,
        },
      });

      res.json({ orgConfig: saved!.config });
    } catch (error) {
      console.error('Failed to update org config:', error);
      res.status(500).json({ error: 'Failed to save organization configuration.' });
    }
  }
);

router.get('/preferences', async (req: AuthRequest, res) => {
  const ctx = req.authContext;
  if (!ctx) {
    res.status(401).json({ error: 'Unauthorized.' });
    return;
  }
  try {
    const payload = await activePreferencesService.getUserPreferences(ctx.user);
    res.json(payload);
  } catch (error) {
    console.error('Failed to load user workspace preferences:', error);
    res.status(500).json({ error: 'Failed to load workspace preferences.' });
  }
});

router.put('/preferences', async (req: AuthRequest, res) => {
  const ctx = req.authContext;
  if (!ctx) {
    res.status(401).json({ error: 'Unauthorized.' });
    return;
  }
  try {
    const payload = await activePreferencesService.updateUserPreferences(
      ctx.user,
      req.body
    );
    res.json(payload);
  } catch (error) {
    if (error instanceof PreferencesValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    console.error('Failed to update user workspace preferences:', error);
    res.status(500).json({ error: 'Failed to save workspace preferences.' });
  }
});

// --- Tenant App Management Endpoints (View #44 / WSP-INT-021) ---

router.get(
  '/apps',
  requirePermission('canViewWorkspace'),
  async (req: AuthRequest, res) => {
    try {
      const ctx = req.authContext!;
      const payload = await getTenantAppsState({
        tenantId: ctx.activeMembership.tenantId,
        permissions: ctx.permissions,
      });
      res.json(payload);
    } catch (error) {
      console.error('Failed to load tenant applications:', error);
      res.status(500).json({ error: 'Failed to load tenant applications.' });
    }
  }
);

router.get(
  '/apps/catalog',
  requirePermission('canViewWorkspace'),
  (_req: AuthRequest, res) => {
    res.json(getAppCatalogPayload());
  }
);

const ToggleTenantAppSchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();

router.put(
  '/apps/:appId',
  requirePermission('canManageSettings'),
  async (req: AuthRequest, res) => {
    const appId = String(req.params.appId || '').trim();
    if (!appId || !/^[a-z0-9-]+$/.test(appId)) {
      res.status(400).json({ error: 'Invalid application identifier.' });
      return;
    }

    const parsed = ToggleTenantAppSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid application activation payload. Expected { "enabled": boolean }.',
      });
      return;
    }

    try {
      const ctx = req.authContext!;
      const result = await updateTenantAppActivation({
        tenantId: ctx.activeMembership.tenantId,
        appId,
        enabled: parsed.data.enabled,
        actorUid: ctx.user.uid,
        actorLabel: ctx.user.displayName,
        permissions: ctx.permissions,
      });

      res.json(result);
    } catch (error) {
      if (error instanceof AppManagementError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      console.error('Failed to update tenant app state:', error);
      res.status(500).json({ error: 'Failed to update application state.' });
    }
  }
);

  return router;
}

export default createWorkspaceRouter();
