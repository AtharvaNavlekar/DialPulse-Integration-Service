import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AuthorizationError,
  resolveVerifiedTenantMembership,
} from './tenant-guard.ts';
import type { TenantMembershipSummary } from '../../shared/types.ts';

const MEMBERSHIPS: TenantMembershipSummary[] = [
  {
    tenantId: 10,
    tenantSlug: 'tenant-a',
    tenantName: 'Tenant A',
    industry: 'Financial Services',
    roleKey: 'admin',
    departmentName: 'Operations',
  },
  {
    tenantId: 20,
    tenantSlug: 'tenant-b',
    tenantName: 'Tenant B',
    industry: 'Financial Services',
    roleKey: 'operator',
    departmentName: 'Calling',
  },
];

test('rejects cross-tenant access when requested tenant ID is not in user memberships', () => {
  assert.throws(
    () => resolveVerifiedTenantMembership(MEMBERSHIPS, 10, '999'),
    (err: unknown) => err instanceof AuthorizationError && err.statusCode === 403
  );
});

test('enforces role-based permissions per verified tenant membership', () => {
  const adminCtx = resolveVerifiedTenantMembership(MEMBERSHIPS, 10, '10');
  assert.equal(adminCtx.membership.tenantId, 10);
  assert.equal(adminCtx.permissions.canManageForms, true);
  assert.equal(adminCtx.permissions.canManageSettings, true);

  const operatorCtx = resolveVerifiedTenantMembership(MEMBERSHIPS, 10, '20');
  assert.equal(operatorCtx.membership.tenantId, 20);
  assert.equal(operatorCtx.permissions.canManageForms, false);
  assert.equal(operatorCtx.permissions.canExportSubmissions, false);
});
