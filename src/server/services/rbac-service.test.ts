import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDefaultTenantRoleMatrix,
  hasEffectivePermission,
  VALID_ROLE_KEYS,
} from '../../shared/rbac.ts';
import {
  buildMatrixFromStoredRows,
  clearTenantRolePermissionsCache,
  invalidateTenantRolePermissionsCache,
  resolveRolePermissionsWithLoader,
  type StoredRolePermissionRow,
} from './rbac-service.ts';

function matrixToStoredRows(
  matrix = buildDefaultTenantRoleMatrix(),
  updatedByUid = 'test:bootstrap'
): StoredRolePermissionRow[] {
  const rows: StoredRolePermissionRow[] = [];
  const now = new Date('2026-11-16T08:00:00.000Z');
  for (const roleKey of VALID_ROLE_KEYS) {
    for (const [permissionKey, enabled] of Object.entries(matrix[roleKey])) {
      rows.push({
        roleKey,
        permissionKey,
        enabled,
        updatedByUid,
        updatedAt: now,
      });
    }
  }
  return rows;
}

test('resolveRolePermissionsWithLoader fails closed on empty/uninitialized, corrupt, or DB-error responses', async () => {
  clearTenantRolePermissionsCache();

  // 1. Uninitialized tenant (0 rows) -> fails closed
  const emptyResult = await resolveRolePermissionsWithLoader({
    tenantId: 901,
    roleKey: 'admin',
    loadRows: async () => [],
  });
  assert.equal(hasEffectivePermission(emptyResult, 'canViewWorkspace'), false);
  assert.equal(hasEffectivePermission(emptyResult, 'canManageRoles'), false);
  assert.equal(hasEffectivePermission(emptyResult, 'canCreateForms'), false);

  // 2. DB failure -> fails closed without throwing
  const dbErrorResult = await resolveRolePermissionsWithLoader({
    tenantId: 902,
    roleKey: 'admin',
    loadRows: async () => {
      throw new Error('simulated connection timeout');
    },
  });
  assert.equal(hasEffectivePermission(dbErrorResult, 'canViewWorkspace'), false);
  assert.equal(hasEffectivePermission(dbErrorResult, 'canManageSettings'), false);

  // 3. Corrupt roleKey in stored rows -> fails closed
  const corruptResult = await resolveRolePermissionsWithLoader({
    tenantId: 903,
    roleKey: 'manager',
    loadRows: async () => [
      {
        roleKey: 'superadmin_corrupt',
        permissionKey: 'canViewWorkspace',
        enabled: true,
        updatedByUid: 'bad',
        updatedAt: new Date(),
      },
    ],
  });
  assert.equal(hasEffectivePermission(corruptResult, 'canViewWorkspace'), false);
  assert.equal(hasEffectivePermission(corruptResult, 'canManageAutomations'), false);
});

test('buildMatrixFromStoredRows keeps missing permission rows fail-closed and forces protected keys false even if DB row is true', () => {
  const rows: StoredRolePermissionRow[] = [
    {
      roleKey: 'admin',
      permissionKey: 'canViewWorkspace',
      enabled: true,
      updatedByUid: 'test:admin',
      updatedAt: new Date('2026-11-16T09:00:00.000Z'),
    },
    {
      roleKey: 'admin',
      permissionKey: 'canAdministerPlatformIdentity',
      enabled: true, // tampered DB row
      updatedByUid: 'tamper',
      updatedAt: new Date('2026-11-16T09:00:00.000Z'),
    },
  ];

  const built = buildMatrixFromStoredRows(11, rows);
  assert.equal(built.initialized, true);
  assert.equal(built.matrix.admin.canViewWorkspace, true);
  assert.equal(built.matrix.admin.canAdministerPlatformIdentity, false);
  assert.equal(built.matrix.admin.canManageRoles, false);
  assert.equal(built.matrix.manager.canCreateForms, false);
});

test('resolveRolePermissionsWithLoader caches per tenant within TTL and immediately reflects invalidation', async () => {
  clearTenantRolePermissionsCache();
  let dbCalls = 0;
  let operatorCanPublish = false;

  const loadRows = async () => {
    dbCalls += 1;
    const m = buildDefaultTenantRoleMatrix();
    m.operator.canPublishForms = operatorCanPublish;
    return matrixToStoredRows(m);
  };

  const first = await resolveRolePermissionsWithLoader({
    tenantId: 777,
    roleKey: 'operator',
    loadRows,
    nowMs: 1_000,
  });
  assert.equal(dbCalls, 1);
  assert.equal(hasEffectivePermission(first, 'canPublishForms'), false);

  // Within 5s TTL: cached hit
  operatorCanPublish = true;
  const cachedHit = await resolveRolePermissionsWithLoader({
    tenantId: 777,
    roleKey: 'operator',
    loadRows,
    nowMs: 4_000,
  });
  assert.equal(dbCalls, 1);
  assert.equal(hasEffectivePermission(cachedHit, 'canPublishForms'), false);

  // Explicit cache invalidation forces fresh DB read
  invalidateTenantRolePermissionsCache(777);
  const afterInvalidation = await resolveRolePermissionsWithLoader({
    tenantId: 777,
    roleKey: 'operator',
    loadRows,
    nowMs: 4_500,
  });
  assert.equal(dbCalls, 2);
  assert.equal(hasEffectivePermission(afterInvalidation, 'canPublishForms'), true);

  // TTL expiry (> 5s) reloads from DB
  operatorCanPublish = false;
  const afterTtlExpiry = await resolveRolePermissionsWithLoader({
    tenantId: 777,
    roleKey: 'operator',
    loadRows,
    nowMs: 10_000,
  });
  assert.equal(dbCalls, 3);
  assert.equal(hasEffectivePermission(afterTtlExpiry, 'canPublishForms'), false);
});
