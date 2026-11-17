import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { eq } from 'drizzle-orm';
import { closePool, db } from '../../db/index.ts';
import {
  tenantMemberships,
  tenants,
  userPreferences,
  users,
  workspaceOrgConfigs,
} from '../../db/schema.ts';
import { createDefaultOrgConfig } from '../../shared/defaults.ts';
import { DEFAULT_USER_PREFERENCES } from '../../shared/preferences.ts';
import type { UserPreferencesPayload } from '../../shared/types.ts';
import { createRequireAuth } from '../middleware/auth.ts';
import { createWorkspaceRouter } from '../routes/workspace.ts';
import { createPreferencesService } from './preferences-service.ts';
import {
  clearTenantRolePermissionsCache,
  seedTenantRolePermissions,
} from './rbac-service.ts';

let server: Server;
let baseUrl = '';

let tenant1Id = 0;
let tenant2Id = 0;
let userA = { id: 0, uid: '', email: '' };
let userB = { id: 0, uid: '', email: '' };
let userDeleteCascade = { id: 0, uid: '', email: '' };

test.before(async () => {
  clearTenantRolePermissionsCache();
  const suffix = randomUUID().slice(0, 8);

  const [t1] = await db
    .insert(tenants)
    .values({
      slug: `test-prefs-t1-${suffix}`,
      name: `Prefs Test Tenant 1 (${suffix})`,
    })
    .returning();
  const [t2] = await db
    .insert(tenants)
    .values({
      slug: `test-prefs-t2-${suffix}`,
      name: `Prefs Test Tenant 2 (${suffix})`,
    })
    .returning();

  tenant1Id = t1!.id;
  tenant2Id = t2!.id;

  await db.insert(workspaceOrgConfigs).values([
    { tenantId: tenant1Id, config: createDefaultOrgConfig() },
    { tenantId: tenant2Id, config: createDefaultOrgConfig() },
  ]);
  await Promise.all([
    seedTenantRolePermissions(tenant1Id, 'test:prefs-bootstrap'),
    seedTenantRolePermissions(tenant2Id, 'test:prefs-bootstrap'),
  ]);

  const [uA] = await db
    .insert(users)
    .values({
      uid: `test-prefs-user-a-${suffix}`,
      email: `prefs-a-${suffix}@dialpulse.example`,
      displayName: 'Prefs User A',
      activeTenantId: tenant1Id,
    })
    .returning();
  const [uB] = await db
    .insert(users)
    .values({
      uid: `test-prefs-user-b-${suffix}`,
      email: `prefs-b-${suffix}@dialpulse.example`,
      displayName: 'Prefs User B',
      activeTenantId: tenant1Id,
    })
    .returning();
  const [uDel] = await db
    .insert(users)
    .values({
      uid: `test-prefs-user-del-${suffix}`,
      email: `prefs-del-${suffix}@dialpulse.example`,
      displayName: 'Prefs Cascade User',
      activeTenantId: tenant1Id,
    })
    .returning();

  userA = { id: uA!.id, uid: uA!.uid, email: uA!.email };
  userB = { id: uB!.id, uid: uB!.uid, email: uB!.email };
  userDeleteCascade = { id: uDel!.id, uid: uDel!.uid, email: uDel!.email };

  await db.insert(tenantMemberships).values([
    {
      tenantId: tenant1Id,
      userUid: userA.uid,
      roleKey: 'admin',
      departmentName: 'Operations',
      status: 'active',
    },
    {
      tenantId: tenant2Id,
      userUid: userA.uid,
      roleKey: 'viewer',
      departmentName: 'Operations',
      status: 'active',
    },
    {
      tenantId: tenant1Id,
      userUid: userB.uid,
      roleKey: 'operator',
      departmentName: 'Operations',
      status: 'active',
    },
    {
      tenantId: tenant1Id,
      userUid: userDeleteCascade.uid,
      roleKey: 'viewer',
      departmentName: 'Operations',
      status: 'active',
    },
  ]);

  const userDirectory = new Map<
    string,
    {
      user: typeof users.$inferSelect;
      memberships: Array<{
        tenantId: number;
        tenantSlug: string;
        tenantName: string;
        industry: string;
        roleKey: 'admin' | 'manager' | 'operator' | 'viewer';
        departmentName: string;
      }>;
      activeTenantId: number;
    }
  >([
    [
      userA.uid,
      {
        user: uA!,
        memberships: [
          {
            tenantId: tenant1Id,
            tenantSlug: t1!.slug,
            tenantName: t1!.name,
            industry: t1!.industry,
            roleKey: 'admin',
            departmentName: 'Operations',
          },
          {
            tenantId: tenant2Id,
            tenantSlug: t2!.slug,
            tenantName: t2!.name,
            industry: t2!.industry,
            roleKey: 'viewer',
            departmentName: 'Operations',
          },
        ],
        activeTenantId: tenant1Id,
      },
    ],
    [
      userB.uid,
      {
        user: uB!,
        memberships: [
          {
            tenantId: tenant1Id,
            tenantSlug: t1!.slug,
            tenantName: t1!.name,
            industry: t1!.industry,
            roleKey: 'operator',
            departmentName: 'Operations',
          },
        ],
        activeTenantId: tenant1Id,
      },
    ],
    [
      userDeleteCascade.uid,
      {
        user: uDel!,
        memberships: [
          {
            tenantId: tenant1Id,
            tenantSlug: t1!.slug,
            tenantName: t1!.name,
            industry: t1!.industry,
            roleKey: 'viewer',
            departmentName: 'Operations',
          },
        ],
        activeTenantId: tenant1Id,
      },
    ],
  ]);

  const authMiddleware = createRequireAuth({
    verifyIdToken: async (token) => {
      if (token === 'invalid-jwt') {
        throw new Error('Firebase token invalid');
      }
      if (!userDirectory.has(token)) {
        throw new Error('Unknown test token');
      }
      const entry = userDirectory.get(token)!;
      return {
        uid: entry.user.uid,
        email: entry.user.email,
        name: entry.user.displayName ?? 'Tester',
      } as never;
    },
    ensureMemberships: async (uid) => {
      const entry = userDirectory.get(uid);
      if (!entry) throw new Error(`Missing user ${uid}`);
      return entry;
    },
  });

  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/workspace', createWorkspaceRouter(authMiddleware));

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
  for (const uid of [userA.uid, userB.uid, userDeleteCascade.uid]) {
    if (uid) {
      await db.delete(users).where(eq(users.uid, uid));
    }
  }
  for (const tId of [tenant1Id, tenant2Id]) {
    if (tId > 0) {
      await db.delete(tenants).where(eq(tenants.id, tId));
    }
  }
  clearTenantRolePermissionsCache();
  await closePool();
});

test('Preferences API enforces 401 auth and 400 strict payload validation', async () => {
  const unauthGet = await fetch(`${baseUrl}/api/workspace/preferences`);
  assert.equal(unauthGet.status, 401);

  const unauthPut = await fetch(`${baseUrl}/api/workspace/preferences`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ theme: 'dark' }),
  });
  assert.equal(unauthPut.status, 401);

  const badTokenGet = await fetch(`${baseUrl}/api/workspace/preferences`, {
    headers: { Authorization: 'Bearer invalid-jwt' },
  });
  assert.equal(badTokenGet.status, 401);

  const invalidPayloads = [
    {},
    { theme: 'purple' },
    { density: 'ultra-compact' },
    { dateFormat: 'epoch' },
    { timezone: 'Mars/Olympus' },
    { theme: 'dark', userId: userB.id },
    { density: 'compact', uid: userB.uid },
    { timezone: 'UTC', unknownField: 'nope' },
  ];

  for (const payload of invalidPayloads) {
    const res = await fetch(`${baseUrl}/api/workspace/preferences`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${userA.uid}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    assert.equal(
      res.status,
      400,
      `Expected 400 for invalid payload: ${JSON.stringify(payload)}`
    );
  }
});

test('Preferences persist per user in PostgreSQL across partial merges, reloads, tenant switches, and isolate across users', async () => {
  // 1. User A GET before saving returns defaults without creating a DB row
  const getInitialA = await fetch(`${baseUrl}/api/workspace/preferences`, {
    headers: { Authorization: `Bearer ${userA.uid}` },
  });
  assert.equal(getInitialA.status, 200);
  const initialJsonA = (await getInitialA.json()) as UserPreferencesPayload;
  assert.equal(initialJsonA.persisted, false);
  assert.equal(initialJsonA.updatedAt, null);
  assert.deepEqual(initialJsonA.preferences, DEFAULT_USER_PREFERENCES);

  const rowsBeforeSave = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userA.id));
  assert.equal(rowsBeforeSave.length, 0);

  // 2. User A saves partial patch (theme + timezone)
  const put1 = await fetch(`${baseUrl}/api/workspace/preferences`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${userA.uid}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ theme: 'dark', timezone: 'UTC' }),
  });
  assert.equal(put1.status, 200);
  const put1Json = (await put1.json()) as UserPreferencesPayload;
  assert.equal(put1Json.persisted, true);
  assert.ok(put1Json.updatedAt);
  assert.deepEqual(put1Json.preferences, {
    theme: 'dark',
    density: 'comfortable',
    timezone: 'UTC',
    dateFormat: 'locale',
  });

  // 3. Partial update (density only) preserves existing dark theme and UTC timezone
  const put2 = await fetch(`${baseUrl}/api/workspace/preferences`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${userA.uid}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ density: 'compact' }),
  });
  assert.equal(put2.status, 200);
  const put2Json = (await put2.json()) as UserPreferencesPayload;
  assert.deepEqual(put2Json.preferences, {
    theme: 'dark',
    density: 'compact',
    timezone: 'UTC',
    dateFormat: 'locale',
  });

  // Exact 1 row in PostgreSQL (no duplicates)
  const dbRowsA = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userA.id));
  assert.equal(dbRowsA.length, 1);

  // 4. Reload & tenant switch preserve User A preferences regardless of role (viewer on tenant 2)
  const reloadT2 = await fetch(`${baseUrl}/api/workspace/preferences`, {
    headers: {
      Authorization: `Bearer ${userA.uid}`,
      'x-tenant-id': String(tenant2Id),
    },
  });
  assert.equal(reloadT2.status, 200);
  const reloadT2Json = (await reloadT2.json()) as UserPreferencesPayload;
  assert.equal(reloadT2Json.persisted, true);
  assert.deepEqual(reloadT2Json.preferences, {
    theme: 'dark',
    density: 'compact',
    timezone: 'UTC',
    dateFormat: 'locale',
  });

  // 5. Cross-user isolation: User B gets clean defaults, saves their own settings, User A stays unaffected
  const getInitialB = await fetch(`${baseUrl}/api/workspace/preferences`, {
    headers: { Authorization: `Bearer ${userB.uid}` },
  });
  assert.equal(getInitialB.status, 200);
  const initialJsonB = (await getInitialB.json()) as UserPreferencesPayload;
  assert.equal(initialJsonB.persisted, false);
  assert.deepEqual(initialJsonB.preferences, DEFAULT_USER_PREFERENCES);

  const putB = await fetch(`${baseUrl}/api/workspace/preferences`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${userB.uid}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ dateFormat: 'iso_short', timezone: 'Europe/London' }),
  });
  assert.equal(putB.status, 200);
  const putBJson = (await putB.json()) as UserPreferencesPayload;
  assert.deepEqual(putBJson.preferences, {
    theme: 'light',
    density: 'comfortable',
    timezone: 'Europe/London',
    dateFormat: 'iso_short',
  });

  const recheckA = await fetch(`${baseUrl}/api/workspace/preferences`, {
    headers: { Authorization: `Bearer ${userA.uid}` },
  });
  const recheckAJson = (await recheckA.json()) as UserPreferencesPayload;
  assert.deepEqual(recheckAJson.preferences, {
    theme: 'dark',
    density: 'compact',
    timezone: 'UTC',
    dateFormat: 'locale',
  });

  // 6. FK ON DELETE CASCADE removes preferences when user is deleted
  const putCascade = await fetch(`${baseUrl}/api/workspace/preferences`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${userDeleteCascade.uid}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ theme: 'dark' }),
  });
  assert.equal(putCascade.status, 200);

  await db.delete(users).where(eq(users.id, userDeleteCascade.id));
  const afterCascade = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userDeleteCascade.id));
  assert.equal(afterCascade.length, 0);
});

test('Database errors on preferences endpoints return safe 500 without leaking internals or affecting RBAC', async () => {
  const failingPrefsService = createPreferencesService({
    findUserIdByUid: async () => {
      throw new Error('Simulated DB connection refused at postgres://internal:5432');
    },
    findByUserId: async () => {
      throw new Error('Simulated SQL syntax error SELECT * FROM secret_table');
    },
    upsertByUserId: async () => {
      throw new Error('Simulated disk full writing user_preferences');
    },
  });

  const isolatedAuth = createRequireAuth({
    verifyIdToken: async () =>
      ({
        uid: userA.uid,
        email: userA.email,
        name: 'Prefs User A',
      }) as never,
    ensureMemberships: async () => {
      const [u] = await db.select().from(users).where(eq(users.uid, userA.uid)).limit(1);
      return {
        user: u!,
        memberships: [
          {
            tenantId: tenant1Id,
            tenantSlug: 't1',
            tenantName: 'Tenant 1',
            industry: 'Loan DSA',
            roleKey: 'admin',
            departmentName: 'Operations',
          },
        ],
        activeTenantId: tenant1Id,
      };
    },
  });

  const errorApp = express();
  errorApp.use(express.json());
  errorApp.use(
    '/api/workspace',
    createWorkspaceRouter(isolatedAuth, { preferencesService: failingPrefsService })
  );

  const errServer = await new Promise<Server>((resolve) => {
    const s = errorApp.listen(0, '127.0.0.1', () => resolve(s));
  });

  try {
    const addr = errServer.address() as AddressInfo;
    const errUrl = `http://127.0.0.1:${addr.port}`;

    const errGet = await fetch(`${errUrl}/api/workspace/preferences`, {
      headers: { Authorization: 'Bearer valid-jwt' },
    });
    assert.equal(errGet.status, 500);
    const errGetJson = (await errGet.json()) as { error: string };
    assert.equal(errGetJson.error, 'Failed to load workspace preferences.');
    assert.equal(errGetJson.error.includes('SELECT'), false);

    const errPut = await fetch(`${errUrl}/api/workspace/preferences`, {
      method: 'PUT',
      headers: {
        Authorization: 'Bearer valid-jwt',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ theme: 'dark' }),
    });
    assert.equal(errPut.status, 500);
    const errPutJson = (await errPut.json()) as { error: string };
    assert.equal(errPutJson.error, 'Failed to save workspace preferences.');
    assert.equal(errPutJson.error.includes('disk full'), false);

    // RBAC decision endpoint remains completely unaffected -> 200
    const rbacRes = await fetch(`${errUrl}/api/workspace/rbac/effective`, {
      headers: { Authorization: 'Bearer valid-jwt' },
    });
    assert.equal(rbacRes.status, 200);
  } finally {
    await new Promise<void>((resolve) => errServer.close(() => resolve()));
  }
});
