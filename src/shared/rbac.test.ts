import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_PERMISSION_KEYS,
  buildDefaultTenantRoleMatrix,
  buildRoleConfigFromCapabilities,
  CONFIGURABLE_PERMISSION_KEYS,
  createFailClosedCapabilities,
  createFailClosedRoleConfig,
  getDefaultCapabilitiesForRole,
  hasAnyEffectivePermission,
  hasEffectivePermission,
  normalizeProposedChanges,
  PERMISSION_CATALOG,
  PROTECTED_PERMISSION_KEYS,
  validateRoleMatrixGovernance,
} from './rbac.ts';

test('permission catalog covers 29 unique keys and marks protected platform capabilities non-configurable', () => {
  assert.equal(ALL_PERMISSION_KEYS.length, 29);
  assert.equal(new Set(ALL_PERMISSION_KEYS).size, 29);
  assert.equal(CONFIGURABLE_PERMISSION_KEYS.length, 26);
  assert.deepEqual([...PROTECTED_PERMISSION_KEYS].sort(), [
    'canAccessCentralCrmAdmin',
    'canAdministerPlatformIdentity',
    'canManageAllTenants',
  ]);

  const adminCaps = getDefaultCapabilitiesForRole('admin');
  const managerCaps = getDefaultCapabilitiesForRole('manager');
  const operatorCaps = getDefaultCapabilitiesForRole('operator');
  const viewerCaps = getDefaultCapabilitiesForRole('viewer');

  for (const key of PROTECTED_PERMISSION_KEYS) {
    assert.equal(adminCaps[key], false);
    assert.equal(managerCaps[key], false);
    assert.equal(operatorCaps[key], false);
    assert.equal(viewerCaps[key], false);
  }

  assert.equal(adminCaps.canManageRoles, true);
  assert.equal(managerCaps.canManageRoles, false);
  assert.equal(managerCaps.canManageConnections, false);
  assert.equal(operatorCaps.canManageTasks, true);
  assert.equal(operatorCaps.canPublishForms, false);
  assert.equal(viewerCaps.canManageTasks, false);
  assert.equal(viewerCaps.canViewWorkspace, true);
});

test('fail-closed helpers deny every capability and protect platform identity keys', () => {
  const closed = createFailClosedCapabilities();
  for (const key of ALL_PERMISSION_KEYS) {
    assert.equal(closed[key], false);
  }

  const closedConfig = createFailClosedRoleConfig('admin');
  assert.equal(hasEffectivePermission(closedConfig, 'canViewWorkspace'), false);
  assert.equal(hasEffectivePermission(closedConfig, 'canManageRoles'), false);
  assert.equal(
    hasAnyEffectivePermission(closedConfig, ['canManageForms', 'canManageSettings']),
    false
  );

  // Even if rawCapabilities attempts to pass protected keys as true, builder forces false
  const tamperedConfig = buildRoleConfigFromCapabilities('admin', {
    ...getDefaultCapabilitiesForRole('admin'),
    canAdministerPlatformIdentity: true,
    canManageAllTenants: true,
    canAccessCentralCrmAdmin: true,
  });
  assert.equal(tamperedConfig.capabilities?.canAdministerPlatformIdentity, false);
  assert.equal(hasEffectivePermission(tamperedConfig, 'canAdministerPlatformIdentity'), false);
});

test('validateRoleMatrixGovernance blocks protected modifications, admin lockout, and non-admin self-escalation', () => {
  const currentMatrix = buildDefaultTenantRoleMatrix();
  const adminPerms = buildRoleConfigFromCapabilities('admin', currentMatrix.admin);

  // 1. Admin lockout attempt -> 400
  const lockoutResult = validateRoleMatrixGovernance({
    actorRoleKey: 'admin',
    actorPermissions: adminPerms,
    currentMatrix,
    changes: [{ roleKey: 'admin', permissionKey: 'canManageRoles', enabled: false }],
  });
  assert.equal(lockoutResult.valid, false);
  assert.equal(lockoutResult.statusCode, 400);

  // 2. Protected key enable attempt -> 403
  const protectedResult = validateRoleMatrixGovernance({
    actorRoleKey: 'admin',
    actorPermissions: adminPerms,
    currentMatrix,
    changes: [
      {
        roleKey: 'admin',
        permissionKey: 'canAdministerPlatformIdentity',
        enabled: true,
      },
    ],
  });
  assert.equal(protectedResult.valid, false);
  assert.equal(protectedResult.statusCode, 403);

  // 3. Unknown role or permission -> 400
  const unknownPerm = validateRoleMatrixGovernance({
    actorRoleKey: 'admin',
    actorPermissions: adminPerms,
    currentMatrix,
    changes: [{ roleKey: 'operator', permissionKey: 'nonExistentPerm', enabled: true }],
  });
  assert.equal(unknownPerm.valid, false);
  assert.equal(unknownPerm.statusCode, 400);

  // 4. Manager without canManageRoles -> 403
  const managerPermsNoRoles = buildRoleConfigFromCapabilities(
    'manager',
    currentMatrix.manager
  );
  const noPermResult = validateRoleMatrixGovernance({
    actorRoleKey: 'manager',
    actorPermissions: managerPermsNoRoles,
    currentMatrix,
    changes: [{ roleKey: 'operator', permissionKey: 'canCreateForms', enabled: true }],
  });
  assert.equal(noPermResult.valid, false);
  assert.equal(noPermResult.statusCode, 403);

  // 5. Delegated manager WITH canManageRoles still cannot self-escalate or modify admin
  const delegatedMgrPerms = buildRoleConfigFromCapabilities('manager', {
    ...currentMatrix.manager,
    canManageRoles: true,
  });
  const selfEscalation = validateRoleMatrixGovernance({
    actorRoleKey: 'manager',
    actorPermissions: delegatedMgrPerms,
    currentMatrix,
    changes: [{ roleKey: 'manager', permissionKey: 'canManageConnections', enabled: true }],
  });
  assert.equal(selfEscalation.valid, false);
  assert.equal(selfEscalation.statusCode, 403);

  const escalateOtherBeyondSelf = validateRoleMatrixGovernance({
    actorRoleKey: 'manager',
    actorPermissions: delegatedMgrPerms,
    currentMatrix,
    changes: [{ roleKey: 'operator', permissionKey: 'canManageConnections', enabled: true }],
  });
  assert.equal(escalateOtherBeyondSelf.valid, false);
  assert.equal(escalateOtherBeyondSelf.statusCode, 403);

  // 6. Valid admin change produces diffs, highRiskChanges, and viewer warnings
  const validResult = validateRoleMatrixGovernance({
    actorRoleKey: 'admin',
    actorPermissions: adminPerms,
    currentMatrix,
    changes: [
      { roleKey: 'operator', permissionKey: 'canPublishForms', enabled: true },
      { roleKey: 'viewer', permissionKey: 'canExportSubmissions', enabled: true },
    ],
  });
  assert.equal(validResult.valid, true);
  assert.equal(validResult.diffs.length, 2);
  assert.equal(validResult.highRiskChanges.length, 2);
  assert.equal(validResult.warnings.length, 1);
  assert.equal(validResult.nextMatrix.operator.canPublishForms, true);
  assert.equal(validResult.nextMatrix.viewer.canExportSubmissions, true);
});

test('normalizeProposedChanges accepts both delta changes array and matrix object cleanly', () => {
  const baseline = buildDefaultTenantRoleMatrix();
  const deltaNormalized = normalizeProposedChanges(
    {
      changes: [{ roleKey: 'operator', permissionKey: 'canCreateForms', enabled: true }],
    },
    baseline
  );
  assert.equal(deltaNormalized.validFormat, true);
  assert.equal(deltaNormalized.changes.length, 1);

  const nextMatrix = structuredClone(baseline);
  nextMatrix.operator.canCreateForms = true;
  const matrixNormalized = normalizeProposedChanges({ matrix: nextMatrix }, baseline);
  assert.equal(matrixNormalized.validFormat, true);
  assert.equal(matrixNormalized.changes.length, 1);
  assert.equal(matrixNormalized.changes[0]?.permissionKey, 'canCreateForms');

  assert.equal(PERMISSION_CATALOG.length, 29);
});
