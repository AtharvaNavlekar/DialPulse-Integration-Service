import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  buildDefaultTenantRoleMatrix,
  PERMISSION_CATALOG,
  PERMISSION_CATEGORIES,
  ROLE_LABELS,
  VALID_ROLE_KEYS,
} from '../../shared/rbac.ts';
import {
  cloneMatrix,
  computeMatrixPendingDiffs,
  filterCatalogItems,
  isCellLocked,
  RolesPermissionsMatrixView,
} from './RolesPermissionsMatrix.tsx';

test('RolesPermissionsMatrixView renders all 29 capabilities, protected lock labels, and editable switches for admin', () => {
  const baseline = buildDefaultTenantRoleMatrix();
  const draft = cloneMatrix(baseline);
  draft.operator.canCreateForms = true;

  const html = renderToStaticMarkup(
    React.createElement(RolesPermissionsMatrixView, {
      catalog: PERMISSION_CATALOG,
      categories: PERMISSION_CATEGORIES,
      roles: VALID_ROLE_KEYS,
      roleLabels: ROLE_LABELS,
      baselineMatrix: baseline,
      draftMatrix: draft,
      metadata: {
        tenantId: 1,
        lastUpdatedAt: '2026-11-16T08:00:00.000Z',
        lastUpdatedByUid: 'admin-uid-1',
      },
      canEdit: true,
      initialized: true,
      loading: false,
      saving: false,
      error: null,
      notice: null,
      categoryFilter: 'all',
      searchQuery: '',
      onCategoryFilterChange: () => {},
      onSearchQueryChange: () => {},
      onToggleCell: () => {},
      onReload: () => {},
      onDiscard: () => {},
      onSaveRequest: () => {},
    })
  );

  assert.match(html, /Role Permissions Matrix \(29 Capabilities · 4 Roles\)/);
  assert.match(html, /1 unsaved change/);
  assert.match(html, /Reload/);
  assert.match(html, /Save Matrix/);
  assert.match(html, /Protected/);
  assert.match(html, /canAdministerPlatformIdentity/);
  assert.match(html, /role="switch"/);
});

test('RolesPermissionsMatrixView renders read-only banner and disables controls when canEdit=false', () => {
  const baseline = buildDefaultTenantRoleMatrix();
  const draft = cloneMatrix(baseline);

  const html = renderToStaticMarkup(
    React.createElement(RolesPermissionsMatrixView, {
      catalog: PERMISSION_CATALOG,
      categories: PERMISSION_CATEGORIES,
      roles: VALID_ROLE_KEYS,
      roleLabels: ROLE_LABELS,
      baselineMatrix: baseline,
      draftMatrix: draft,
      metadata: {
        tenantId: 1,
        lastUpdatedAt: null,
        lastUpdatedByUid: null,
      },
      canEdit: false,
      initialized: true,
      loading: false,
      saving: false,
      error: null,
      notice: null,
      categoryFilter: 'all',
      searchQuery: '',
      onCategoryFilterChange: () => {},
      onSearchQueryChange: () => {},
      onToggleCell: () => {},
      onDiscard: () => {},
      onSaveRequest: () => {},
    })
  );

  assert.match(html, /Read-only RBAC view/);
  assert.equal(html.includes('Save Matrix'), false);
});

test('matrix filtering, pending diff calculation, and cell lock checks work deterministically', () => {
  const baseline = buildDefaultTenantRoleMatrix();
  const draft = cloneMatrix(baseline);
  draft.operator.canPublishForms = true;

  const diffs = computeMatrixPendingDiffs(baseline, draft);
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0]?.roleKey, 'operator');
  assert.equal(diffs[0]?.permissionKey, 'canPublishForms');
  assert.equal(diffs[0]?.riskLevel, 'high');

  const formsFiltered = filterCatalogItems(PERMISSION_CATALOG, 'Forms', '');
  assert.equal(formsFiltered.length, 7);

  const searchFiltered = filterCatalogItems(PERMISSION_CATALOG, 'all', 'replay');
  assert.equal(searchFiltered.length, 1);
  assert.equal(searchFiltered[0]?.key, 'canReplayEvents');

  const adminManageRolesItem = PERMISSION_CATALOG.find(
    (p) => p.key === 'canManageRoles'
  )!;
  assert.equal(isCellLocked(adminManageRolesItem, 'admin', true).locked, true);
  assert.equal(isCellLocked(adminManageRolesItem, 'manager', true).locked, false);

  const protectedItem = PERMISSION_CATALOG.find(
    (p) => p.key === 'canAdministerPlatformIdentity'
  )!;
  assert.equal(isCellLocked(protectedItem, 'admin', true).locked, true);
});
