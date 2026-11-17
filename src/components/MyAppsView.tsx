import React from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { resolveEffectiveTenantApps } from '../shared/app-catalog.ts';
import { hasEffectivePermission } from '../shared/rbac.ts';
import type { NavSectionId, TenantAppState } from '../shared/types.ts';
import { getWorkspaceAppIcon } from './app-icons.tsx';
import {
  Button,
  Card,
  PageHeader,
  StatusIndicator,
  type SemanticStatus,
} from './ui/Primitives.tsx';

function getLauncherBadge(app: TenantAppState): {
  tone: SemanticStatus;
  label: string;
} {
  if (app.status === 'blocked') {
    return { tone: 'error', label: `Blocked · ${app.milestone}` };
  }
  if (app.status === 'coming_soon') {
    return { tone: 'warning', label: `Coming soon · ${app.milestone}` };
  }
  if (app.status === 'deprecated') {
    return { tone: 'neutral', label: 'Deprecated' };
  }
  if (!app.enabled) {
    return { tone: 'neutral', label: 'Disabled for tenant' };
  }
  if (!app.supportsTenantActivation) {
    return { tone: 'info', label: `Core · ${app.milestone}` };
  }
  return { tone: 'success', label: `Active · ${app.milestone}` };
}

export function MyAppsViewContent({
  apps,
  tenantName,
  canManageApps,
  onSelectApp,
  onOpenAppManagement,
}: {
  apps: TenantAppState[];
  tenantName: string;
  canManageApps: boolean;
  onSelectApp: (id: NavSectionId) => void;
  onOpenAppManagement?: () => void;
}) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="My Apps"
        description={`Internal mini-applications and tenant activation status for ${tenantName}.`}
        actions={
          onOpenAppManagement && (
            <Button variant="secondary" onClick={onOpenAppManagement}>
              <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
              {canManageApps ? 'Manage Tenant Apps' : 'View App Catalogue'}
            </Button>
          )
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {apps.map((app) => {
          const Icon = getWorkspaceAppIcon(app.id);
          const badge = getLauncherBadge(app);
          const isAvailableAndEnabled =
            app.status === 'available' && app.enabled;
          const isDisabledForTenant =
            app.status === 'available' && !app.enabled;

          let actionLabel = 'Planned Roadmap Module';
          let actionVariant: 'primary' | 'secondary' = 'secondary';
          let actionDisabled = false;
          let onClickAction: (() => void) | undefined;

          if (app.id === 'app-management' && onOpenAppManagement) {
            actionLabel = 'Open App Management';
            actionVariant = 'primary';
            onClickAction = onOpenAppManagement;
          } else if (isAvailableAndEnabled && app.navSectionId) {
            if (app.canLaunch) {
              actionLabel = `Open ${app.name}`;
              actionVariant = 'primary';
              const targetSection = app.navSectionId;
              onClickAction = () => onSelectApp(targetSection);
            } else {
              actionLabel = `Restricted (${app.requiredPermission})`;
              actionVariant = 'secondary';
              actionDisabled = true;
            }
          } else if (isDisabledForTenant) {
            actionLabel = canManageApps
              ? 'Disabled · Enable in App Management'
              : 'Disabled for Tenant';
            actionVariant = 'secondary';
            if (canManageApps && onOpenAppManagement) {
              onClickAction = onOpenAppManagement;
            } else {
              actionDisabled = true;
            }
          } else if (app.navSectionId) {
            actionLabel =
              app.status === 'blocked'
                ? 'View Compliance Blocker'
                : 'View Roadmap Scope';
            actionVariant = 'secondary';
            const targetSection = app.navSectionId;
            onClickAction = () => onSelectApp(targetSection);
          } else {
            actionLabel = `Planned · ${app.milestone}`;
            actionVariant = 'secondary';
            actionDisabled = true;
          }

          return (
            <Card key={app.id} className="p-5 flex flex-col justify-between gap-5">
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div
                    className={`p-2 rounded-[var(--dp-radius-sm)] ${
                      isAvailableAndEnabled
                        ? 'bg-[var(--dp-primary-container)] text-[var(--dp-primary)]'
                        : 'bg-[var(--dp-surface-container)] text-[var(--dp-on-surface-variant)]'
                    }`}
                  >
                    <Icon className="w-5 h-5" aria-hidden="true" />
                  </div>
                  <StatusIndicator tone={badge.tone} label={badge.label} />
                </div>

                <div>
                  <h2 className="text-[16px] font-semibold text-[var(--dp-on-surface)]">
                    {app.name}
                  </h2>
                  <p className="text-[12px] text-[var(--dp-on-surface-variant)] mt-0.5">
                    {app.category} · Inspired by {app.inspiredBy}
                  </p>
                </div>

                <p className="text-[13px] text-[var(--dp-on-surface-variant)] leading-relaxed">
                  {app.description}
                </p>

                {app.blockerReason && (
                  <p className="text-[12px] text-[var(--dp-error)] bg-[var(--dp-error-container)]/50 px-3 py-2 rounded-[var(--dp-radius-sm)]">
                    {app.blockerReason}
                  </p>
                )}
              </div>

              <Button
                type="button"
                variant={actionVariant}
                disabled={actionDisabled}
                onClick={onClickAction}
                className="w-full"
              >
                {actionLabel}
              </Button>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export function MyAppsView({
  onSelectApp,
  onOpenAppManagement,
}: {
  onSelectApp: (id: NavSectionId) => void;
  onOpenAppManagement?: () => void;
}) {
  const { session } = useAuth();
  const canManageApps = hasEffectivePermission(
    session?.permissions,
    'canManageSettings'
  );
  const apps =
    session?.apps ??
    resolveEffectiveTenantApps({
      storedRows: [],
      permissions: session?.permissions,
      canManageApps,
    });

  return (
    <MyAppsViewContent
      apps={apps}
      tenantName={session?.activeTenant.tenantName || 'Active Tenant'}
      canManageApps={canManageApps}
      onSelectApp={onSelectApp}
      onOpenAppManagement={onOpenAppManagement}
    />
  );
}
