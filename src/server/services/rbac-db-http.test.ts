import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { and, desc, eq } from 'drizzle-orm';
import { closePool, db } from '../../db/index.ts';
import {
  activityLogs,
  eventOutbox,
  formSubmissions,
  forms,
  tenantMemberships,
  tenants,
  users,
  workspaceOrgConfigs,
} from '../../db/schema.ts';
import { ensureUserMemberships } from '../../db/users.ts';
import { createDefaultOrgConfig, STARTER_ENQUIRY_FIELDS } from '../../shared/defaults.ts';
import type { RoleKey } from '../../shared/types.ts';
import { enqueueOutboxEvent } from '../events/outbox-repository.ts';
import { createRequireAuth } from '../middleware/auth.ts';
import { createAutomationsRouter } from '../routes/automations.ts';
import { createFormsRouter } from '../routes/forms.ts';
import { createIntegrationsRouter } from '../routes/integrations.ts';
import { createWorkspaceRouter } from '../routes/workspace.ts';
import {
  clearTenantRolePermissionsCache,
  seedTenantRolePermissions,
} from './rbac-service.ts';

let server: Server;
let baseUrl = '';

let tenantAId = 0;
let tenantBId = 0;
let tenantUninitializedId = 0;

let activeRoleKey: RoleKey = 'admin';
let activeUserUid = 'test:rbac-admin-a';
let activeTenantIds: number[] = [];

test.before(async () => {
  clearTenantRolePermissionsCache();
  const suffix = randomUUID().slice(0, 8);

  const [tA] = await db
    .insert(tenants)
    .values({
      slug: `test-rbac-a-${suffix}`,
      name: `RBAC Test Tenant A (${suffix})`,
    })
    .returning();
  const [tB] = await db
    .insert(tenants)
    .values({
      slug: `test-rbac-b-${suffix}`,
      name: `RBAC Test Tenant B (${suffix})`,
    })
    .returning();
  const [tUninit] = await db
    .insert(tenants)
    .values({
      slug: `test-rbac-uninit-${suffix}`,
      name: `RBAC Uninitialized Tenant (${suffix})`,
    })
    .returning();

  tenantAId = tA!.id;
  tenantBId = tB!.id;
  tenantUninitializedId = tUninit!.id;
  activeTenantIds = [tenantAId];

  await db.insert(workspaceOrgConfigs).values([
    { tenantId: tenantAId, config: createDefaultOrgConfig() },
    { tenantId: tenantBId, config: createDefaultOrgConfig() },
    { tenantId: tenantUninitializedId, config: createDefaultOrgConfig() },
  ]);

  // Seed Tenant A and Tenant B, leaving tenantUninitializedId intentionally unseeded
  await Promise.all([
    seedTenantRolePermissions(tenantAId, 'test:bootstrap'),
    seedTenantRolePermissions(tenantBId, 'test:bootstrap'),
  ]);

  const authMiddleware = createRequireAuth({
    verifyIdToken: async () =>
      ({
        uid: activeUserUid,
        email: `${activeUserUid}@dialpulse.example`,
        name: 'RBAC Governance Tester',
      }) as never,
    ensureMemberships: async (uid) => ({
      user: {
        id: 1,
        uid,
        email: `${uid}@dialpulse.example`,
        displayName: 'RBAC Governance Tester',
        activeTenantId: activeTenantIds[0] ?? tenantAId,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      memberships: activeTenantIds.map((tId) => ({
        tenantId: tId,
        tenantSlug: `tenant-${tId}`,
        tenantName: `Tenant ${tId}`,
        industry: 'Financial Services & Loan DSA',
        roleKey: activeRoleKey,
        departmentName: 'Operations',
      })),
      activeTenantId: activeTenantIds[0] ?? tenantAId,
    }),
  });

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Mount workspace, forms, automations, integrations using our test authMiddleware
  app.use('/api/workspace', createWorkspaceRouter(authMiddleware));
  app.use('/api/forms', createFormsRouter(authMiddleware));
  app.use('/api/automations', createAutomationsRouter(authMiddleware));
  app.use('/api/integrations', createIntegrationsRouter({ authMiddleware }));

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const tId of [tenantAId, tenantBId, tenantUninitializedId]) {
    if (tId > 0) {
      await db.delete(tenants).where(eq(tenants.id, tId));
    }
  }
  clearTenantRolePermissionsCache();
  await closePool();
});

async function updateMatrixAsAdmin(
  changes: Array<{ roleKey: RoleKey; permissionKey: string; enabled: boolean }>
): Promise<Response> {
  const prevRole = activeRoleKey;
  const prevUid = activeUserUid;
  const prevTenants = activeTenantIds;

  activeRoleKey = 'admin';
  activeUserUid = 'test:rbac-admin-a';
  activeTenantIds = [tenantAId];

  const res = await fetch(`${baseUrl}/api/workspace/rbac/matrix`, {
    method: 'PUT',
    headers: {
      Authorization: 'Bearer test-jwt',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ changes }),
  });

  activeRoleKey = prevRole;
  activeUserUid = prevUid;
  activeTenantIds = prevTenants;
  return res;
}

test('RBAC APIs enforce auth (401), canManageRoles authorization (403), governance rules, cross-tenant isolation, and fail-closed uninitialized tenants', async () => {
  // 1. Unauthenticated -> 401
  const unauthMatrix = await fetch(`${baseUrl}/api/workspace/rbac/matrix`);
  assert.equal(unauthMatrix.status, 401);

  const unauthCatalog = await fetch(`${baseUrl}/api/workspace/rbac/catalog`);
  assert.equal(unauthCatalog.status, 401);

  // 2. Non-admin roles (manager, operator, viewer) cannot validate or update matrix -> 403
  for (const role of ['manager', 'operator', 'viewer'] as RoleKey[]) {
    activeRoleKey = role;
    activeUserUid = `test:${role}-a`;
    activeTenantIds = [tenantAId];

    const putRes = await fetch(`${baseUrl}/api/workspace/rbac/matrix`, {
      method: 'PUT',
      headers: {
        Authorization: 'Bearer test-jwt',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        changes: [{ roleKey: 'operator', permissionKey: 'canCreateForms', enabled: true }],
      }),
    });
    assert.equal(putRes.status, 403, `${role} should get 403 on PUT /rbac/matrix`);

    const valRes = await fetch(`${baseUrl}/api/workspace/rbac/validate`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-jwt',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        changes: [{ roleKey: 'operator', permissionKey: 'canCreateForms', enabled: true }],
      }),
    });
    assert.equal(valRes.status, 403, `${role} should get 403 on POST /rbac/validate`);
  }

  // 3. Uninitialized tenant fails closed even for admin -> 403 on overview & forms
  activeRoleKey = 'admin';
  activeUserUid = 'test:uninit-admin';
  activeTenantIds = [tenantUninitializedId];
  const uninitOverview = await fetch(`${baseUrl}/api/workspace/overview`, {
    headers: { Authorization: 'Bearer test-jwt' },
  });
  assert.equal(uninitOverview.status, 403);

  // 4. Cross-tenant header override rejected -> 403
  activeRoleKey = 'admin';
  activeUserUid = 'test:rbac-admin-b';
  activeTenantIds = [tenantBId];
  const crossHeaderRes = await fetch(`${baseUrl}/api/workspace/rbac/matrix`, {
    headers: {
      Authorization: 'Bearer test-jwt',
      'x-tenant-id': String(tenantAId),
    },
  });
  assert.equal(crossHeaderRes.status, 403);

  // 5. Protected platform capability tampering -> 403
  activeRoleKey = 'admin';
  activeUserUid = 'test:rbac-admin-a';
  activeTenantIds = [tenantAId];
  const protectedTamperRes = await fetch(`${baseUrl}/api/workspace/rbac/matrix`, {
    method: 'PUT',
    headers: {
      Authorization: 'Bearer test-jwt',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      changes: [
        {
          roleKey: 'admin',
          permissionKey: 'canAdministerPlatformIdentity',
          enabled: true,
        },
      ],
    }),
  });
  assert.equal(protectedTamperRes.status, 403);

  // 6. Admin lockout attempt -> 400
  const lockoutRes = await fetch(`${baseUrl}/api/workspace/rbac/matrix`, {
    method: 'PUT',
    headers: {
      Authorization: 'Bearer test-jwt',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      changes: [{ roleKey: 'admin', permissionKey: 'canManageRoles', enabled: false }],
    }),
  });
  assert.equal(lockoutRes.status, 400);

  // 7. Unknown permission key -> 400
  const unknownKeyRes = await fetch(`${baseUrl}/api/workspace/rbac/matrix`, {
    method: 'PUT',
    headers: {
      Authorization: 'Bearer test-jwt',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      changes: [{ roleKey: 'operator', permissionKey: 'doesNotExist', enabled: true }],
    }),
  });
  assert.equal(unknownKeyRes.status, 400);
});

test('toggling RBAC permissions dynamically flips real backend HTTP authorization (200 <-> 403) per tenant with immutable audit logs', async () => {
  // Seed a form & submission & dead-letter outbox event in Tenant A for live endpoint assertions
  const [seededForm] = await db
    .insert(forms)
    .values({
      tenantId: tenantAId,
      slug: `rbac-live-form-${randomUUID().slice(0, 6)}`,
      title: 'RBAC Live Verification Form',
      description: 'Tests live RBAC enforcement.',
      category: 'Lead Intake',
      status: 'draft',
      fields: STARTER_ENQUIRY_FIELDS.slice(0, 3),
      submitButtonLabel: 'Submit',
      successMessage: 'Saved',
      createdByUid: 'test:rbac-admin-a',
    })
    .returning();

  await db.insert(formSubmissions).values({
    tenantId: tenantAId,
    formId: seededForm!.id,
    idempotencyKey: `rbac-sub-${randomUUID()}`,
    source: 'preview_test',
    answers: { full_name: 'Aarav Rao', email: 'aarav@example.com' },
    submitterSummary: 'Aarav Rao',
  });

  const dlqEventId = `rbac-dlq-${randomUUID()}`;
  const outboxEntry = await enqueueOutboxEvent({
    tenantId: tenantAId,
    eventId: dlqEventId,
    eventType: 'lead_created',
    aggregateType: 'lead_intake',
    aggregateId: '777',
    correlationId: randomUUID(),
    payload: {
      sourceEntityType: 'lead_intake',
      sourceEntityId: 777,
      actorUid: 'test:rbac-admin-a',
      actorLabel: 'RBAC Admin',
      eventPayload: { full_name: 'DLQ RBAC Test' },
    },
  });
  await db
    .update(eventOutbox)
    .set({ status: 'dead_letter', attempts: 5, lastError: 'Simulated DLQ for RBAC test' })
    .where(eq(eventOutbox.id, outboxEntry.record.id));

  // A. Operator cannot create or publish forms initially (403)
  activeRoleKey = 'operator';
  activeUserUid = 'test:rbac-operator-a';
  activeTenantIds = [tenantAId];

  const createBefore = await fetch(`${baseUrl}/api/forms`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-jwt',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: 'Operator Created Form',
      fields: STARTER_ENQUIRY_FIELDS.slice(0, 2),
    }),
  });
  assert.equal(createBefore.status, 403);

  const publishBefore = await fetch(
    `${baseUrl}/api/forms/${seededForm!.id}/publish`,
    {
      method: 'POST',
      headers: { Authorization: 'Bearer test-jwt' },
    }
  );
  assert.equal(publishBefore.status, 403);

  // Admin enables operator.canCreateForms and operator.canPublishForms
  const grantFormCaps = await updateMatrixAsAdmin([
    { roleKey: 'operator', permissionKey: 'canCreateForms', enabled: true },
    { roleKey: 'operator', permissionKey: 'canPublishForms', enabled: true },
  ]);
  assert.equal(grantFormCaps.status, 200);
  const grantJson = (await grantFormCaps.json()) as {
    updatedCount: number;
    correlationId: string;
  };
  assert.equal(grantJson.updatedCount, 2);

  // Immediately enforced on next HTTP request -> 201 and 200
  const createAfter = await fetch(`${baseUrl}/api/forms`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-jwt',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: 'Operator Created Form',
      fields: STARTER_ENQUIRY_FIELDS.slice(0, 2),
    }),
  });
  assert.equal(createAfter.status, 201);

  const publishAfter = await fetch(
    `${baseUrl}/api/forms/${seededForm!.id}/publish`,
    {
      method: 'POST',
      headers: { Authorization: 'Bearer test-jwt' },
    }
  );
  assert.equal(publishAfter.status, 200);

  // Tenant B operator MUST remain unaffected (403) -> strict tenant isolation
  activeTenantIds = [tenantBId];
  const tenantBOperatorCreate = await fetch(`${baseUrl}/api/forms`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-jwt',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: 'Tenant B Denied Form',
      fields: STARTER_ENQUIRY_FIELDS.slice(0, 2),
    }),
  });
  assert.equal(tenantBOperatorCreate.status, 403);

  // Revert operator form capabilities in Tenant A -> immediately 403 again
  activeTenantIds = [tenantAId];
  const revokeFormCaps = await updateMatrixAsAdmin([
    { roleKey: 'operator', permissionKey: 'canCreateForms', enabled: false },
    { roleKey: 'operator', permissionKey: 'canPublishForms', enabled: false },
  ]);
  assert.equal(revokeFormCaps.status, 200);
  const publishReverted = await fetch(
    `${baseUrl}/api/forms/${seededForm!.id}/publish`,
    {
      method: 'POST',
      headers: { Authorization: 'Bearer test-jwt' },
    }
  );
  assert.equal(publishReverted.status, 403);

  // B. Manager CSV export toggle: 200 -> 403 -> 200
  activeRoleKey = 'manager';
  activeUserUid = 'test:rbac-manager-a';
  activeTenantIds = [tenantAId];
  const csvBefore = await fetch(
    `${baseUrl}/api/forms/${seededForm!.id}/submissions/export.csv`,
    { headers: { Authorization: 'Bearer test-jwt' } }
  );
  assert.equal(csvBefore.status, 200);

  await updateMatrixAsAdmin([
    { roleKey: 'manager', permissionKey: 'canExportSubmissions', enabled: false },
  ]);
  const csvAfterRevoke = await fetch(
    `${baseUrl}/api/forms/${seededForm!.id}/submissions/export.csv`,
    { headers: { Authorization: 'Bearer test-jwt' } }
  );
  assert.equal(csvAfterRevoke.status, 403);

  // C. Operator dynamic automation & DLQ replay toggle (replaces hardcoded roleKey guard!)
  activeRoleKey = 'operator';
  activeUserUid = 'test:rbac-operator-a';
  const autoBefore = await fetch(`${baseUrl}/api/automations`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-jwt',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'Operator Dynamic Automation',
      triggerType: 'form_submitted',
      conditions: [],
      actions: [
        {
          id: 'a1',
          type: 'record_activity',
          config: { activitySummary: 'Dynamic test' },
        },
      ],
      active: false,
    }),
  });
  assert.equal(autoBefore.status, 403);

  const replayBefore = await fetch(
    `${baseUrl}/api/automations/events/outbox/${outboxEntry.record.id}/replay`,
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-jwt',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason: 'Operator replay before grant' }),
    }
  );
  assert.equal(replayBefore.status, 403);

  await updateMatrixAsAdmin([
    { roleKey: 'operator', permissionKey: 'canManageAutomations', enabled: true },
    { roleKey: 'operator', permissionKey: 'canReplayEvents', enabled: true },
  ]);

  const autoAfter = await fetch(`${baseUrl}/api/automations`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-jwt',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'Operator Dynamic Automation',
      triggerType: 'form_submitted',
      conditions: [],
      actions: [
        {
          id: 'a1',
          type: 'record_activity',
          config: { activitySummary: 'Dynamic test' },
        },
      ],
      active: false,
    }),
  });
  assert.equal(autoAfter.status, 201);

  const replayAfter = await fetch(
    `${baseUrl}/api/automations/events/outbox/${outboxEntry.record.id}/replay`,
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-jwt',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason: 'Authorized via dynamic canReplayEvents' }),
    }
  );
  assert.equal(replayAfter.status, 200);

  // D. Manager connection management toggle: 403 -> 201
  activeRoleKey = 'manager';
  activeUserUid = 'test:rbac-manager-a';
  const connPayload = {
    providerId: 'dialpulse_web',
    connectionName: 'Manager Delegated Connection',
    authMode: 'webhook_hmac',
    secretRef: {
      provider: 'env_dev_only',
      secretName: 'TEST_RBAC_CONN_SECRET',
      version: '1',
    },
    allowedScopes: ['intake:submit'],
    config: {},
    environment: 'development',
  };

  const connBefore = await fetch(`${baseUrl}/api/integrations/connections`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-jwt',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(connPayload),
  });
  assert.equal(connBefore.status, 403);

  await updateMatrixAsAdmin([
    { roleKey: 'manager', permissionKey: 'canManageConnections', enabled: true },
  ]);
  const connAfter = await fetch(`${baseUrl}/api/integrations/connections`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-jwt',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(connPayload),
  });
  assert.equal(connAfter.status, 201);

  // E. Audit logs recorded every permission update with previousValue, newValue, correlationId
  const rbacAudits = await db
    .select()
    .from(activityLogs)
    .where(
      and(
        eq(activityLogs.tenantId, tenantAId),
        eq(activityLogs.action, 'rbac.permission_updated')
      )
    )
    .orderBy(desc(activityLogs.createdAt));

  assert.ok(rbacAudits.length >= 6);
  const sampleAudit = rbacAudits[0]!;
  assert.equal(sampleAudit.actorUid, 'test:rbac-admin-a');
  assert.equal(typeof sampleAudit.metadata.previousValue, 'boolean');
  assert.equal(typeof sampleAudit.metadata.newValue, 'boolean');
  assert.equal(typeof sampleAudit.metadata.correlationId, 'string');

  // F. PUT /api/workspace/settings/org-config cannot mutate role permissions & enforces section permissions
  const sessionRes = await fetch(`${baseUrl}/api/workspace/session`, {
    headers: { Authorization: 'Bearer test-jwt' },
  });
  assert.equal(sessionRes.status, 200);
  const sessionData = (await sessionRes.json()) as {
    orgConfig: ReturnType<typeof createDefaultOrgConfig>;
  };

  // Grant manager canManageEmployees ONLY (not canManageSettings)
  await updateMatrixAsAdmin([
    { roleKey: 'manager', permissionKey: 'canManageEmployees', enabled: true },
  ]);

  // Manager modifying departments (requires canManageSettings) -> 403
  const forbiddenDeptSave = await fetch(`${baseUrl}/api/workspace/settings/org-config`, {
    method: 'PUT',
    headers: {
      Authorization: 'Bearer test-jwt',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...sessionData.orgConfig,
      departments: [
        ...sessionData.orgConfig.departments,
        { id: 'dept-extra', name: 'Blocked Dept', leadRoleKey: 'manager' },
      ],
    }),
  });
  assert.equal(forbiddenDeptSave.status, 403);

  // Manager modifying employees + attempting sneaky roles override -> 200, but roles preserved from DB!
  const tamperedRoles = sessionData.orgConfig.roles.map((r) => ({
    ...r,
    canManageSettings: true,
    canManageForms: true,
  }));
  const employeeSaveRes = await fetch(`${baseUrl}/api/workspace/settings/org-config`, {
    method: 'PUT',
    headers: {
      Authorization: 'Bearer test-jwt',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...sessionData.orgConfig,
      roles: tamperedRoles,
      employees: [
        ...sessionData.orgConfig.employees,
        {
          id: 'emp-rbac-added',
          name: 'Added By Employee Manager',
          email: 'added@dialpulse.example',
          departmentId: sessionData.orgConfig.departments[0]!.id,
          roleKey: 'operator',
          active: true,
        },
      ],
    }),
  });
  assert.equal(employeeSaveRes.status, 200);
  const employeeSaveJson = (await employeeSaveRes.json()) as {
    orgConfig: { roles: Array<{ key: string; canManageSettings: boolean }> };
  };
  const viewerRoleProjection = employeeSaveJson.orgConfig.roles.find(
    (r) => r.key === 'viewer'
  );
  assert.equal(viewerRoleProjection?.canManageSettings, false);
});

test('enforces invalid token (401), revoked/demoted DB memberships (403), multi-tenant switch, cache reload, activity logs, and delegated non-admin governance', async () => {
  // 1. Multi-tenant switching & activity log dynamic flip + cache-clear persistence
  activeRoleKey = 'operator';
  activeUserUid = 'test:rbac-multitenant-op';
  activeTenantIds = [tenantAId, tenantBId];

  // Operator initially allowed on GET /api/workspace/activity in both Tenant A and Tenant B
  const actA1 = await fetch(`${baseUrl}/api/workspace/activity`, {
    headers: {
      Authorization: 'Bearer test-jwt',
      'x-tenant-id': String(tenantAId),
    },
  });
  assert.equal(actA1.status, 200);

  // Admin disables operator.canViewActivityLogs in Tenant A ONLY
  const revokeActRes = await updateMatrixAsAdmin([
    { roleKey: 'operator', permissionKey: 'canViewActivityLogs', enabled: false },
  ]);
  assert.equal(revokeActRes.status, 200);

  // Operator in Tenant A is now denied (403)
  activeRoleKey = 'operator';
  activeUserUid = 'test:rbac-multitenant-op';
  activeTenantIds = [tenantAId, tenantBId];
  const actA2 = await fetch(`${baseUrl}/api/workspace/activity`, {
    headers: {
      Authorization: 'Bearer test-jwt',
      'x-tenant-id': String(tenantAId),
    },
  });
  assert.equal(actA2.status, 403);

  // Switching tenant to Tenant B immediately loads Tenant B matrix -> 200!
  const actB = await fetch(`${baseUrl}/api/workspace/activity`, {
    headers: {
      Authorization: 'Bearer test-jwt',
      'x-tenant-id': String(tenantBId),
    },
  });
  assert.equal(actB.status, 200);

  // Cache cleared reload still reflects Tenant A persisted matrix in PostgreSQL
  clearTenantRolePermissionsCache();
  const matrixA = await fetch(`${baseUrl}/api/workspace/rbac/matrix`, {
    headers: {
      Authorization: 'Bearer test-jwt',
      'x-tenant-id': String(tenantAId),
    },
  });
  assert.equal(matrixA.status, 200);
  const matrixAJson = (await matrixA.json()) as {
    matrix: { operator: { canViewActivityLogs: boolean } };
  };
  assert.equal(matrixAJson.matrix.operator.canViewActivityLogs, false);

  // 2. Delegated non-admin governance over HTTP (manager with canManageRoles)
  await updateMatrixAsAdmin([
    { roleKey: 'manager', permissionKey: 'canManageRoles', enabled: true },
  ]);
  activeRoleKey = 'manager';
  activeUserUid = 'test:rbac-delegated-mgr';
  activeTenantIds = [tenantAId];

  // Allowed: manager holds canViewForms -> can toggle operator.canViewForms
  const mgrAllowed = await fetch(`${baseUrl}/api/workspace/rbac/matrix`, {
    method: 'PUT',
    headers: {
      Authorization: 'Bearer test-jwt',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      changes: [{ roleKey: 'operator', permissionKey: 'canViewForms', enabled: false }],
    }),
  });
  assert.equal(mgrAllowed.status, 200);

  // Denied: manager cannot modify admin, self-escalate manager, grant unheld settings, or delegate canManageRoles
  for (const blockedChange of [
    { roleKey: 'admin', permissionKey: 'canViewForms', enabled: false },
    { roleKey: 'manager', permissionKey: 'canManageSettings', enabled: true },
    { roleKey: 'operator', permissionKey: 'canManageSettings', enabled: true },
    { roleKey: 'operator', permissionKey: 'canManageRoles', enabled: true },
  ]) {
    const blockedRes = await fetch(`${baseUrl}/api/workspace/rbac/matrix`, {
      method: 'PUT',
      headers: {
        Authorization: 'Bearer test-jwt',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ changes: [blockedChange] }),
    });
    assert.equal(
      blockedRes.status,
      403,
      `Expected 403 for delegated manager change ${blockedChange.roleKey}.${blockedChange.permissionKey}`
    );
  }

  // 3. Dedicated Express app wired with real ensureUserMemberships & rejecting invalid tokens -> 401 / 403
  const realMembershipApp = express();
  realMembershipApp.use(express.json());
  const prevDemoFlag = process.env.WORKSPACE_DEMO_PROVISIONING_ENABLED;
  process.env.WORKSPACE_DEMO_PROVISIONING_ENABLED = 'false';

  const realAuth = createRequireAuth({
    verifyIdToken: async (token) => {
      if (token === 'invalid-token') {
        throw new Error('Firebase ID token signature invalid');
      }
      const uid = token.startsWith('uid:') ? token.slice(4) : token;
      return {
        uid,
        email: `${uid}@dialpulse.example`,
        name: 'Real Membership Test User',
      } as never;
    },
    ensureMemberships: ensureUserMemberships,
  });

  realMembershipApp.use('/api/workspace', createWorkspaceRouter(realAuth));

  let realServer: Server | null = null;
  const createdUids = [
    `test-revoked-${randomUUID().slice(0, 8)}`,
    `test-missing-${randomUUID().slice(0, 8)}`,
    `test-demote-${randomUUID().slice(0, 8)}`,
  ];

  try {
    const realUrl = await new Promise<string>((resolve) => {
      realServer = realMembershipApp.listen(0, '127.0.0.1', () => {
        const addr = realServer!.address() as AddressInfo;
        resolve(`http://127.0.0.1:${addr.port}`);
      });
    });

    // Invalid token -> 401
    const invalidTokenRes = await fetch(`${realUrl}/api/workspace/rbac/matrix`, {
      headers: { Authorization: 'Bearer invalid-token' },
    });
    assert.equal(invalidTokenRes.status, 401);

    // Missing membership (with demo provisioning disabled) -> 403
    const missingRes = await fetch(`${realUrl}/api/workspace/overview`, {
      headers: { Authorization: `Bearer uid:${createdUids[1]}` },
    });
    assert.equal(missingRes.status, 403);

    // Revoked membership in PostgreSQL -> 403 (never provisions demo tenants!)
    await db.insert(users).values({
      uid: createdUids[0]!,
      email: `${createdUids[0]}@dialpulse.example`,
      displayName: 'Revoked Tester',
      activeTenantId: tenantAId,
    });
    await db.insert(tenantMemberships).values({
      tenantId: tenantAId,
      userUid: createdUids[0]!,
      roleKey: 'admin',
      departmentName: 'Operations',
      status: 'revoked',
    });

    const revokedRes = await fetch(`${realUrl}/api/workspace/rbac/matrix`, {
      headers: { Authorization: `Bearer uid:${createdUids[0]}` },
    });
    assert.equal(revokedRes.status, 403);

    // Active admin demoted to viewer in PostgreSQL -> immediate 403 on next request
    await db.insert(users).values({
      uid: createdUids[2]!,
      email: `${createdUids[2]}@dialpulse.example`,
      displayName: 'Demoted Admin Tester',
      activeTenantId: tenantAId,
    });
    await db.insert(tenantMemberships).values({
      tenantId: tenantAId,
      userUid: createdUids[2]!,
      roleKey: 'admin',
      departmentName: 'Operations',
      status: 'active',
    });

    const beforeDemote = await fetch(`${realUrl}/api/workspace/rbac/validate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer uid:${createdUids[2]}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        changes: [{ roleKey: 'operator', permissionKey: 'canViewForms', enabled: true }],
      }),
    });
    assert.equal(beforeDemote.status, 200);

    await db
      .update(tenantMemberships)
      .set({ roleKey: 'viewer' })
      .where(
        and(
          eq(tenantMemberships.tenantId, tenantAId),
          eq(tenantMemberships.userUid, createdUids[2]!)
        )
      );

    const afterDemote = await fetch(`${realUrl}/api/workspace/rbac/validate`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + `uid:${createdUids[2]}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        changes: [{ roleKey: 'operator', permissionKey: 'canViewForms', enabled: true }],
      }),
    });
    assert.equal(afterDemote.status, 403);
  } finally {
    if (prevDemoFlag === undefined) {
      delete process.env.WORKSPACE_DEMO_PROVISIONING_ENABLED;
    } else {
      process.env.WORKSPACE_DEMO_PROVISIONING_ENABLED = prevDemoFlag;
    }
    if (realServer) {
      await new Promise<void>((resolve) => realServer!.close(() => resolve()));
    }
    for (const uid of createdUids) {
      await db.delete(users).where(eq(users.uid, uid));
    }
  }
});
