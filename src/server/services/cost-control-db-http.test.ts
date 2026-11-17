import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { and, desc, eq } from 'drizzle-orm';
import { closePool, db } from '../../db/index.ts';
import {
  activityLogs,
  costAlerts,
  costBudgets,
  costRecords,
  internalNotifications,
  providerPricingConfigs,
  tenantMemberships,
  tenants,
  users,
  workspaceOrgConfigs,
} from '../../db/schema.ts';
import { createDefaultOrgConfig } from '../../shared/defaults.ts';
import type {
  CostAlertItem,
  CostBudgetEvaluationItem,
  CostProviderCatalogSummary,
  CostRecordItem,
  CostSummaryPayload,
  CostUsageEstimateItem,
} from '../../shared/types.ts';
import { createRequireAuth } from '../middleware/auth.ts';
import { createCostsRouter } from '../routes/costs.ts';
import { createWorkspaceRouter } from '../routes/workspace.ts';
import {
  clearTenantAppsCache,
  seedTenantAppInstallations,
} from './app-management-service.ts';
import {
  clearTenantRolePermissionsCache,
  seedTenantRolePermissions,
} from './rbac-service.ts';

let server: Server;
let baseUrl = '';

let tenant1Id = 0;
let tenant2Id = 0;

let adminUser = { id: 0, uid: '', email: '' };
let operatorUser = { id: 0, uid: '', email: '' };
let viewerUser = { id: 0, uid: '', email: '' };
let suspendedUser = { id: 0, uid: '', email: '' };

const tokenToUser = new Map<string, { uid: string; email: string; name: string }>();

test.before(async () => {
  clearTenantRolePermissionsCache();
  clearTenantAppsCache();

  const suffix = randomUUID().slice(0, 8);
  const [t1] = await db
    .insert(tenants)
    .values({
      slug: `test-cost-t1-${suffix}`,
      name: `Cost Test Tenant 1 (${suffix})`,
    })
    .returning();
  const [t2] = await db
    .insert(tenants)
    .values({
      slug: `test-cost-t2-${suffix}`,
      name: `Cost Test Tenant 2 (${suffix})`,
    })
    .returning();

  tenant1Id = t1!.id;
  tenant2Id = t2!.id;

  await db.insert(workspaceOrgConfigs).values([
    { tenantId: tenant1Id, config: createDefaultOrgConfig() },
    { tenantId: tenant2Id, config: createDefaultOrgConfig() },
  ]);

  await Promise.all([
    seedTenantRolePermissions(tenant1Id, 'test:cost-bootstrap'),
    seedTenantRolePermissions(tenant2Id, 'test:cost-bootstrap'),
    seedTenantAppInstallations(tenant1Id, 'test:cost-bootstrap'),
    seedTenantAppInstallations(tenant2Id, 'test:cost-bootstrap'),
  ]);

  const [uAdmin] = await db
    .insert(users)
    .values({
      uid: `test-cost-admin-${suffix}`,
      email: `cost-admin-${suffix}@dialpulse.example`,
      displayName: 'Cost Admin',
      activeTenantId: tenant1Id,
    })
    .returning();
  const [uOp] = await db
    .insert(users)
    .values({
      uid: `test-cost-op-${suffix}`,
      email: `cost-op-${suffix}@dialpulse.example`,
      displayName: 'Cost Operator',
      activeTenantId: tenant1Id,
    })
    .returning();
  const [uViewer] = await db
    .insert(users)
    .values({
      uid: `test-cost-viewer-${suffix}`,
      email: `cost-viewer-${suffix}@dialpulse.example`,
      displayName: 'Cost Viewer',
      activeTenantId: tenant1Id,
    })
    .returning();
  const [uSusp] = await db
    .insert(users)
    .values({
      uid: `test-cost-susp-${suffix}`,
      email: `cost-susp-${suffix}@dialpulse.example`,
      displayName: 'Cost Suspended',
      activeTenantId: tenant1Id,
    })
    .returning();

  adminUser = { id: uAdmin!.id, uid: uAdmin!.uid, email: uAdmin!.email };
  operatorUser = { id: uOp!.id, uid: uOp!.uid, email: uOp!.email };
  viewerUser = { id: uViewer!.id, uid: uViewer!.uid, email: uViewer!.email };
  suspendedUser = { id: uSusp!.id, uid: uSusp!.uid, email: uSusp!.email };

  await db.insert(tenantMemberships).values([
    {
      tenantId: tenant1Id,
      userUid: adminUser.uid,
      roleKey: 'admin',
      departmentName: 'Finance',
      status: 'active',
    },
    {
      tenantId: tenant2Id,
      userUid: adminUser.uid,
      roleKey: 'admin',
      departmentName: 'Finance',
      status: 'active',
    },
    {
      tenantId: tenant1Id,
      userUid: operatorUser.uid,
      roleKey: 'operator',
      departmentName: 'Operations',
      status: 'active',
    },
    {
      tenantId: tenant1Id,
      userUid: viewerUser.uid,
      roleKey: 'viewer',
      departmentName: 'Audit',
      status: 'active',
    },
    {
      tenantId: tenant1Id,
      userUid: suspendedUser.uid,
      roleKey: 'admin',
      departmentName: 'Finance',
      status: 'inactive',
    },
  ]);

  tokenToUser.set('token-admin', {
    uid: adminUser.uid,
    email: adminUser.email,
    name: 'Cost Admin',
  });
  tokenToUser.set('token-operator', {
    uid: operatorUser.uid,
    email: operatorUser.email,
    name: 'Cost Operator',
  });
  tokenToUser.set('token-viewer', {
    uid: viewerUser.uid,
    email: viewerUser.email,
    name: 'Cost Viewer',
  });
  tokenToUser.set('token-suspended', {
    uid: suspendedUser.uid,
    email: suspendedUser.email,
    name: 'Cost Suspended',
  });

  const testAuth = createRequireAuth({
    verifyIdToken: async (idToken) => {
      const hit = tokenToUser.get(idToken);
      if (!hit) throw new Error('Invalid token');
      return {
        uid: hit.uid,
        email: hit.email,
        name: hit.name,
      } as never;
    },
    ensureMemberships: async (uid) => {
      const userRows = await db
        .select()
        .from(users)
        .where(eq(users.uid, uid))
        .limit(1);
      const user = userRows[0];
      const memberships = await db
        .select({
          tenantId: tenants.id,
          tenantSlug: tenants.slug,
          tenantName: tenants.name,
          industry: tenants.industry,
          roleKey: tenantMemberships.roleKey,
          departmentName: tenantMemberships.departmentName,
        })
        .from(tenantMemberships)
        .innerJoin(tenants, eq(tenantMemberships.tenantId, tenants.id))
        .where(
          and(
            eq(tenantMemberships.userUid, uid),
            eq(tenantMemberships.status, 'active')
          )
        );
      if (!user || memberships.length === 0) {
        const { AuthorizationError } = await import('../middleware/tenant-guard.ts');
        throw new AuthorizationError(403, 'Inactive or missing tenant membership.');
      }
      return {
        user,
        memberships: memberships.map((m) => ({
          ...m,
          roleKey: m.roleKey as 'admin' | 'manager' | 'operator' | 'viewer',
        })),
        activeTenantId: user.activeTenantId || memberships[0]!.tenantId,
      };
    },
  });

  const app = express();
  app.use(express.json());
  app.use('/api/workspace/costs', createCostsRouter(testAuth));
  app.use('/api/workspace', createWorkspaceRouter(testAuth));

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

test.after(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await db
    .delete(users)
    .where(eq(users.uid, adminUser.uid))
    .catch(() => {});
  await db
    .delete(users)
    .where(eq(users.uid, operatorUser.uid))
    .catch(() => {});
  await db
    .delete(users)
    .where(eq(users.uid, viewerUser.uid))
    .catch(() => {});
  await db
    .delete(users)
    .where(eq(users.uid, suspendedUser.uid))
    .catch(() => {});
  await db
    .delete(tenants)
    .where(eq(tenants.id, tenant1Id))
    .catch(() => {});
  await db
    .delete(tenants)
    .where(eq(tenants.id, tenant2Id))
    .catch(() => {});
  await closePool();
});

test('enforces authentication, tenant isolation, and dynamic Cost Center RBAC permissions', async () => {
  // 1. Unauthenticated -> 401
  const unauthRes = await fetch(`${baseUrl}/api/workspace/costs/summary`);
  assert.equal(unauthRes.status, 401);

  // 2. Suspended user -> 403
  const suspRes = await fetch(`${baseUrl}/api/workspace/costs/summary`, {
    headers: { Authorization: 'Bearer token-suspended' },
  });
  assert.equal(suspRes.status, 403);

  // 3. Default operator / viewer do NOT have canViewCostCenter -> 403
  const opDenied = await fetch(`${baseUrl}/api/workspace/costs/summary`, {
    headers: {
      Authorization: 'Bearer token-operator',
      'x-tenant-id': String(tenant1Id),
    },
  });
  assert.equal(opDenied.status, 403);

  // 4. Viewer cannot access cross-tenant -> 403
  const crossTenantDenied = await fetch(`${baseUrl}/api/workspace/costs/summary`, {
    headers: {
      Authorization: 'Bearer token-viewer',
      'x-tenant-id': String(tenant2Id),
    },
  });
  assert.equal(crossTenantDenied.status, 403);

  // 5. Grant viewer canViewCostCenter dynamically via RBAC API -> gets read-only 200 on GET, 403 on write
  const grantRes = await fetch(`${baseUrl}/api/workspace/rbac/matrix`, {
    method: 'PUT',
    headers: {
      Authorization: 'Bearer token-admin',
      'x-tenant-id': String(tenant1Id),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      changes: [
        { roleKey: 'viewer', permissionKey: 'canViewCostCenter', enabled: true },
      ],
    }),
  });
  assert.equal(grantRes.status, 200);

  const viewerSummaryRes = await fetch(`${baseUrl}/api/workspace/costs/summary`, {
    headers: {
      Authorization: 'Bearer token-viewer',
      'x-tenant-id': String(tenant1Id),
    },
  });
  assert.equal(viewerSummaryRes.status, 200);
  const viewerSummary = (await viewerSummaryRes.json()) as CostSummaryPayload;
  assert.equal(viewerSummary.canManageCosts, false);

  const viewerWriteDenied = await fetch(
    `${baseUrl}/api/workspace/costs/records`,
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer token-viewer',
        'x-tenant-id': String(tenant1Id),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        providerId: 'google_cloud_run',
        category: 'infrastructure',
        recordType: 'actual',
        amount: '100.00',
        currency: 'INR',
      }),
    }
  );
  assert.equal(viewerWriteDenied.status, 403);
});

test('persists manual expenses, deduplicates CSV imports, isolates currencies, evaluates budgets, triggers alerts & notifications, and enforces app toggle', async () => {
  const adminHeaders = {
    Authorization: 'Bearer token-admin',
    'x-tenant-id': String(tenant1Id),
    'Content-Type': 'application/json',
  };
  const billingPeriod = '2026-11';

  // 1. Create a tenant monthly budget in INR (Limit 1000.00, warn 80%, crit 100%)
  const budgetRes = await fetch(`${baseUrl}/api/workspace/costs/budgets`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      name: 'Monthly Total INR Budget',
      scopeType: 'tenant',
      period: 'monthly',
      budgetAmount: '1000.00',
      currency: 'INR',
      warningThresholdPct: 80,
      criticalThresholdPct: 100,
      enabled: true,
    }),
  });
  assert.equal(budgetRes.status, 201);
  const budgetData = (await budgetRes.json()) as { budget: { id: number } };
  const budgetId = budgetData.budget.id;

  // 2. Configure provider pricing rate (0.500000 INR per request)
  const priceRes = await fetch(
    `${baseUrl}/api/workspace/costs/providers/pricing`,
    {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({
        providerId: 'google_cloud_run',
        serviceName: 'Cloud Run Request Execution',
        category: 'infrastructure',
        unit: 'request',
        unitPrice: '0.500000',
        currency: 'INR',
        effectiveDate: '2026-11-01',
        active: true,
      }),
    }
  );
  assert.equal(priceRes.status, 200);

  // Check provider pricing persisted in DB & honest not_connected billing status returned
  const provRes = await fetch(`${baseUrl}/api/workspace/costs/providers`, {
    headers: adminHeaders,
  });
  assert.equal(provRes.status, 200);
  const provJson = (await provRes.json()) as {
    providers: CostProviderCatalogSummary[];
  };
  const gcp = provJson.providers.find((p) => p.providerId === 'google_cloud_run')!;
  assert.equal(gcp.billingIntegrationStatus, 'not_connected');
  assert.equal(gcp.pricingConfigs.length, 1);
  assert.equal(gcp.pricingConfigs[0]!.unitPrice, '0.500000');

  // Check usage estimates endpoint
  const estRes = await fetch(
    `${baseUrl}/api/workspace/costs/usage-estimates?billingPeriod=${billingPeriod}`,
    { headers: adminHeaders }
  );
  assert.equal(estRes.status, 200);
  const estJson = (await estRes.json()) as {
    estimates: CostUsageEstimateItem[];
  };
  const gcpEst = estJson.estimates.find((e) => e.providerId === 'google_cloud_run')!;
  assert.equal(gcpEst.pricingStatus, 'configured');

  // 3. Record manual estimated cost (must NOT trigger budget warning even if 2000 INR!)
  const estCostRes = await fetch(`${baseUrl}/api/workspace/costs/records`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      mode: 'manual',
      providerId: 'gemini_ai',
      appId: 'workflow-automation',
      category: 'ai_models',
      recordType: 'estimated',
      usageQuantity: '1000',
      unit: '1k_input_tokens',
      unitPrice: '2.000000',
      currency: 'INR',
      billingPeriod,
      recordedAt: '2026-11-05T10:00:00.000Z',
      notes: 'Estimated AI tokens projection',
    }),
  });
  assert.equal(estCostRes.status, 201);
  const estCostBody = (await estCostRes.json()) as { record: CostRecordItem };
  assert.equal(estCostBody.record.amount, '2000.0000');
  assert.equal(estCostBody.record.recordType, 'estimated');

  // Verify 0 alerts after estimated-only entry
  const alertsBefore = await db
    .select()
    .from(costAlerts)
    .where(eq(costAlerts.tenantId, tenant1Id));
  assert.equal(alertsBefore.length, 0);

  // 4. Record manual ACTUAL expense = 850.00 INR -> crosses 80% warning threshold!
  const actualRes = await fetch(`${baseUrl}/api/workspace/costs/records`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      mode: 'manual',
      providerId: 'voice_telephony_approved',
      appId: 'call-operations',
      category: 'telephony',
      recordType: 'actual',
      amount: '850.00',
      currency: 'INR',
      billingPeriod,
      recordedAt: '2026-11-10T10:00:00.000Z',
      reference: 'TEL-INV-850',
      notes: 'Monthly voice carrier minutes',
    }),
  });
  assert.equal(actualRes.status, 201);

  const alertsAfterWarn = await db
    .select()
    .from(costAlerts)
    .where(eq(costAlerts.tenantId, tenant1Id));
  assert.equal(alertsAfterWarn.length, 1);
  assert.equal(alertsAfterWarn[0]!.alertLevel, 'warning');
  assert.equal(alertsAfterWarn[0]!.status, 'active');

  // Verify internal notification emitted
  const notifsAfterWarn = await db
    .select()
    .from(internalNotifications)
    .where(eq(internalNotifications.tenantId, tenant1Id));
  assert.equal(notifsAfterWarn.length, 1);
  assert.ok(notifsAfterWarn[0]!.title.includes('Warning Cost Budget Alert'));

  // 5. Import CSV batch containing:
  //    - 250.00 INR (pushes verified total to 1100.00 INR -> crosses 100% critical!)
  //    - 35.00 USD (verifies currency isolation)
  const csvBody = [
    'providerId,providerName,category,amount,currency,billingPeriod,recordedAt,reference,appId,notes',
    `google_cloud_run,Google Cloud Run,infrastructure,250.00,INR,${billingPeriod},2026-11-11,GCP-CSV-01,forms-studio,Cloud Run batch`,
    `external_saas_tools,External SaaS,software_services,35.00,USD,${billingPeriod},2026-11-12,SAAS-USD-01,,Seat license`,
  ].join('\n');

  const import1Res = await fetch(`${baseUrl}/api/workspace/costs/records`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      mode: 'import',
      csvText: csvBody,
    }),
  });
  assert.equal(import1Res.status, 201);
  const import1Json = (await import1Res.json()) as {
    importedCount: number;
    skippedDuplicatesCount: number;
  };
  assert.equal(import1Json.importedCount, 2);
  assert.equal(import1Json.skippedDuplicatesCount, 0);

  // Re-import exact same CSV -> must skip both duplicates and NOT double count!
  const import2Res = await fetch(`${baseUrl}/api/workspace/costs/records`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      mode: 'import',
      csvText: csvBody,
    }),
  });
  assert.equal(import2Res.status, 201);
  const import2Json = (await import2Res.json()) as {
    importedCount: number;
    skippedDuplicatesCount: number;
  };
  assert.equal(import2Json.importedCount, 0);
  assert.equal(import2Json.skippedDuplicatesCount, 2);

  // Verify Critical alert created once (total 2 alerts: 1 warning, 1 critical)
  const alertsAfterCrit = await db
    .select()
    .from(costAlerts)
    .where(eq(costAlerts.tenantId, tenant1Id));
  assert.equal(alertsAfterCrit.length, 2);
  assert.ok(alertsAfterCrit.some((a) => a.alertLevel === 'critical'));

  // 6. Verify summary currency isolation & totals in INR vs USD
  const sumInrRes = await fetch(
    `${baseUrl}/api/workspace/costs/summary?billingPeriod=${billingPeriod}&currency=INR`,
    { headers: adminHeaders }
  );
  assert.equal(sumInrRes.status, 200);
  const sumInr = (await sumInrRes.json()) as CostSummaryPayload;
  assert.equal(sumInr.hasMixedCurrencies, true);
  assert.deepEqual(sumInr.availableCurrencies, ['INR', 'USD']);
  assert.equal(sumInr.totals.actualTotal, '850.00');
  assert.equal(sumInr.totals.importedTotal, '250.00');
  assert.equal(sumInr.totals.verifiedTotal, '1100.00');
  assert.equal(sumInr.totals.estimatedTotal, '2000.00');
  assert.equal(sumInr.budgetUtilizationPct, 110);

  const sumUsdRes = await fetch(
    `${baseUrl}/api/workspace/costs/summary?billingPeriod=${billingPeriod}&currency=USD`,
    { headers: adminHeaders }
  );
  assert.equal(sumUsdRes.status, 200);
  const sumUsd = (await sumUsdRes.json()) as CostSummaryPayload;
  assert.equal(sumUsd.totals.currency, 'USD');
  assert.equal(sumUsd.totals.importedTotal, '35.00');
  assert.equal(sumUsd.totals.actualTotal, '0.00');

  // 7. Resolve active warning alert + raise budget cap -> verify critical auto-resolves
  const warnAlert = alertsAfterCrit.find((a) => a.alertLevel === 'warning')!;
  const resolveRes = await fetch(
    `${baseUrl}/api/workspace/costs/alerts/${warnAlert.id}/resolve`,
    {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({}),
    }
  );
  assert.equal(resolveRes.status, 200);
  const resolvedJson = (await resolveRes.json()) as { alert: CostAlertItem };
  assert.equal(resolvedJson.alert.status, 'resolved');

  const updateBudgetRes = await fetch(
    `${baseUrl}/api/workspace/costs/budgets/${budgetId}`,
    {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({
        budgetAmount: '5000.00',
      }),
    }
  );
  assert.equal(updateBudgetRes.status, 200);

  const budgetsCheckRes = await fetch(
    `${baseUrl}/api/workspace/costs/budgets?billingPeriod=${billingPeriod}`,
    { headers: adminHeaders }
  );
  const budgetsCheckJson = (await budgetsCheckRes.json()) as {
    budgets: CostBudgetEvaluationItem[];
  };
  assert.equal(budgetsCheckJson.budgets[0]!.alertState, 'nominal');

  // 8. Tenant 2 remains isolated with 0 records
  const t2RecsRes = await fetch(`${baseUrl}/api/workspace/costs/records`, {
    headers: {
      Authorization: 'Bearer token-admin',
      'x-tenant-id': String(tenant2Id),
    },
  });
  assert.equal(t2RecsRes.status, 200);
  const t2RecsJson = (await t2RecsRes.json()) as { total: number };
  assert.equal(t2RecsJson.total, 0);

  // 9. Verify activity_logs recorded financial audit events
  const auditRows = await db
    .select()
    .from(activityLogs)
    .where(and(eq(activityLogs.tenantId, tenant1Id), eq(activityLogs.module, 'costs')))
    .orderBy(desc(activityLogs.id));
  assert.ok(auditRows.length >= 6);

  // 10. Disabling cost-control-center in App Management enforces 403 APP_DISABLED cleanly
  const disableAppRes = await fetch(
    `${baseUrl}/api/workspace/apps/cost-control-center`,
    {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({ enabled: false }),
    }
  );
  assert.equal(disableAppRes.status, 200);

  const blockedRes = await fetch(`${baseUrl}/api/workspace/costs/summary`, {
    headers: adminHeaders,
  });
  assert.equal(blockedRes.status, 403);
  const blockedBody = (await blockedRes.json()) as { code?: string };
  assert.equal(blockedBody.code, 'APP_DISABLED');

  // Re-enable cleanly and confirm data preserved
  await fetch(`${baseUrl}/api/workspace/apps/cost-control-center`, {
    method: 'PUT',
    headers: adminHeaders,
    body: JSON.stringify({ enabled: true }),
  });

  const dbCostCount = await db
    .select()
    .from(costRecords)
    .where(eq(costRecords.tenantId, tenant1Id));
  assert.equal(dbCostCount.length, 4);

  const dbPricingCount = await db
    .select()
    .from(providerPricingConfigs)
    .where(eq(providerPricingConfigs.tenantId, tenant1Id));
  assert.equal(dbPricingCount.length, 1);

  const dbBudgetCount = await db
    .select()
    .from(costBudgets)
    .where(eq(costBudgets.tenantId, tenant1Id));
  assert.equal(dbBudgetCount.length, 1);
});
