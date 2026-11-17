import type { RoleConfig, TenantMembershipSummary } from '../../shared/types.ts';
import { getRolePermissions } from '../../shared/defaults.ts';

export class AuthorizationError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'AuthorizationError';
  }
}

export function resolveVerifiedTenantMembership(
  memberships: TenantMembershipSummary[],
  defaultTenantId: number,
  requestedTenantHeader?: string
): { membership: TenantMembershipSummary; permissions: RoleConfig } {
  if (memberships.length === 0) {
    throw new AuthorizationError(403, 'User does not belong to any active workspace tenant.');
  }

  let targetTenantId = defaultTenantId;
  if (requestedTenantHeader !== undefined && requestedTenantHeader.trim() !== '') {
    const parsed = Number(requestedTenantHeader);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new AuthorizationError(400, 'Invalid tenant context header.');
    }
    targetTenantId = parsed;
  }

  const membership = memberships.find((m) => m.tenantId === targetTenantId);
  if (!membership) {
    throw new AuthorizationError(
      403,
      'Access denied: you are not a member of the requested tenant.'
    );
  }

  return {
    membership,
    permissions: getRolePermissions(membership.roleKey),
  };
}
