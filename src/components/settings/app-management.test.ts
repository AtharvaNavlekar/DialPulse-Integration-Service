import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  computeTenantAppsOverview,
  resolveEffectiveTenantApps,
} from '../../shared/app-catalog.ts';
import {
  buildRoleConfigFromCapabilities,
  getDefaultCapabilitiesForRole,
} from '../../shared/rbac.ts';
import { MyAppsViewContent } from '../MyAppsView.tsx';
import { AppManagementViewContent } from './AppManagementView.tsx';

test('AppManagementViewContent renders catalogue, KPI cards, details, and blocks coming_soon/blocked toggles', () => {
  const adminPerms = buildRoleConfigFromCapabilities(
    'admin',
    getDefaultCapabilitiesForRole('admin')
  );
  const apps = resolveEffectiveTenantApps({
    storedRows: [
      {
        appId: 'forms-studio',
        enabled: false,
        enabledByUid: 'admin-1',
        updatedAt: '2026-11-17T10:00:00.000Z',
      },
      {
        appId: 'workflow-automation',
        enabled: true,
        enabledByUid: 'admin-1',
        updatedAt: '2026-11-17T10:00:00.000Z',
      },
    ],
    permissions: adminPerms,
  });

  const html = renderToStaticMarkup(
    React.createElement(AppManagementViewContent, {
      tenantName: 'DialPulse Capital DSA',
      roleLabel: 'Workspace Admin',
      apps,
      overview: computeTenantAppsOverview(apps),
      canManageApps: true,
      loading: false,
      busyAppId: null,
      error: null,
      notice: null,
      searchQuery: '',
      categoryFilter: 'all',
      statusFilter: 'all',
      selectedAppId: 'document-workflow',
      onSearchQueryChange: () => {},
      onCategoryFilterChange: () => {},
      onStatusFilterChange: () => {},
      onSelectApp: () => {},
      onRetry: () => {},
      onRequestToggle: () => {},
    })
  );

  assert.match(html, /Catalog Applications/);
  assert.match(html, /Forms Studio/);
  assert.match(html, /Workflow Automation/);
  assert.match(html, /Document Workflow/);
  assert.match(html, /Cost Control Center/);
  assert.match(html, /Internal Knowledge Hub/);
  assert.match(html, /Disabled for Tenant/);
  assert.match(html, /Blocked · Non-Activatable/);
  assert.match(html, /Encrypted Object Storage/);
  assert.match(html, /Enable/);
  assert.match(html, /Disable/);
});

test('AppManagementViewContent renders read-only banner for unauthorized users and error/retry state', () => {
  const viewerPerms = buildRoleConfigFromCapabilities(
    'viewer',
    getDefaultCapabilitiesForRole('viewer')
  );
  const apps = resolveEffectiveTenantApps({
    storedRows: [],
    permissions: viewerPerms,
  });

  const readOnlyHtml = renderToStaticMarkup(
    React.createElement(AppManagementViewContent, {
      tenantName: 'DialPulse Branch B',
      roleLabel: 'Read-Only Auditor',
      apps,
      overview: computeTenantAppsOverview(apps),
      canManageApps: false,
      loading: false,
      busyAppId: null,
      error: 'Network timeout while loading tenant apps.',
      notice: null,
      searchQuery: 'no-such-module-xyz',
      categoryFilter: 'all',
      statusFilter: 'all',
      selectedAppId: null,
      onSearchQueryChange: () => {},
      onCategoryFilterChange: () => {},
      onStatusFilterChange: () => {},
      onSelectApp: () => {},
      onRetry: () => {},
      onRequestToggle: () => {},
    })
  );

  assert.match(readOnlyHtml, /Read-only view:/);
  assert.match(readOnlyHtml, /Network timeout while loading tenant apps\./);
  assert.match(readOnlyHtml, /Retry/);
  assert.match(readOnlyHtml, /No workspace applications match your filters\./);
  assert.match(readOnlyHtml, /Reset Filters/);
});

test('MyAppsViewContent shows disabled-for-tenant and blocked labels accurately from PostgreSQL state', () => {
  const adminPerms = buildRoleConfigFromCapabilities(
    'admin',
    getDefaultCapabilitiesForRole('admin')
  );
  const apps = resolveEffectiveTenantApps({
    storedRows: [
      {
        appId: 'forms-studio',
        enabled: false,
        enabledByUid: 'admin-1',
        updatedAt: '2026-11-17T10:00:00.000Z',
      },
      {
        appId: 'workflow-automation',
        enabled: true,
        enabledByUid: 'admin-1',
        updatedAt: '2026-11-17T10:00:00.000Z',
      },
    ],
    permissions: adminPerms,
  });

  const html = renderToStaticMarkup(
    React.createElement(MyAppsViewContent, {
      apps,
      tenantName: 'DialPulse Capital DSA',
      canManageApps: true,
      onSelectApp: () => {},
      onOpenAppManagement: () => {},
    })
  );

  assert.match(html, /Disabled for tenant/);
  assert.match(html, /Disabled · Enable in App Management/);
  assert.match(html, /Open Workflow Automation/);
  assert.match(html, /Blocked · Milestone H · Stage 5/);
});
