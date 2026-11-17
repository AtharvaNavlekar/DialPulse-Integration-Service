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
  forms,
  tenantAppInstallations,
  tenantMemberships,
  tenants,
  users,
  workspaceOrgConfigs,
} from '../../db/schema.ts';
import { createDefaultOrgConfig } from '../../shared/defaults.ts';
import type { TenantAppsPayload, WorkspaceSessionPayload } from '../../shared/types.ts';
import { createRequireAuth } from '../middleware/auth.ts';
import { createAutomationsRouter } from '../routes/automations.ts';
import { createFormsRouter } from '../routes/forms.ts';
import publicFormsRouter from '../routes/public-forms.ts';
import { createWorkspaceRouter } from '../routes/workspace.ts';
import {
  clearTenantAppsCache,
  seedTenantAppInstallations,
} from './app-management-service.ts';
import {
  clearTenantRolePermissionsCache,
  seedTenantRolePermissions,
} from './rbac-service.ts';

let server: Server;
let baseUrl = '';

let tenant1Id = 0;
let tenant2Id = 0;
let starterSlug = '';

let adminUser = { id: 0, uid: '', email: '' };
let operatorUser = { id: 0, uid: '', email: '' };
let suspendedUser = { id: 0, uid: '', email: '' };

const tokenToUser = new Map<string, { uid: string; email: string; name: string }>();

test.before(async () => {
  clearTenantRolePermissionsCache();
  clearTenantAppsCache();

  const suffix = randomUUID().slice(0, 8);
  const [t1] = await db
    .insert(tenants)
    .values({
      slug: `test-apps-t1-${suffix}`,
      name: `Apps Test Tenant 1 (${suffix})`,
    })
    .returning();
  const [t2] = await db
    .insert(tenants)
    .values({
      slug: `test-apps-t2-${suffix}`,
      name: `Apps Test Tenant 2 (${suffix})`,
    })
    .returning();

  tenant1Id = t1!.id;
  tenant2Id = t2!.id;

  await db.insert(workspaceOrgConfigs).values([
    { tenantId: tenant1Id, config: createDefaultOrgConfig() },
    { tenantId: tenant2Id, config: createDefaultOrgConfig() },
  ]);

  await Promise.all([
    seedTenantRolePermissions(tenant1Id, 'test:apps-bootstrap'),
    seedTenantRolePermissions(tenant2Id, 'test:apps-bootstrap'),
    seedTenantAppInstallations(tenant1Id, 'test:apps-bootstrap'),
    seedTenantAppInstallations(tenant2Id, 'test:apps-bootstrap'),
  ]);

  const [uAdmin] = await db
    .insert(users)
    .values({
      uid: `test-apps-admin-${suffix}`,
      email: `apps-admin-${suffix}@dialpulse.example`,
      displayName: 'Apps Admin',
      activeTenantId: tenant1Id,
    })
    .returning();
  const [uOp] = await db
    .insert(users)
    .values({
      uid: `test-apps-op-${suffix}`,
      email: `apps-op-${suffix}@dialpulse.example`,
      displayName: 'Apps Operator',
      activeTenantId: tenant1Id,
    })
    .returning();
  const [uSusp] = await db
    .insert(users)
    .values({
      uid: `test-apps-susp-${suffix}`,
      email: `apps-susp-${suffix}@dialpulse.example`,
      displayName: 'Apps Suspended',
      activeTenantId: tenant1Id,
    })
    .returning();

  adminUser = { id: uAdmin!.id, uid: uAdmin!.uid, email: uAdmin!.email };
  operatorUser = { id: uOp!.id, uid: uOp!.uid, email: uOp!.email };
  suspendedUser = { id: uSusp!.id, uid: uSusp!.uid, email: uSusp!.email };

  await db.insert(tenantMemberships).values([
    {
      tenantId: tenant1Id,
      userUid: adminUser.uid,
      roleKey: 'admin',
      departmentName: 'Operations',
      status: 'active',
    },
    {
      tenantId: tenant2Id,
      userUid: adminUser.uid,
      roleKey: 'admin',
      departmentName: 'Operations',
      status: 'active',
    },
    {
      tenantId: tenant1Id,
      userUid: operatorUser.uid,
      roleKey: 'operator',
      departmentName: 'Calling',
      status: 'active',
    },
    {
      tenantId: tenant1Id,
      userUid: suspendedUser.uid,
      roleKey: 'admin',
      departmentName: 'Operations',
      status: 'inactive',
    },
  ]);

  starterSlug = `test-apps-form-${suffix}`;
  await db.insert(forms).values({
    tenantId: tenant1Id,
    slug: starterSlug,
    title: 'Test App Gating Intake Form',
    description: 'Verifies public intake continues independently.',
    category: 'Lead Intake',
    status: 'published',
    fields: [],
    createdByUid: adminUser.uid,
    publishedAt: new Date(),
  });

  tokenToUser.set('token-admin', {
    uid: adminUser.uid,
    email: adminUser.email,
    name: 'Apps Admin',
  });
  tokenToUser.set('token-operator', {
    uid: operatorUser.uid,
    email: operatorUser.email,
    name: 'Apps Operator',
  });
  tokenToUser.set('token-suspended', {
    uid: suspendedUser.uid,
    email: suspendedUser.email,
    name: 'Apps Suspended',
  });

  const testAuth = createRequireAuth({
    verifyIdToken: async (idToken) => {
      const hit = tokenToUser.get(idToken);
      if (!hit) throw new Error('Invalid token');
      return {
        uid: hit.uid,
        email: hit.email,
        name: hit.name,
      } as never;
    },
    ensureMemberships: async (uid) => {
      const userRows = await db
        .select()
        .from(users)
        .where(eq(users.uid, uid))
        .limit(1);
      const user = userRows[0];
      const memberships = await db
        .select({
          tenantId: tenants.id,
          tenantSlug: tenants.slug,
          tenantName: tenants.name,
          industry: tenants.industry,
          roleKey: tenantMemberships.roleKey,
          departmentName: tenantMemberships.departmentName,
        })
        .from(tenantMemberships)
        .innerJoin(tenants, eq(tenantMemberships.tenantId, tenants.id))
        .where(
          and(
            eq(tenantMemberships.userUid, uid),
            eq(tenantMemberships.status, 'active')
          )
        );
      if (!user || memberships.length === 0) {
        const { AuthorizationError } = await import('../middleware/tenant-guard.ts');
        throw new AuthorizationError(403, 'Inactive or missing tenant membership.');
      }
      return {
        user,
        memberships: memberships.map((m) => ({
          ...m,
          roleKey: m.roleKey as 'admin' | 'manager' | 'operator' | 'viewer',
        })),
        activeTenantId: user.activeTenantId || memberships[0]!.tenantId,
      };
    },
  });

  const app = express();
  app.use(express.json());
  app.use('/api/public/forms', publicFormsRouter);
  app.use('/api/workspace', createWorkspaceRouter(testAuth));
  app.use('/api/forms', createFormsRouter(testAuth));
  app.use('/api/automations', createAutomationsRouter(testAuth));

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

test.after(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await db
    .delete(users)
    .where(eq(users.uid, adminUser.uid))
    .catch(() => {});
  await db
    .delete(users)
    .where(eq(users.uid, operatorUser.uid))
    .catch(() => {});
  await db
    .delete(users)
    .where(eq(users.uid, suspendedUser.uid))
    .catch(() => {});
  await db
    .delete(tenants)
    .where(eq(tenants.id, tenant1Id))
    .catch(() => {});
  await db
    .delete(tenants)
    .where(eq(tenants.id, tenant2Id))
    .catch(() => {});
  await closePool();
});

test('auth and RBAC guard GET/PUT /api/workspace/apps endpoints strictly', async () => {
  // Unauthenticated
  const unauthRes = await fetch(`${baseUrl}/api/workspace/apps`);
  assert.equal(unauthRes.status, 401);

  const unauthPut = await fetch(`${baseUrl}/api/workspace/apps/forms-studio`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: false }),
  });
  assert.equal(unauthPut.status, 401);

  // Suspended user fails closed with 403
  const suspRes = await fetch(`${baseUrl}/api/workspace/apps`, {
    headers: { Authorization: 'Bearer token-suspended' },
  });
  assert.equal(suspRes.status, 403);

  // Operator can view apps read-only, canManageApps === false
  const opView = await fetch(`${baseUrl}/api/workspace/apps`, {
    headers: {
      Authorization: 'Bearer token-operator',
      'x-tenant-id': String(tenant1Id),
    },
  });
  assert.equal(opView.status, 200);
  const opPayload = (await opView.json()) as TenantAppsPayload;
  assert.equal(opPayload.canManageApps, false);
  assert.equal(opPayload.apps.length, 10);

  // Operator cannot toggle apps -> 403
  const opToggle = await fetch(`${baseUrl}/api/workspace/apps/forms-studio`, {
    method: 'PUT',
    headers: {
      Authorization: 'Bearer token-operator',
      'x-tenant-id': String(tenant1Id),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ enabled: false }),
  });
  assert.equal(opToggle.status, 403);
});

test('validation rejects unknown app IDs, invalid payloads, and coming_soon/blocked/core activation attempts', async () => {
  const adminHeaders = {
    Authorization: 'Bearer token-admin',
    'x-tenant-id': String(tenant1Id),
    'Content-Type': 'application/json',
  };

  // Unknown app ID -> 404
  const unknownRes = await fetch(`${baseUrl}/api/workspace/apps/does-not-exist`, {
    method: 'PUT',
    headers: adminHeaders,
    body: JSON.stringify({ enabled: true }),
  });
  assert.equal(unknownRes.status, 404);

  // Strict schema rejects extra spoofed keys or non-boolean enabled -> 400
  const spoofedRes = await fetch(`${baseUrl}/api/workspace/apps/forms-studio`, {
    method: 'PUT',
    headers: adminHeaders,
    body: JSON.stringify({ enabled: true, tenantId: tenant2Id }),
  });
  assert.equal(spoofedRes.status, 400);

  // coming_soon cannot be enabled -> 400
  const comingSoonRes = await fetch(
    `${baseUrl}/api/workspace/apps/appointment-scheduler`,
    {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({ enabled: true }),
    }
  );
  assert.equal(comingSoonRes.status, 400);

  // blocked cannot be enabled -> 400
  const blockedRes = await fetch(
    `${baseUrl}/api/workspace/apps/document-workflow`,
    {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({ enabled: true }),
    }
  );
  assert.equal(blockedRes.status, 400);

  // core control plane cannot be disabled -> 400
  const coreRes = await fetch(`${baseUrl}/api/workspace/apps/app-management`, {
    method: 'PUT',
    headers: adminHeaders,
    body: JSON.stringify({ enabled: false }),
  });
  assert.equal(coreRes.status, 400);
});

test('admin toggling persists to PostgreSQL, writes activity_logs, isolates per tenant, enforces /api/forms guard, and preserves public forms & data', async () => {
  const t1Headers = {
    Authorization: 'Bearer token-admin',
    'x-tenant-id': String(tenant1Id),
    'Content-Type': 'application/json',
  };
  const t2Headers = {
    Authorization: 'Bearer token-admin',
    'x-tenant-id': String(tenant2Id),
  };

  // 1. Disable Forms Studio for Tenant 1
  const disableRes = await fetch(`${baseUrl}/api/workspace/apps/forms-studio`, {
    method: 'PUT',
    headers: t1Headers,
    body: JSON.stringify({ enabled: false }),
  });
  assert.equal(disableRes.status, 200);
  const disableJson = (await disableRes.json()) as {
    app: { id: string; enabled: boolean };
    overview: { activeMiniAppsCount: number };
    changed: boolean;
    correlationId: string;
  };
  assert.equal(disableJson.app.id, 'forms-studio');
  assert.equal(disableJson.app.enabled, false);
  assert.equal(disableJson.overview.activeMiniAppsCount, 2);
  assert.equal(disableJson.changed, true);
  assert.ok(disableJson.correlationId.length > 8);

  // 2. Verify PostgreSQL row directly
  const [dbRow] = await db
    .select()
    .from(tenantAppInstallations)
    .where(
      and(
        eq(tenantAppInstallations.tenantId, tenant1Id),
        eq(tenantAppInstallations.appId, 'forms-studio')
      )
    )
    .limit(1);
  assert.equal(dbRow?.enabled, false);
  assert.equal(dbRow?.enabledByUid, adminUser.uid);

  // 3. Verify activity_logs audit trail
  const logs = await db
    .select()
    .from(activityLogs)
    .where(
      and(
        eq(activityLogs.tenantId, tenant1Id),
        eq(activityLogs.module, 'apps'),
        eq(activityLogs.entityId, 'forms-studio')
      )
    )
    .orderBy(desc(activityLogs.id))
    .limit(1);
  assert.equal(logs[0]?.action, 'app.disabled');
  assert.equal(logs[0]?.metadata?.previousEnabled, true);
  assert.equal(logs[0]?.metadata?.nextEnabled, false);

  // 4. Verify workspace /api/forms is blocked (403 APP_DISABLED) for Tenant 1
  const t1FormsRes = await fetch(`${baseUrl}/api/forms`, { headers: t1Headers });
  assert.equal(t1FormsRes.status, 403);
  const t1FormsBody = (await t1FormsRes.json()) as { code?: string };
  assert.equal(t1FormsBody.code, 'APP_DISABLED');

  // 5. Verify Tenant 2 remains enabled (cross-tenant isolation) & /api/forms works on Tenant 2
  const t2AppsRes = await fetch(`${baseUrl}/api/workspace/apps`, {
    headers: t2Headers,
  });
  assert.equal(t2AppsRes.status, 200);
  const t2Apps = (await t2AppsRes.json()) as TenantAppsPayload;
  assert.equal(
    t2Apps.apps.find((a) => a.id === 'forms-studio')?.enabled,
    true
  );
  const t2FormsRes = await fetch(`${baseUrl}/api/forms`, { headers: t2Headers });
  assert.equal(t2FormsRes.status, 200);

  // 6. Verify /api/public/forms/:slug stays open and historical form rows untouched
  const pubRes = await fetch(`${baseUrl}/api/public/forms/${starterSlug}`);
  assert.equal(pubRes.status, 200);

  // 7. Verify Overview & Session payloads dynamically reflect Tenant 1 disabled state
  const overviewRes = await fetch(`${baseUrl}/api/workspace/overview`, {
    headers: t1Headers,
  });
  assert.equal(overviewRes.status, 200);
  const overviewBody = (await overviewRes.json()) as {
    stats: { activeMiniApps: number; totalMiniApps: number };
  };
  assert.equal(overviewBody.stats.activeMiniApps, 2);
  assert.equal(overviewBody.stats.totalMiniApps, 10);

  const sessionRes = await fetch(`${baseUrl}/api/workspace/session`, {
    headers: t1Headers,
  });
  assert.equal(sessionRes.status, 200);
  const sessionBody = (await sessionRes.json()) as WorkspaceSessionPayload;
  assert.equal(
    sessionBody.apps?.find((a) => a.id === 'forms-studio')?.enabled,
    false
  );

  // 8. Re-enable Forms Studio cleanly (including repeated idempotent call)
  const enableRes = await fetch(`${baseUrl}/api/workspace/apps/forms-studio`, {
    method: 'PUT',
    headers: t1Headers,
    body: JSON.stringify({ enabled: true }),
  });
  assert.equal(enableRes.status, 200);

  const idempotentEnable = await fetch(
    `${baseUrl}/api/workspace/apps/forms-studio`,
    {
      method: 'PUT',
      headers: t1Headers,
      body: JSON.stringify({ enabled: true }),
    }
  );
  assert.equal(idempotentEnable.status, 200);
  const idempJson = (await idempotentEnable.json()) as { changed: boolean };
  assert.equal(idempJson.changed, false);

  // 9. Forms route is immediately accessible again & starter form preserved
  const t1FormsRestored = await fetch(`${baseUrl}/api/forms`, {
    headers: t1Headers,
  });
  assert.equal(t1FormsRestored.status, 200);
  const restoredFormsBody = (await t1FormsRestored.json()) as {
    forms: Array<{ slug: string }>;
  };
  assert.ok(restoredFormsBody.forms.some((f) => f.slug === starterSlug));
});
