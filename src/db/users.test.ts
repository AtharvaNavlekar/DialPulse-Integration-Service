import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthorizationError } from '../server/middleware/tenant-guard.ts';
import {
  resolveOrProvisionMemberships,
  type MembershipResolutionDeps,
  type UserRecordSummary,
} from './users.ts';

function buildDeps(
  overrides: Partial<MembershipResolutionDeps<UserRecordSummary>> & {
    onProvisionCalled?: () => void;
  } = {}
): MembershipResolutionDeps<UserRecordSummary> {
  return {
    upsertUser: async (uid, email, displayName) => ({
      uid,
      email,
      displayName: displayName ?? 'Test User',
      activeTenantId: null,
    }),
    findActiveMemberships: async () => [],
    countAllMemberships: async () => 0,
    updateActiveTenant: async () => {},
    provisionDemoTenants: async () => {
      overrides.onProvisionCalled?.();
      return {
        memberships: [
          {
            tenantId: 101,
            tenantSlug: 'dialpulse-dsa-demo',
            tenantName: 'DialPulse Capital DSA (Demo)',
            industry: 'Financial Services & Loan DSA',
            roleKey: 'admin',
            departmentName: 'Backend Operations & Login',
          },
        ],
        activeTenantId: 101,
      };
    },
    ...overrides,
  };
}

test('production with demo flag disabled denies unprovisioned user without creating tenants', async () => {
  let provisioned = false;
  await assert.rejects(
    () =>
      resolveOrProvisionMemberships(
        {
          uid: 'u-prod-1',
          email: 'user@dialpulse.com',
          nodeEnv: 'production',
          demoProvisioningFlag: 'false',
        },
        buildDeps({ onProvisionCalled: () => { provisioned = true; } })
      ),
    (err: unknown) =>
      err instanceof AuthorizationError && err.statusCode === 403
  );
  assert.equal(provisioned, false);
});

test('production with demo flag accidentally enabled still fails closed and creates zero tenants', async () => {
  let provisioned = false;
  await assert.rejects(
    () =>
      resolveOrProvisionMemberships(
        {
          uid: 'u-prod-2',
          email: 'user2@dialpulse.com',
          nodeEnv: 'production',
          demoProvisioningFlag: 'true',
        },
        buildDeps({ onProvisionCalled: () => { provisioned = true; } })
      ),
    (err: unknown) =>
      err instanceof AuthorizationError && err.statusCode === 403
  );
  assert.equal(provisioned, false);
});

test('development with demo flag disabled denies user with no membership', async () => {
  let provisioned = false;
  await assert.rejects(
    () =>
      resolveOrProvisionMemberships(
        {
          uid: 'u-dev-1',
          email: 'dev1@dialpulse.com',
          nodeEnv: 'development',
          demoProvisioningFlag: 'false',
        },
        buildDeps({ onProvisionCalled: () => { provisioned = true; } })
      ),
    (err: unknown) =>
      err instanceof AuthorizationError && err.statusCode === 403
  );
  assert.equal(provisioned, false);
});

test('development with demo flag explicitly enabled provisions demo workspaces', async () => {
  let provisioned = false;
  const result = await resolveOrProvisionMemberships(
    {
      uid: 'u-dev-2',
      email: 'dev2@dialpulse.com',
      nodeEnv: 'development',
      demoProvisioningFlag: 'true',
    },
    buildDeps({ onProvisionCalled: () => { provisioned = true; } })
  );
  assert.equal(provisioned, true);
  assert.equal(result.activeTenantId, 101);
  assert.equal(result.memberships[0]?.roleKey, 'admin');
});

test('existing active membership succeeds in production without touching demo provisioning', async () => {
  let provisioned = false;
  let updatedTenant: number | null = null;
  const result = await resolveOrProvisionMemberships(
    {
      uid: 'u-existing',
      email: 'ops@dialpulse.com',
      nodeEnv: 'production',
      demoProvisioningFlag: 'false',
    },
    buildDeps({
      upsertUser: async (uid, email) => ({
        uid,
        email,
        displayName: 'Existing Ops',
        activeTenantId: 999, // stale active tenant id
      }),
      findActiveMemberships: async () => [
        {
          tenantId: 42,
          tenantSlug: 'dialpulse-prod',
          tenantName: 'DialPulse Capital',
          industry: 'Loan DSA',
          roleKey: 'operator',
          departmentName: 'Calling',
        },
      ],
      updateActiveTenant: async (_uid, tenantId) => {
        updatedTenant = tenantId;
      },
      onProvisionCalled: () => {
        provisioned = true;
      },
    })
  );

  assert.equal(provisioned, false);
  assert.equal(result.activeTenantId, 42);
  assert.equal(updatedTenant, 42);
  assert.equal(result.memberships[0]?.roleKey, 'operator');
});

test('inactive membership is denied even in development with demo flag enabled', async () => {
  let provisioned = false;
  await assert.rejects(
    () =>
      resolveOrProvisionMemberships(
        {
          uid: 'u-inactive',
          email: 'suspended@dialpulse.com',
          nodeEnv: 'development',
          demoProvisioningFlag: 'true',
        },
        buildDeps({
          findActiveMemberships: async () => [],
          countAllMemberships: async () => 1,
          onProvisionCalled: () => {
            provisioned = true;
          },
        })
      ),
    (err: unknown) =>
      err instanceof AuthorizationError &&
      err.statusCode === 403 &&
      /inactive/i.test(err.message)
  );
  assert.equal(provisioned, false);
});
