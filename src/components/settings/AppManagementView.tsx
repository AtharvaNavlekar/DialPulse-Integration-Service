import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Lock,
  Power,
  RefreshCw,
  Search,
  ShieldAlert,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { usePreferences } from '../../context/PreferencesContext.tsx';
import { useToast } from '../../context/ToastContext.tsx';
import {
  APP_CATEGORIES,
  computeTenantAppsOverview,
  filterAppCatalogItems,
} from '../../shared/app-catalog.ts';
import type {
  TenantAppState,
  TenantAppsOverview,
  TenantAppsPayload,
} from '../../shared/types.ts';
import { getWorkspaceAppIcon } from '../app-icons.tsx';
import {
  AlertBanner,
  Button,
  Card,
  ConfirmModal,
  INPUT_BASE_CLASS,
  SELECT_BASE_CLASS,
  StatusIndicator,
  type SemanticStatus,
} from '../ui/Primitives.tsx';

export interface AppManagementViewContentProps {
  tenantName: string;
  roleLabel: string;
  apps: TenantAppState[];
  overview: TenantAppsOverview;
  canManageApps: boolean;
  loading: boolean;
  busyAppId: string | null;
  error: string | null;
  notice: string | null;
  searchQuery: string;
  categoryFilter: string;
  statusFilter: string;
  selectedAppId: string | null;
  onSearchQueryChange: (q: string) => void;
  onCategoryFilterChange: (category: string) => void;
  onStatusFilterChange: (status: string) => void;
  onSelectApp: (appId: string) => void;
  onRetry: () => void;
  onRequestToggle: (app: TenantAppState, targetEnabled: boolean) => void;
  onLaunchApp?: (app: TenantAppState) => void;
  formatTimestamp?: (iso: string) => string;
}

export function getAppStatusMeta(app: TenantAppState): {
  tone: SemanticStatus;
  label: string;
  availabilityLabel: string;
} {
  if (app.status === 'blocked') {
    return {
      tone: 'error',
      label: 'Blocked · Non-Activatable',
      availabilityLabel: 'Blocked',
    };
  }
  if (app.status === 'coming_soon') {
    return {
      tone: 'warning',
      label: `Coming Soon · ${app.milestone}`,
      availabilityLabel: 'Coming Soon',
    };
  }
  if (app.status === 'deprecated') {
    return {
      tone: 'neutral',
      label: 'Deprecated',
      availabilityLabel: 'Deprecated',
    };
  }
  if (!app.supportsTenantActivation) {
    return {
      tone: 'info',
      label: 'Core Control Plane · Always On',
      availabilityLabel: 'Available (Core)',
    };
  }
  if (app.enabled) {
    return {
      tone: 'success',
      label: 'Enabled for Tenant',
      availabilityLabel: 'Available',
    };
  }
  return {
    tone: 'neutral',
    label: 'Disabled for Tenant',
    availabilityLabel: 'Available',
  };
}

export function AppManagementViewContent({
  tenantName,
  roleLabel,
  apps,
  overview,
  canManageApps,
  loading,
  busyAppId,
  error,
  notice,
  searchQuery,
  categoryFilter,
  statusFilter,
  selectedAppId,
  onSearchQueryChange,
  onCategoryFilterChange,
  onStatusFilterChange,
  onSelectApp,
  onRetry,
  onRequestToggle,
  onLaunchApp,
  formatTimestamp = (iso) => new Date(iso).toLocaleString(),
}: AppManagementViewContentProps) {
  const filteredApps = useMemo(
    () =>
      filterAppCatalogItems(apps, {
        searchQuery,
        category: categoryFilter,
        status: statusFilter,
      }),
    [apps, searchQuery, categoryFilter, statusFilter]
  );

  const selectedApp = useMemo(() => {
    if (selectedAppId) {
      const explicit = apps.find((a) => a.id === selectedAppId);
      if (explicit) return explicit;
    }
    return filteredApps[0] ?? apps[0] ?? null;
  }, [apps, filteredApps, selectedAppId]);

  if (loading && apps.length === 0) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((idx) => (
            <div
              key={idx}
              className="h-24 bg-[var(--dp-surface-container-lowest)] border border-[var(--dp-outline-variant)] rounded-[var(--dp-radius-md)] animate-pulse"
            />
          ))}
        </div>
        <div className="h-72 bg-[var(--dp-surface-container-lowest)] border border-[var(--dp-outline-variant)] rounded-[var(--dp-radius-md)] animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPI Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4 space-y-1">
          <div className="text-[12px] font-medium text-[var(--dp-on-surface-variant)]">
            Catalog Applications
          </div>
          <div className="font-heading text-[24px] font-semibold text-[var(--dp-on-surface)] tabular-nums">
            {overview.totalCatalogApps}
          </div>
          <div className="text-[11px] text-[var(--dp-on-surface-variant)]">
            Across {APP_CATEGORIES.length} operational categories
          </div>
        </Card>

        <Card className="p-4 space-y-1">
          <div className="text-[12px] font-medium text-[var(--dp-on-surface-variant)]">
            Available Now
          </div>
          <div className="font-heading text-[24px] font-semibold text-[var(--dp-primary)] tabular-nums">
            {overview.availableCount}
          </div>
          <div className="text-[11px] text-[var(--dp-on-surface-variant)]">
            {overview.toggleableCount} tenant-toggleable modules
          </div>
        </Card>

        <Card className="p-4 space-y-1">
          <div className="text-[12px] font-medium text-[var(--dp-on-surface-variant)]">
            Enabled for {tenantName}
          </div>
          <div className="font-heading text-[24px] font-semibold text-[var(--dp-success-text)] tabular-nums">
            {overview.enabledCount}
          </div>
          <div className="text-[11px] text-[var(--dp-on-surface-variant)]">
            {overview.activeMiniAppsCount} of {overview.toggleableCount} mini-apps active
          </div>
        </Card>

        <Card className="p-4 space-y-1">
          <div className="text-[12px] font-medium text-[var(--dp-on-surface-variant)]">
            Roadmap &amp; Blocked
          </div>
          <div className="font-heading text-[24px] font-semibold text-[var(--dp-on-surface)] tabular-nums">
            {overview.comingSoonCount + overview.blockedCount}
          </div>
          <div className="text-[11px] text-[var(--dp-on-surface-variant)]">
            {overview.comingSoonCount} coming soon · {overview.blockedCount} blocked
          </div>
        </Card>
      </div>

      {/* Role & Governance Notices */}
      {!canManageApps && (
        <AlertBanner
          tone="warning"
          message={`Read-only view: your current role (${roleLabel}) on ${tenantName} lacks "canManageSettings" permission to enable or disable tenant applications.`}
        />
      )}

      {notice && <AlertBanner tone="success" message={notice} />}

      {error && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-[var(--dp-radius-md)] border border-[var(--dp-error)]/30 bg-[var(--dp-error-container)] text-[var(--dp-on-error-container)] text-[13px]">
          <span>{error}</span>
          <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            Retry
          </Button>
        </div>
      )}

      {/* Search & Filter Controls */}
      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
          <div className="md:col-span-5 relative">
            <Search
              className="w-4 h-4 text-[var(--dp-outline)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              aria-label="Search workspace applications"
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              placeholder="Search apps by name, module ID, or capability..."
              className={`${INPUT_BASE_CLASS} pl-9`}
            />
          </div>

          <div className="md:col-span-3">
            <select
              aria-label="Filter by category"
              value={categoryFilter}
              onChange={(e) => onCategoryFilterChange(e.target.value)}
              className={`${SELECT_BASE_CLASS} w-full h-10`}
            >
              <option value="all">All Categories</option>
              {APP_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <select
              aria-label="Filter by status"
              value={statusFilter}
              onChange={(e) => onStatusFilterChange(e.target.value)}
              className={`${SELECT_BASE_CLASS} w-full h-10`}
            >
              <option value="all">All Statuses</option>
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
              <option value="available">Available</option>
              <option value="coming_soon">Coming Soon</option>
              <option value="blocked">Blocked</option>
            </select>
          </div>

          <div className="md:col-span-2 flex justify-end">
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={onRetry}
              disabled={loading}
              className="w-full"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              Refresh
            </Button>
          </div>
        </div>
      </Card>

      {/* Main Split: Catalogue List + Details Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 space-y-3">
          {filteredApps.length === 0 ? (
            <Card className="p-8 text-center space-y-3">
              <p className="text-[14px] font-medium text-[var(--dp-on-surface)]">
                No workspace applications match your filters.
              </p>
              <p className="text-[12px] text-[var(--dp-on-surface-variant)]">
                Clear the search query or switch category/status filters to inspect all {apps.length} modules.
              </p>
              <div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    onSearchQueryChange('');
                    onCategoryFilterChange('all');
                    onStatusFilterChange('all');
                  }}
                >
                  Reset Filters
                </Button>
              </div>
            </Card>
          ) : (
            filteredApps.map((app) => {
              const Icon = getWorkspaceAppIcon(app.id);
              const meta = getAppStatusMeta(app);
              const isSelected = selectedApp?.id === app.id;
              const isBusy = busyAppId === app.id;

              return (
                <Card
                  key={app.id}
                  className={`p-4 transition-colors duration-150 ${
                    isSelected
                      ? 'border-[var(--dp-primary)] ring-1 ring-[var(--dp-primary)]/30'
                      : 'hover:border-[var(--dp-outline)]'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    <button
                      type="button"
                      onClick={() => onSelectApp(app.id)}
                      className="flex items-start gap-3.5 text-left min-w-0 flex-1 cursor-pointer focus-visible:outline-none"
                    >
                      <div
                        className={`p-2.5 rounded-[var(--dp-radius-sm)] shrink-0 ${
                          app.enabled
                            ? 'bg-[var(--dp-primary-container)] text-[var(--dp-primary)]'
                            : 'bg-[var(--dp-surface-container)] text-[var(--dp-on-surface-variant)]'
                        }`}
                      >
                        <Icon className="w-5 h-5" aria-hidden="true" />
                      </div>
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-[15px] font-semibold text-[var(--dp-on-surface)]">
                            {app.name}
                          </h2>
                          <span className="text-[11px] font-mono text-[var(--dp-on-surface-variant)] bg-[var(--dp-surface-container)] px-1.5 py-0.5 rounded">
                            {app.category}
                          </span>
                        </div>
                        <p className="text-[13px] text-[var(--dp-on-surface-variant)] leading-snug">
                          {app.shortDescription}
                        </p>
                        <div className="pt-1 flex flex-wrap items-center gap-3">
                          <StatusIndicator tone={meta.tone} label={meta.label} />
                          <span className="text-[11px] text-[var(--dp-outline)]">
                            {app.milestone}
                          </span>
                        </div>
                      </div>
                    </button>

                    <div className="flex sm:flex-col items-center sm:items-end gap-2 shrink-0">
                      {app.supportsTenantActivation && app.status === 'available' ? (
                        <Button
                          type="button"
                          variant={app.enabled ? 'secondary' : 'primary'}
                          size="sm"
                          disabled={!app.canToggle || isBusy}
                          loading={isBusy}
                          title={app.toggleDisabledReason || undefined}
                          onClick={() => onRequestToggle(app, !app.enabled)}
                        >
                          <Power className="w-3.5 h-3.5" aria-hidden="true" />
                          {isBusy
                            ? 'Updating...'
                            : app.enabled
                              ? 'Disable'
                              : 'Enable'}
                        </Button>
                      ) : (
                        <span
                          title={app.toggleDisabledReason || undefined}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[var(--dp-radius-sm)] border border-[var(--dp-outline-variant)] bg-[var(--dp-surface-container-low)] text-[11px] font-medium text-[var(--dp-on-surface-variant)] whitespace-nowrap"
                        >
                          <Lock className="w-3 h-3 shrink-0" aria-hidden="true" />
                          {app.status === 'available'
                            ? 'Core Module'
                            : app.status === 'blocked'
                              ? 'Blocked'
                              : 'Not Released'}
                        </span>
                      )}

                      {app.canLaunch && onLaunchApp && app.id !== 'app-management' && (
                        <button
                          type="button"
                          onClick={() => onLaunchApp(app)}
                          className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--dp-primary)] hover:underline cursor-pointer"
                        >
                          Open
                          <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })
          )}
        </div>

        {/* Selected Application Details Panel */}
        <div className="lg:col-span-5">
          {selectedApp ? (
            <Card className="p-5 space-y-5 sticky top-20">
              {(() => {
                const Icon = getWorkspaceAppIcon(selectedApp.id);
                const meta = getAppStatusMeta(selectedApp);
                const isBusy = busyAppId === selectedApp.id;

                return (
                  <>
                    <div className="flex items-start justify-between gap-3 border-b border-[var(--dp-outline-variant)] pb-4">
                      <div className="flex items-start gap-3 min-w-0">
                        <div
                          className={`p-2.5 rounded-[var(--dp-radius-sm)] shrink-0 ${
                            selectedApp.enabled
                              ? 'bg-[var(--dp-primary-container)] text-[var(--dp-primary)]'
                              : 'bg-[var(--dp-surface-container)] text-[var(--dp-on-surface-variant)]'
                          }`}
                        >
                          <Icon className="w-5 h-5" aria-hidden="true" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-[17px] font-semibold text-[var(--dp-on-surface)]">
                            {selectedApp.name}
                          </h3>
                          <p className="text-[12px] text-[var(--dp-on-surface-variant)] mt-0.5">
                            {selectedApp.category} · Inspired by {selectedApp.inspiredBy}
                          </p>
                        </div>
                      </div>
                      <StatusIndicator tone={meta.tone} label={meta.availabilityLabel} />
                    </div>

                    <p className="text-[13px] text-[var(--dp-on-surface)] leading-relaxed">
                      {selectedApp.description}
                    </p>

                    <div className="grid grid-cols-2 gap-3 text-[12px] p-3.5 rounded-[var(--dp-radius-sm)] bg-[var(--dp-surface-container-low)] border border-[var(--dp-outline-variant)]">
                      <div>
                        <div className="text-[var(--dp-on-surface-variant)]">
                          Tenant State
                        </div>
                        <div className="font-semibold text-[var(--dp-on-surface)] mt-0.5">
                          {selectedApp.status !== 'available'
                            ? 'Inactive (Unreleased)'
                            : selectedApp.enabled
                              ? 'Enabled'
                              : 'Disabled'}
                        </div>
                      </div>
                      <div>
                        <div className="text-[var(--dp-on-surface-variant)]">
                          Module Key
                        </div>
                        <div className="font-mono text-[var(--dp-on-surface)] mt-0.5 truncate">
                          {selectedApp.id}
                        </div>
                      </div>
                      <div>
                        <div className="text-[var(--dp-on-surface-variant)]">
                          Release Milestone
                        </div>
                        <div className="font-medium text-[var(--dp-on-surface)] mt-0.5">
                          {selectedApp.milestone}
                        </div>
                      </div>
                      <div>
                        <div className="text-[var(--dp-on-surface-variant)]">
                          Access Permission
                        </div>
                        <div className="font-mono text-[var(--dp-on-surface)] mt-0.5 truncate">
                          {selectedApp.requiredPermission}
                        </div>
                      </div>
                    </div>

                    {selectedApp.blockerReason && (
                      <div className="p-3.5 rounded-[var(--dp-radius-sm)] border border-[var(--dp-error)]/30 bg-[var(--dp-error-container)] text-[var(--dp-on-error-container)] text-[12px] flex items-start gap-2.5">
                        <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                        <span>{selectedApp.blockerReason}</span>
                      </div>
                    )}

                    <div className="space-y-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--dp-on-surface-variant)]">
                        Architecture Dependencies
                      </div>
                      {selectedApp.dependencies.length === 0 ? (
                        <p className="text-[12px] text-[var(--dp-on-surface-variant)]">
                          Standalone workspace module with no upstream dependencies.
                        </p>
                      ) : (
                        <ul className="space-y-1 text-[12px] text-[var(--dp-on-surface-variant)] list-disc pl-5">
                          {selectedApp.dependencies.map((dep) => (
                            <li key={dep}>{dep}</li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {selectedApp.updatedAt && (
                      <div className="text-[11px] text-[var(--dp-on-surface-variant)] border-t border-[var(--dp-outline-variant)] pt-3 space-y-0.5">
                        <div>
                          Last updated: {formatTimestamp(selectedApp.updatedAt)}
                        </div>
                        {selectedApp.enabledByUid && (
                          <div className="font-mono truncate">
                            Actor: {selectedApp.enabledByUid}
                          </div>
                        )}
                      </div>
                    )}

                    {selectedApp.toggleDisabledReason && (
                      <p className="text-[12px] text-[var(--dp-on-surface-variant)] bg-[var(--dp-surface-container-low)] p-3 rounded-[var(--dp-radius-sm)] border border-[var(--dp-outline-variant)]">
                        {selectedApp.toggleDisabledReason}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center gap-2.5 pt-1">
                      {selectedApp.supportsTenantActivation &&
                        selectedApp.status === 'available' && (
                          <Button
                            type="button"
                            variant={selectedApp.enabled ? 'danger' : 'primary'}
                            disabled={!selectedApp.canToggle || isBusy}
                            loading={isBusy}
                            onClick={() =>
                              onRequestToggle(selectedApp, !selectedApp.enabled)
                            }
                          >
                            <Power className="w-4 h-4" aria-hidden="true" />
                            {selectedApp.enabled
                              ? 'Disable for Tenant'
                              : 'Enable for Tenant'}
                          </Button>
                        )}

                      {selectedApp.canLaunch &&
                        onLaunchApp &&
                        selectedApp.id !== 'app-management' && (
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => onLaunchApp(selectedApp)}
                          >
                            Open {selectedApp.name}
                            <ArrowUpRight className="w-4 h-4" aria-hidden="true" />
                          </Button>
                        )}
                    </div>
                  </>
                );
              })()}
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function AppManagementView({
  onLaunchApp,
}: {
  onLaunchApp?: (app: TenantAppState) => void;
}) {
  const { session, apiFetch, refreshSession } = useAuth();
  const { formatTimestamp } = usePreferences();
  const { pushToast } = useToast();

  const [payload, setPayload] = useState<TenantAppsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAppId, setBusyAppId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedAppId, setSelectedAppId] = useState<string | null>('forms-studio');
  const [pendingConfirm, setPendingConfirm] = useState<{
    app: TenantAppState;
    targetEnabled: boolean;
  } | null>(null);

  const loadApps = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<TenantAppsPayload>('/api/workspace/apps');
      setPayload(data);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to load tenant application configuration.'
      );
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    void loadApps();
  }, [loadApps, session?.activeTenant.tenantId]);

  const handleConfirmToggle = async () => {
    if (!pendingConfirm) return;
    const { app, targetEnabled } = pendingConfirm;
    setBusyAppId(app.id);
    setError(null);
    setNotice(null);

    try {
      const res = await apiFetch<{
        app: TenantAppState;
        overview: TenantAppsOverview;
        changed: boolean;
      }>(`/api/workspace/apps/${encodeURIComponent(app.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: targetEnabled }),
      });

      setPayload((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          apps: prev.apps.map((item) =>
            item.id === res.app.id ? res.app : item
          ),
          overview: res.overview,
        };
      });
      await refreshSession();

      const msg = targetEnabled
        ? `${app.name} is now enabled for ${session?.activeTenant.tenantName}.`
        : `${app.name} has been disabled for ${session?.activeTenant.tenantName}. Historical records remain safely preserved.`;
      setNotice(msg);
      pushToast(msg);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : `Unable to update ${app.name} activation.`;
      setError(msg);
      pushToast(msg, 'error');
    } finally {
      setBusyAppId(null);
      setPendingConfirm(null);
    }
  };

  if (!session) return null;

  const fallbackApps = session.apps ?? [];
  const effectiveApps = payload?.apps ?? fallbackApps;
  const effectiveOverview =
    payload?.overview ?? computeTenantAppsOverview(effectiveApps);
  const canManageApps = payload?.canManageApps ?? false;

  return (
    <>
      <AppManagementViewContent
        tenantName={session.activeTenant.tenantName}
        roleLabel={session.permissions.label}
        apps={effectiveApps}
        overview={effectiveOverview}
        canManageApps={canManageApps}
        loading={loading}
        busyAppId={busyAppId}
        error={error}
        notice={notice}
        searchQuery={searchQuery}
        categoryFilter={categoryFilter}
        statusFilter={statusFilter}
        selectedAppId={selectedAppId}
        onSearchQueryChange={setSearchQuery}
        onCategoryFilterChange={setCategoryFilter}
        onStatusFilterChange={setStatusFilter}
        onSelectApp={setSelectedAppId}
        onRetry={() => void loadApps()}
        onRequestToggle={(app, targetEnabled) =>
          setPendingConfirm({ app, targetEnabled })
        }
        onLaunchApp={onLaunchApp}
        formatTimestamp={formatTimestamp}
      />

      <ConfirmModal
        open={Boolean(pendingConfirm)}
        title={
          pendingConfirm?.targetEnabled
            ? `Enable ${pendingConfirm.app.name}?`
            : `Disable ${pendingConfirm?.app.name}?`
        }
        description={
          pendingConfirm?.targetEnabled
            ? `Enabling ${pendingConfirm.app.name} restores workspace UI and authenticated API access for authorized users in ${session.activeTenant.tenantName}.`
            : `Disabling ${pendingConfirm?.app.name} blocks workspace users on ${session.activeTenant.tenantName} from opening or calling ${pendingConfirm?.app.name} APIs. Existing database records and public form data are NOT deleted.`
        }
        confirmLabel={
          pendingConfirm?.targetEnabled ? 'Enable Application' : 'Disable Application'
        }
        destructive={pendingConfirm ? !pendingConfirm.targetEnabled : false}
        busy={Boolean(busyAppId)}
        onConfirm={() => void handleConfirmToggle()}
        onCancel={() => {
          if (!busyAppId) setPendingConfirm(null);
        }}
      />
    </>
  );
}
