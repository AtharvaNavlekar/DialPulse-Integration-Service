import { randomUUID } from 'node:crypto';
import type { NextFunction, Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { activityLogs, tenantAppInstallations } from '../../db/schema.ts';
import {
  APP_CATEGORIES,
  WORKSPACE_APP_CATALOG,
  computeTenantAppsOverview,
  getAppCatalog,
  getAppCatalogEntry,
  resolveEffectiveTenantApps,
  validateAppToggleRequest,
  type StoredTenantAppRow,
} from '../../shared/app-catalog.ts';
import { hasEffectivePermission } from '../../shared/rbac.ts';
import type {
  RoleConfig,
  TenantAppState,
  TenantAppsOverview,
  TenantAppsPayload,
} from '../../shared/types.ts';
import type { AuthRequest } from '../middleware/auth.ts';

const MAX_TENANT_CACHE_ENTRIES = 200;
const CACHE_TTL_MS = 5000;

interface CachedTenantApps {
  rows: StoredTenantAppRow[];
  expiresAt: number;
}

const tenantAppsCache = new Map<number, CachedTenantApps>();

export class AppManagementError extends Error {
  statusCode: 400 | 403 | 404 | 500;
  constructor(statusCode: 400 | 403 | 404 | 500, message: string) {
    super(message);
    this.name = 'AppManagementError';
    this.statusCode = statusCode;
  }
}

export function clearTenantAppsCache(tenantId?: number): void {
  if (typeof tenantId === 'number') {
    tenantAppsCache.delete(tenantId);
  } else {
    tenantAppsCache.clear();
  }
}

function setCachedTenantRows(tenantId: number, rows: StoredTenantAppRow[]): void {
  if (tenantAppsCache.has(tenantId)) {
    tenantAppsCache.delete(tenantId);
  } else if (tenantAppsCache.size >= MAX_TENANT_CACHE_ENTRIES) {
    const oldestKey = tenantAppsCache.keys().next().value;
    if (oldestKey !== undefined) {
      tenantAppsCache.delete(oldestKey);
    }
  }
  tenantAppsCache.set(tenantId, {
    rows,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

async function getStoredRowsForTenant(
  tenantId: number
): Promise<StoredTenantAppRow[]> {
  const cached = tenantAppsCache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) {
    // refresh LRU order
    tenantAppsCache.delete(tenantId);
    tenantAppsCache.set(tenantId, cached);
    return cached.rows;
  }

  const dbRows = await db
    .select({
      appId: tenantAppInstallations.appId,
      enabled: tenantAppInstallations.enabled,
      enabledByUid: tenantAppInstallations.enabledByUid,
      updatedAt: tenantAppInstallations.updatedAt,
    })
    .from(tenantAppInstallations)
    .where(eq(tenantAppInstallations.tenantId, tenantId));

  const normalized: StoredTenantAppRow[] = dbRows.map((row) => ({
    appId: row.appId,
    enabled: Boolean(row.enabled),
    enabledByUid: row.enabledByUid ?? null,
    updatedAt: row.updatedAt ?? null,
  }));

  setCachedTenantRows(tenantId, normalized);
  return normalized;
}

export async function seedTenantAppInstallations(
  tenantId: number,
  actorUid = 'system:bootstrap'
): Promise<void> {
  const defaultRows = WORKSPACE_APP_CATALOG.filter(
    (entry) => entry.status === 'available' && entry.availableToTenants
  ).map((entry) => ({
    tenantId,
    appId: entry.id,
    enabled: entry.defaultEnabled,
    enabledByUid: actorUid,
  }));

  if (defaultRows.length === 0) return;

  await db
    .insert(tenantAppInstallations)
    .values(defaultRows)
    .onConflictDoNothing({
      target: [tenantAppInstallations.tenantId, tenantAppInstallations.appId],
    });

  clearTenantAppsCache(tenantId);
}

export async function getTenantAppsState(params: {
  tenantId: number;
  permissions?: RoleConfig | null;
}): Promise<TenantAppsPayload> {
  const storedRows = await getStoredRowsForTenant(params.tenantId);
  const canManageApps = hasEffectivePermission(
    params.permissions,
    'canManageSettings'
  );
  const apps = resolveEffectiveTenantApps({
    storedRows,
    permissions: params.permissions,
    canManageApps,
  });
  const overview = computeTenantAppsOverview(apps);

  return {
    tenantId: params.tenantId,
    apps,
    overview,
    categories: [...APP_CATEGORIES],
    canManageApps,
  };
}

export async function isTenantAppEnabled(
  tenantId: number,
  appId: string
): Promise<boolean> {
  const entry = getAppCatalogEntry(appId);
  if (!entry || entry.status !== 'available' || !entry.availableToTenants) {
    return false;
  }
  if (!entry.supportsTenantActivation) {
    return true;
  }
  const storedRows = await getStoredRowsForTenant(tenantId);
  const found = storedRows.find((row) => row.appId === appId);
  if (!found) {
    return entry.defaultEnabled;
  }
  return found.enabled === true;
}

export async function updateTenantAppActivation(params: {
  tenantId: number;
  appId: string;
  enabled: boolean;
  actorUid: string;
  actorLabel: string;
  permissions: RoleConfig | null | undefined;
}): Promise<{
  app: TenantAppState;
  overview: TenantAppsOverview;
  changed: boolean;
  correlationId: string;
}> {
  const canManageApps = hasEffectivePermission(
    params.permissions,
    'canManageSettings'
  );
  const entry = getAppCatalogEntry(params.appId);
  const validation = validateAppToggleRequest({
    entry,
    enabled: params.enabled,
    canManageApps,
  });

  if (!validation.valid || !entry) {
    throw new AppManagementError(
      validation.statusCode === 200 ? 400 : validation.statusCode,
      validation.error || 'Unable to update application activation.'
    );
  }

  const correlationId = randomUUID();
  const now = new Date();

  const txResult = await db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(tenantAppInstallations)
      .where(
        and(
          eq(tenantAppInstallations.tenantId, params.tenantId),
          eq(tenantAppInstallations.appId, entry.id)
        )
      )
      .limit(1);

    const previousEnabled =
      existing[0] !== undefined ? existing[0].enabled === true : entry.defaultEnabled;
    const changed = previousEnabled !== params.enabled || existing.length === 0;

    await tx
      .insert(tenantAppInstallations)
      .values({
        tenantId: params.tenantId,
        appId: entry.id,
        enabled: params.enabled,
        enabledByUid: params.actorUid,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [tenantAppInstallations.tenantId, tenantAppInstallations.appId],
        set: {
          enabled: params.enabled,
          enabledByUid: params.actorUid,
          updatedAt: now,
        },
      });

    await tx.insert(activityLogs).values({
      tenantId: params.tenantId,
      actorUid: params.actorUid,
      actorLabel: params.actorLabel,
      module: 'apps',
      action: params.enabled ? 'app.enabled' : 'app.disabled',
      entityType: 'workspace_app',
      entityId: entry.id,
      summary: `${params.enabled ? 'Enabled' : 'Disabled'} application "${entry.name}" for tenant.`,
      metadata: {
        appId: entry.id,
        appName: entry.name,
        previousEnabled,
        nextEnabled: params.enabled,
        changed,
        correlationId,
      },
    });

    return { changed };
  });

  clearTenantAppsCache(params.tenantId);

  const refreshed = await getTenantAppsState({
    tenantId: params.tenantId,
    permissions: params.permissions,
  });
  const updatedApp = refreshed.apps.find((a) => a.id === entry.id);
  if (!updatedApp) {
    throw new AppManagementError(500, 'Updated application state could not be resolved.');
  }

  return {
    app: updatedApp,
    overview: refreshed.overview,
    changed: txResult.changed,
    correlationId,
  };
}

export function getAppCatalogPayload() {
  return {
    catalog: getAppCatalog(),
    categories: [...APP_CATEGORIES],
  };
}

export function requireAppEnabled(
  appId: 'forms-studio' | 'workflow-automation' | 'cost-control-center'
) {
  const entry = getAppCatalogEntry(appId);
  const appName = entry?.name || appId;

  return async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const tenantId = req.authContext?.activeMembership.tenantId;
    if (!tenantId) {
      res.status(401).json({ error: 'Unauthorized.' });
      return;
    }

    try {
      const enabled = await isTenantAppEnabled(tenantId, appId);
      if (!enabled) {
        res.status(403).json({
          error: `Application disabled: "${appName}" is currently disabled for this tenant. A Workspace Admin can re-enable it in Settings > App Management.`,
          code: 'APP_DISABLED',
          appId,
        });
        return;
      }
      next();
    } catch (error) {
      console.error(`Failed checking tenant app state for ${appId}:`, error);
      res.status(500).json({ error: `Failed to verify "${appName}" module availability.` });
    }
  };
}
