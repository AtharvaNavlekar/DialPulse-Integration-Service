import React from 'react';
import { Building2, Check, LogOut, ShieldCheck, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { useToast } from '../context/ToastContext.tsx';
import { Button, Card, PageHeader, StatusIndicator } from './ui/Primitives.tsx';

import { PERMISSION_CATALOG, hasEffectivePermission } from '../shared/rbac.ts';

export function ProfileView() {
  const { firebaseUser, session, switchTenant, signOut } = useAuth();
  const { pushToast } = useToast();

  if (!session || !firebaseUser) return null;

  const permissionsList = PERMISSION_CATALOG.filter((item) => !item.protected).map(
    (item) => ({
      key: item.key,
      label: item.label,
      category: item.category,
      granted: hasEffectivePermission(session.permissions, item.key),
    })
  );

  const handleSwitchTenant = async (tenantId: number, tenantName: string) => {
    try {
      await switchTenant(tenantId);
      pushToast(`Switched active workspace to ${tenantName}.`, 'info');
    } catch {
      pushToast('Failed to switch tenant workspace.', 'error');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Profile"
        description="Authenticated identity, verified tenant memberships, and active role permissions."
        actions={
          <Button variant="danger" onClick={() => void signOut()}>
            <LogOut className="w-4 h-4" aria-hidden="true" />
            Sign Out
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <Card className="lg:col-span-5 p-6 space-y-5">
          <div className="flex items-center gap-4">
            {firebaseUser.photoURL ? (
              <img
                src={firebaseUser.photoURL}
                alt={session.user.displayName}
                referrerPolicy="no-referrer"
                className="w-14 h-14 rounded-full object-cover border border-[var(--dp-outline-variant)]"
              />
            ) : (
              <div className="w-14 h-14 rounded-full bg-[var(--dp-primary)] text-[var(--dp-on-primary)] text-[18px] font-semibold flex items-center justify-center">
                {(session.user.displayName || 'DP').slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <h2 className="text-[18px] font-semibold text-[var(--dp-on-surface)] truncate">
                {session.user.displayName}
              </h2>
              <p className="text-[13px] text-[var(--dp-on-surface-variant)] truncate">
                {session.user.email}
              </p>
              <p className="text-[12px] font-medium text-[var(--dp-primary)] mt-1">
                {session.permissions.label} · {session.activeTenant.departmentName}
              </p>
            </div>
          </div>

          <div className="pt-4 border-t border-[var(--dp-outline-variant)] space-y-2 text-[12px]">
            <div className="flex justify-between gap-2">
              <span className="text-[var(--dp-on-surface-variant)]">User UID</span>
              <span className="font-mono text-[var(--dp-on-surface)] truncate max-w-52">
                {session.user.uid}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-[var(--dp-on-surface-variant)]">Active Tenant</span>
              <span className="font-medium text-[var(--dp-on-surface)]">
                {session.activeTenant.tenantName}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-[var(--dp-on-surface-variant)]">Auth Provider</span>
              <span className="font-medium text-[var(--dp-on-surface)]">
                Firebase Google Sign-In
              </span>
            </div>
          </div>
        </Card>

        <Card className="lg:col-span-7 p-6 space-y-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[var(--dp-primary)]" aria-hidden="true" />
            <h2 className="text-[16px] font-semibold text-[var(--dp-on-surface)]">
              Active Tenant Role Permissions ({session.activeTenant.roleKey})
            </h2>
          </div>

          <div className="divide-y divide-[var(--dp-outline-variant)] border border-[var(--dp-outline-variant)] rounded-[var(--dp-radius-sm)]">
            {permissionsList.map((perm) => (
              <div
                key={perm.label}
                className="px-4 py-3 flex items-center justify-between gap-4 text-[13px]"
              >
                <span className="text-[var(--dp-on-surface)]">{perm.label}</span>
                {perm.granted ? (
                  <span className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--dp-success-text)]">
                    <Check className="w-3.5 h-3.5" aria-hidden="true" /> Allowed
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--dp-on-surface-variant)]">
                    <X className="w-3.5 h-3.5" aria-hidden="true" /> Restricted
                  </span>
                )}
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--dp-outline-variant)] flex items-center gap-2">
          <Building2 className="w-4 h-4 text-[var(--dp-primary)]" aria-hidden="true" />
          <h2 className="text-[16px] font-semibold text-[var(--dp-on-surface)]">
            Verified Tenant Memberships ({session.memberships.length})
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-[var(--dp-surface-container-low)] border-b border-[var(--dp-outline-variant)] text-[var(--dp-on-surface-variant)]">
              <tr>
                <th className="py-2.5 px-4 font-medium">Workspace</th>
                <th className="py-2.5 px-4 font-medium">Industry</th>
                <th className="py-2.5 px-4 font-medium">Department</th>
                <th className="py-2.5 px-4 font-medium">Role</th>
                <th className="py-2.5 px-4 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--dp-outline-variant)]">
              {session.memberships.map((m) => {
                const isActive = m.tenantId === session.activeTenant.tenantId;
                return (
                  <tr key={m.tenantId}>
                    <td className="py-3 px-4 font-semibold text-[var(--dp-on-surface)]">
                      {m.tenantName}
                      <div className="font-mono text-[11px] font-normal text-[var(--dp-on-surface-variant)]">
                        {m.tenantSlug}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-[var(--dp-on-surface-variant)]">
                      {m.industry}
                    </td>
                    <td className="py-3 px-4 text-[var(--dp-on-surface)]">
                      {m.departmentName}
                    </td>
                    <td className="py-3 px-4">
                      <StatusIndicator
                        tone={isActive ? 'success' : 'neutral'}
                        label={m.roleKey}
                      />
                    </td>
                    <td className="py-3 px-4 text-right">
                      {isActive ? (
                        <span className="text-[12px] font-medium text-[var(--dp-primary)]">
                          Current Workspace
                        </span>
                      ) : (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => void handleSwitchTenant(m.tenantId, m.tenantName)}
                        >
                          Switch Workspace
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
