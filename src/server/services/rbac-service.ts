import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
  activityLogs,
  tenantRolePermissions,
  workspaceOrgConfigs,
} from '../../db/schema.ts';
import {
  ALL_PERMISSION_KEYS,
  buildDefaultTenantRoleMatrix,
  buildRoleConfigFromCapabilities,
  createFailClosedCapabilities,
  createFailClosedRoleConfig,
  isProtectedPermission,
  isValidPermissionKey,
  isValidRoleKey,
  PERMISSION_CATALOG,
  type RolePermissionChangeInput,
  type RolePermissionDiff,
  VALID_ROLE_KEYS,
  validateRoleMatrixGovernance,
} from '../../shared/rbac.ts';
import type {
  PermissionKey,
  RoleConfig,
  RoleKey,
  TenantRoleMatrixMetadata,
  TenantRolePermissionMatrix,
} from '../../shared/types.ts';

export interface StoredRolePermissionRow {
  roleKey: string;
  permissionKey: string;
  enabled: boolean;
  updatedByUid: string | null;
  updatedAt: Date;
}

export class RbacGovernanceError extends Error {
  readonly statusCode: number;
  readonly details: string[];

  constructor(statusCode: number, message: string, details: string[] = [message]) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.name = 'RbacGovernanceError';
  }
}

const MAX_TENANT_CACHE_ENTRIES = 200;
const CACHE_TTL_MS = 5_000;

interface CachedTenantMatrix {
  matrix: TenantRolePermissionMatrix;
  metadata: TenantRoleMatrixMetadata;
  expiresAt: number;
}

const tenantMatrixCache = new Map<number, CachedTenantMatrix>();

export function invalidateTenantRolePermissionsCache(tenantId: number): void {
  tenantMatrixCache.delete(tenantId);
}

export function clearTenantRolePermissionsCache(): void {
  tenantMatrixCache.clear();
}

function setCachedTenantMatrix(
  tenantId: number,
  matrix: TenantRolePermissionMatrix,
  metadata: TenantRoleMatrixMetadata,
  nowMs = Date.now()
): void {
  if (tenantMatrixCache.has(tenantId)) {
    tenantMatrixCache.delete(tenantId);
  } else if (tenantMatrixCache.size >= MAX_TENANT_CACHE_ENTRIES) {
    const oldestKey = tenantMatrixCache.keys().next().value;
    if (oldestKey !== undefined) {
      tenantMatrixCache.delete(oldestKey);
    }
  }
  tenantMatrixCache.set(tenantId, {
    matrix,
    metadata,
    expiresAt: nowMs + CACHE_TTL_MS,
  });
}

function getCachedTenantMatrix(
  tenantId: number,
  nowMs = Date.now()
): CachedTenantMatrix | null {
  const entry = tenantMatrixCache.get(tenantId);
  if (!entry) return null;
  if (entry.expiresAt <= nowMs) {
    tenantMatrixCache.delete(tenantId);
    return null;
  }
  return entry;
}

export function buildMatrixFromStoredRows(
  tenantId: number,
  rows: StoredRolePermissionRow[]
): {
  initialized: boolean;
  matrix: TenantRolePermissionMatrix;
  metadata: TenantRoleMatrixMetadata;
} {
  const failClosedMatrix: TenantRolePermissionMatrix = {
    admin: createFailClosedCapabilities(),
    manager: createFailClosedCapabilities(),
    operator: createFailClosedCapabilities(),
    viewer: createFailClosedCapabilities(),
  };

  if (rows.length === 0) {
    return {
      initialized: false,
      matrix: failClosedMatrix,
      metadata: {
        tenantId,
        lastUpdatedAt: null,
        lastUpdatedByUid: null,
      },
    };
  }

  let latestMs = -1;
  let lastUpdatedByUid: string | null = null;

  for (const row of rows) {
    if (!row || typeof row.enabled !== 'boolean') {
      throw new Error('Corrupt role permission row encountered (non-boolean enabled).');
    }
    if (!isValidRoleKey(row.roleKey)) {
      throw new Error(`Corrupt role permission row encountered (invalid roleKey "${String(row.roleKey)}").`);
    }
    if (row.updatedAt instanceof Date && !Number.isNaN(row.updatedAt.getTime())) {
      const ms = row.updatedAt.getTime();
      if (ms >= latestMs) {
        latestMs = ms;
        lastUpdatedByUid = row.updatedByUid ?? null;
      }
    }
    if (!isValidPermissionKey(row.permissionKey)) {
      continue;
    }
    if (isProtectedPermission(row.permissionKey)) {
      failClosedMatrix[row.roleKey][row.permissionKey] = false;
      continue;
    }
    failClosedMatrix[row.roleKey][row.permissionKey] = row.enabled;
  }

  return {
    initialized: true,
    matrix: failClosedMatrix,
    metadata: {
      tenantId,
      lastUpdatedAt: latestMs >= 0 ? new Date(latestMs).toISOString() : null,
      lastUpdatedByUid,
    },
  };
}

export async function resolveRolePermissionsWithLoader(params: {
  tenantId: number;
  roleKey: RoleKey;
  loadRows: (tenantId: number) => Promise<StoredRolePermissionRow[]>;
  bypassCache?: boolean;
  nowMs?: number;
}): Promise<RoleConfig> {
  const { tenantId, roleKey, loadRows, bypassCache = false, nowMs = Date.now() } = params;

  if (!isValidRoleKey(roleKey)) {
    return createFailClosedRoleConfig('viewer');
  }

  if (!bypassCache) {
    const cached = getCachedTenantMatrix(tenantId, nowMs);
    if (cached) {
      return buildRoleConfigFromCapabilities(roleKey, cached.matrix[roleKey]);
    }
  }

  try {
    const rows = await loadRows(tenantId);
    const parsed = buildMatrixFromStoredRows(tenantId, rows);
    if (!parsed.initialized) {
      // Fail closed when tenant has no initialized role permission rows.
      return createFailClosedRoleConfig(roleKey);
    }
    if (!bypassCache) {
      setCachedTenantMatrix(tenantId, parsed.matrix, parsed.metadata, nowMs);
    }
    return buildRoleConfigFromCapabilities(roleKey, parsed.matrix[roleKey]);
  } catch (error) {
    console.error(
      `RBAC resolution failed closed for tenant=${tenantId} role=${roleKey}:`,
      error instanceof Error ? error.message : error
    );
    return createFailClosedRoleConfig(roleKey);
  }
}

type DbExecutor = Pick<typeof db, 'select' | 'insert' | 'update'>;

async function queryTenantRolePermissionRows(
  tenantId: number,
  executor: DbExecutor = db
): Promise<StoredRolePermissionRow[]> {
  return executor
    .select({
      roleKey: tenantRolePermissions.roleKey,
      permissionKey: tenantRolePermissions.permissionKey,
      enabled: tenantRolePermissions.enabled,
      updatedByUid: tenantRolePermissions.updatedByUid,
      updatedAt: tenantRolePermissions.updatedAt,
    })
    .from(tenantRolePermissions)
    .where(eq(tenantRolePermissions.tenantId, tenantId));
}

export async function resolveTenantRolePermissionsForRequest(
  tenantId: number,
  roleKey: RoleKey,
  options?: { bypassCache?: boolean }
): Promise<RoleConfig> {
  return resolveRolePermissionsWithLoader({
    tenantId,
    roleKey,
    bypassCache: options?.bypassCache,
    loadRows: (id) => queryTenantRolePermissionRows(id, db),
  });
}

export function buildSeedPermissionRowsForTenant(
  tenantId: number,
  updatedByUid = 'system:bootstrap'
): Array<{
  tenantId: number;
  roleKey: RoleKey;
  permissionKey: PermissionKey;
  enabled: boolean;
  updatedByUid: string;
}> {
  const defaultMatrix = buildDefaultTenantRoleMatrix();
  const values: Array<{
    tenantId: number;
    roleKey: RoleKey;
    permissionKey: PermissionKey;
    enabled: boolean;
    updatedByUid: string;
  }> = [];

  for (const roleKey of VALID_ROLE_KEYS) {
    for (const permKey of ALL_PERMISSION_KEYS) {
      values.push({
        tenantId,
        roleKey,
        permissionKey: permKey,
        enabled: isProtectedPermission(permKey)
          ? false
          : defaultMatrix[roleKey][permKey],
        updatedByUid,
      });
    }
  }
  return values;
}

export async function seedTenantRolePermissions(
  tenantId: number,
  actorUid = 'system:bootstrap',
  executor: DbExecutor = db
): Promise<void> {
  const values = buildSeedPermissionRowsForTenant(tenantId, actorUid);
  await executor
    .insert(tenantRolePermissions)
    .values(values)
    .onConflictDoNothing({
      target: [
        tenantRolePermissions.tenantId,
        tenantRolePermissions.roleKey,
        tenantRolePermissions.permissionKey,
      ],
    });
  invalidateTenantRolePermissionsCache(tenantId);
}

export function buildRolesConfigArrayFromMatrix(
  matrix: TenantRolePermissionMatrix
): RoleConfig[] {
  return VALID_ROLE_KEYS.map((roleKey) =>
    buildRoleConfigFromCapabilities(roleKey, matrix[roleKey])
  );
}

export async function getTenantRoleMatrix(tenantId: number): Promise<{
  initialized: boolean;
  matrix: TenantRolePermissionMatrix;
  metadata: TenantRoleMatrixMetadata;
}> {
  const rows = await queryTenantRolePermissionRows(tenantId, db);
  return buildMatrixFromStoredRows(tenantId, rows);
}

export async function updateTenantRolePermissions(params: {
  tenantId: number;
  actorUid: string;
  actorLabel: string;
  actorRoleKey: RoleKey;
  actorPermissions: RoleConfig;
  changes: RolePermissionChangeInput[];
  correlationId?: string;
}): Promise<{
  matrix: TenantRolePermissionMatrix;
  metadata: TenantRoleMatrixMetadata;
  diffs: RolePermissionDiff[];
  highRiskChanges: RolePermissionDiff[];
  warnings: string[];
  updatedCount: number;
  correlationId: string;
}> {
  const correlationId = params.correlationId || randomUUID();

  const txResult = await db.transaction(async (tx) => {
    const existingRows = await queryTenantRolePermissionRows(params.tenantId, tx);
    const currentState = buildMatrixFromStoredRows(params.tenantId, existingRows);

    if (!currentState.initialized) {
      throw new RbacGovernanceError(
        403,
        'Tenant role permissions are not initialized; failing closed.'
      );
    }

    const validation = validateRoleMatrixGovernance({
      actorRoleKey: params.actorRoleKey,
      actorPermissions: params.actorPermissions,
      currentMatrix: currentState.matrix,
      changes: params.changes,
    });

    if (!validation.valid) {
      throw new RbacGovernanceError(
        validation.statusCode,
        validation.errors[0] || 'Permission matrix governance validation failed.',
        validation.errors
      );
    }

    const now = new Date();
    if (validation.diffs.length > 0) {
      await tx
        .insert(tenantRolePermissions)
        .values(
          validation.diffs.map((diff) => ({
            tenantId: params.tenantId,
            roleKey: diff.roleKey,
            permissionKey: diff.permissionKey,
            enabled: isProtectedPermission(diff.permissionKey)
              ? false
              : diff.newValue,
            updatedByUid: params.actorUid,
            updatedAt: now,
          }))
        )
        .onConflictDoUpdate({
          target: [
            tenantRolePermissions.tenantId,
            tenantRolePermissions.roleKey,
            tenantRolePermissions.permissionKey,
          ],
          set: {
            enabled: sql`excluded.enabled`,
            updatedByUid: sql`excluded.updated_by_uid`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
    }

    if (validation.diffs.length > 0) {
      await tx.insert(activityLogs).values(
        validation.diffs.map((diff) => ({
          tenantId: params.tenantId,
          actorUid: params.actorUid,
          actorLabel: params.actorLabel,
          module: 'settings',
          action: 'rbac.permission_updated',
          entityType: 'tenant_role_permission',
          entityId: `${params.tenantId}:${diff.roleKey}:${diff.permissionKey}`,
          summary: `Updated ${diff.roleKey}.${diff.permissionKey} from ${String(
            diff.previousValue
          )} to ${String(diff.newValue)}.`,
          metadata: {
            roleKey: diff.roleKey,
            permissionKey: diff.permissionKey,
            label: diff.label,
            category: diff.category,
            riskLevel: diff.riskLevel,
            previousValue: diff.previousValue,
            newValue: diff.newValue,
            correlationId,
            changeCount: validation.diffs.length,
          },
        }))
      );
    }

    // Keep workspace_org_configs.config.roles synchronized as a read projection
    const existingOrgRows = await tx
      .select()
      .from(workspaceOrgConfigs)
      .where(eq(workspaceOrgConfigs.tenantId, params.tenantId))
      .limit(1);
    if (existingOrgRows[0]) {
      const updatedRoles = buildRolesConfigArrayFromMatrix(validation.nextMatrix);
      await tx
        .update(workspaceOrgConfigs)
        .set({
          config: {
            ...existingOrgRows[0].config,
            roles: updatedRoles,
          },
          updatedAt: now,
        })
        .where(eq(workspaceOrgConfigs.tenantId, params.tenantId));
    }

    return {
      matrix: validation.nextMatrix,
      metadata: {
        tenantId: params.tenantId,
        lastUpdatedAt:
          validation.diffs.length > 0
            ? now.toISOString()
            : currentState.metadata.lastUpdatedAt,
        lastUpdatedByUid:
          validation.diffs.length > 0
            ? params.actorUid
            : currentState.metadata.lastUpdatedByUid,
      },
      diffs: validation.diffs,
      highRiskChanges: validation.highRiskChanges,
      warnings: validation.warnings,
      updatedCount: validation.diffs.length,
      correlationId,
    };
  });

  invalidateTenantRolePermissionsCache(params.tenantId);
  return txResult;
}
