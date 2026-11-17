import test from 'node:test';
import assert from 'node:assert/strict';
import type { Response, NextFunction } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import {
  createRequireAuth,
  requirePermission,
  type AuthRequest,
} from './auth.ts';
import { AuthorizationError } from './tenant-guard.ts';
import { getRolePermissions } from '../../shared/defaults.ts';

function createMockResponse() {
  const state: { statusCode: number; body: unknown } = {
    statusCode: 200,
    body: null,
  };
  const res = {
    status(code: number) {
      state.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      state.body = payload;
      return res;
    },
  } as unknown as Response;
  return { res, state };
}

function createFakeReq(headers: Record<string, string | undefined>): AuthRequest {
  const normalized: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(headers)) {
    normalized[k.toLowerCase()] = v;
  }
  return {
    headers: normalized,
    header(name: string) {
      return normalized[name.toLowerCase()];
    },
  } as unknown as AuthRequest;
}

const VALID_MEMBERSHIP = {
  tenantId: 10,
  tenantSlug: 'tenant-a',
  tenantName: 'Tenant A',
  industry: 'Loan DSA',
  roleKey: 'operator' as const,
  departmentName: 'Operations',
};

test('rejects missing or empty Bearer token with 401', async () => {
  const middleware = createRequireAuth({
    verifyIdToken: async () => {
      throw new Error('should not be called');
    },
    ensureMemberships: async () => {
      throw new Error('should not be called');
    },
  });

  const { res: res1, state: s1 } = createMockResponse();
  let next1 = false;
  await middleware(createFakeReq({}), res1, (() => { next1 = true; }) as NextFunction);
  assert.equal(next1, false);
  assert.equal(s1.statusCode, 401);

  const { res: res2, state: s2 } = createMockResponse();
  let next2 = false;
  await middleware(
    createFakeReq({ authorization: 'Bearer   ' }),
    res2,
    (() => { next2 = true; }) as NextFunction
  );
  assert.equal(next2, false);
  assert.equal(s2.statusCode, 401);
});

test('rejects expired or invalid Firebase ID token with 401', async () => {
  const middleware = createRequireAuth({
    verifyIdToken: async () => {
      throw new Error('Firebase ID token has expired.');
    },
    ensureMemberships: async () => {
      throw new Error('should not be called');
    },
  });

  const { res, state } = createMockResponse();
  let nextCalled = false;
  await middleware(
    createFakeReq({ authorization: 'Bearer expired.jwt.token' }),
    res,
    (() => { nextCalled = true; }) as NextFunction
  );
  assert.equal(nextCalled, false);
  assert.equal(state.statusCode, 401);
});

test('returns 403 when user has no tenant membership (production fail-closed)', async () => {
  const middleware = createRequireAuth({
    verifyIdToken: async () => ({ uid: 'u-1', email: 'a@b.com' } as DecodedIdToken),
    ensureMemberships: async () => {
      throw new AuthorizationError(403, 'Workspace access denied: no active tenant membership.');
    },
  });

  const { res, state } = createMockResponse();
  let nextCalled = false;
  await middleware(
    createFakeReq({ authorization: 'Bearer valid.token' }),
    res,
    (() => { nextCalled = true; }) as NextFunction
  );
  assert.equal(nextCalled, false);
  assert.equal(state.statusCode, 403);
});

test('rejects cross-tenant x-tenant-id header with 403', async () => {
  const middleware = createRequireAuth({
    verifyIdToken: async () => ({ uid: 'u-1', email: 'a@b.com' } as DecodedIdToken),
    ensureMemberships: async () => ({
      user: {
        id: 1,
        uid: 'u-1',
        email: 'a@b.com',
        displayName: 'Test User',
        activeTenantId: 10,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      memberships: [VALID_MEMBERSHIP],
      activeTenantId: 10,
    }),
  });

  const { res, state } = createMockResponse();
  let nextCalled = false;
  await middleware(
    createFakeReq({ authorization: 'Bearer valid.token', 'x-tenant-id': '999' }),
    res,
    (() => { nextCalled = true; }) as NextFunction
  );
  assert.equal(nextCalled, false);
  assert.equal(state.statusCode, 403);
});

test('requirePermission enforces role capabilities on server and rejects operator/viewer on admin routes', () => {
  const adminGuard = requirePermission('canManageSettings');

  const operatorReq = {
    authContext: {
      activeMembership: { ...VALID_MEMBERSHIP, roleKey: 'operator' },
      permissions: getRolePermissions('operator'),
    },
  } as unknown as AuthRequest;
  const { res: opRes, state: opState } = createMockResponse();
  let opNext = false;
  adminGuard(operatorReq, opRes, (() => { opNext = true; }) as NextFunction);
  assert.equal(opNext, false);
  assert.equal(opState.statusCode, 403);

  const adminReq = {
    authContext: {
      activeMembership: { ...VALID_MEMBERSHIP, roleKey: 'admin' },
      permissions: getRolePermissions('admin'),
    },
  } as unknown as AuthRequest;
  const { res: admRes, state: admState } = createMockResponse();
  let admNext = false;
  adminGuard(adminReq, admRes, (() => { admNext = true; }) as NextFunction);
  assert.equal(admNext, true);
  assert.equal(admState.statusCode, 200);
});
