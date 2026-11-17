import type { Request, Response, NextFunction } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { adminAuth } from '../../lib/firebase-admin.ts';
import { ensureUserMemberships } from '../../db/users.ts';
import {
  AuthorizationError,
  resolveVerifiedTenantMembership,
} from './tenant-guard.ts';
import {
  createFailClosedRoleConfig,
  hasAnyEffectivePermission,
  hasEffectivePermission,
} from '../../shared/rbac.ts';
import { resolveTenantRolePermissionsForRequest } from '../services/rbac-service.ts';
import type {
  PermissionKey,
  RoleConfig,
  RoleKey,
  TenantMembershipSummary,
} from '../../shared/types.ts';

export interface AuthContext {
  token: DecodedIdToken;
  user: {
    id: number;
    uid: string;
    email: string;
    displayName: string;
  };
  activeMembership: TenantMembershipSummary;
  memberships: TenantMembershipSummary[];
  permissions: RoleConfig;
}

export interface AuthRequest extends Request {
  authContext?: AuthContext;
}

export interface RequireAuthDeps {
  verifyIdToken: (idToken: string) => Promise<DecodedIdToken>;
  ensureMemberships: typeof ensureUserMemberships;
  resolveRolePermissions?: (
    tenantId: number,
    roleKey: RoleKey
  ) => Promise<RoleConfig>;
}

export function createRequireAuth(deps: RequireAuthDeps) {
  const resolvePerms =
    deps.resolveRolePermissions ?? resolveTenantRolePermissionsForRequest;

  return async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Unauthorized: Missing Bearer token.' });
      return;
    }

    const idToken = authHeader.slice('Bearer '.length).trim();
    if (!idToken) {
      res.status(401).json({ error: 'Unauthorized: Empty Bearer token.' });
      return;
    }

    try {
      const decodedToken = await deps.verifyIdToken(idToken);
      const email = decodedToken.email || `${decodedToken.uid}@dialpulse.local`;
      const displayName =
        typeof decodedToken.name === 'string' && decodedToken.name.trim()
          ? decodedToken.name.trim()
          : email.split('@')[0] || 'DialPulse User';

      const { user, memberships, activeTenantId } =
        await deps.ensureMemberships(decodedToken.uid, email, displayName);

      const requestedTenantHeader = req.header('x-tenant-id');
      const { membership } = resolveVerifiedTenantMembership(
        memberships,
        activeTenantId,
        requestedTenantHeader
      );

      let permissions: RoleConfig;
      try {
        permissions = await resolvePerms(membership.tenantId, membership.roleKey);
      } catch (rbacErr) {
        console.error(
          'Authoritative RBAC lookup failed; failing closed:',
          rbacErr instanceof Error ? rbacErr.message : rbacErr
        );
        permissions = createFailClosedRoleConfig(membership.roleKey);
      }

      req.authContext = {
        token: decodedToken,
        user: {
          id: user.id,
          uid: user.uid,
          email: user.email,
          displayName: user.displayName || displayName,
        },
        activeMembership: membership,
        memberships,
        permissions,
      };

      next();
    } catch (error) {
      if (error instanceof AuthorizationError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      console.error('Authentication check failed:', error);
      res.status(401).json({ error: 'Unauthorized: Invalid or expired token.' });
    }
  };
}

export const requireAuth = createRequireAuth({
  verifyIdToken: (token) => adminAuth.verifyIdToken(token),
  ensureMemberships: ensureUserMemberships,
  resolveRolePermissions: resolveTenantRolePermissionsForRequest,
});

export function requirePermission(
  permissionKey: PermissionKey | 'canManageForms'
) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const ctx = req.authContext;
    if (!ctx) {
      res.status(401).json({ error: 'Unauthorized.' });
      return;
    }
    if (!hasEffectivePermission(ctx.permissions, permissionKey)) {
      res.status(403).json({
        error: `Forbidden: role "${ctx.activeMembership.roleKey}" lacks "${permissionKey}".`,
      });
      return;
    }
    next();
  };
}

export function requireAnyPermission(
  permissionKeys: ReadonlyArray<PermissionKey | 'canManageForms'>
) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const ctx = req.authContext;
    if (!ctx) {
      res.status(401).json({ error: 'Unauthorized.' });
      return;
    }
    if (!hasAnyEffectivePermission(ctx.permissions, permissionKeys)) {
      res.status(403).json({
        error: `Forbidden: role "${ctx.activeMembership.roleKey}" lacks required permissions (${permissionKeys.join(' or ')}).`,
      });
      return;
    }
    next();
  };
}
