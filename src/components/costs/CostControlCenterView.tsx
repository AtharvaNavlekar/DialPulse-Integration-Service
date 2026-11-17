import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  CircleDollarSign,
  FileSpreadsheet,
  Filter,
  Info,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Upload,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { usePreferences } from '../../context/PreferencesContext.tsx';
import { useToast } from '../../context/ToastContext.tsx';
import {
  COST_CATEGORIES,
  SUPPORTED_CURRENCIES,
  formatCurrencyAmount,
  getCostCategoryLabel,
  getCurrentBillingPeriod,
  multiplyQuantityByUnitPrice,
} from '../../shared/cost-engine.ts';
import { hasEffectivePermission } from '../../shared/rbac.ts';
import type { CostSubTab } from '../../shared/routes.ts';
import type {
  CostAlertItem,
  CostBudgetEvaluationItem,
  CostCategory,
  CostProviderCatalogSummary,
  CostRecordItem,
  CostRecordType,
  CostSummaryPayload,
  CostUsageEstimateItem,
} from '../../shared/types.ts';
import {
  AlertBanner,
  Button,
  Card,
  INPUT_BASE_CLASS,
  PageHeader,
  SELECT_BASE_CLASS,
  SegmentedControl,
  StatusIndicator,
} from '../ui/Primitives.tsx';

export interface CostControlCenterContentProps {
  tenantName: string;
  activeTab: CostSubTab;
  onTabChange: (tab: CostSubTab) => void;
  billingPeriod: string;
  onBillingPeriodChange: (period: string) => void;
  selectedCurrency: string;
  onCurrencyChange: (currency: string) => void;
  summary: CostSummaryPayload | null;
  records: CostRecordItem[];
  recordsTotal: number;
  recordsPage: number;
  recordsPageSize: number;
  onRecordsPageChange: (page: number) => void;
  recordFilters: {
    search: string;
    category: string;
    recordType: string;
    providerId: string;
    from: string;
    to: string;
  };
  onRecordFiltersChange: (
    next: CostControlCenterContentProps['recordFilters']
  ) => void;
  providers: CostProviderCatalogSummary[];
  budgets: CostBudgetEvaluationItem[];
  alerts: CostAlertItem[];
  usageEstimates: CostUsageEstimateItem[];
  canManageCosts: boolean;
  loading: boolean;
  error: string | null;
  busyAction: string | null;
  onRefresh: () => void;
  onOpenAddExpense: () => void;
  onOpenCsvImport: () => void;
  onOpenBudgetModal: (budget?: CostBudgetEvaluationItem) => void;
  onOpenPricingModal: (provider?: CostProviderCatalogSummary) => void;
  onSelectRecordDetail: (record: CostRecordItem) => void;
  onResolveAlert: (alertId: number) => void;
  onRecordEstimate?: (estimate: CostUsageEstimateItem) => void;
  formatTimestamp?: (iso: string) => string;
}

const RECORD_TYPE_LABEL: Record<CostRecordType, string> = {
  actual: 'Actual',
  imported: 'Imported',
  estimated: 'Estimated',
};

const APP_ID_OPTIONS = [
  { id: '', label: 'Shared Platform / Infrastructure' },
  { id: 'forms-studio', label: 'Forms Studio' },
  { id: 'workflow-automation', label: 'Workflow Automation' },
  { id: 'cost-control-center', label: 'Cost Control Center' },
  { id: 'integrations-console', label: 'Integrations Console' },
];

export function CostControlCenterContent(props: CostControlCenterContentProps) {
  const {
    tenantName,
    activeTab,
    onTabChange,
    billingPeriod,
    onBillingPeriodChange,
    selectedCurrency,
    onCurrencyChange,
    summary,
    records,
    recordsTotal,
    recordsPage,
    recordsPageSize,
    onRecordsPageChange,
    recordFilters,
    onRecordFiltersChange,
    providers,
    budgets,
    alerts,
    usageEstimates,
    canManageCosts,
    loading,
    error,
    busyAction,
    onRefresh,
    onOpenAddExpense,
    onOpenCsvImport,
    onOpenBudgetModal,
    onOpenPricingModal,
    onSelectRecordDetail,
    onResolveAlert,
    onRecordEstimate,
    formatTimestamp = (iso) => new Date(iso).toLocaleString(),
  } = props;

  if (loading && !summary) {
    return (
      <div className="space-y-6" data-testid="cost-loading-state">
        <div className="h-12 w-72 bg-[var(--dp-surface-container)] rounded-[var(--dp-radius-md)] animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((idx) => (
            <div
              key={idx}
              className="h-28 bg-[var(--dp-surface-container-lowest)] border border-[var(--dp-outline-variant)] rounded-[var(--dp-radius-md)] animate-pulse"
            />
          ))}
        </div>
        <div className="h-64 bg-[var(--dp-surface-container-lowest)] border border-[var(--dp-outline-variant)] rounded-[var(--dp-radius-md)] animate-pulse" />
      </div>
    );
  }

  if (error && !summary) {
    return (
      <Card className="p-6 space-y-4">
        <AlertBanner tone="error" message={error} />
        <div>
          <Button variant="primary" onClick={onRefresh}>
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            Retry Loading Cost Control Center
          </Button>
        </div>
      </Card>
    );
  }

  const totals = summary?.totals;
  const displayCurrency = summary?.selectedCurrency || selectedCurrency || 'INR';
  const currencyOptions =
    summary?.availableCurrencies && summary.availableCurrencies.length > 0
      ? summary.availableCurrencies
      : [displayCurrency];

  const totalPages = Math.max(1, Math.ceil(recordsTotal / Math.max(1, recordsPageSize)));

  const renderTrendRows = (
    points: NonNullable<CostSummaryPayload['dailyTrend']>,
    emptyLabel: string
  ) => {
    if (points.length === 0) {
      return (
        <div className="p-6 text-center text-[13px] text-[var(--dp-on-surface-variant)]">
          {emptyLabel}
        </div>
      );
    }

    const maxNumeric = Math.max(
      1,
      ...points.map((p) =>
        Math.max(Number(p.verifiedTotalAmount) || 0, Number(p.estimatedAmount) || 0)
      )
    );

    return (
      <div className="divide-y divide-[var(--dp-outline-variant)]">
        {points.map((pt) => {
          const verifiedNum = Number(pt.verifiedTotalAmount) || 0;
          const estimatedNum = Number(pt.estimatedAmount) || 0;
          const verifiedPct = verifiedNum > 0 ? Math.max(4, Math.round((verifiedNum / maxNumeric) * 100)) : 0;
          const estimatedPct = estimatedNum > 0 ? Math.max(4, Math.round((estimatedNum / maxNumeric) * 100)) : 0;
          return (
            <div key={pt.key} className="px-5 py-3 space-y-1.5 text-[12px]">
              <div className="flex items-center justify-between gap-4">
                <span className="font-mono font-medium text-[var(--dp-on-surface)] tabular-nums">
                  {pt.label}
                </span>
                <div className="flex items-center gap-4 font-mono tabular-nums">
                  <span className="text-[var(--dp-on-surface)]">
                    Verified: {formatCurrencyAmount(pt.verifiedTotalAmount, displayCurrency)}
                  </span>
                  {estimatedNum > 0 && (
                    <span className="text-[var(--dp-warning-text)]">
                      Estimated: {formatCurrencyAmount(pt.estimatedAmount, displayCurrency)}
                    </span>
                  )}
                </div>
              </div>
              <div className="space-y-1">
                <div className="h-2 bg-[var(--dp-surface-container)] rounded-[var(--dp-radius-sm)] overflow-hidden">
                  <div
                    className="h-full bg-[var(--dp-primary)] rounded-[var(--dp-radius-sm)]"
                    style={{ width: `${verifiedPct}%` }}
                  />
                </div>
                {estimatedNum > 0 && (
                  <div className="h-1.5 bg-[var(--dp-surface-container)] rounded-[var(--dp-radius-sm)] overflow-hidden">
                    <div
                      className="h-full bg-[var(--dp-warning)] rounded-[var(--dp-radius-sm)]"
                      style={{ width: `${estimatedPct}%` }}
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderBreakdownTable = (
    title: string,
    subtitle: string,
    rows: NonNullable<CostSummaryPayload['byProvider']>,
    emptyText: string
  ) => (
    <Card className="overflow-hidden">
      <div className="px-5 py-4 border-b border-[var(--dp-outline-variant)]">
        <h3 className="text-[15px] font-semibold text-[var(--dp-on-surface)]">
          {title}
        </h3>
        <p className="text-[12px] text-[var(--dp-on-surface-variant)] mt-0.5">
          {subtitle}
        </p>
      </div>
      {rows.length === 0 ? (
        <div className="p-6 text-center text-[13px] text-[var(--dp-on-surface-variant)]">
          {emptyText}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-[var(--dp-surface-container-low)] border-b border-[var(--dp-outline-variant)] text-[var(--dp-on-surface-variant)]">
              <tr>
                <th className="py-2.5 px-4 font-medium">Dimension</th>
                <th className="py-2.5 px-4 font-medium text-right">Actual</th>
                <th className="py-2.5 px-4 font-medium text-right">Imported</th>
                <th className="py-2.5 px-4 font-medium text-right">Verified Total</th>
                <th className="py-2.5 px-4 font-medium text-right">Estimated (Sep.)</th>
                <th className="py-2.5 px-4 font-medium text-right">Share</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--dp-outline-variant)]">
              {rows.map((row) => (
                <tr
                  key={row.key}
                  className="hover:bg-[var(--dp-surface-variant)]/50 transition-colors"
                >
                  <td className="py-2.5 px-4 font-medium text-[var(--dp-on-surface)]">
                    <div>{row.label}</div>
                    <div className="text-[11px] font-mono text-[var(--dp-on-surface-variant)] tabular-nums">
                      {row.recordCount} {row.recordCount === 1 ? 'entry' : 'entries'}
                    </div>
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums text-[var(--dp-on-surface)]">
                    {formatCurrencyAmount(row.actualAmount, displayCurrency)}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums text-[var(--dp-on-surface)]">
                    {formatCurrencyAmount(row.importedAmount, displayCurrency)}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono font-semibold tabular-nums text-[var(--dp-on-surface)]">
                    {formatCurrencyAmount(row.verifiedTotalAmount, displayCurrency)}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums text-[var(--dp-warning-text)]">
                    {formatCurrencyAmount(row.estimatedAmount, displayCurrency)}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums text-[var(--dp-on-surface-variant)]">
                    {row.sharePct.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cost Control Center"
        description={`Financial governance, verified expense ledger, provider pricing, and tenant budgets for ${tenantName}.`}
        actions={
          <>
            {canManageCosts && (
              <>
                <Button variant="secondary" onClick={onOpenCsvImport}>
                  <Upload className="w-4 h-4" aria-hidden="true" />
                  Import CSV
                </Button>
                <Button variant="primary" onClick={onOpenAddExpense}>
                  <Plus className="w-4 h-4" aria-hidden="true" />
                  Add Expense
                </Button>
              </>
            )}
          </>
        }
      />

      {error && <AlertBanner tone="error" message={error} />}

      {!canManageCosts && (
        <AlertBanner
          tone="info"
          message="Read-only view: your current role has canViewCostCenter without canManageCostCenter. Expense recording, CSV imports, pricing edits, and budget modifications require management permission."
        />
      )}

      {/* Navigation Tabs + Global Period/Currency Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-2 border-b border-[var(--dp-outline-variant)]">
        <SegmentedControl<CostSubTab>
          value={activeTab}
          onChange={onTabChange}
          options={[
            { value: 'overview', label: 'Overview' },
            { value: 'analytics', label: 'Spending Analytics' },
            { value: 'records', label: 'Expense Records' },
            { value: 'budgets', label: 'Budgets & Alerts' },
            { value: 'providers', label: 'Provider Pricing' },
          ]}
        />

        <div className="flex flex-wrap items-center gap-2.5">
          <label className="flex items-center gap-1.5 text-[12px] text-[var(--dp-on-surface-variant)]">
            <span>Period</span>
            <input
              type="month"
              aria-label="Billing Period"
              value={billingPeriod}
              onChange={(e) => {
                if (e.target.value) onBillingPeriodChange(e.target.value);
              }}
              className={`${INPUT_BASE_CLASS} w-38 py-1.5 text-[12px] font-mono tabular-nums`}
            />
          </label>
          <label className="flex items-center gap-1.5 text-[12px] text-[var(--dp-on-surface-variant)]">
            <span>Currency</span>
            <select
              aria-label="Display Currency"
              value={displayCurrency}
              onChange={(e) => onCurrencyChange(e.target.value)}
              className={`${SELECT_BASE_CLASS} py-1.5 text-[12px] font-mono`}
            >
              {currencyOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="secondary"
            size="sm"
            onClick={onRefresh}
            disabled={loading}
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Data Integrity / Multi-currency / External Billing Notice */}
      {summary && summary.incompleteDataIndicators.length > 0 && (
        <div className="px-4 py-3 rounded-[var(--dp-radius-sm)] border border-[var(--dp-outline-variant)] bg-[var(--dp-surface-container-low)] flex items-start gap-2.5 text-[12px] text-[var(--dp-on-surface-variant)]">
          <Info className="w-4 h-4 text-[var(--dp-primary)] shrink-0 mt-0.5" aria-hidden="true" />
          <div className="space-y-1">
            {summary.incompleteDataIndicators.map((note, idx) => (
              <p key={idx}>{note}</p>
            ))}
          </div>
        </div>
      )}

      {/* TAB 1: OVERVIEW */}
      {activeTab === 'overview' && summary && totals && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Card className="p-5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-medium text-[var(--dp-on-surface-variant)]">
                  Verified Actual Spend
                </span>
                <span className="text-[11px] font-mono px-2 py-0.5 border border-[var(--dp-outline-variant)] rounded-[var(--dp-radius-sm)] text-[var(--dp-on-surface-variant)]">
                  Actual
                </span>
              </div>
              <div className="mt-2 font-heading text-[24px] font-semibold text-[var(--dp-on-surface)] font-mono tabular-nums">
                {formatCurrencyAmount(totals.actualTotal, displayCurrency)}
              </div>
              <p className="text-[12px] text-[var(--dp-on-surface-variant)] mt-1">
                Manually recorded vendor invoices for {summary.billingPeriod}
              </p>
            </Card>

            <Card className="p-5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-medium text-[var(--dp-on-surface-variant)]">
                  Imported Billing Spend
                </span>
                <span className="text-[11px] font-mono px-2 py-0.5 border border-[var(--dp-outline-variant)] rounded-[var(--dp-radius-sm)] text-[var(--dp-on-surface-variant)]">
                  Imported CSV
                </span>
              </div>
              <div className="mt-2 font-heading text-[24px] font-semibold text-[var(--dp-on-surface)] font-mono tabular-nums">
                {formatCurrencyAmount(totals.importedTotal, displayCurrency)}
              </div>
              <p className="text-[12px] text-[var(--dp-on-surface-variant)] mt-1">
                Verified Total (Actual + Imported):{' '}
                <span className="font-mono font-semibold tabular-nums text-[var(--dp-on-surface)]">
                  {formatCurrencyAmount(totals.verifiedTotal, displayCurrency)}
                </span>
              </p>
            </Card>

            <Card className="p-5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-medium text-[var(--dp-on-surface-variant)]">
                  Estimated Usage Spend
                </span>
                <StatusIndicator tone="warning" label="Estimated" />
              </div>
              <div className="mt-2 font-heading text-[24px] font-semibold text-[var(--dp-warning-text)] font-mono tabular-nums">
                {formatCurrencyAmount(totals.estimatedTotal, displayCurrency)}
              </div>
              <p className="text-[12px] text-[var(--dp-on-surface-variant)] mt-1">
                Tracked separately from verified expenditure
              </p>
            </Card>

            <Card className="p-5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-medium text-[var(--dp-on-surface-variant)]">
                  Monthly Budget Utilization
                </span>
                <button
                  type="button"
                  onClick={() => onTabChange('budgets')}
                  className="text-[12px] font-medium text-[var(--dp-primary)] hover:underline cursor-pointer"
                >
                  Budgets
                </button>
              </div>
              <div className="mt-2 flex items-baseline justify-between gap-2">
                <span className="font-heading text-[24px] font-semibold text-[var(--dp-on-surface)] font-mono tabular-nums">
                  {summary.budgetUtilizationPct !== null
                    ? `${summary.budgetUtilizationPct.toFixed(1)}%`
                    : 'Not set'}
                </span>
                <span className="text-[12px] font-mono text-[var(--dp-on-surface-variant)] tabular-nums">
                  {summary.totalBudgetConfigured !== null
                    ? `Limit ${formatCurrencyAmount(summary.totalBudgetConfigured, displayCurrency)}`
                    : 'No monthly budget'}
                </span>
              </div>
              <div className="mt-2 h-2 bg-[var(--dp-surface-container)] rounded-[var(--dp-radius-sm)] overflow-hidden">
                <div
                  className={`h-full rounded-[var(--dp-radius-sm)] ${
                    (summary.budgetUtilizationPct ?? 0) >= 100
                      ? 'bg-[var(--dp-error)]'
                      : (summary.budgetUtilizationPct ?? 0) >= 80
                        ? 'bg-[var(--dp-warning)]'
                        : 'bg-[var(--dp-primary)]'
                  }`}
                  style={{
                    width: `${Math.min(100, Math.max(0, summary.budgetUtilizationPct ?? 0))}%`,
                  }}
                />
              </div>
            </Card>

            <Card className="p-5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-medium text-[var(--dp-on-surface-variant)]">
                  Projected Period Spend
                </span>
                <StatusIndicator tone="info" label="Projected" />
              </div>
              <div className="mt-2 font-heading text-[24px] font-semibold text-[var(--dp-on-surface)] font-mono tabular-nums">
                {totals.projectedMonthlySpend !== null
                  ? formatCurrencyAmount(totals.projectedMonthlySpend, displayCurrency)
                  : 'Insufficient data'}
              </div>
              <p className="text-[12px] text-[var(--dp-on-surface-variant)] mt-1">
                Linear run-rate projection from verified spend only
              </p>
            </Card>

            <Card className="p-5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-medium text-[var(--dp-on-surface-variant)]">
                  Active Cost Alerts
                </span>
                <StatusIndicator
                  tone={summary.activeAlertsCount > 0 ? 'error' : 'success'}
                  label={summary.activeAlertsCount > 0 ? 'Attention' : 'Nominal'}
                />
              </div>
              <div
                className={`mt-2 font-heading text-[24px] font-semibold font-mono tabular-nums ${
                  summary.activeAlertsCount > 0
                    ? 'text-[var(--dp-error)]'
                    : 'text-[var(--dp-on-surface)]'
                }`}
              >
                {summary.activeAlertsCount}
              </div>
              <p className="text-[12px] text-[var(--dp-on-surface-variant)] mt-1">
                Threshold notifications logged to workspace inbox
              </p>
            </Card>
          </div>

          {/* Multi-currency side summary if mixed currencies exist */}
          {summary.hasMixedCurrencies && (
            <Card className="overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[var(--dp-outline-variant)]">
                <h2 className="text-[15px] font-semibold text-[var(--dp-on-surface)]">
                  Multi-Currency Isolation Summary ({summary.billingPeriod})
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12px]">
                  <thead className="bg-[var(--dp-surface-container-low)] border-b border-[var(--dp-outline-variant)] text-[var(--dp-on-surface-variant)]">
                    <tr>
                      <th className="py-2 px-4 font-medium">Currency</th>
                      <th className="py-2 px-4 font-medium text-right">Actual</th>
                      <th className="py-2 px-4 font-medium text-right">Imported</th>
                      <th className="py-2 px-4 font-medium text-right">Verified</th>
                      <th className="py-2 px-4 font-medium text-right">Estimated</th>
                      <th className="py-2 px-4 font-medium text-right">Records</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--dp-outline-variant)]">
                    {summary.currencyTotals.map((ct) => (
                      <tr key={ct.currency}>
                        <td className="py-2 px-4 font-mono font-semibold text-[var(--dp-on-surface)]">
                          {ct.currency}
                        </td>
                        <td className="py-2 px-4 text-right font-mono tabular-nums">
                          {formatCurrencyAmount(ct.actualTotal, ct.currency)}
                        </td>
                        <td className="py-2 px-4 text-right font-mono tabular-nums">
                          {formatCurrencyAmount(ct.importedTotal, ct.currency)}
                        </td>
                        <td className="py-2 px-4 text-right font-mono font-semibold tabular-nums">
                          {formatCurrencyAmount(ct.verifiedTotal, ct.currency)}
                        </td>
                        <td className="py-2 px-4 text-right font-mono tabular-nums text-[var(--dp-warning-text)]">
                          {formatCurrencyAmount(ct.estimatedTotal, ct.currency)}
                        </td>
                        <td className="py-2 px-4 text-right font-mono tabular-nums">
                          {ct.recordCount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Category Breakdown + Active Budgets */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {renderBreakdownTable(
              'Category Breakdown',
              `Verified and estimated spend for ${summary.billingPeriod} (${displayCurrency})`,
              summary.byCategory,
              'No cost records in this billing period yet. Record an expense or import a billing CSV.'
            )}

            <Card className="overflow-hidden">
              <div className="px-5 py-4 border-b border-[var(--dp-outline-variant)] flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-[15px] font-semibold text-[var(--dp-on-surface)]">
                    Budget Thresholds & Alerts
                  </h3>
                  <p className="text-[12px] text-[var(--dp-on-surface-variant)] mt-0.5">
                    Evaluated against verified actual + imported spend
                  </p>
                </div>
                {canManageCosts && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onOpenBudgetModal()}
                  >
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                    New Budget
                  </Button>
                )}
              </div>
              {summary.budgets.length === 0 ? (
                <div className="p-6 text-center space-y-3">
                  <p className="text-[13px] text-[var(--dp-on-surface-variant)]">
                    No cost budgets configured for {tenantName} yet.
                  </p>
                  {canManageCosts && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => onOpenBudgetModal()}
                    >
                      Create First Budget
                    </Button>
                  )}
                </div>
              ) : (
                <div className="divide-y divide-[var(--dp-outline-variant)]">
                  {summary.budgets.slice(0, 5).map((b) => (
                    <div key={b.id} className="px-5 py-3.5 space-y-2 text-[12px]">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="font-semibold text-[var(--dp-on-surface)]">
                            {b.name}
                          </div>
                          <div className="text-[var(--dp-on-surface-variant)]">
                            {b.scopeType === 'tenant'
                              ? 'Tenant-wide'
                              : `${b.scopeType}: ${b.scopeValue}`}{' '}
                            · {b.period}
                          </div>
                        </div>
                        <StatusIndicator
                          tone={
                            b.alertState === 'critical'
                              ? 'error'
                              : b.alertState === 'warning'
                                ? 'warning'
                                : 'success'
                          }
                          label={`${b.utilizationPct.toFixed(1)}%`}
                        />
                      </div>
                      <div className="flex items-center justify-between font-mono tabular-nums text-[11px] text-[var(--dp-on-surface-variant)]">
                        <span>
                          Observed:{' '}
                          {formatCurrencyAmount(b.observedVerifiedSpend, b.currency)}
                        </span>
                        <span>
                          Limit: {formatCurrencyAmount(b.budgetAmount, b.currency)}
                        </span>
                      </div>
                      <div className="h-1.5 bg-[var(--dp-surface-container)] rounded-[var(--dp-radius-sm)] overflow-hidden">
                        <div
                          className={`h-full rounded-[var(--dp-radius-sm)] ${
                            b.alertState === 'critical'
                              ? 'bg-[var(--dp-error)]'
                              : b.alertState === 'warning'
                                ? 'bg-[var(--dp-warning)]'
                                : 'bg-[var(--dp-primary)]'
                          }`}
                          style={{ width: `${Math.min(100, b.utilizationPct)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      {/* TAB 2: SPENDING ANALYTICS */}
      {activeTab === 'analytics' && summary && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="overflow-hidden">
              <div className="px-5 py-4 border-b border-[var(--dp-outline-variant)]">
                <h2 className="text-[15px] font-semibold text-[var(--dp-on-surface)]">
                  Daily Spend Trend ({summary.billingPeriod} · {displayCurrency})
                </h2>
                <p className="text-[12px] text-[var(--dp-on-surface-variant)] mt-0.5">
                  Daily verified actual/imported spend with separate estimated usage bar
                </p>
              </div>
              {renderTrendRows(
                summary.dailyTrend,
                `No dated entries recorded in ${summary.billingPeriod} (${displayCurrency}).`
              )}
            </Card>

            <Card className="overflow-hidden">
              <div className="px-5 py-4 border-b border-[var(--dp-outline-variant)]">
                <h2 className="text-[15px] font-semibold text-[var(--dp-on-surface)]">
                  Monthly Spend Comparison ({displayCurrency})
                </h2>
                <p className="text-[12px] text-[var(--dp-on-surface-variant)] mt-0.5">
                  Historical monthly ledger across billing periods
                </p>
              </div>
              {renderTrendRows(
                summary.monthlyTrend,
                `No monthly history recorded yet (${displayCurrency}).`
              )}
            </Card>
          </div>

          {renderBreakdownTable(
            'Spend by Provider',
            `Provider totals for ${summary.billingPeriod} (${displayCurrency})`,
            summary.byProvider,
            'No provider spend recorded for this billing period.'
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {renderBreakdownTable(
              'Spend by Workspace Application',
              `Module attribution for ${summary.billingPeriod} (${displayCurrency})`,
              summary.byApp,
              'No application-attributed spend recorded.'
            )}
            {renderBreakdownTable(
              'Spend by Cost Category',
              `Category distribution for ${summary.billingPeriod} (${displayCurrency})`,
              summary.byCategory,
              'No category breakdown recorded.'
            )}
          </div>
        </div>
      )}

      {/* TAB 3: EXPENSE RECORDS */}
      {activeTab === 'records' && (
        <div className="space-y-4">
          <Card className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--dp-on-surface)]">
              <Filter className="w-3.5 h-3.5 text-[var(--dp-primary)]" aria-hidden="true" />
              <span>Filter Ledger Entries</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
              <input
                type="search"
                aria-label="Search expense records"
                placeholder="Search provider, ref, notes..."
                value={recordFilters.search}
                onChange={(e) =>
                  onRecordFiltersChange({ ...recordFilters, search: e.target.value })
                }
                className={`${INPUT_BASE_CLASS} py-1.5 text-[12px] lg:col-span-2`}
              />
              <select
                aria-label="Filter by category"
                value={recordFilters.category}
                onChange={(e) =>
                  onRecordFiltersChange({ ...recordFilters, category: e.target.value })
                }
                className={`${SELECT_BASE_CLASS} py-1.5 text-[12px]`}
              >
                <option value="">All Categories</option>
                {COST_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter by record type"
                value={recordFilters.recordType}
                onChange={(e) =>
                  onRecordFiltersChange({ ...recordFilters, recordType: e.target.value })
                }
                className={`${SELECT_BASE_CLASS} py-1.5 text-[12px]`}
              >
                <option value="">All Types</option>
                <option value="actual">Actual</option>
                <option value="imported">Imported</option>
                <option value="estimated">Estimated</option>
              </select>
              <input
                type="date"
                aria-label="From date"
                value={recordFilters.from}
                onChange={(e) =>
                  onRecordFiltersChange({ ...recordFilters, from: e.target.value })
                }
                className={`${INPUT_BASE_CLASS} py-1.5 text-[12px] font-mono`}
              />
              <input
                type="date"
                aria-label="To date"
                value={recordFilters.to}
                onChange={(e) =>
                  onRecordFiltersChange({ ...recordFilters, to: e.target.value })
                }
                className={`${INPUT_BASE_CLASS} py-1.5 text-[12px] font-mono`}
              />
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[var(--dp-outline-variant)] flex flex-wrap items-center justify-between gap-3">
              <div className="text-[13px] font-semibold text-[var(--dp-on-surface)]">
                Expense Ledger{' '}
                <span className="font-mono text-[12px] font-normal text-[var(--dp-on-surface-variant)] tabular-nums">
                  ({recordsTotal} total records)
                </span>
              </div>
              {canManageCosts && (
                <div className="flex items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={onOpenCsvImport}>
                    <FileSpreadsheet className="w-3.5 h-3.5" aria-hidden="true" />
                    Import CSV
                  </Button>
                  <Button variant="primary" size="sm" onClick={onOpenAddExpense}>
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                    Log Expense
                  </Button>
                </div>
              )}
            </div>

            {records.length === 0 ? (
              <div className="p-8 text-center space-y-3">
                <p className="text-[14px] font-medium text-[var(--dp-on-surface)]">
                  No matching cost records found
                </p>
                <p className="text-[12px] text-[var(--dp-on-surface-variant)] max-w-md mx-auto">
                  Record verified vendor invoices manually or upload a billing CSV export to inspect itemized expenses.
                </p>
                {canManageCosts && (
                  <div className="flex justify-center gap-2">
                    <Button variant="primary" size="sm" onClick={onOpenAddExpense}>
                      Add First Expense
                    </Button>
                    <Button variant="secondary" size="sm" onClick={onOpenCsvImport}>
                      Import Billing CSV
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12px]">
                  <thead className="bg-[var(--dp-surface-container-low)] border-b border-[var(--dp-outline-variant)] text-[var(--dp-on-surface-variant)]">
                    <tr>
                      <th className="py-2.5 px-4 font-medium">Recorded</th>
                      <th className="py-2.5 px-4 font-medium">Provider & Ref</th>
                      <th className="py-2.5 px-4 font-medium">Category</th>
                      <th className="py-2.5 px-4 font-medium">App</th>
                      <th className="py-2.5 px-4 font-medium">Type</th>
                      <th className="py-2.5 px-4 font-medium text-right">Amount</th>
                      <th className="py-2.5 px-4 font-medium text-right">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--dp-outline-variant)]">
                    {records.map((rec) => (
                      <tr
                        key={rec.id}
                        className="hover:bg-[var(--dp-surface-variant)]/50 transition-colors"
                      >
                        <td className="py-2.5 px-4 font-mono text-[11px] text-[var(--dp-on-surface-variant)] tabular-nums whitespace-nowrap">
                          <div>{rec.recordedAt.slice(0, 10)}</div>
                          <div>{rec.billingPeriod}</div>
                        </td>
                        <td className="py-2.5 px-4">
                          <div className="font-medium text-[var(--dp-on-surface)]">
                            {rec.providerName}
                          </div>
                          {rec.reference && (
                            <div className="font-mono text-[11px] text-[var(--dp-on-surface-variant)]">
                              Ref: {rec.reference}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-[var(--dp-on-surface-variant)]">
                          {getCostCategoryLabel(rec.category)}
                        </td>
                        <td className="py-2.5 px-4 text-[var(--dp-on-surface-variant)] font-mono text-[11px]">
                          {rec.appId || 'shared'}
                        </td>
                        <td className="py-2.5 px-4">
                          <StatusIndicator
                            tone={
                              rec.recordType === 'estimated'
                                ? 'warning'
                                : rec.recordType === 'imported'
                                  ? 'info'
                                  : 'success'
                            }
                            label={RECORD_TYPE_LABEL[rec.recordType]}
                          />
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono font-semibold tabular-nums text-[var(--dp-on-surface)] whitespace-nowrap">
                          {formatCurrencyAmount(rec.amount, rec.currency)}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => onSelectRecordDetail(rec)}
                            className="text-[12px] font-medium text-[var(--dp-primary)] hover:underline cursor-pointer"
                          >
                            Inspect
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {recordsTotal > recordsPageSize && (
              <div className="px-5 py-3 border-t border-[var(--dp-outline-variant)] flex items-center justify-between text-[12px]">
                <span className="font-mono text-[var(--dp-on-surface-variant)] tabular-nums">
                  Page {recordsPage} of {totalPages}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={recordsPage <= 1}
                    onClick={() => onRecordsPageChange(recordsPage - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={recordsPage >= totalPages}
                    onClick={() => onRecordsPageChange(recordsPage + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* TAB 4: BUDGETS & ALERTS */}
      {activeTab === 'budgets' && (
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--dp-outline-variant)] flex items-center justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-semibold text-[var(--dp-on-surface)]">
                  Configured Cost Budgets
                </h2>
                <p className="text-[12px] text-[var(--dp-on-surface-variant)] mt-0.5">
                  Thresholds evaluate against verified (actual + imported) spend and trigger internal workspace notifications
                </p>
              </div>
              {canManageCosts && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => onOpenBudgetModal()}
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  Create Budget
                </Button>
              )}
            </div>

            {budgets.length === 0 ? (
              <div className="p-8 text-center space-y-3">
                <p className="text-[13px] text-[var(--dp-on-surface-variant)]">
                  No budgets configured yet.
                </p>
                {canManageCosts && (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => onOpenBudgetModal()}
                  >
                    Create Monthly Budget
                  </Button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12px]">
                  <thead className="bg-[var(--dp-surface-container-low)] border-b border-[var(--dp-outline-variant)] text-[var(--dp-on-surface-variant)]">
                    <tr>
                      <th className="py-2.5 px-4 font-medium">Budget Name</th>
                      <th className="py-2.5 px-4 font-medium">Scope / Period</th>
                      <th className="py-2.5 px-4 font-medium text-right">Verified Spend</th>
                      <th className="py-2.5 px-4 font-medium text-right">Budget Limit</th>
                      <th className="py-2.5 px-4 font-medium text-right">Utilization</th>
                      <th className="py-2.5 px-4 font-medium">Status</th>
                      {canManageCosts && (
                        <th className="py-2.5 px-4 font-medium text-right">Action</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--dp-outline-variant)]">
                    {budgets.map((b) => (
                      <tr key={b.id}>
                        <td className="py-2.5 px-4">
                          <div className="font-medium text-[var(--dp-on-surface)]">
                            {b.name}
                          </div>
                          <div className="text-[11px] font-mono text-[var(--dp-on-surface-variant)] tabular-nums">
                            Warn {b.warningThresholdPct}% · Crit {b.criticalThresholdPct}%
                          </div>
                        </td>
                        <td className="py-2.5 px-4 text-[var(--dp-on-surface-variant)]">
                          {b.scopeType === 'tenant'
                            ? 'Tenant-wide'
                            : `${b.scopeType}: ${b.scopeValue}`}{' '}
                          ({b.period})
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                          {formatCurrencyAmount(b.observedVerifiedSpend, b.currency)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono font-semibold tabular-nums">
                          {formatCurrencyAmount(b.budgetAmount, b.currency)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                          {b.utilizationPct.toFixed(1)}%
                        </td>
                        <td className="py-2.5 px-4">
                          <StatusIndicator
                            tone={
                              !b.enabled
                                ? 'neutral'
                                : b.alertState === 'critical'
                                  ? 'error'
                                  : b.alertState === 'warning'
                                    ? 'warning'
                                    : 'success'
                            }
                            label={
                              !b.enabled
                                ? 'Paused'
                                : b.alertState === 'critical'
                                  ? 'Critical'
                                  : b.alertState === 'warning'
                                    ? 'Warning'
                                    : 'Nominal'
                            }
                          />
                        </td>
                        {canManageCosts && (
                          <td className="py-2.5 px-4 text-right">
                            <button
                              type="button"
                              onClick={() => onOpenBudgetModal(b)}
                              className="text-[12px] font-medium text-[var(--dp-primary)] hover:underline cursor-pointer"
                            >
                              Edit
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card className="overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--dp-outline-variant)]">
              <h2 className="text-[15px] font-semibold text-[var(--dp-on-surface)]">
                Cost Threshold Alert History
              </h2>
              <p className="text-[12px] text-[var(--dp-on-surface-variant)] mt-0.5">
                Deduplicated per budget, billing period, and severity tier
              </p>
            </div>
            {alerts.length === 0 ? (
              <div className="p-6 text-center text-[13px] text-[var(--dp-on-surface-variant)]">
                No cost alerts triggered for this tenant.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12px]">
                  <thead className="bg-[var(--dp-surface-container-low)] border-b border-[var(--dp-outline-variant)] text-[var(--dp-on-surface-variant)]">
                    <tr>
                      <th className="py-2.5 px-4 font-medium">Budget</th>
                      <th className="py-2.5 px-4 font-medium">Period</th>
                      <th className="py-2.5 px-4 font-medium">Level</th>
                      <th className="py-2.5 px-4 font-medium text-right">Observed / Limit</th>
                      <th className="py-2.5 px-4 font-medium">Status</th>
                      <th className="py-2.5 px-4 font-medium">Triggered</th>
                      {canManageCosts && (
                        <th className="py-2.5 px-4 font-medium text-right">Action</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--dp-outline-variant)]">
                    {alerts.map((al) => (
                      <tr key={al.id}>
                        <td className="py-2.5 px-4 font-medium text-[var(--dp-on-surface)]">
                          {al.budgetName}
                        </td>
                        <td className="py-2.5 px-4 font-mono tabular-nums">
                          {al.billingPeriod}
                        </td>
                        <td className="py-2.5 px-4">
                          <StatusIndicator
                            tone={al.alertLevel === 'critical' ? 'error' : 'warning'}
                            label={`${al.alertLevel} (>=${al.thresholdPct}%)`}
                          />
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                          {formatCurrencyAmount(al.observedAmount, al.currency)} /{' '}
                          {formatCurrencyAmount(al.budgetAmount, al.currency)}
                        </td>
                        <td className="py-2.5 px-4">
                          <StatusIndicator
                            tone={al.status === 'active' ? 'error' : 'success'}
                            label={al.status === 'active' ? 'Active' : 'Resolved'}
                          />
                        </td>
                        <td className="py-2.5 px-4 font-mono text-[11px] text-[var(--dp-on-surface-variant)] tabular-nums">
                          {formatTimestamp(al.triggeredAt)}
                        </td>
                        {canManageCosts && (
                          <td className="py-2.5 px-4 text-right">
                            {al.status === 'active' ? (
                              <Button
                                variant="secondary"
                                size="sm"
                                disabled={busyAction === `resolve-${al.id}`}
                                onClick={() => onResolveAlert(al.id)}
                              >
                                Resolve
                              </Button>
                            ) : (
                              <span className="text-[11px] text-[var(--dp-on-surface-variant)]">
                                Closed
                              </span>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* TAB 5: PROVIDER PRICING & USAGE ESTIMATES */}
      {activeTab === 'providers' && (
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--dp-outline-variant)]">
              <h2 className="text-[15px] font-semibold text-[var(--dp-on-surface)]">
                Recorded Platform Usage Estimates ({billingPeriod})
              </h2>
              <p className="text-[12px] text-[var(--dp-on-surface-variant)] mt-0.5">
                Calculated strictly from PostgreSQL activity counts × configured unit prices. Never fabricated or merged into verified actual spend.
              </p>
            </div>
            {usageEstimates.length === 0 ? (
              <div className="p-6 text-center text-[13px] text-[var(--dp-on-surface-variant)]">
                No metered workspace usage events recorded for {billingPeriod}.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12px]">
                  <thead className="bg-[var(--dp-surface-container-low)] border-b border-[var(--dp-outline-variant)] text-[var(--dp-on-surface-variant)]">
                    <tr>
                      <th className="py-2.5 px-4 font-medium">Service & Source</th>
                      <th className="py-2.5 px-4 font-medium text-right">Observed Usage</th>
                      <th className="py-2.5 px-4 font-medium text-right">Unit Price</th>
                      <th className="py-2.5 px-4 font-medium text-right">Estimated Total</th>
                      {canManageCosts && (
                        <th className="py-2.5 px-4 font-medium text-right">Action</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--dp-outline-variant)]">
                    {usageEstimates.map((est) => (
                      <tr key={`${est.providerId}-${est.serviceName}`}>
                        <td className="py-2.5 px-4">
                          <div className="font-medium text-[var(--dp-on-surface)]">
                            {est.providerName} — {est.serviceName}
                          </div>
                          <div className="text-[11px] text-[var(--dp-on-surface-variant)]">
                            Source: {est.usageSource}
                          </div>
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                          {est.usageQuantity} {est.unit}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                          {est.pricingStatus === 'configured' &&
                          est.unitPrice &&
                          est.currency ? (
                            `${est.currency} ${est.unitPrice}`
                          ) : (
                            <span className="text-[var(--dp-warning-text)]">
                              Pricing not configured
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono font-semibold tabular-nums text-[var(--dp-warning-text)]">
                          {est.pricingStatus === 'configured' &&
                          est.estimatedAmount &&
                          est.currency
                            ? formatCurrencyAmount(est.estimatedAmount, est.currency)
                            : '—'}
                        </td>
                        {canManageCosts && (
                          <td className="py-2.5 px-4 text-right">
                            {est.pricingStatus === 'configured' &&
                            est.estimatedAmount &&
                            onRecordEstimate ? (
                              <Button
                                variant="secondary"
                                size="sm"
                                disabled={
                                  busyAction === `estimate-${est.providerId}` ||
                                  Number(est.estimatedAmount) <= 0
                                }
                                onClick={() => onRecordEstimate(est)}
                              >
                                Log Estimate
                              </Button>
                            ) : (
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => {
                                  const match = providers.find(
                                    (p) => p.providerId === est.providerId
                                  );
                                  onOpenPricingModal(match);
                                }}
                              >
                                Set Unit Price
                              </Button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card className="overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--dp-outline-variant)] flex items-center justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-semibold text-[var(--dp-on-surface)]">
                  Provider Billing Connectors & Unit Pricing Rules
                </h2>
                <p className="text-[12px] text-[var(--dp-on-surface-variant)] mt-0.5">
                  External billing APIs remain explicitly disconnected; configure unit prices for transparent estimates or import statements
                </p>
              </div>
              {canManageCosts && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => onOpenPricingModal()}
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
                  Configure Unit Price
                </Button>
              )}
            </div>
            <div className="divide-y divide-[var(--dp-outline-variant)]">
              {providers.map((prov) => (
                <div
                  key={prov.providerId}
                  className="px-5 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 text-[12px]"
                >
                  <div className="space-y-1 max-w-2xl">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="text-[14px] font-semibold text-[var(--dp-on-surface)]">
                        {prov.name}
                      </span>
                      <StatusIndicator
                        tone="neutral"
                        label="Not connected · Manual / CSV Import"
                      />
                    </div>
                    <p className="text-[var(--dp-on-surface-variant)]">
                      {prov.billingIntegrationNote}
                    </p>
                    <div className="flex flex-wrap items-center gap-4 pt-1 font-mono text-[11px] text-[var(--dp-on-surface-variant)] tabular-nums">
                      <span>Category: {getCostCategoryLabel(prov.category)}</span>
                      <span>
                        Last import:{' '}
                        {prov.lastImportedAt
                          ? formatTimestamp(prov.lastImportedAt)
                          : 'Never'}
                      </span>
                      <span>
                        Configured rules: {prov.pricingConfigs.length}
                      </span>
                    </div>
                    {prov.pricingConfigs.length > 0 && (
                      <div className="flex flex-wrap gap-2 pt-1.5">
                        {prov.pricingConfigs.map((cfg) => (
                          <span
                            key={cfg.id}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--dp-radius-sm)] border border-[var(--dp-outline-variant)] bg-[var(--dp-surface-container-low)] font-mono text-[11px] tabular-nums text-[var(--dp-on-surface)]"
                          >
                            {cfg.serviceName}: {cfg.currency} {cfg.unitPrice}/{cfg.unit} (eff.{' '}
                            {cfg.effectiveDate})
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {canManageCosts && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => onOpenPricingModal(prov)}
                      >
                        Set Rate
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

export function CostControlCenterView({
  routeTab,
  onNavigateTab,
}: {
  routeTab: CostSubTab;
  onNavigateTab: (tab: CostSubTab) => void;
}) {
  const { apiFetch, session } = useAuth();
  const { formatTimestamp } = usePreferences();
  const { pushToast } = useToast();

  const canManageCosts = hasEffectivePermission(
    session?.permissions,
    'canManageCostCenter'
  );

  const [billingPeriod, setBillingPeriod] = useState<string>(() =>
    getCurrentBillingPeriod()
  );
  const [selectedCurrency, setSelectedCurrency] = useState<string>('INR');

  const [summary, setSummary] = useState<CostSummaryPayload | null>(null);
  const [records, setRecords] = useState<CostRecordItem[]>([]);
  const [recordsTotal, setRecordsTotal] = useState(0);
  const [recordsPage, setRecordsPage] = useState(1);
  const recordsPageSize = 20;
  const [recordFilters, setRecordFilters] = useState({
    search: '',
    category: '',
    recordType: '',
    providerId: '',
    from: '',
    to: '',
  });
  const [providers, setProviders] = useState<CostProviderCatalogSummary[]>([]);
  const [budgets, setBudgets] = useState<CostBudgetEvaluationItem[]>([]);
  const [alerts, setAlerts] = useState<CostAlertItem[]>([]);
  const [usageEstimates, setUsageEstimates] = useState<CostUsageEstimateItem[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  // Modals / Drawers
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [budgetModalOpen, setBudgetModalOpen] = useState(false);
  const [editingBudget, setEditingBudget] =
    useState<CostBudgetEvaluationItem | null>(null);
  const [pricingModalOpen, setPricingModalOpen] = useState(false);
  const [detailRecord, setDetailRecord] = useState<CostRecordItem | null>(null);

  // Manual expense form state
  const [expProviderId, setExpProviderId] = useState('voice_telephony_approved');
  const [expAppId, setExpAppId] = useState('');
  const [expCategory, setExpCategory] = useState<CostCategory>('telephony');
  const [expRecordType, setExpRecordType] = useState<'actual' | 'estimated'>(
    'actual'
  );
  const [expAmount, setExpAmount] = useState('');
  const [expCurrency, setExpCurrency] = useState('INR');
  const [expQty, setExpQty] = useState('');
  const [expUnit, setExpUnit] = useState('');
  const [expUnitPrice, setExpUnitPrice] = useState('');
  const [expPeriod, setExpPeriod] = useState(() => getCurrentBillingPeriod());
  const [expDate, setExpDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [expRef, setExpRef] = useState('');
  const [expNotes, setExpNotes] = useState('');

  // CSV Import state
  const [csvText, setCsvText] = useState('');
  const [csvCurrency, setCsvCurrency] = useState('INR');
  const [csvPeriod, setCsvPeriod] = useState(() => getCurrentBillingPeriod());
  const [csvImportSummary, setCsvImportSummary] = useState<string | null>(null);

  // Budget form state
  const [bName, setBName] = useState('');
  const [bScopeType, setBScopeType] = useState<'tenant' | 'category' | 'app'>(
    'tenant'
  );
  const [bScopeValue, setBScopeValue] = useState('');
  const [bPeriod, setBPeriod] = useState<'monthly' | 'yearly'>('monthly');
  const [bAmount, setBAmount] = useState('');
  const [bCurrency, setBCurrency] = useState('INR');
  const [bWarnPct, setBWarnPct] = useState('80');
  const [bCritPct, setBCritPct] = useState('100');
  const [bEnabled, setBEnabled] = useState(true);

  // Pricing form state
  const [pProviderId, setPProviderId] = useState('gemini_ai');
  const [pServiceName, setPServiceName] = useState('');
  const [pCategory, setPCategory] = useState<CostCategory>('ai_models');
  const [pUnit, setPUnit] = useState('1k_input_tokens');
  const [pUnitPrice, setPUnitPrice] = useState('');
  const [pCurrency, setPCurrency] = useState('INR');
  const [pEffectiveDate, setPEffectiveDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const summaryParams = new URLSearchParams({
        billingPeriod,
        currency: selectedCurrency,
      });
      const recParams = new URLSearchParams({
        page: String(recordsPage),
        pageSize: String(recordsPageSize),
      });
      if (recordFilters.search.trim()) recParams.set('search', recordFilters.search.trim());
      if (recordFilters.category) recParams.set('category', recordFilters.category);
      if (recordFilters.recordType) recParams.set('recordType', recordFilters.recordType);
      if (recordFilters.providerId) recParams.set('providerId', recordFilters.providerId);
      if (recordFilters.from) recParams.set('from', recordFilters.from);
      if (recordFilters.to) recParams.set('to', recordFilters.to);

      const [sumRes, recRes, provRes, budRes, alRes, estRes] = await Promise.all([
        apiFetch<CostSummaryPayload>(
          `/api/workspace/costs/summary?${summaryParams.toString()}`
        ),
        apiFetch<{
          records: CostRecordItem[];
          total: number;
          page: number;
          pageSize: number;
        }>(`/api/workspace/costs/records?${recParams.toString()}`),
        apiFetch<{ providers: CostProviderCatalogSummary[] }>(
          '/api/workspace/costs/providers'
        ),
        apiFetch<{ budgets: CostBudgetEvaluationItem[] }>(
          `/api/workspace/costs/budgets?billingPeriod=${encodeURIComponent(
            billingPeriod
          )}`
        ),
        apiFetch<{ alerts: CostAlertItem[] }>('/api/workspace/costs/alerts'),
        apiFetch<{ estimates: CostUsageEstimateItem[] }>(
          `/api/workspace/costs/usage-estimates?billingPeriod=${encodeURIComponent(
            billingPeriod
          )}`
        ),
      ]);

      setSummary(sumRes);
      if (sumRes.selectedCurrency && sumRes.selectedCurrency !== selectedCurrency) {
        setSelectedCurrency(sumRes.selectedCurrency);
      }
      setRecords(recRes.records);
      setRecordsTotal(recRes.total);
      setProviders(provRes.providers);
      setBudgets(budRes.budgets);
      setAlerts(alRes.alerts);
      setUsageEstimates(estRes.estimates);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to load Cost Control Center data.'
      );
    } finally {
      setLoading(false);
    }
  }, [
    apiFetch,
    billingPeriod,
    selectedCurrency,
    recordsPage,
    recordFilters,
  ]);

  useEffect(() => {
    void loadAll();
  }, [loadAll, session?.activeTenant.tenantId]);

  const computedPreviewAmount = useMemo(() => {
    if (!expQty.trim() || !expUnitPrice.trim()) return null;
    try {
      return multiplyQuantityByUnitPrice(expQty, expUnitPrice);
    } catch {
      return null;
    }
  }, [expQty, expUnitPrice]);

  const handleSaveManualExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusyAction('save-expense');
    try {
      await apiFetch('/api/workspace/costs/records', {
        method: 'POST',
        body: JSON.stringify({
          mode: 'manual',
          providerId: expProviderId,
          appId: expAppId || null,
          category: expCategory,
          recordType: expRecordType,
          ...(expAmount.trim() ? { amount: expAmount.trim() } : {}),
          currency: expCurrency,
          ...(expQty.trim() ? { usageQuantity: expQty.trim() } : {}),
          ...(expUnit.trim() ? { unit: expUnit.trim() } : {}),
          ...(expUnitPrice.trim() ? { unitPrice: expUnitPrice.trim() } : {}),
          billingPeriod: expPeriod,
          recordedAt: `${expDate}T12:00:00.000Z`,
          ...(expRef.trim() ? { reference: expRef.trim() } : {}),
          notes: expNotes.trim(),
        }),
      });
      pushToast('Expense record saved to PostgreSQL ledger.');
      setAddOpen(false);
      setExpAmount('');
      setExpQty('');
      setExpUnitPrice('');
      setExpRef('');
      setExpNotes('');
      await loadAll();
    } catch (err) {
      pushToast(
        err instanceof Error ? err.message : 'Unable to save expense record.',
        'error'
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleCsvImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusyAction('import-csv');
    setCsvImportSummary(null);
    try {
      const res = await apiFetch<{
        importedCount: number;
        skippedDuplicatesCount: number;
        errors: string[];
      }>('/api/workspace/costs/records', {
        method: 'POST',
        body: JSON.stringify({
          mode: 'import',
          csvText,
          defaultCurrency: csvCurrency,
          defaultBillingPeriod: csvPeriod,
        }),
      });
      const msg = `Imported ${res.importedCount} records (${res.skippedDuplicatesCount} duplicates skipped).`;
      setCsvImportSummary(msg);
      pushToast(msg);
      if (res.importedCount > 0) {
        setImportOpen(false);
        setCsvText('');
        await loadAll();
      }
    } catch (err) {
      pushToast(
        err instanceof Error ? err.message : 'CSV import failed.',
        'error'
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleOpenBudgetModal = (budget?: CostBudgetEvaluationItem) => {
    if (budget) {
      setEditingBudget(budget);
      setBName(budget.name);
      setBScopeType(budget.scopeType);
      setBScopeValue(budget.scopeValue || '');
      setBPeriod(budget.period);
      setBAmount(budget.budgetAmount);
      setBCurrency(budget.currency);
      setBWarnPct(String(budget.warningThresholdPct));
      setBCritPct(String(budget.criticalThresholdPct));
      setBEnabled(budget.enabled);
    } else {
      setEditingBudget(null);
      setBName('');
      setBScopeType('tenant');
      setBScopeValue('');
      setBPeriod('monthly');
      setBAmount('');
      setBCurrency(selectedCurrency || 'INR');
      setBWarnPct('80');
      setBCritPct('100');
      setBEnabled(true);
    }
    setBudgetModalOpen(true);
  };

  const handleSaveBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusyAction('save-budget');
    try {
      if (editingBudget) {
        await apiFetch(`/api/workspace/costs/budgets/${editingBudget.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: bName.trim(),
            budgetAmount: bAmount.trim(),
            warningThresholdPct: Number(bWarnPct),
            criticalThresholdPct: Number(bCritPct),
            enabled: bEnabled,
          }),
        });
        pushToast('Cost budget updated.');
      } else {
        await apiFetch('/api/workspace/costs/budgets', {
          method: 'POST',
          body: JSON.stringify({
            name: bName.trim(),
            scopeType: bScopeType,
            scopeValue: bScopeType === 'tenant' ? null : bScopeValue.trim(),
            period: bPeriod,
            budgetAmount: bAmount.trim(),
            currency: bCurrency,
            warningThresholdPct: Number(bWarnPct),
            criticalThresholdPct: Number(bCritPct),
            enabled: bEnabled,
          }),
        });
        pushToast('Cost budget created.');
      }
      setBudgetModalOpen(false);
      await loadAll();
    } catch (err) {
      pushToast(
        err instanceof Error ? err.message : 'Unable to save cost budget.',
        'error'
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleOpenPricingModal = (provider?: CostProviderCatalogSummary) => {
    if (provider) {
      setPProviderId(provider.providerId);
      setPCategory(provider.category);
      setPUnit(provider.supportedUnits[0] || 'unit');
      const existing = provider.pricingConfigs[0];
      setPServiceName(existing?.serviceName || `${provider.name} Usage`);
      setPUnitPrice(existing?.unitPrice || '');
      setPCurrency(existing?.currency || selectedCurrency || 'INR');
    } else {
      setPProviderId('gemini_ai');
      setPCategory('ai_models');
      setPUnit('1k_input_tokens');
      setPServiceName('');
      setPUnitPrice('');
      setPCurrency(selectedCurrency || 'INR');
    }
    setPricingModalOpen(true);
  };

  const handleSavePricing = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusyAction('save-pricing');
    try {
      await apiFetch('/api/workspace/costs/providers/pricing', {
        method: 'PUT',
        body: JSON.stringify({
          providerId: pProviderId,
          serviceName: pServiceName.trim(),
          category: pCategory,
          unit: pUnit.trim(),
          unitPrice: pUnitPrice.trim(),
          currency: pCurrency,
          effectiveDate: pEffectiveDate,
          active: true,
        }),
      });
      pushToast('Provider unit pricing rule saved.');
      setPricingModalOpen(false);
      await loadAll();
    } catch (err) {
      pushToast(
        err instanceof Error ? err.message : 'Failed to save unit pricing.',
        'error'
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleResolveAlert = async (alertId: number) => {
    setBusyAction(`resolve-${alertId}`);
    try {
      await apiFetch(`/api/workspace/costs/alerts/${alertId}/resolve`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      pushToast('Cost alert marked resolved.');
      await loadAll();
    } catch (err) {
      pushToast(
        err instanceof Error ? err.message : 'Unable to resolve alert.',
        'error'
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleRecordEstimate = async (est: CostUsageEstimateItem) => {
    if (!est.estimatedAmount || !est.currency || !est.unitPrice) return;
    setBusyAction(`estimate-${est.providerId}`);
    try {
      await apiFetch('/api/workspace/costs/records', {
        method: 'POST',
        body: JSON.stringify({
          mode: 'manual',
          providerId: est.providerId,
          providerName: est.providerName,
          appId: est.appId,
          category: est.category,
          recordType: 'estimated',
          amount: est.estimatedAmount,
          currency: est.currency,
          usageQuantity: est.usageQuantity,
          unit: est.unit,
          unitPrice: est.unitPrice,
          billingPeriod,
          reference: `est-${billingPeriod}-${est.providerId}`,
          notes: `Calculated from ${est.usageSource}`,
        }),
      });
      pushToast(`Logged estimated cost for ${est.providerName}.`);
      await loadAll();
    } catch (err) {
      pushToast(
        err instanceof Error ? err.message : 'Unable to record estimate.',
        'error'
      );
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <>
      <CostControlCenterContent
        tenantName={session?.activeTenant.tenantName || 'Active Tenant'}
        activeTab={routeTab}
        onTabChange={onNavigateTab}
        billingPeriod={billingPeriod}
        onBillingPeriodChange={(p) => {
          setBillingPeriod(p);
          setRecordsPage(1);
        }}
        selectedCurrency={selectedCurrency}
        onCurrencyChange={setSelectedCurrency}
        summary={summary}
        records={records}
        recordsTotal={recordsTotal}
        recordsPage={recordsPage}
        recordsPageSize={recordsPageSize}
        onRecordsPageChange={setRecordsPage}
        recordFilters={recordFilters}
        onRecordFiltersChange={(next) => {
          setRecordFilters(next);
          setRecordsPage(1);
        }}
        providers={providers}
        budgets={budgets}
        alerts={alerts}
        usageEstimates={usageEstimates}
        canManageCosts={canManageCosts}
        loading={loading}
        error={error}
        busyAction={busyAction}
        onRefresh={() => void loadAll()}
        onOpenAddExpense={() => setAddOpen(true)}
        onOpenCsvImport={() => setImportOpen(true)}
        onOpenBudgetModal={handleOpenBudgetModal}
        onOpenPricingModal={handleOpenPricingModal}
        onSelectRecordDetail={setDetailRecord}
        onResolveAlert={(id) => void handleResolveAlert(id)}
        onRecordEstimate={(est) => void handleRecordEstimate(est)}
        formatTimestamp={formatTimestamp}
      />

      {/* Add Manual Expense Modal */}
      {addOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-expense-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={() => setAddOpen(false)}
        >
          <div
            className="w-full max-w-lg bg-[var(--dp-surface-container-lowest)] border border-[var(--dp-outline-variant)] rounded-[var(--dp-radius-lg)] p-6 space-y-4 shadow-xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2
                id="add-expense-title"
                className="text-[17px] font-semibold text-[var(--dp-on-surface)]"
              >
                Add Manual Expense Record
              </h2>
              <button
                type="button"
                aria-label="Close modal"
                onClick={() => setAddOpen(false)}
                className="p-1 rounded-[var(--dp-radius-sm)] text-[var(--dp-on-surface-variant)] hover:bg-[var(--dp-surface-variant)] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveManualExpense} className="space-y-3.5 text-[13px]">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="space-y-1 block">
                  <span className="font-medium">Provider</span>
                  <select
                    value={expProviderId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setExpProviderId(id);
                      const match = providers.find((p) => p.providerId === id);
                      if (match) setExpCategory(match.category);
                    }}
                    className={`${SELECT_BASE_CLASS} w-full`}
                  >
                    {providers.map((p) => (
                      <option key={p.providerId} value={p.providerId}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 block">
                  <span className="font-medium">Category</span>
                  <select
                    value={expCategory}
                    onChange={(e) => setExpCategory(e.target.value as CostCategory)}
                    className={`${SELECT_BASE_CLASS} w-full`}
                  >
                    {COST_CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="space-y-1 block">
                  <span className="font-medium">Record Type</span>
                  <select
                    value={expRecordType}
                    onChange={(e) =>
                      setExpRecordType(e.target.value as 'actual' | 'estimated')
                    }
                    className={`${SELECT_BASE_CLASS} w-full`}
                  >
                    <option value="actual">Actual (Verified)</option>
                    <option value="estimated">Estimated</option>
                  </select>
                </label>
                <label className="space-y-1 block">
                  <span className="font-medium">Currency</span>
                  <select
                    value={expCurrency}
                    onChange={(e) => setExpCurrency(e.target.value)}
                    className={`${SELECT_BASE_CLASS} w-full font-mono`}
                  >
                    {SUPPORTED_CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 block">
                  <span className="font-medium">Application</span>
                  <select
                    value={expAppId}
                    onChange={(e) => setExpAppId(e.target.value)}
                    className={`${SELECT_BASE_CLASS} w-full`}
                  >
                    {APP_ID_OPTIONS.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="space-y-1 block">
                  <span className="font-medium">Amount ({expCurrency})</span>
                  <input
                    type="text"
                    placeholder={computedPreviewAmount || 'e.g. 1250.50'}
                    value={expAmount}
                    onChange={(e) => setExpAmount(e.target.value)}
                    className={`${INPUT_BASE_CLASS} font-mono tabular-nums`}
                  />
                </label>
                <label className="space-y-1 block">
                  <span className="font-medium">Usage Qty (opt.)</span>
                  <input
                    type="text"
                    placeholder="e.g. 500"
                    value={expQty}
                    onChange={(e) => setExpQty(e.target.value)}
                    className={`${INPUT_BASE_CLASS} font-mono tabular-nums`}
                  />
                </label>
                <label className="space-y-1 block">
                  <span className="font-medium">Unit Price (opt.)</span>
                  <input
                    type="text"
                    placeholder="e.g. 1.2500"
                    value={expUnitPrice}
                    onChange={(e) => setExpUnitPrice(e.target.value)}
                    className={`${INPUT_BASE_CLASS} font-mono tabular-nums`}
                  />
                </label>
              </div>

              {computedPreviewAmount && !expAmount.trim() && (
                <p className="text-[12px] font-mono text-[var(--dp-primary)] tabular-nums">
                  Auto-calculated amount: {expCurrency} {computedPreviewAmount}
                </p>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="space-y-1 block">
                  <span className="font-medium">Billing Period</span>
                  <input
                    type="month"
                    required
                    value={expPeriod}
                    onChange={(e) => setExpPeriod(e.target.value)}
                    className={`${INPUT_BASE_CLASS} font-mono`}
                  />
                </label>
                <label className="space-y-1 block">
                  <span className="font-medium">Date</span>
                  <input
                    type="date"
                    required
                    value={expDate}
                    onChange={(e) => setExpDate(e.target.value)}
                    className={`${INPUT_BASE_CLASS} font-mono`}
                  />
                </label>
                <label className="space-y-1 block">
                  <span className="font-medium">Unit (opt.)</span>
                  <input
                    type="text"
                    placeholder="minute, request..."
                    value={expUnit}
                    onChange={(e) => setExpUnit(e.target.value)}
                    className={INPUT_BASE_CLASS}
                  />
                </label>
              </div>

              <label className="space-y-1 block">
                <span className="font-medium">Invoice / Reference ID</span>
                <input
                  type="text"
                  placeholder="e.g. INV-2026-0412"
                  value={expRef}
                  onChange={(e) => setExpRef(e.target.value)}
                  className={`${INPUT_BASE_CLASS} font-mono`}
                />
              </label>

              <label className="space-y-1 block">
                <span className="font-medium">Notes</span>
                <input
                  type="text"
                  placeholder="Optional description or vendor memo"
                  value={expNotes}
                  onChange={(e) => setExpNotes(e.target.value)}
                  className={INPUT_BASE_CLASS}
                />
              </label>

              <div className="flex justify-end gap-2.5 pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setAddOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={busyAction === 'save-expense'}
                >
                  {busyAction === 'save-expense' ? 'Saving...' : 'Save Expense'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CSV Import Modal */}
      {importOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="import-csv-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={() => setImportOpen(false)}
        >
          <div
            className="w-full max-w-2xl bg-[var(--dp-surface-container-lowest)] border border-[var(--dp-outline-variant)] rounded-[var(--dp-radius-lg)] p-6 space-y-4 shadow-xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2
                id="import-csv-title"
                className="text-[17px] font-semibold text-[var(--dp-on-surface)]"
              >
                Import Billing Export CSV
              </h2>
              <button
                type="button"
                aria-label="Close modal"
                onClick={() => setImportOpen(false)}
                className="p-1 rounded-[var(--dp-radius-sm)] text-[var(--dp-on-surface-variant)] hover:bg-[var(--dp-surface-variant)] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[12px] text-[var(--dp-on-surface-variant)]">
              Imported rows are stored with record type <strong>imported</strong> and deduplicated by tenant + reference/fingerprint so re-importing the same statement does not double-count charges.
            </p>
            <form onSubmit={handleCsvImportSubmit} className="space-y-3.5 text-[13px]">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="space-y-1 block">
                  <span className="font-medium">Default Currency</span>
                  <select
                    value={csvCurrency}
                    onChange={(e) => setCsvCurrency(e.target.value)}
                    className={`${SELECT_BASE_CLASS} w-full font-mono`}
                  >
                    {SUPPORTED_CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 block">
                  <span className="font-medium">Default Billing Period</span>
                  <input
                    type="month"
                    value={csvPeriod}
                    onChange={(e) => setCsvPeriod(e.target.value)}
                    className={`${INPUT_BASE_CLASS} font-mono`}
                  />
                </label>
              </div>

              <div className="flex items-center justify-between gap-2">
                <label className="text-[12px] font-medium text-[var(--dp-on-surface)]">
                  Upload .csv file or paste rows below
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setCsvText(
                      `providerId,providerName,category,amount,currency,billingPeriod,recordedAt,reference,appId,notes\ngoogle_cloud_run,Google Cloud Run,infrastructure,2450.75,${csvCurrency},${csvPeriod},${csvPeriod}-10,GCP-INV-1001,forms-studio,Monthly Cloud Run compute`
                    )
                  }
                  className="text-[12px] font-medium text-[var(--dp-primary)] hover:underline cursor-pointer"
                >
                  Insert sample CSV template
                </button>
              </div>

              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => {
                    if (typeof reader.result === 'string') {
                      setCsvText(reader.result);
                    }
                  };
                  reader.readAsText(file);
                }}
                className="text-[12px] text-[var(--dp-on-surface-variant)]"
              />

              <textarea
                rows={7}
                required
                placeholder="providerId,providerName,category,amount,currency,billingPeriod,recordedAt,reference,appId,notes"
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                className={`${INPUT_BASE_CLASS} font-mono text-[12px]`}
              />

              {csvImportSummary && (
                <AlertBanner tone="info" message={csvImportSummary} />
              )}

              <div className="flex justify-end gap-2.5 pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setImportOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={busyAction === 'import-csv'}
                >
                  {busyAction === 'import-csv' ? 'Importing...' : 'Import Billing Rows'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create / Edit Budget Modal */}
      {budgetModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="budget-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={() => setBudgetModalOpen(false)}
        >
          <div
            className="w-full max-w-lg bg-[var(--dp-surface-container-lowest)] border border-[var(--dp-outline-variant)] rounded-[var(--dp-radius-lg)] p-6 space-y-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2
                id="budget-modal-title"
                className="text-[17px] font-semibold text-[var(--dp-on-surface)]"
              >
                {editingBudget ? 'Edit Cost Budget' : 'Create Cost Budget'}
              </h2>
              <button
                type="button"
                aria-label="Close modal"
                onClick={() => setBudgetModalOpen(false)}
                className="p-1 rounded-[var(--dp-radius-sm)] text-[var(--dp-on-surface-variant)] hover:bg-[var(--dp-surface-variant)] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveBudget} className="space-y-3.5 text-[13px]">
              <label className="space-y-1 block">
                <span className="font-medium">Budget Name</span>
                <input
                  type="text"
                  required
                  placeholder="e.g. Monthly Telephony & Infra Cap"
                  value={bName}
                  onChange={(e) => setBName(e.target.value)}
                  className={INPUT_BASE_CLASS}
                />
              </label>

              {!editingBudget && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="space-y-1 block">
                    <span className="font-medium">Scope Type</span>
                    <select
                      value={bScopeType}
                      onChange={(e) => {
                        const next = e.target.value as 'tenant' | 'category' | 'app';
                        setBScopeType(next);
                        if (next === 'category') setBScopeValue('telephony');
                        else if (next === 'app') setBScopeValue('forms-studio');
                        else setBScopeValue('');
                      }}
                      className={`${SELECT_BASE_CLASS} w-full`}
                    >
                      <option value="tenant">Entire Tenant</option>
                      <option value="category">Cost Category</option>
                      <option value="app">Workspace App</option>
                    </select>
                  </label>
                  <label className="space-y-1 block">
                    <span className="font-medium">Period</span>
                    <select
                      value={bPeriod}
                      onChange={(e) =>
                        setBPeriod(e.target.value as 'monthly' | 'yearly')
                      }
                      className={`${SELECT_BASE_CLASS} w-full`}
                    >
                      <option value="monthly">Monthly</option>
                      <option value="yearly">Yearly</option>
                    </select>
                  </label>
                </div>
              )}

              {!editingBudget && bScopeType === 'category' && (
                <label className="space-y-1 block">
                  <span className="font-medium">Target Category</span>
                  <select
                    value={bScopeValue}
                    onChange={(e) => setBScopeValue(e.target.value)}
                    className={`${SELECT_BASE_CLASS} w-full`}
                  >
                    {COST_CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {!editingBudget && bScopeType === 'app' && (
                <label className="space-y-1 block">
                  <span className="font-medium">Target Application</span>
                  <select
                    value={bScopeValue}
                    onChange={(e) => setBScopeValue(e.target.value)}
                    className={`${SELECT_BASE_CLASS} w-full`}
                  >
                    {APP_ID_OPTIONS.filter((a) => a.id).map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="space-y-1 block">
                  <span className="font-medium">Budget Amount</span>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 25000.00"
                    value={bAmount}
                    onChange={(e) => setBAmount(e.target.value)}
                    className={`${INPUT_BASE_CLASS} font-mono tabular-nums`}
                  />
                </label>
                <label className="space-y-1 block">
                  <span className="font-medium">Currency</span>
                  <select
                    disabled={Boolean(editingBudget)}
                    value={bCurrency}
                    onChange={(e) => setBCurrency(e.target.value)}
                    className={`${SELECT_BASE_CLASS} w-full font-mono`}
                  >
                    {SUPPORTED_CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="space-y-1 block">
                  <span className="font-medium">Warning Threshold (%)</span>
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    required
                    value={bWarnPct}
                    onChange={(e) => setBWarnPct(e.target.value)}
                    className={`${INPUT_BASE_CLASS} font-mono tabular-nums`}
                  />
                </label>
                <label className="space-y-1 block">
                  <span className="font-medium">Critical Threshold (%)</span>
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    required
                    value={bCritPct}
                    onChange={(e) => setBCritPct(e.target.value)}
                    className={`${INPUT_BASE_CLASS} font-mono tabular-nums`}
                  />
                </label>
              </div>

              <label className="flex items-center gap-2 pt-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={bEnabled}
                  onChange={(e) => setBEnabled(e.target.checked)}
                />
                <span>Budget evaluation & threshold alerts enabled</span>
              </label>

              <div className="flex justify-end gap-2.5 pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setBudgetModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={busyAction === 'save-budget'}
                >
                  {busyAction === 'save-budget' ? 'Saving...' : 'Save Budget'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Provider Pricing Modal */}
      {pricingModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="pricing-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={() => setPricingModalOpen(false)}
        >
          <div
            className="w-full max-w-lg bg-[var(--dp-surface-container-lowest)] border border-[var(--dp-outline-variant)] rounded-[var(--dp-radius-lg)] p-6 space-y-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2
                id="pricing-modal-title"
                className="text-[17px] font-semibold text-[var(--dp-on-surface)]"
              >
                Configure Provider Unit Pricing
              </h2>
              <button
                type="button"
                aria-label="Close modal"
                onClick={() => setPricingModalOpen(false)}
                className="p-1 rounded-[var(--dp-radius-sm)] text-[var(--dp-on-surface-variant)] hover:bg-[var(--dp-surface-variant)] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSavePricing} className="space-y-3.5 text-[13px]">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="space-y-1 block">
                  <span className="font-medium">Provider</span>
                  <select
                    value={pProviderId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setPProviderId(id);
                      const match = providers.find((p) => p.providerId === id);
                      if (match) {
                        setPCategory(match.category);
                        setPUnit(match.supportedUnits[0] || 'unit');
                      }
                    }}
                    className={`${SELECT_BASE_CLASS} w-full`}
                  >
                    {providers.map((p) => (
                      <option key={p.providerId} value={p.providerId}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 block">
                  <span className="font-medium">Category</span>
                  <select
                    value={pCategory}
                    onChange={(e) => setPCategory(e.target.value as CostCategory)}
                    className={`${SELECT_BASE_CLASS} w-full`}
                  >
                    {COST_CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="space-y-1 block">
                <span className="font-medium">Service / SKU Name</span>
                <input
                  type="text"
                  required
                  placeholder="e.g. Outbound Calling Per Minute"
                  value={pServiceName}
                  onChange={(e) => setPServiceName(e.target.value)}
                  className={INPUT_BASE_CLASS}
                />
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="space-y-1 block">
                  <span className="font-medium">Unit</span>
                  <input
                    type="text"
                    required
                    placeholder="minute, request..."
                    value={pUnit}
                    onChange={(e) => setPUnit(e.target.value)}
                    className={`${INPUT_BASE_CLASS} font-mono`}
                  />
                </label>
                <label className="space-y-1 block">
                  <span className="font-medium">Unit Price</span>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 0.450000"
                    value={pUnitPrice}
                    onChange={(e) => setPUnitPrice(e.target.value)}
                    className={`${INPUT_BASE_CLASS} font-mono tabular-nums`}
                  />
                </label>
                <label className="space-y-1 block">
                  <span className="font-medium">Currency</span>
                  <select
                    value={pCurrency}
                    onChange={(e) => setPCurrency(e.target.value)}
                    className={`${SELECT_BASE_CLASS} w-full font-mono`}
                  >
                    {SUPPORTED_CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="space-y-1 block">
                <span className="font-medium">Effective Date</span>
                <input
                  type="date"
                  required
                  value={pEffectiveDate}
                  onChange={(e) => setPEffectiveDate(e.target.value)}
                  className={`${INPUT_BASE_CLASS} font-mono`}
                />
              </label>

              <div className="flex justify-end gap-2.5 pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setPricingModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={busyAction === 'save-pricing'}
                >
                  {busyAction === 'save-pricing' ? 'Saving...' : 'Save Unit Price'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Expense Record Detail Modal */}
      {detailRecord && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="expense-detail-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={() => setDetailRecord(null)}
        >
          <div
            className="w-full max-w-lg bg-[var(--dp-surface-container-lowest)] border border-[var(--dp-outline-variant)] rounded-[var(--dp-radius-lg)] p-6 space-y-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2
                id="expense-detail-title"
                className="text-[17px] font-semibold text-[var(--dp-on-surface)]"
              >
                Expense Record #{detailRecord.id}
              </h2>
              <button
                type="button"
                aria-label="Close modal"
                onClick={() => setDetailRecord(null)}
                className="p-1 rounded-[var(--dp-radius-sm)] text-[var(--dp-on-surface-variant)] hover:bg-[var(--dp-surface-variant)] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-[12px]">
              <div>
                <dt className="text-[var(--dp-on-surface-variant)]">Provider</dt>
                <dd className="font-medium text-[var(--dp-on-surface)]">
                  {detailRecord.providerName}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--dp-on-surface-variant)]">Amount</dt>
                <dd className="font-mono font-semibold text-[var(--dp-on-surface)] tabular-nums">
                  {formatCurrencyAmount(detailRecord.amount, detailRecord.currency, 4)}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--dp-on-surface-variant)]">Record Type</dt>
                <dd className="font-medium">{RECORD_TYPE_LABEL[detailRecord.recordType]}</dd>
              </div>
              <div>
                <dt className="text-[var(--dp-on-surface-variant)]">Category</dt>
                <dd>{getCostCategoryLabel(detailRecord.category)}</dd>
              </div>
              <div>
                <dt className="text-[var(--dp-on-surface-variant)]">Billing Period</dt>
                <dd className="font-mono">{detailRecord.billingPeriod}</dd>
              </div>
              <div>
                <dt className="text-[var(--dp-on-surface-variant)]">Application</dt>
                <dd className="font-mono">{detailRecord.appId || 'shared_platform'}</dd>
              </div>
              {detailRecord.usageQuantity && detailRecord.unitPrice && (
                <div className="col-span-2">
                  <dt className="text-[var(--dp-on-surface-variant)]">
                    Metered Calculation
                  </dt>
                  <dd className="font-mono tabular-nums">
                    {detailRecord.usageQuantity} {detailRecord.unit || 'units'} ×{' '}
                    {detailRecord.currency} {detailRecord.unitPrice}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-[var(--dp-on-surface-variant)]">Reference</dt>
                <dd className="font-mono">{detailRecord.reference || '—'}</dd>
              </div>
              <div>
                <dt className="text-[var(--dp-on-surface-variant)]">Source</dt>
                <dd className="font-mono">{detailRecord.sourceType}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-[var(--dp-on-surface-variant)]">Notes</dt>
                <dd className="text-[var(--dp-on-surface)]">
                  {detailRecord.notes || 'No notes provided.'}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-[var(--dp-on-surface-variant)]">Recorded At</dt>
                <dd className="font-mono text-[11px] tabular-nums">
                  {formatTimestamp(detailRecord.recordedAt)} · by {detailRecord.createdByUid}
                </dd>
              </div>
            </dl>
            <div className="flex justify-end pt-2">
              <Button variant="secondary" onClick={() => setDetailRecord(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
