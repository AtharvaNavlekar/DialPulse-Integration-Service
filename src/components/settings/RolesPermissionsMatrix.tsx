import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Lock, RefreshCw, RotateCcw, Save, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { usePreferences } from '../../context/PreferencesContext.tsx';
import { useToast } from '../../context/ToastContext.tsx';
import {
  PERMISSION_CATALOG,
  PERMISSION_CATEGORIES,
  ROLE_LABELS,
  VALID_ROLE_KEYS,
  type RolePermissionChangeInput,
  type RolePermissionDiff,
  validateRoleMatrixGovernance,
} from '../../shared/rbac.ts';
import type {
  PermissionCatalogItem,
  PermissionCategory,
  PermissionRiskLevel,
  RoleConfig,
  RoleKey,
  TenantRoleMatrixMetadata,
  TenantRolePermissionMatrix,
} from '../../shared/types.ts';
import {
  AlertBanner,
  Button,
  Card,
  ConfirmModal,
  INPUT_BASE_CLASS,
  SELECT_BASE_CLASS,
} from '../ui/Primitives.tsx';

export interface RbacMatrixApiResponse {
  tenantId: number;
  initialized: boolean;
  matrix: TenantRolePermissionMatrix;
  metadata: TenantRoleMatrixMetadata;
  canEdit: boolean;
}

export interface RbacCatalogApiResponse {
  catalog: PermissionCatalogItem[];
  categories: PermissionCategory[];
  roles: RoleKey[];
  roleLabels: Record<RoleKey, string>;
}

export interface RbacSaveApiResponse {
  matrix: TenantRolePermissionMatrix;
  metadata: TenantRoleMatrixMetadata;
  updatedCount: number;
  diffs: RolePermissionDiff[];
  highRiskChanges: RolePermissionDiff[];
  warnings: string[];
  correlationId: string;
}

export function cloneMatrix(
  matrix: TenantRolePermissionMatrix
): TenantRolePermissionMatrix {
  return {
    admin: { ...matrix.admin },
    manager: { ...matrix.manager },
    operator: { ...matrix.operator },
    viewer: { ...matrix.viewer },
  };
}

export function computeMatrixPendingDiffs(
  baseline: TenantRolePermissionMatrix,
  draft: TenantRolePermissionMatrix,
  catalog: readonly PermissionCatalogItem[] = PERMISSION_CATALOG
): RolePermissionDiff[] {
  const diffs: RolePermissionDiff[] = [];
  for (const roleKey of VALID_ROLE_KEYS) {
    for (const item of catalog) {
      const prev = Boolean(baseline[roleKey]?.[item.key]);
      const next = Boolean(draft[roleKey]?.[item.key]);
      if (prev !== next) {
        diffs.push({
          roleKey,
          permissionKey: item.key,
          label: item.label,
          category: item.category,
          riskLevel: item.riskLevel,
          previousValue: prev,
          newValue: next,
        });
      }
    }
  }
  return diffs;
}

export function filterCatalogItems(
  catalog: readonly PermissionCatalogItem[],
  categoryFilter: string,
  searchQuery: string
): PermissionCatalogItem[] {
  const q = searchQuery.trim().toLowerCase();
  return catalog.filter((item) => {
    if (categoryFilter !== 'all' && item.category !== categoryFilter) {
      return false;
    }
    if (!q) return true;
    return (
      item.label.toLowerCase().includes(q) ||
      item.key.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q)
    );
  });
}

export function isCellLocked(
  item: Pick<PermissionCatalogItem, 'key' | 'configurable' | 'protected'>,
  roleKey: RoleKey,
  canEdit: boolean
): { locked: boolean; reason?: string } {
  if (item.protected || !item.configurable) {
    return {
      locked: true,
      reason: 'Protected platform capability managed by Central CRM only.',
    };
  }
  if (roleKey === 'admin' && item.key === 'canManageRoles') {
    return {
      locked: true,
      reason: 'Locked to prevent Workspace Admin permission lockout.',
    };
  }
  if (!canEdit) {
    return {
      locked: true,
      reason: 'Requires canManageRoles permission to modify.',
    };
  }
  return { locked: false };
}

function getRiskPresentation(riskLevel: PermissionRiskLevel): {
  label: string;
  className: string;
} {
  switch (riskLevel) {
    case 'critical':
      return {
        label: 'Critical',
        className: 'text-[var(--dp-error)] font-semibold',
      };
    case 'high':
      return {
        label: 'High',
        className: 'text-[var(--dp-warning-text)] font-semibold',
      };
    case 'medium':
      return {
        label: 'Medium',
        className: 'text-[var(--dp-primary)] font-medium',
      };
    case 'low':
    default:
      return {
        label: 'Low',
        className: 'text-[var(--dp-on-surface-variant)] font-normal',
      };
  }
}

export interface RolesPermissionsMatrixViewProps {
  catalog: readonly PermissionCatalogItem[];
  categories: readonly PermissionCategory[];
  roles: readonly RoleKey[];
  roleLabels: Record<RoleKey, string>;
  baselineMatrix: TenantRolePermissionMatrix;
  draftMatrix: TenantRolePermissionMatrix;
  metadata: TenantRoleMatrixMetadata | null;
  canEdit: boolean;
  initialized: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;
  notice: string | null;
  categoryFilter: string;
  searchQuery: string;
  onCategoryFilterChange: (next: string) => void;
  onSearchQueryChange: (next: string) => void;
  onToggleCell: (roleKey: RoleKey, item: PermissionCatalogItem) => void;
  onReload?: () => void;
  onDiscard: () => void;
  onSaveRequest: () => void;
  formatTimestamp?: (iso: string | Date) => string;
}

export function RolesPermissionsMatrixView({
  catalog,
  categories,
  roles,
  roleLabels,
  baselineMatrix,
  draftMatrix,
  metadata,
  canEdit,
  initialized,
  loading,
  saving,
  error,
  notice,
  categoryFilter,
  searchQuery,
  onCategoryFilterChange,
  onSearchQueryChange,
  onToggleCell,
  onReload,
  onDiscard,
  onSaveRequest,
  formatTimestamp = (val) => new Date(val).toLocaleString(),
}: RolesPermissionsMatrixViewProps) {
  const pendingDiffs = useMemo(
    () => computeMatrixPendingDiffs(baselineMatrix, draftMatrix, catalog),
    [baselineMatrix, draftMatrix, catalog]
  );

  const filteredItems = useMemo(
    () => filterCatalogItems(catalog, categoryFilter, searchQuery),
    [catalog, categoryFilter, searchQuery]
  );

  const highRiskPendingCount = useMemo(
    () =>
      pendingDiffs.filter(
        (d) => d.riskLevel === 'high' || d.riskLevel === 'critical'
      ).length,
    [pendingDiffs]
  );

  return (
    <Card className="overflow-hidden">
      <div className="px-5 py-4 border-b border-[var(--dp-outline-variant)] space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck
                className="w-4 h-4 text-[var(--dp-primary)] shrink-0"
                aria-hidden="true"
              />
              <h2 className="text-[16px] font-semibold text-[var(--dp-on-surface)]">
                Role Permissions Matrix ({catalog.length} Capabilities · {roles.length} Roles)
              </h2>
            </div>
            <p className="text-[12px] text-[var(--dp-on-surface-variant)] mt-0.5">
              Dynamic PostgreSQL RBAC matrix enforced across every backend route and workspace view.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {pendingDiffs.length > 0 && (
              <span className="text-[12px] font-mono tabular-nums text-[var(--dp-primary)] font-medium mr-1">
                {pendingDiffs.length} unsaved change{pendingDiffs.length === 1 ? '' : 's'}
                {highRiskPendingCount > 0
                  ? ` (${highRiskPendingCount} high/critical)`
                  : ''}
              </span>
            )}
            {onReload && (
              <Button
                variant="tertiary"
                size="sm"
                disabled={loading || saving}
                onClick={onReload}
              >
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                Reload
              </Button>
            )}
            {canEdit && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={pendingDiffs.length === 0 || saving}
                  onClick={onDiscard}
                >
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  Discard
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={pendingDiffs.length === 0 || saving || !initialized}
                  onClick={onSaveRequest}
                >
                  <Save className="w-3.5 h-3.5" aria-hidden="true" />
                  {saving ? 'Saving...' : 'Save Matrix'}
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-1">
          <div className="flex flex-wrap items-center gap-2.5 flex-1">
            <select
              aria-label="Filter permissions by category"
              value={categoryFilter}
              onChange={(e) => onCategoryFilterChange(e.target.value)}
              className={`${SELECT_BASE_CLASS} py-1.5 text-[12px]`}
            >
              <option value="all">All Categories ({catalog.length})</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>

            <input
              type="search"
              aria-label="Search permissions"
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              placeholder="Search capability name, key, or description..."
              className={`${INPUT_BASE_CLASS} max-w-sm py-1.5 text-[12px]`}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono tabular-nums text-[var(--dp-on-surface-variant)]">
            <span>
              Last updated:{' '}
              {metadata?.lastUpdatedAt
                ? formatTimestamp(metadata.lastUpdatedAt)
                : 'Default bootstrap'}
            </span>
            {metadata?.lastUpdatedByUid && (
              <span className="truncate max-w-44" title={metadata.lastUpdatedByUid}>
                by {metadata.lastUpdatedByUid}
              </span>
            )}
          </div>
        </div>
      </div>

      {!canEdit && (
        <div className="px-5 pt-4">
          <AlertBanner
            tone="warning"
            message="Read-only RBAC view: editing tenant role permissions requires the canManageRoles capability."
          />
        </div>
      )}

      {!initialized && !loading && (
        <div className="px-5 pt-4">
          <AlertBanner
            tone="error"
            message="Fail-closed state: tenant role permission rows are not initialized in PostgreSQL."
          />
        </div>
      )}

      {error && (
        <div className="px-5 pt-4">
          <AlertBanner tone="error" message={error} />
        </div>
      )}

      {notice && (
        <div className="px-5 pt-4">
          <AlertBanner tone="success" message={notice} />
        </div>
      )}

      <div className="overflow-x-auto mt-3">
        {loading ? (
          <div className="p-6 text-[13px] text-[var(--dp-on-surface-variant)]">
            Loading tenant role permission matrix...
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-8 text-center text-[13px] text-[var(--dp-on-surface-variant)]">
            No capabilities match the current filter.
          </div>
        ) : (
          <table className="w-full text-left text-[12px] border-t border-[var(--dp-outline-variant)]">
            <thead className="bg-[var(--dp-surface-container-low)] border-b border-[var(--dp-outline-variant)] text-[var(--dp-on-surface-variant)]">
              <tr>
                <th className="py-2.5 px-4 font-medium min-w-[260px]">
                  Permission Capability
                </th>
                <th className="py-2.5 px-3 font-medium whitespace-nowrap">Risk</th>
                {roles.map((roleKey) => (
                  <th
                    key={roleKey}
                    className="py-2.5 px-3 font-medium text-center whitespace-nowrap"
                  >
                    <div className="text-[var(--dp-on-surface)] font-semibold">
                      {roleKey.charAt(0).toUpperCase() + roleKey.slice(1)}
                    </div>
                    <div className="text-[10px] font-normal text-[var(--dp-on-surface-variant)]">
                      {roleLabels[roleKey]}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--dp-outline-variant)]">
              {filteredItems.map((item) => {
                const risk = getRiskPresentation(item.riskLevel);
                return (
                  <tr
                    key={item.key}
                    className={`min-h-[42px] transition-colors duration-100 ${
                      item.protected
                        ? 'bg-[var(--dp-surface-container-low)]/70'
                        : 'hover:bg-[var(--dp-surface-variant)]/40'
                    }`}
                  >
                    <td className="py-2 px-4 align-middle">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-[var(--dp-on-surface)] text-[13px]">
                          {item.label}
                        </span>
                        {item.protected && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-[var(--dp-on-surface-variant)]">
                            <Lock className="w-3 h-3" aria-hidden="true" />
                            Protected
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[var(--dp-on-surface-variant)] mt-0.5">
                        <span className="font-mono text-[var(--dp-primary)]/90">
                          {item.key}
                        </span>{' '}
                        · {item.category} — {item.description}
                      </div>
                    </td>
                    <td className="py-2 px-3 align-middle whitespace-nowrap">
                      <span className={`text-[11px] uppercase tracking-wide ${risk.className}`}>
                        {risk.label}
                      </span>
                    </td>
                    {roles.map((roleKey) => {
                      const enabled = Boolean(draftMatrix[roleKey]?.[item.key]);
                      const baselineEnabled = Boolean(
                        baselineMatrix[roleKey]?.[item.key]
                      );
                      const changed = enabled !== baselineEnabled;
                      const cellLock = isCellLocked(item, roleKey, canEdit);
                      const switchLabel = `${item.label} for ${roleLabels[roleKey] || roleKey}`;

                      return (
                        <td
                          key={`${item.key}-${roleKey}`}
                          className="py-2 px-3 text-center align-middle"
                        >
                          <div className="inline-flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              role="switch"
                              aria-checked={enabled}
                              aria-label={switchLabel}
                              disabled={cellLock.locked || saving}
                              title={cellLock.reason || switchLabel}
                              onClick={() => onToggleCell(roleKey, item)}
                              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dp-primary)] ${
                                enabled
                                  ? 'bg-[var(--dp-primary)] border-[var(--dp-primary)]'
                                  : 'bg-[var(--dp-surface-container-highest)] border-[var(--dp-outline-variant)]'
                              } ${
                                cellLock.locked
                                  ? 'opacity-55 cursor-not-allowed'
                                  : 'cursor-pointer'
                              } ${
                                changed
                                  ? 'ring-2 ring-[var(--dp-warning)]/60 ring-offset-1 ring-offset-[var(--dp-surface)]'
                                  : ''
                              }`}
                            >
                              <span
                                className={`pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-[var(--dp-on-primary)] shadow-xs transition-transform duration-150 ${
                                  enabled ? 'translate-x-4' : 'translate-x-0.5'
                                }`}
                              />
                            </button>
                            {cellLock.locked &&
                              (item.protected ||
                                (roleKey === 'admin' && item.key === 'canManageRoles')) && (
                                <Lock
                                  className="w-3 h-3 text-[var(--dp-on-surface-variant)] shrink-0"
                                  aria-hidden="true"
                                />
                              )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
}

export function RolesPermissionsMatrix({
  actorRoleKey,
  actorPermissions,
}: {
  actorRoleKey: RoleKey;
  actorPermissions: RoleConfig;
}) {
  const { apiFetch, refreshSession, session } = useAuth();
  const { formatTimestamp } = usePreferences();
  const { pushToast } = useToast();
  const activeTenantId = session?.activeTenant.tenantId ?? null;

  const [catalog, setCatalog] = useState<PermissionCatalogItem[]>([...PERMISSION_CATALOG]);
  const [categories, setCategories] = useState<PermissionCategory[]>([
    ...PERMISSION_CATEGORIES,
  ]);
  const [roles, setRoles] = useState<RoleKey[]>([...VALID_ROLE_KEYS]);
  const [roleLabels, setRoleLabels] = useState<Record<RoleKey, string>>(ROLE_LABELS);

  const [baselineMatrix, setBaselineMatrix] = useState<TenantRolePermissionMatrix | null>(
    null
  );
  const [draftMatrix, setDraftMatrix] = useState<TenantRolePermissionMatrix | null>(null);
  const [metadata, setMetadata] = useState<TenantRoleMatrixMetadata | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [initialized, setInitialized] = useState(true);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [categoryFilter, setCategoryFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmHighRiskDiffs, setConfirmHighRiskDiffs] = useState<RolePermissionDiff[]>(
    []
  );
  const [confirmWarnings, setConfirmWarnings] = useState<string[]>([]);

  const loadMatrixData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [catRes, matRes] = await Promise.all([
        apiFetch<RbacCatalogApiResponse>('/api/workspace/rbac/catalog'),
        apiFetch<RbacMatrixApiResponse>('/api/workspace/rbac/matrix'),
      ]);
      setCatalog(catRes.catalog);
      setCategories(catRes.categories);
      setRoles(catRes.roles);
      setRoleLabels(catRes.roleLabels);
      setBaselineMatrix(cloneMatrix(matRes.matrix));
      setDraftMatrix(cloneMatrix(matRes.matrix));
      setMetadata(matRes.metadata);
      setCanEdit(matRes.canEdit);
      setInitialized(matRes.initialized);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to load role permissions matrix.'
      );
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    void loadMatrixData();
  }, [loadMatrixData, actorRoleKey, activeTenantId]);

  const handleToggleCell = (roleKey: RoleKey, item: PermissionCatalogItem) => {
    const lock = isCellLocked(item, roleKey, canEdit);
    if (lock.locked || !draftMatrix) return;

    setNotice(null);
    setError(null);
    setDraftMatrix((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        [roleKey]: {
          ...prev[roleKey],
          [item.key]: !prev[roleKey][item.key],
        },
      };
    });
  };

  const handleDiscard = () => {
    if (!baselineMatrix) return;
    setDraftMatrix(cloneMatrix(baselineMatrix));
    setError(null);
    setNotice(null);
  };

  const executeSave = async (changes: RolePermissionChangeInput[]) => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch<RbacSaveApiResponse>('/api/workspace/rbac/matrix', {
        method: 'PUT',
        body: JSON.stringify({ changes }),
      });
      setBaselineMatrix(cloneMatrix(res.matrix));
      setDraftMatrix(cloneMatrix(res.matrix));
      setMetadata(res.metadata);
      setConfirmOpen(false);
      await refreshSession();

      const msg =
        res.updatedCount > 0
          ? `Saved ${res.updatedCount} permission change${res.updatedCount === 1 ? '' : 's'} to PostgreSQL (audit correlation ${res.correlationId.slice(0, 8)}).`
          : 'No permission changes required.';
      setNotice(msg);
      pushToast(msg);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Failed to save role permission changes.';
      setError(msg);
      pushToast(msg, 'error');
      setConfirmOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveRequest = async () => {
    if (!baselineMatrix || !draftMatrix) return;
    const diffs = computeMatrixPendingDiffs(baselineMatrix, draftMatrix, catalog);
    if (diffs.length === 0) return;

    const changes: RolePermissionChangeInput[] = diffs.map((d) => ({
      roleKey: d.roleKey,
      permissionKey: d.permissionKey,
      enabled: d.newValue,
    }));

    const localValidation = validateRoleMatrixGovernance({
      actorRoleKey,
      actorPermissions,
      currentMatrix: baselineMatrix,
      changes,
    });

    if (!localValidation.valid) {
      const msg =
        localValidation.errors[0] ||
        'Permission change violates tenant governance rules.';
      setError(msg);
      pushToast(msg, 'error');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const serverValidation = await apiFetch<{
        valid: boolean;
        errors: string[];
        warnings: string[];
        highRiskChanges: RolePermissionDiff[];
      }>('/api/workspace/rbac/validate', {
        method: 'POST',
        body: JSON.stringify({ changes }),
      });

      if (!serverValidation.valid) {
        const msg =
          serverValidation.errors[0] ||
          'Server governance validation rejected permission changes.';
        setError(msg);
        pushToast(msg, 'error');
        setSaving(false);
        return;
      }

      if (
        serverValidation.highRiskChanges.length > 0 ||
        serverValidation.warnings.length > 0
      ) {
        setConfirmHighRiskDiffs(serverValidation.highRiskChanges);
        setConfirmWarnings(serverValidation.warnings);
        setConfirmOpen(true);
        setSaving(false);
        return;
      }
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Permission validation failed.';
      setError(msg);
      pushToast(msg, 'error');
      setSaving(false);
      return;
    }

    void executeSave(changes);
  };

  if (!baselineMatrix || !draftMatrix) {
    return (
      <Card className="p-5 space-y-3">
        {error ? (
          <AlertBanner tone="error" message={error} />
        ) : (
          <div className="text-[13px] text-[var(--dp-on-surface-variant)]">
            Loading role permissions matrix...
          </div>
        )}
      </Card>
    );
  }

  return (
    <>
      <RolesPermissionsMatrixView
        catalog={catalog}
        categories={categories}
        roles={roles}
        roleLabels={roleLabels}
        baselineMatrix={baselineMatrix}
        draftMatrix={draftMatrix}
        metadata={metadata}
        canEdit={canEdit}
        initialized={initialized}
        loading={loading}
        saving={saving}
        error={error}
        notice={notice}
        categoryFilter={categoryFilter}
        searchQuery={searchQuery}
        onCategoryFilterChange={setCategoryFilter}
        onSearchQueryChange={setSearchQuery}
        onToggleCell={handleToggleCell}
        onReload={() => {
          setNotice(null);
          void loadMatrixData();
        }}
        onDiscard={handleDiscard}
        onSaveRequest={() => void handleSaveRequest()}
        formatTimestamp={formatTimestamp}
      />

      <ConfirmModal
        open={confirmOpen}
        title="Confirm High-Risk Permission Changes"
        description={
          [
            `You are applying ${confirmHighRiskDiffs.length} high or critical-risk permission change${confirmHighRiskDiffs.length === 1 ? '' : 's'}:`,
            ...confirmHighRiskDiffs
              .slice(0, 6)
              .map(
                (d) =>
                  `${d.roleKey}.${d.permissionKey}: ${d.previousValue ? 'ON' : 'OFF'} → ${d.newValue ? 'ON' : 'OFF'}`
              ),
            ...(confirmHighRiskDiffs.length > 6
              ? [`+${confirmHighRiskDiffs.length - 6} additional change(s)`]
              : []),
            ...confirmWarnings,
          ].join(' · ')
        }
        confirmLabel="Apply Permission Changes"
        destructive={confirmHighRiskDiffs.some((d) => d.riskLevel === 'critical')}
        busy={saving}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          if (!baselineMatrix || !draftMatrix) return;
          const diffs = computeMatrixPendingDiffs(
            baselineMatrix,
            draftMatrix,
            catalog
          );
          void executeSave(
            diffs.map((d) => ({
              roleKey: d.roleKey,
              permissionKey: d.permissionKey,
              enabled: d.newValue,
            }))
          );
        }}
      />
    </>
  );
}
