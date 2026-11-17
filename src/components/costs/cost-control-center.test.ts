import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CostControlCenterContent,
  type CostControlCenterContentProps,
} from './CostControlCenterView.tsx';
import type { CostSummaryPayload } from '../../shared/types.ts';

function buildBaseSummary(): CostSummaryPayload {
  return {
    tenantId: 1,
    billingPeriod: '2026-11',
    selectedCurrency: 'INR',
    availableCurrencies: ['INR', 'USD'],
    hasMixedCurrencies: true,
    currencyTotals: [
      {
        currency: 'INR',
        actualTotal: '850.00',
        importedTotal: '250.00',
        verifiedTotal: '1100.00',
        estimatedTotal: '400.00',
        projectedMonthlySpend: '2200.00',
        recordCount: 3,
      },
      {
        currency: 'USD',
        actualTotal: '20.00',
        importedTotal: '0.00',
        verifiedTotal: '20.00',
        estimatedTotal: '0.00',
        projectedMonthlySpend: '40.00',
        recordCount: 1,
      },
    ],
    totals: {
      currency: 'INR',
      actualTotal: '850.00',
      importedTotal: '250.00',
      verifiedTotal: '1100.00',
      estimatedTotal: '400.00',
      projectedMonthlySpend: '2200.00',
      recordCount: 3,
    },
    totalBudgetConfigured: '2000.00',
    budgetUtilizationPct: 55,
    activeAlertsCount: 1,
    incompleteDataIndicators: [
      'Live external vendor billing APIs are not connected; figures reflect verified manual entries, imported CSV statements, and configured unit-price estimates only.',
    ],
    dailyTrend: [
      {
        key: '2026-11-10',
        label: '11-10',
        actualAmount: '850.00',
        importedAmount: '0.00',
        verifiedTotalAmount: '850.00',
        estimatedAmount: '400.00',
      },
    ],
    monthlyTrend: [
      {
        key: '2026-11',
        label: '2026-11',
        actualAmount: '850.00',
        importedAmount: '250.00',
        verifiedTotalAmount: '1100.00',
        estimatedAmount: '400.00',
      },
    ],
    byProvider: [
      {
        key: 'voice_telephony_approved',
        label: 'Voice & Telephony Provider',
        actualAmount: '850.00',
        importedAmount: '0.00',
        verifiedTotalAmount: '850.00',
        estimatedAmount: '0.00',
        recordCount: 1,
        sharePct: 77.27,
      },
    ],
    byCategory: [
      {
        key: 'telephony',
        label: 'Voice & Telephony',
        actualAmount: '850.00',
        importedAmount: '0.00',
        verifiedTotalAmount: '850.00',
        estimatedAmount: '0.00',
        recordCount: 1,
        sharePct: 77.27,
      },
    ],
    byApp: [
      {
        key: 'forms-studio',
        label: 'forms-studio',
        actualAmount: '0.00',
        importedAmount: '250.00',
        verifiedTotalAmount: '250.00',
        estimatedAmount: '0.00',
        recordCount: 1,
        sharePct: 22.73,
      },
    ],
    budgets: [
      {
        id: 1,
        tenantId: 1,
        name: 'Monthly Tenant Spend Cap',
        scopeType: 'tenant',
        scopeValue: null,
        period: 'monthly',
        budgetAmount: '2000.0000',
        currency: 'INR',
        warningThresholdPct: 80,
        criticalThresholdPct: 100,
        enabled: true,
        createdByUid: 'admin-1',
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
        observedVerifiedSpend: '1100.00',
        estimatedSpend: '400.00',
        utilizationPct: 55,
        projectedSpend: '2200.00',
        projectedUtilizationPct: 110,
        alertState: 'nominal',
        activeAlertCount: 1,
      },
    ],
    recentAlerts: [],
    canManageCosts: true,
  };
}

function buildBaseProps(
  overrides: Partial<CostControlCenterContentProps> = {}
): CostControlCenterContentProps {
  const summary = buildBaseSummary();
  return {
    tenantName: 'DialPulse Capital DSA (Demo)',
    activeTab: 'overview',
    onTabChange: () => {},
    billingPeriod: '2026-11',
    onBillingPeriodChange: () => {},
    selectedCurrency: 'INR',
    onCurrencyChange: () => {},
    summary,
    records: [
      {
        id: 101,
        tenantId: 1,
        providerId: 'voice_telephony_approved',
        providerName: 'Voice & Telephony Provider',
        appId: 'call-operations',
        category: 'telephony',
        recordType: 'actual',
        amount: '850.0000',
        currency: 'INR',
        usageQuantity: '1000.0000',
        unit: 'minute',
        unitPrice: '0.850000',
        billingPeriod: '2026-11',
        reference: 'TEL-001',
        idempotencyKey: null,
        sourceType: 'manual_entry',
        sourceMetadata: {},
        notes: 'Carrier voice invoice',
        recordedAt: '2026-11-10T10:00:00.000Z',
        createdByUid: 'admin-1',
        createdAt: '2026-11-10T10:00:00.000Z',
        updatedAt: '2026-11-10T10:00:00.000Z',
      },
    ],
    recordsTotal: 1,
    recordsPage: 1,
    recordsPageSize: 20,
    onRecordsPageChange: () => {},
    recordFilters: {
      search: '',
      category: '',
      recordType: '',
      providerId: '',
      from: '',
      to: '',
    },
    onRecordFiltersChange: () => {},
    providers: [
      {
        providerId: 'google_cloud_run',
        name: 'Google Cloud Run & Compute',
        category: 'infrastructure',
        registryProviderId: null,
        billingIntegrationStatus: 'not_connected',
        billingIntegrationNote: 'Live billing API sync is not connected.',
        supportedUnits: ['request', 'vCPU-hour'],
        pricingConfigs: [],
        lastImportedAt: null,
        lastRecordedAt: null,
        verifiedSpendTotal: '250.00',
        estimatedSpendTotal: '0.00',
      },
    ],
    budgets: summary.budgets,
    alerts: [
      {
        id: 9,
        tenantId: 1,
        budgetId: 1,
        budgetName: 'Monthly Tenant Spend Cap',
        scopeType: 'tenant',
        scopeValue: null,
        billingPeriod: '2026-11',
        alertLevel: 'warning',
        thresholdPct: 80,
        observedAmount: '1650.0000',
        budgetAmount: '2000.0000',
        currency: 'INR',
        status: 'active',
        triggeredAt: '2026-11-10T12:00:00.000Z',
        resolvedAt: null,
      },
    ],
    usageEstimates: [
      {
        providerId: 'google_cloud_run',
        providerName: 'Google Cloud Run & Compute',
        appId: 'forms-studio',
        category: 'infrastructure',
        serviceName: 'Workspace Intake & Execution Requests',
        usageSource: 'PostgreSQL form_submissions + automation_executions',
        usageQuantity: '42',
        unit: 'request',
        unitPrice: null,
        currency: null,
        estimatedAmount: null,
        pricingStatus: 'missing_pricing',
        note: 'Pricing not configured.',
      },
    ],
    canManageCosts: true,
    loading: false,
    error: null,
    busyAction: null,
    onRefresh: () => {},
    onOpenAddExpense: () => {},
    onOpenCsvImport: () => {},
    onOpenBudgetModal: () => {},
    onOpenPricingModal: () => {},
    onSelectRecordDetail: () => {},
    onResolveAlert: () => {},
    ...overrides,
  };
}

test('CostControlCenterContent renders Overview, multi-currency isolation, and separate Actual/Imported/Estimated/Projected KPIs', () => {
  const html = renderToStaticMarkup(
    React.createElement(CostControlCenterContent, buildBaseProps({ activeTab: 'overview' }))
  );

  assert.match(html, /Cost Control Center/);
  assert.match(html, /Verified Actual Spend/);
  assert.match(html, /Imported Billing Spend/);
  assert.match(html, /Estimated Usage Spend/);
  assert.match(html, /Projected Period Spend/);
  assert.match(html, /Multi-Currency Isolation Summary/);
  assert.match(html, /Add Expense/);
  assert.match(html, /Import CSV/);
  assert.match(html, /Live external vendor billing APIs are not connected/);
});

test('CostControlCenterContent renders Analytics, Expense Records, Budgets & Alerts, and Provider Pricing tabs cleanly', () => {
  const analyticsHtml = renderToStaticMarkup(
    React.createElement(CostControlCenterContent, buildBaseProps({ activeTab: 'analytics' }))
  );
  assert.match(analyticsHtml, /Daily Spend Trend/);
  assert.match(analyticsHtml, /Monthly Spend Comparison/);
  assert.match(analyticsHtml, /Spend by Provider/);
  assert.match(analyticsHtml, /Spend by Workspace Application/);

  const recordsHtml = renderToStaticMarkup(
    React.createElement(CostControlCenterContent, buildBaseProps({ activeTab: 'records' }))
  );
  assert.match(recordsHtml, /Expense Ledger/);
  assert.match(recordsHtml, /TEL-001/);

  const budgetsHtml = renderToStaticMarkup(
    React.createElement(CostControlCenterContent, buildBaseProps({ activeTab: 'budgets' }))
  );
  assert.match(budgetsHtml, /Configured Cost Budgets/);
  assert.match(budgetsHtml, /Cost Threshold Alert History/);
  assert.match(budgetsHtml, /Resolve/);

  const providersHtml = renderToStaticMarkup(
    React.createElement(CostControlCenterContent, buildBaseProps({ activeTab: 'providers' }))
  );
  assert.match(providersHtml, /Recorded Platform Usage Estimates/);
  assert.match(providersHtml, /Pricing not configured/);
  assert.match(providersHtml, /Not connected · Manual \/ CSV Import/);
});

test('CostControlCenterContent respects read-only RBAC mode, loading skeletons, and error/retry states', () => {
  const readOnlyHtml = renderToStaticMarkup(
    React.createElement(
      CostControlCenterContent,
      buildBaseProps({ activeTab: 'overview', canManageCosts: false })
    )
  );
  assert.match(readOnlyHtml, /Read-only view/);
  assert.doesNotMatch(readOnlyHtml, />Add Expense</);
  assert.doesNotMatch(readOnlyHtml, />Import CSV</);

  const loadingHtml = renderToStaticMarkup(
    React.createElement(
      CostControlCenterContent,
      buildBaseProps({ loading: true, summary: null })
    )
  );
  assert.match(loadingHtml, /cost-loading-state/);

  const errorHtml = renderToStaticMarkup(
    React.createElement(
      CostControlCenterContent,
      buildBaseProps({ error: 'Database unavailable', summary: null })
    )
  );
  assert.match(errorHtml, /Database unavailable/);
  assert.match(errorHtml, /Retry Loading Cost Control Center/);
});
