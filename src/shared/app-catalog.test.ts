import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APP_CATEGORIES,
  WORKSPACE_APP_CATALOG,
  canActivateApp,
  computeTenantAppsOverview,
  filterAppCatalogItems,
  getAppCatalog,
  getAppCatalogEntry,
  isWorkspaceModuleEnabled,
  resolveEffectiveTenantApps,
  validateAppToggleRequest,
} from './app-catalog.ts';
import {
  buildRoleConfigFromCapabilities,
  getDefaultCapabilitiesForRole,
} from './rbac.ts';
import { buildWorkspacePath, parseWorkspaceRoute } from './routes.ts';

test('application catalogue contains unique IDs, honest statuses, and required DialPulse modules', () => {
  const catalog = getAppCatalog();
  const ids = catalog.map((a) => a.id);
  assert.equal(new Set(ids).size, catalog.length);
  assert.equal(catalog.length, 10);

  const forms = getAppCatalogEntry('forms-studio');
  const automations = getAppCatalogEntry('workflow-automation');
  const appMgmt = getAppCatalogEntry('app-management');
  const docs = getAppCatalogEntry('document-workflow');
  const scheduler = getAppCatalogEntry('appointment-scheduler');

  assert.equal(forms?.status, 'available');
  assert.equal(canActivateApp(forms!), true);
  assert.equal(automations?.status, 'available');
  assert.equal(canActivateApp(automations!), true);

  // App Management is available core control plane and non-disableable to prevent lockout
  assert.equal(appMgmt?.status, 'available');
  assert.equal(appMgmt?.supportsTenantActivation, false);
  assert.equal(canActivateApp(appMgmt!), false);

  // Unimplemented/blocked modules cannot be activated
  assert.equal(docs?.status, 'blocked');
  assert.ok(docs?.blockerReason && docs.blockerReason.length > 20);
  assert.equal(canActivateApp(docs!), false);

  assert.equal(scheduler?.status, 'coming_soon');
  assert.equal(canActivateApp(scheduler!), false);
});

test('validateAppToggleRequest enforces RBAC, available status, and unknown app IDs', () => {
  const forms = getAppCatalogEntry('forms-studio');
  const docs = getAppCatalogEntry('document-workflow');
  const scheduler = getAppCatalogEntry('appointment-scheduler');
  const appMgmt = getAppCatalogEntry('app-management');

  assert.equal(
    validateAppToggleRequest({ entry: null, enabled: true, canManageApps: true })
      .statusCode,
    404
  );
  assert.equal(
    validateAppToggleRequest({
      entry: forms,
      enabled: false,
      canManageApps: false,
    }).statusCode,
    403
  );
  assert.equal(
    validateAppToggleRequest({ entry: docs, enabled: true, canManageApps: true })
      .statusCode,
    400
  );
  assert.equal(
    validateAppToggleRequest({
      entry: scheduler,
      enabled: true,
      canManageApps: true,
    }).statusCode,
    400
  );
  assert.equal(
    validateAppToggleRequest({
      entry: appMgmt,
      enabled: false,
      canManageApps: true,
    }).statusCode,
    400
  );

  const ok = validateAppToggleRequest({
    entry: forms,
    enabled: false,
    canManageApps: true,
  });
  assert.equal(ok.valid, true);
  assert.equal(ok.statusCode, 200);
});

test('resolveEffectiveTenantApps ignores forged DB enabled=true rows on coming_soon or blocked apps and honors disabled available apps', () => {
  const adminPerms = buildRoleConfigFromCapabilities(
    'admin',
    getDefaultCapabilitiesForRole('admin')
  );
  const viewerPerms = buildRoleConfigFromCapabilities(
    'viewer',
    getDefaultCapabilitiesForRole('viewer')
  );

  const resolvedAdmin = resolveEffectiveTenantApps({
    storedRows: [
      {
        appId: 'forms-studio',
        enabled: false,
        enabledByUid: 'admin-1',
        updatedAt: '2026-11-17T10:00:00.000Z',
      },
      // Forged/corrupted row claiming a blocked app is enabled must stay disabled
      {
        appId: 'document-workflow',
        enabled: true,
        enabledByUid: 'tamper',
        updatedAt: '2026-11-17T10:00:00.000Z',
      },
    ],
    permissions: adminPerms,
  });

  const formsState = resolvedAdmin.find((a) => a.id === 'forms-studio')!;
  const autoState = resolvedAdmin.find((a) => a.id === 'workflow-automation')!;
  const docsState = resolvedAdmin.find((a) => a.id === 'document-workflow')!;

  assert.equal(formsState.enabled, false);
  assert.equal(formsState.canLaunch, false);
  assert.equal(formsState.canToggle, true);
  assert.equal(autoState.enabled, true);
  assert.equal(autoState.canLaunch, true);
  assert.equal(docsState.enabled, false);
  assert.equal(docsState.canToggle, false);

  const costState = resolvedAdmin.find((a) => a.id === 'cost-control-center')!;
  assert.equal(costState.status, 'available');
  assert.equal(costState.enabled, true);
  assert.equal(costState.canLaunch, true);

  assert.equal(isWorkspaceModuleEnabled(resolvedAdmin, 'forms-studio'), false);
  assert.equal(
    isWorkspaceModuleEnabled(resolvedAdmin, 'workflow-automation'),
    true
  );
  assert.equal(
    isWorkspaceModuleEnabled(resolvedAdmin, 'cost-control-center'),
    true
  );

  const overview = computeTenantAppsOverview(resolvedAdmin);
  assert.equal(overview.totalCatalogApps, WORKSPACE_APP_CATALOG.length);
  assert.equal(overview.availableCount, 4);
  assert.equal(overview.activeMiniAppsCount, 2);
  assert.equal(overview.blockedCount, 1);

  const resolvedViewer = resolveEffectiveTenantApps({
    storedRows: [],
    permissions: viewerPerms,
  });
  const viewerForms = resolvedViewer.find((a) => a.id === 'forms-studio')!;
  assert.equal(viewerForms.canToggle, false);
  assert.equal(viewerForms.canLaunch, true);
});

test('filterAppCatalogItems and /settings/apps and /costs routes operate accurately', () => {
  const apps = resolveEffectiveTenantApps({ storedRows: [], canManageApps: true });

  assert.equal(
    filterAppCatalogItems(apps, { category: APP_CATEGORIES[3] }).length,
    1
  );
  assert.equal(
    filterAppCatalogItems(apps, { searchQuery: 'calendly' }).length,
    1
  );
  assert.equal(filterAppCatalogItems(apps, { status: 'blocked' }).length, 1);

  const parsed = parseWorkspaceRoute('/settings/apps');
  assert.equal(parsed.section, 'settings');
  assert.equal(parsed.settingsTab, 'apps');
  assert.equal(
    buildWorkspacePath('settings', { settingsTab: 'apps' }),
    '/settings/apps'
  );

  const costParsed = parseWorkspaceRoute('/costs/budgets');
  assert.equal(costParsed.section, 'cost-control-center');
  assert.equal(costParsed.costTab, 'budgets');
  assert.equal(
    buildWorkspacePath('cost-control-center', { costTab: 'providers' }),
    '/costs/providers'
  );
});
