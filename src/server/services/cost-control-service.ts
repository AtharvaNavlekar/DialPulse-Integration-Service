import { and, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
  activityLogs,
  automationExecutions,
  costAlerts,
  costBudgets,
  costRecords,
  formSubmissions,
  internalNotifications,
  providerPricingConfigs,
  providerWebhookLogs,
} from '../../db/schema.ts';
import {
  AMOUNT_DECIMALS,
  UNIT_PRICE_DECIMALS,
  aggregateCurrencyTotals,
  buildCostBreakdown,
  buildDailyCostTrend,
  buildImportRowFingerprint,
  buildMonthlyCostTrend,
  evaluateBudgetStatus,
  formatScaledBigInt,
  getCurrentBillingPeriod,
  multiplyQuantityByUnitPrice,
  normalizeBillingPeriod,
  normalizeCurrencyCode,
  parseCsvCostImport,
  parseDecimalToScaledBigInt,
  type CostCalculationRecordInput,
} from '../../shared/cost-engine.ts';
import type {
  CostAlertItem,
  CostAlertLevel,
  CostBudgetEvaluationItem,
  CostBudgetItem,
  CostBudgetPeriod,
  CostBudgetScopeType,
  CostCategory,
  CostCurrencyTotals,
  CostProviderCatalogSummary,
  CostRecordItem,
  CostRecordType,
  CostSummaryPayload,
  CostUsageEstimateItem,
  ProviderPricingConfigItem,
} from '../../shared/types.ts';
import { getProviderRegistryEntry } from '../integrations/provider-registry.ts';

export class CostControlError extends Error {
  statusCode: 400 | 403 | 404 | 409 | 500;
  details?: string[];

  constructor(
    statusCode: 400 | 403 | 404 | 409 | 500,
    message: string,
    details?: string[]
  ) {
    super(message);
    this.name = 'CostControlError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

export interface CostProviderDefinition {
  providerId: string;
  name: string;
  category: CostCategory;
  registryProviderId: string | null;
  supportedUnits: string[];
  billingIntegrationNote: string;
}

export const COST_PROVIDER_CATALOG: readonly CostProviderDefinition[] = [
  {
    providerId: 'google_cloud_run',
    name: 'Google Cloud Run & Compute',
    category: 'infrastructure',
    registryProviderId: null,
    supportedUnits: ['vCPU-hour', 'GiB-hour', '1M-requests', 'month'],
    billingIntegrationNote:
      'Live Google Cloud Billing API sync is not connected. Enter invoice totals or import billing CSV exports.',
  },
  {
    providerId: 'cloud_sql_postgres',
    name: 'Cloud SQL (PostgreSQL)',
    category: 'storage',
    registryProviderId: null,
    supportedUnits: ['instance-hour', 'GB-month', 'month'],
    billingIntegrationNote:
      'Live Cloud SQL billing feed is not connected. Record monthly instance charges or unit rates manually.',
  },
  {
    providerId: 'cloud_storage',
    name: 'Cloud Storage & Backups',
    category: 'storage',
    registryProviderId: null,
    supportedUnits: ['GB-month', '10k-ops'],
    billingIntegrationNote:
      'Object storage billing export sync is not connected. Track storage invoices via manual entry or CSV.',
  },
  {
    providerId: 'gemini_ai',
    name: 'Gemini AI Models',
    category: 'ai_models',
    registryProviderId: null,
    supportedUnits: ['1k_input_tokens', '1k_output_tokens', 'request'],
    billingIntegrationNote:
      'Vertex/Gemini billing export is not connected. Configure per-request or token rates to generate transparent estimates.',
  },
  {
    providerId: 'voice_telephony_approved',
    name: 'Voice & Telephony Provider',
    category: 'telephony',
    registryProviderId: 'voice_telephony_approved',
    supportedUnits: ['minute', 'call', 'number-month'],
    billingIntegrationNote:
      getProviderRegistryEntry('voice_telephony_approved')?.costModelNote ??
      'Telephony carrier billing API is not connected.',
  },
  {
    providerId: 'whatsapp_business_approved',
    name: 'WhatsApp Business Messaging',
    category: 'messaging',
    registryProviderId: 'whatsapp_business_approved',
    supportedUnits: ['conversation', 'template_message'],
    billingIntegrationNote:
      getProviderRegistryEntry('whatsapp_business_approved')?.costModelNote ??
      'Meta WABA billing API is not connected.',
  },
  {
    providerId: 'sms_delivery_gateway',
    name: 'SMS Delivery Gateway',
    category: 'messaging',
    registryProviderId: null,
    supportedUnits: ['sms_segment', 'message'],
    billingIntegrationNote:
      'DLT/SMS aggregator billing webhook is not connected. Configure per-SMS pricing or import vendor statements.',
  },
  {
    providerId: 'transactional_email_approved',
    name: 'Transactional Email Relay',
    category: 'messaging',
    registryProviderId: 'transactional_email_approved',
    supportedUnits: ['email', '1k_emails'],
    billingIntegrationNote:
      getProviderRegistryEntry('transactional_email_approved')?.costModelNote ??
      'Email relay billing API is not connected.',
  },
  {
    providerId: 'document_ocr_kyc',
    name: 'Document Processing & OCR',
    category: 'software_services',
    registryProviderId: null,
    supportedUnits: ['page', 'document'],
    billingIntegrationNote:
      'OCR/KYC verification vendor billing is not connected.',
  },
  {
    providerId: 'esign_provider_approved',
    name: 'E-Signature Provider',
    category: 'software_services',
    registryProviderId: 'esign_provider_approved',
    supportedUnits: ['envelope', 'signature'],
    billingIntegrationNote:
      getProviderRegistryEntry('esign_provider_approved')?.costModelNote ??
      'E-signature provider billing API is not connected.',
  },
  {
    providerId: 'external_saas_tools',
    name: 'External Software & SaaS Services',
    category: 'software_services',
    registryProviderId: null,
    supportedUnits: ['seat-month', 'license', 'invoice'],
    billingIntegrationNote:
      'Third-party SaaS subscription invoices are tracked via manual entry or billing CSV import.',
  },
] as const;

function mapCostRecord(row: typeof costRecords.$inferSelect): CostRecordItem {
  return {
    id: row.id,
    tenantId: row.tenantId,
    providerId: row.providerId,
    providerName: row.providerName,
    appId: row.appId ?? null,
    category: row.category as CostCategory,
    recordType: row.recordType as CostRecordType,
    amount: String(row.amount),
    currency: row.currency,
    usageQuantity: row.usageQuantity !== null ? String(row.usageQuantity) : null,
    unit: row.unit ?? null,
    unitPrice: row.unitPrice !== null ? String(row.unitPrice) : null,
    billingPeriod: row.billingPeriod,
    reference: row.reference ?? null,
    idempotencyKey: row.idempotencyKey ?? null,
    sourceType: row.sourceType,
    sourceMetadata: (row.sourceMetadata ?? {}) as Record<string, unknown>,
    notes: row.notes,
    recordedAt: row.recordedAt.toISOString(),
    createdByUid: row.createdByUid,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapPricingConfig(
  row: typeof providerPricingConfigs.$inferSelect
): ProviderPricingConfigItem {
  return {
    id: row.id,
    tenantId: row.tenantId,
    providerId: row.providerId,
    serviceName: row.serviceName,
    category: row.category as CostCategory,
    unit: row.unit,
    unitPrice: String(row.unitPrice),
    currency: row.currency,
    effectiveDate: row.effectiveDate,
    active: row.active,
    updatedByUid: row.updatedByUid ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapBudget(row: typeof costBudgets.$inferSelect): CostBudgetItem {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    scopeType: row.scopeType as CostBudgetScopeType,
    scopeValue: row.scopeValue ?? null,
    period: row.period as CostBudgetPeriod,
    budgetAmount: String(row.budgetAmount),
    currency: row.currency,
    warningThresholdPct: row.warningThresholdPct,
    criticalThresholdPct: row.criticalThresholdPct,
    enabled: row.enabled,
    createdByUid: row.createdByUid,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function resolveProviderName(providerId: string, providedName?: string): string {
  const trimmed = (providedName || '').trim();
  if (trimmed) return trimmed;
  const known = COST_PROVIDER_CATALOG.find((p) => p.providerId === providerId);
  return known?.name || providerId;
}

type DbExecutor = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete'>;

async function evaluateAndPersistBudgetAlerts(
  executor: DbExecutor,
  tenantId: number,
  billingPeriod: string,
  currency: string
): Promise<void> {
  const normalizedPeriod = normalizeBillingPeriod(billingPeriod);
  const normalizedCurrency = normalizeCurrencyCode(currency);
  const yearPrefix = normalizedPeriod.slice(0, 4);

  const [budgets, periodAndYearRecords, existingAlerts] = await Promise.all([
    executor
      .select()
      .from(costBudgets)
      .where(
        and(
          eq(costBudgets.tenantId, tenantId),
          eq(costBudgets.currency, normalizedCurrency),
          eq(costBudgets.enabled, true)
        )
      ),
    executor
      .select()
      .from(costRecords)
      .where(
        and(
          eq(costRecords.tenantId, tenantId),
          eq(costRecords.currency, normalizedCurrency),
          ilike(costRecords.billingPeriod, `${yearPrefix}-%`)
        )
      ),
    executor
      .select()
      .from(costAlerts)
      .where(
        and(
          eq(costAlerts.tenantId, tenantId),
          eq(costAlerts.currency, normalizedCurrency)
        )
      ),
  ]);

  if (budgets.length === 0) return;

  const calcInputs: CostCalculationRecordInput[] = periodAndYearRecords.map((r) => ({
    id: r.id,
    providerId: r.providerId,
    providerName: r.providerName,
    appId: r.appId ?? null,
    category: r.category as CostCategory,
    recordType: r.recordType as CostRecordType,
    amount: String(r.amount),
    currency: r.currency,
    billingPeriod: r.billingPeriod,
    recordedAt: r.recordedAt,
  }));

  for (const bRow of budgets) {
    const budget = mapBudget(bRow);
    const alertPeriod =
      budget.period === 'yearly' ? yearPrefix : normalizedPeriod;
    const evaluation = evaluateBudgetStatus({
      budget,
      records: calcInputs,
      targetBillingPeriod: normalizedPeriod,
    });

    const levelsToTrigger: Array<{ level: CostAlertLevel; thresholdPct: number }> = [];
    if (evaluation.utilizationPct >= budget.warningThresholdPct) {
      levelsToTrigger.push({
        level: 'warning',
        thresholdPct: budget.warningThresholdPct,
      });
    }
    if (evaluation.utilizationPct >= budget.criticalThresholdPct) {
      levelsToTrigger.push({
        level: 'critical',
        thresholdPct: budget.criticalThresholdPct,
      });
    }

    for (const trig of levelsToTrigger) {
      const inserted = await executor
        .insert(costAlerts)
        .values({
          tenantId,
          budgetId: budget.id,
          billingPeriod: alertPeriod,
          alertLevel: trig.level,
          thresholdPct: trig.thresholdPct,
          observedAmount: evaluation.observedVerifiedSpend,
          budgetAmount: budget.budgetAmount,
          currency: budget.currency,
          status: 'active',
        })
        .onConflictDoNothing({
          target: [
            costAlerts.tenantId,
            costAlerts.budgetId,
            costAlerts.billingPeriod,
            costAlerts.alertLevel,
          ],
        })
        .returning({ id: costAlerts.id });

      if (inserted.length > 0) {
        const levelLabel = trig.level === 'critical' ? 'Critical' : 'Warning';
        await executor
          .insert(internalNotifications)
          .values({
            tenantId,
            idempotencyKey: `cost-alert:${tenantId}:${budget.id}:${alertPeriod}:${trig.level}`,
            title: `${levelLabel} Cost Budget Alert: ${budget.name}`,
            message: `${budget.name} (${alertPeriod}) reached ${evaluation.utilizationPct.toFixed(
              1
            )}% (${budget.currency} ${evaluation.observedVerifiedSpend} / ${
              budget.budgetAmount
            }), crossing the ${trig.thresholdPct}% ${trig.level} threshold.`,
            read: false,
          })
          .onConflictDoNothing({
            target: [
              internalNotifications.tenantId,
              internalNotifications.idempotencyKey,
            ],
          });
      } else {
        // Keep observed amount fresh while active
        await executor
          .update(costAlerts)
          .set({
            observedAmount: evaluation.observedVerifiedSpend,
            budgetAmount: budget.budgetAmount,
          })
          .where(
            and(
              eq(costAlerts.tenantId, tenantId),
              eq(costAlerts.budgetId, budget.id),
              eq(costAlerts.billingPeriod, alertPeriod),
              eq(costAlerts.alertLevel, trig.level),
              eq(costAlerts.status, 'active')
            )
          );
      }
    }

    // Auto-resolve active alerts if budget limit was raised or spend dropped below threshold
    const triggeredLevelSet = new Set(levelsToTrigger.map((t) => t.level));
    for (const existing of existingAlerts) {
      if (
        existing.budgetId === budget.id &&
        existing.billingPeriod === alertPeriod &&
        existing.status === 'active' &&
        !triggeredLevelSet.has(existing.alertLevel as CostAlertLevel)
      ) {
        await executor
          .update(costAlerts)
          .set({
            status: 'resolved',
            resolvedAt: new Date(),
            observedAmount: evaluation.observedVerifiedSpend,
            budgetAmount: budget.budgetAmount,
          })
          .where(eq(costAlerts.id, existing.id));
      }
    }
  }
}

export async function getCostSummary(params: {
  tenantId: number;
  billingPeriod?: string;
  currency?: string;
  canManageCosts: boolean;
}): Promise<CostSummaryPayload> {
  const billingPeriod = params.billingPeriod
    ? normalizeBillingPeriod(params.billingPeriod)
    : getCurrentBillingPeriod();
  const yearPrefix = billingPeriod.slice(0, 4);

  const [allRecords, allBudgets, allAlerts, pricingConfigs] = await Promise.all([
    db
      .select()
      .from(costRecords)
      .where(eq(costRecords.tenantId, params.tenantId))
      .orderBy(desc(costRecords.recordedAt)),
    db
      .select()
      .from(costBudgets)
      .where(eq(costBudgets.tenantId, params.tenantId))
      .orderBy(desc(costBudgets.updatedAt)),
    db
      .select()
      .from(costAlerts)
      .where(eq(costAlerts.tenantId, params.tenantId))
      .orderBy(desc(costAlerts.triggeredAt)),
    db
      .select()
      .from(providerPricingConfigs)
      .where(
        and(
          eq(providerPricingConfigs.tenantId, params.tenantId),
          eq(providerPricingConfigs.active, true)
        )
      ),
  ]);

  const calcAllRecords: CostCalculationRecordInput[] = allRecords.map((r) => ({
    id: r.id,
    providerId: r.providerId,
    providerName: r.providerName,
    appId: r.appId ?? null,
    category: r.category as CostCategory,
    recordType: r.recordType as CostRecordType,
    amount: String(r.amount),
    currency: r.currency,
    billingPeriod: r.billingPeriod,
    recordedAt: r.recordedAt,
  }));

  const periodRecords = calcAllRecords.filter(
    (r) => r.billingPeriod === billingPeriod
  );

  const periodAgg = aggregateCurrencyTotals(periodRecords, billingPeriod);
  const allAgg = aggregateCurrencyTotals(calcAllRecords, billingPeriod);

  const availableCurrencies = Array.from(
    new Set([
      ...periodAgg.availableCurrencies,
      ...allAgg.availableCurrencies,
      ...allBudgets.map((b) => b.currency),
    ])
  ).sort();

  const requestedCurrency = params.currency
    ? normalizeCurrencyCode(params.currency)
    : null;
  const selectedCurrency =
    (requestedCurrency && availableCurrencies.includes(requestedCurrency)
      ? requestedCurrency
      : null) ??
    periodAgg.availableCurrencies[0] ??
    availableCurrencies[0] ??
    'INR';

  const totals: CostCurrencyTotals = periodAgg.currencyTotals.find(
    (t) => t.currency === selectedCurrency
  ) ?? {
    currency: selectedCurrency,
    actualTotal: '0.00',
    importedTotal: '0.00',
    verifiedTotal: '0.00',
    estimatedTotal: '0.00',
    projectedMonthlySpend: null,
    recordCount: 0,
  };

  const budgetMap = new Map(allBudgets.map((b) => [b.id, mapBudget(b)]));
  const activeAlertsByBudget = new Map<number, number>();
  for (const a of allAlerts) {
    if (a.status === 'active') {
      activeAlertsByBudget.set(
        a.budgetId,
        (activeAlertsByBudget.get(a.budgetId) ?? 0) + 1
      );
    }
  }

  const budgets: CostBudgetEvaluationItem[] = allBudgets.map((bRow) => {
    const budget = mapBudget(bRow);
    return evaluateBudgetStatus({
      budget,
      records: calcAllRecords,
      targetBillingPeriod: billingPeriod,
      activeAlertCount: activeAlertsByBudget.get(budget.id) ?? 0,
    });
  });

  // Only aggregate tenant/total budgets of the selected currency cleanly
  const matchingActiveBudgets = budgets.filter(
    (b) => b.enabled && b.currency === selectedCurrency && b.period === 'monthly'
  );
  const tenantLevelBudgets = matchingActiveBudgets.filter(
    (b) => b.scopeType === 'tenant'
  );
  const budgetSourceForTotal =
    tenantLevelBudgets.length > 0 ? tenantLevelBudgets : matchingActiveBudgets;

  let totalBudgetConfigured: string | null = null;
  let budgetUtilizationPct: number | null = null;
  if (budgetSourceForTotal.length > 0) {
    const sumBudgetScaled = budgetSourceForTotal.reduce(
      (acc, b) =>
        acc +
        parseDecimalToScaledBigInt(b.budgetAmount, AMOUNT_DECIMALS, {
          allowZero: true,
        }),
      0n
    );
    const verifiedPeriodScaled = parseDecimalToScaledBigInt(
      totals.verifiedTotal,
      AMOUNT_DECIMALS,
      { allowZero: true }
    );
    totalBudgetConfigured = formatScaledBigInt(sumBudgetScaled, AMOUNT_DECIMALS, 2);
    budgetUtilizationPct =
      sumBudgetScaled > 0n
        ? Number((verifiedPeriodScaled * 10_000n) / sumBudgetScaled) / 100
        : null;
  }

  const recentAlerts: CostAlertItem[] = allAlerts.slice(0, 25).map((a) => {
    const budget = budgetMap.get(a.budgetId);
    return {
      id: a.id,
      tenantId: a.tenantId,
      budgetId: a.budgetId,
      budgetName: budget?.name || `Budget #${a.budgetId}`,
      scopeType: budget?.scopeType ?? 'tenant',
      scopeValue: budget?.scopeValue ?? null,
      billingPeriod: a.billingPeriod,
      alertLevel: a.alertLevel as CostAlertLevel,
      thresholdPct: a.thresholdPct,
      observedAmount: String(a.observedAmount),
      budgetAmount: String(a.budgetAmount),
      currency: a.currency,
      status: a.status as 'active' | 'resolved',
      triggeredAt: a.triggeredAt.toISOString(),
      resolvedAt: a.resolvedAt ? a.resolvedAt.toISOString() : null,
    };
  });

  const activeAlertsCount = allAlerts.filter((a) => a.status === 'active').length;

  const incompleteDataIndicators: string[] = [
    'Live external vendor billing APIs are not connected; figures reflect verified manual entries, imported CSV statements, and configured unit-price estimates only.',
  ];
  if (availableCurrencies.length > 1) {
    incompleteDataIndicators.push(
      `Records span multiple currencies (${availableCurrencies.join(
        ', '
      )}). Currencies are isolated and never combined; currently showing ${selectedCurrency}.`
    );
  }
  if (periodRecords.length === 0) {
    incompleteDataIndicators.push(
      `No cost records recorded for ${billingPeriod} yet.`
    );
  }
  if (pricingConfigs.length === 0) {
    incompleteDataIndicators.push(
      'No provider unit pricing rules are configured for automated usage estimates.'
    );
  }
  if (allRecords.some((r) => r.recordType === 'estimated' && r.billingPeriod.startsWith(yearPrefix))) {
    incompleteDataIndicators.push(
      'Estimated costs are tracked separately and excluded from verified actual expenditure and budget breach calculations.'
    );
  }

  return {
    tenantId: params.tenantId,
    billingPeriod,
    selectedCurrency,
    availableCurrencies:
      availableCurrencies.length > 0 ? availableCurrencies : ['INR'],
    hasMixedCurrencies: availableCurrencies.length > 1,
    currencyTotals: periodAgg.currencyTotals,
    totals,
    totalBudgetConfigured,
    budgetUtilizationPct,
    activeAlertsCount,
    incompleteDataIndicators,
    dailyTrend: buildDailyCostTrend(
      periodRecords,
      selectedCurrency,
      billingPeriod
    ),
    monthlyTrend: buildMonthlyCostTrend(calcAllRecords, selectedCurrency),
    byProvider: buildCostBreakdown(periodRecords, selectedCurrency, 'provider'),
    byCategory: buildCostBreakdown(periodRecords, selectedCurrency, 'category'),
    byApp: buildCostBreakdown(periodRecords, selectedCurrency, 'app'),
    budgets,
    recentAlerts,
    canManageCosts: params.canManageCosts,
  };
}

export async function listCostRecords(params: {
  tenantId: number;
  search?: string;
  from?: string;
  to?: string;
  billingPeriod?: string;
  providerId?: string;
  category?: string;
  recordType?: string;
  currency?: string;
  page?: number;
  pageSize?: number;
}): Promise<{
  records: CostRecordItem[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(params.pageSize ?? 25)));

  const conditions = [eq(costRecords.tenantId, params.tenantId)];
  if (params.billingPeriod) {
    conditions.push(
      eq(costRecords.billingPeriod, normalizeBillingPeriod(params.billingPeriod))
    );
  }
  if (params.providerId) {
    conditions.push(eq(costRecords.providerId, params.providerId.trim()));
  }
  if (params.category) {
    conditions.push(eq(costRecords.category, params.category.trim()));
  }
  if (params.recordType) {
    conditions.push(eq(costRecords.recordType, params.recordType.trim()));
  }
  if (params.currency) {
    conditions.push(
      eq(costRecords.currency, normalizeCurrencyCode(params.currency))
    );
  }
  if (params.from) {
    const d = new Date(params.from);
    if (!Number.isNaN(d.getTime())) {
      conditions.push(gte(costRecords.recordedAt, d));
    }
  }
  if (params.to) {
    const d = new Date(params.to);
    if (!Number.isNaN(d.getTime())) {
      conditions.push(lte(costRecords.recordedAt, d));
    }
  }
  if (params.search && params.search.trim()) {
    const pattern = `%${params.search.trim()}%`;
    conditions.push(
      or(
        ilike(costRecords.providerName, pattern),
        ilike(costRecords.providerId, pattern),
        ilike(costRecords.reference, pattern),
        ilike(costRecords.notes, pattern),
        ilike(costRecords.appId, pattern)
      )!
    );
  }

  const whereClause = and(...conditions);

  const [countRows, rows] = await Promise.all([
    db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(costRecords)
      .where(whereClause),
    db
      .select()
      .from(costRecords)
      .where(whereClause)
      .orderBy(desc(costRecords.recordedAt), desc(costRecords.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
  ]);

  return {
    records: rows.map(mapCostRecord),
    total: Number(countRows[0]?.count ?? 0),
    page,
    pageSize,
  };
}

export async function createCostRecord(params: {
  tenantId: number;
  actorUid: string;
  actorLabel: string;
  providerId: string;
  providerName?: string;
  appId?: string | null;
  category: CostCategory;
  recordType: CostRecordType;
  amount?: string | number;
  currency: string;
  usageQuantity?: string | number | null;
  unit?: string | null;
  unitPrice?: string | number | null;
  billingPeriod?: string;
  reference?: string | null;
  idempotencyKey?: string | null;
  notes?: string;
  recordedAt?: string;
}): Promise<{ record: CostRecordItem }> {
  const providerId = params.providerId.trim().toLowerCase();
  const providerName = resolveProviderName(providerId, params.providerName);
  const currency = normalizeCurrencyCode(params.currency);

  const recordedDate = params.recordedAt ? new Date(params.recordedAt) : new Date();
  if (Number.isNaN(recordedDate.getTime())) {
    throw new CostControlError(400, 'Invalid recordedAt timestamp.');
  }

  const billingPeriod = normalizeBillingPeriod(
    params.billingPeriod || recordedDate.toISOString().slice(0, 7)
  );

  let usageQtyFormatted: string | null = null;
  let unitPriceFormatted: string | null = null;

  if (
    params.usageQuantity !== undefined &&
    params.usageQuantity !== null &&
    String(params.usageQuantity).trim() !== ''
  ) {
    try {
      usageQtyFormatted = formatScaledBigInt(
        parseDecimalToScaledBigInt(params.usageQuantity, AMOUNT_DECIMALS, {
          allowZero: false,
        }),
        AMOUNT_DECIMALS,
        AMOUNT_DECIMALS
      );
    } catch (err) {
      throw new CostControlError(
        400,
        err instanceof Error ? err.message : 'Invalid usageQuantity.'
      );
    }
  }

  if (
    params.unitPrice !== undefined &&
    params.unitPrice !== null &&
    String(params.unitPrice).trim() !== ''
  ) {
    try {
      unitPriceFormatted = formatScaledBigInt(
        parseDecimalToScaledBigInt(params.unitPrice, UNIT_PRICE_DECIMALS, {
          allowZero: false,
        }),
        UNIT_PRICE_DECIMALS,
        UNIT_PRICE_DECIMALS
      );
    } catch (err) {
      throw new CostControlError(
        400,
        err instanceof Error ? err.message : 'Invalid unitPrice.'
      );
    }
  }

  let amountFormatted: string;
  if (
    params.amount !== undefined &&
    params.amount !== null &&
    String(params.amount).trim() !== ''
  ) {
    try {
      amountFormatted = formatScaledBigInt(
        parseDecimalToScaledBigInt(params.amount, AMOUNT_DECIMALS, {
          allowZero: false,
        }),
        AMOUNT_DECIMALS,
        AMOUNT_DECIMALS
      );
    } catch (err) {
      throw new CostControlError(
        400,
        err instanceof Error ? err.message : 'Invalid cost amount.'
      );
    }
  } else if (usageQtyFormatted && unitPriceFormatted) {
    amountFormatted = multiplyQuantityByUnitPrice(
      usageQtyFormatted,
      unitPriceFormatted
    );
  } else {
    throw new CostControlError(
      400,
      'Provide a positive amount or both usageQuantity and unitPrice.'
    );
  }

  const cleanIdempotencyKey = params.idempotencyKey?.trim() || null;

  const created = await db.transaction(async (tx) => {
    if (cleanIdempotencyKey) {
      const dup = await tx
        .select({ id: costRecords.id })
        .from(costRecords)
        .where(
          and(
            eq(costRecords.tenantId, params.tenantId),
            eq(costRecords.idempotencyKey, cleanIdempotencyKey)
          )
        )
        .limit(1);
      if (dup.length > 0) {
        throw new CostControlError(
          409,
          `Duplicate cost record prevented: idempotencyKey "${cleanIdempotencyKey}" already exists.`
        );
      }
    }

    const [inserted] = await tx
      .insert(costRecords)
      .values({
        tenantId: params.tenantId,
        providerId,
        providerName,
        appId: params.appId?.trim() || null,
        category: params.category,
        recordType: params.recordType,
        amount: amountFormatted,
        currency,
        usageQuantity: usageQtyFormatted,
        unit: params.unit?.trim() || null,
        unitPrice: unitPriceFormatted,
        billingPeriod,
        reference: params.reference?.trim() || null,
        idempotencyKey: cleanIdempotencyKey,
        sourceType:
          params.recordType === 'estimated' ? 'usage_estimate' : 'manual_entry',
        sourceMetadata: {},
        notes: (params.notes || '').trim(),
        recordedAt: recordedDate,
        createdByUid: params.actorUid,
      })
      .returning();

    await tx.insert(activityLogs).values({
      tenantId: params.tenantId,
      actorUid: params.actorUid,
      actorLabel: params.actorLabel,
      module: 'costs',
      action: `cost.record_${params.recordType}_created`,
      entityType: 'cost_record',
      entityId: String(inserted!.id),
      summary: `Recorded ${params.recordType} cost for ${providerName}: ${currency} ${amountFormatted} (${billingPeriod}).`,
      metadata: {
        providerId,
        category: params.category,
        recordType: params.recordType,
        currency,
        amount: amountFormatted,
        billingPeriod,
      },
    });

    await evaluateAndPersistBudgetAlerts(
      tx,
      params.tenantId,
      billingPeriod,
      currency
    );

    return inserted!;
  });

  return { record: mapCostRecord(created) };
}

export async function importCostRecordsBatch(params: {
  tenantId: number;
  actorUid: string;
  actorLabel: string;
  csvText?: string;
  defaultCurrency?: string;
  defaultBillingPeriod?: string;
  rows?: Array<{
    providerId: string;
    providerName?: string;
    appId?: string | null;
    category: CostCategory;
    amount: string | number;
    currency?: string;
    billingPeriod?: string;
    recordedAt?: string;
    reference?: string | null;
    usageQuantity?: string | number | null;
    unit?: string | null;
    unitPrice?: string | number | null;
    notes?: string;
  }>;
}): Promise<{
  importedCount: number;
  skippedDuplicatesCount: number;
  errors: string[];
  records: CostRecordItem[];
}> {
  let normalizedRows: Array<{
    providerId: string;
    providerName: string;
    appId: string | null;
    category: CostCategory;
    amount: string;
    currency: string;
    billingPeriod: string;
    recordedAt: Date;
    reference: string | null;
    usageQuantity: string | null;
    unit: string | null;
    unitPrice: string | null;
    notes: string;
    idempotencyKey: string;
  }> = [];
  const parseErrors: string[] = [];

  if (typeof params.csvText === 'string' && params.csvText.trim().length > 0) {
    const parsedCsv = parseCsvCostImport(params.csvText, {
      defaultCurrency: params.defaultCurrency,
      defaultBillingPeriod: params.defaultBillingPeriod,
    });
    parseErrors.push(...parsedCsv.errors);
    normalizedRows = parsedCsv.rows.map((r) => ({
      providerId: r.providerId,
      providerName: resolveProviderName(r.providerId, r.providerName),
      appId: r.appId,
      category: r.category,
      amount: r.amount,
      currency: r.currency,
      billingPeriod: r.billingPeriod,
      recordedAt: new Date(r.recordedAt),
      reference: r.reference,
      usageQuantity: r.usageQuantity,
      unit: r.unit,
      unitPrice: r.unitPrice,
      notes: r.notes,
      idempotencyKey: r.idempotencyKey,
    }));
  } else if (Array.isArray(params.rows) && params.rows.length > 0) {
    for (let i = 0; i < params.rows.length; i += 1) {
      const r = params.rows[i]!;
      try {
        const providerId = r.providerId.trim().toLowerCase();
        const providerName = resolveProviderName(providerId, r.providerName);
        const currency = normalizeCurrencyCode(
          r.currency || params.defaultCurrency || 'INR'
        );
        const recDate = r.recordedAt ? new Date(r.recordedAt) : new Date();
        if (Number.isNaN(recDate.getTime())) {
          throw new Error('Invalid recordedAt timestamp.');
        }
        const billingPeriod = normalizeBillingPeriod(
          r.billingPeriod ||
            params.defaultBillingPeriod ||
            recDate.toISOString().slice(0, 7)
        );
        const amount = formatScaledBigInt(
          parseDecimalToScaledBigInt(r.amount, AMOUNT_DECIMALS, {
            allowZero: false,
          }),
          AMOUNT_DECIMALS,
          AMOUNT_DECIMALS
        );
        const usageQuantity =
          r.usageQuantity !== undefined &&
          r.usageQuantity !== null &&
          String(r.usageQuantity).trim() !== ''
            ? formatScaledBigInt(
                parseDecimalToScaledBigInt(r.usageQuantity, AMOUNT_DECIMALS, {
                  allowZero: true,
                }),
                AMOUNT_DECIMALS,
                AMOUNT_DECIMALS
              )
            : null;
        const unitPrice =
          r.unitPrice !== undefined &&
          r.unitPrice !== null &&
          String(r.unitPrice).trim() !== ''
            ? formatScaledBigInt(
                parseDecimalToScaledBigInt(r.unitPrice, UNIT_PRICE_DECIMALS, {
                  allowZero: true,
                }),
                UNIT_PRICE_DECIMALS,
                UNIT_PRICE_DECIMALS
              )
            : null;
        const reference = r.reference?.trim() || null;
        const idempotencyKey = reference
          ? `import-ref:${providerId}:${reference.toLowerCase()}`
          : buildImportRowFingerprint({
              providerId,
              category: r.category,
              amount,
              currency,
              billingPeriod,
              recordedAt: recDate.toISOString(),
              reference: r.notes || String(i + 1),
            });

        normalizedRows.push({
          providerId,
          providerName,
          appId: r.appId?.trim() || null,
          category: r.category,
          amount,
          currency,
          billingPeriod,
          recordedAt: recDate,
          reference,
          usageQuantity,
          unit: r.unit?.trim() || null,
          unitPrice,
          notes: (r.notes || '').trim(),
          idempotencyKey,
        });
      } catch (err) {
        parseErrors.push(
          `Row ${i + 1}: ${err instanceof Error ? err.message : 'Invalid row.'}`
        );
      }
    }
  } else {
    throw new CostControlError(
      400,
      'Provide CSV content (csvText) or at least one structured billing row to import.'
    );
  }

  if (normalizedRows.length === 0) {
    throw new CostControlError(
      400,
      parseErrors[0] || 'No valid billing rows found to import.',
      parseErrors
    );
  }

  const result = await db.transaction(async (tx) => {
    const insertedRows: Array<typeof costRecords.$inferSelect> = [];
    let skippedDuplicatesCount = 0;
    const periodCurrencyPairs = new Set<string>();

    for (const row of normalizedRows) {
      const inserted = await tx
        .insert(costRecords)
        .values({
          tenantId: params.tenantId,
          providerId: row.providerId,
          providerName: row.providerName,
          appId: row.appId,
          category: row.category,
          recordType: 'imported',
          amount: row.amount,
          currency: row.currency,
          usageQuantity: row.usageQuantity,
          unit: row.unit,
          unitPrice: row.unitPrice,
          billingPeriod: row.billingPeriod,
          reference: row.reference,
          idempotencyKey: row.idempotencyKey,
          sourceType: 'csv_import',
          sourceMetadata: {
            importedByUid: params.actorUid,
          },
          notes: row.notes,
          recordedAt: row.recordedAt,
          createdByUid: params.actorUid,
        })
        .onConflictDoNothing({
          target: [costRecords.tenantId, costRecords.idempotencyKey],
        })
        .returning();

      if (inserted.length > 0) {
        insertedRows.push(inserted[0]!);
        periodCurrencyPairs.add(`${row.billingPeriod}|${row.currency}`);
      } else {
        skippedDuplicatesCount += 1;
      }
    }

    await tx.insert(activityLogs).values({
      tenantId: params.tenantId,
      actorUid: params.actorUid,
      actorLabel: params.actorLabel,
      module: 'costs',
      action: 'cost.records_imported',
      entityType: 'cost_import_batch',
      entityId: String(Date.now()),
      summary: `Imported ${insertedRows.length} billing records (${skippedDuplicatesCount} duplicate rows skipped).`,
      metadata: {
        importedCount: insertedRows.length,
        skippedDuplicatesCount,
        parseErrorCount: parseErrors.length,
      },
    });

    for (const pair of periodCurrencyPairs) {
      const [bp, curr] = pair.split('|');
      if (bp && curr) {
        await evaluateAndPersistBudgetAlerts(tx, params.tenantId, bp, curr);
      }
    }

    return {
      importedCount: insertedRows.length,
      skippedDuplicatesCount,
      records: insertedRows.map(mapCostRecord),
    };
  });

  return {
    ...result,
    errors: parseErrors,
  };
}

export async function listCostProvidersWithPricing(
  tenantId: number
): Promise<{ providers: CostProviderCatalogSummary[] }> {
  const [pricingRows, recordRows] = await Promise.all([
    db
      .select()
      .from(providerPricingConfigs)
      .where(eq(providerPricingConfigs.tenantId, tenantId))
      .orderBy(desc(providerPricingConfigs.effectiveDate), desc(providerPricingConfigs.id)),
    db
      .select()
      .from(costRecords)
      .where(eq(costRecords.tenantId, tenantId)),
  ]);

  const knownIds = new Set<string>(COST_PROVIDER_CATALOG.map((p) => p.providerId));
  const extraProviders: CostProviderDefinition[] = [];
  for (const r of recordRows) {
    if (!knownIds.has(r.providerId)) {
      knownIds.add(r.providerId);
      extraProviders.push({
        providerId: r.providerId,
        name: r.providerName,
        category: (r.category as CostCategory) || 'other',
        registryProviderId: null,
        supportedUnits: ['unit'],
        billingIntegrationNote:
          'Custom vendor recorded via manual entry or CSV billing import. Live billing API not connected.',
      });
    }
  }

  const allDefs = [...COST_PROVIDER_CATALOG, ...extraProviders];
  const providers: CostProviderCatalogSummary[] = allDefs.map((def) => {
    const configs = pricingRows
      .filter((p) => p.providerId === def.providerId)
      .map(mapPricingConfig);
    const matchingRecords = recordRows.filter(
      (r) => r.providerId === def.providerId
    );

    let lastImportedAt: string | null = null;
    let lastRecordedAt: string | null = null;
    let verifiedScaled = 0n;
    let estimatedScaled = 0n;

    for (const rec of matchingRecords) {
      const iso = rec.recordedAt.toISOString();
      if (!lastRecordedAt || iso > lastRecordedAt) {
        lastRecordedAt = iso;
      }
      if (rec.recordType === 'imported') {
        const createdIso = rec.createdAt.toISOString();
        if (!lastImportedAt || createdIso > lastImportedAt) {
          lastImportedAt = createdIso;
        }
      }
      const amt = parseDecimalToScaledBigInt(String(rec.amount), AMOUNT_DECIMALS, {
        allowZero: true,
      });
      if (rec.recordType === 'estimated') {
        estimatedScaled += amt;
      } else {
        verifiedScaled += amt;
      }
    }

    return {
      providerId: def.providerId,
      name: def.name,
      category: def.category,
      registryProviderId: def.registryProviderId,
      billingIntegrationStatus: 'not_connected',
      billingIntegrationNote: def.billingIntegrationNote,
      supportedUnits: [...def.supportedUnits],
      pricingConfigs: configs,
      lastImportedAt,
      lastRecordedAt,
      verifiedSpendTotal: formatScaledBigInt(verifiedScaled, AMOUNT_DECIMALS, 2),
      estimatedSpendTotal: formatScaledBigInt(estimatedScaled, AMOUNT_DECIMALS, 2),
    };
  });

  return { providers };
}

export async function upsertProviderPricing(params: {
  tenantId: number;
  actorUid: string;
  actorLabel: string;
  providerId: string;
  serviceName: string;
  category: CostCategory;
  unit: string;
  unitPrice: string | number;
  currency: string;
  effectiveDate?: string;
  active?: boolean;
}): Promise<{ pricingConfig: ProviderPricingConfigItem }> {
  const providerId = params.providerId.trim().toLowerCase();
  const serviceName = params.serviceName.trim();
  const unit = params.unit.trim();
  const currency = normalizeCurrencyCode(params.currency);
  const effectiveDate =
    params.effectiveDate?.trim() || new Date().toISOString().slice(0, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
    throw new CostControlError(
      400,
      'effectiveDate must follow YYYY-MM-DD format.'
    );
  }

  let unitPriceFormatted: string;
  try {
    unitPriceFormatted = formatScaledBigInt(
      parseDecimalToScaledBigInt(params.unitPrice, UNIT_PRICE_DECIMALS, {
        allowZero: false,
      }),
      UNIT_PRICE_DECIMALS,
      UNIT_PRICE_DECIMALS
    );
  } catch (err) {
    throw new CostControlError(
      400,
      err instanceof Error ? err.message : 'Invalid unitPrice.'
    );
  }

  const active = params.active !== false;
  const now = new Date();

  const saved = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(providerPricingConfigs)
      .values({
        tenantId: params.tenantId,
        providerId,
        serviceName,
        category: params.category,
        unit,
        unitPrice: unitPriceFormatted,
        currency,
        effectiveDate,
        active,
        updatedByUid: params.actorUid,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          providerPricingConfigs.tenantId,
          providerPricingConfigs.providerId,
          providerPricingConfigs.serviceName,
          providerPricingConfigs.effectiveDate,
        ],
        set: {
          category: params.category,
          unit,
          unitPrice: unitPriceFormatted,
          currency,
          active,
          updatedByUid: params.actorUid,
          updatedAt: now,
        },
      })
      .returning();

    await tx.insert(activityLogs).values({
      tenantId: params.tenantId,
      actorUid: params.actorUid,
      actorLabel: params.actorLabel,
      module: 'costs',
      action: 'cost.pricing_updated',
      entityType: 'provider_pricing_config',
      entityId: String(row!.id),
      summary: `Configured unit price for ${providerId} (${serviceName}): ${currency} ${unitPriceFormatted} per ${unit}.`,
      metadata: {
        providerId,
        serviceName,
        unit,
        unitPrice: unitPriceFormatted,
        currency,
        effectiveDate,
        active,
      },
    });

    return row!;
  });

  return { pricingConfig: mapPricingConfig(saved) };
}

export async function listCostBudgets(
  tenantId: number,
  billingPeriod?: string
): Promise<{ budgets: CostBudgetEvaluationItem[] }> {
  const period = billingPeriod
    ? normalizeBillingPeriod(billingPeriod)
    : getCurrentBillingPeriod();

  const [budgetRows, recordRows, alertRows] = await Promise.all([
    db
      .select()
      .from(costBudgets)
      .where(eq(costBudgets.tenantId, tenantId))
      .orderBy(desc(costBudgets.updatedAt)),
    db.select().from(costRecords).where(eq(costRecords.tenantId, tenantId)),
    db
      .select()
      .from(costAlerts)
      .where(and(eq(costAlerts.tenantId, tenantId), eq(costAlerts.status, 'active'))),
  ]);

  const calcRecords: CostCalculationRecordInput[] = recordRows.map((r) => ({
    id: r.id,
    providerId: r.providerId,
    providerName: r.providerName,
    appId: r.appId ?? null,
    category: r.category as CostCategory,
    recordType: r.recordType as CostRecordType,
    amount: String(r.amount),
    currency: r.currency,
    billingPeriod: r.billingPeriod,
    recordedAt: r.recordedAt,
  }));

  const alertCounts = new Map<number, number>();
  for (const a of alertRows) {
    alertCounts.set(a.budgetId, (alertCounts.get(a.budgetId) ?? 0) + 1);
  }

  return {
    budgets: budgetRows.map((b) =>
      evaluateBudgetStatus({
        budget: mapBudget(b),
        records: calcRecords,
        targetBillingPeriod: period,
        activeAlertCount: alertCounts.get(b.id) ?? 0,
      })
    ),
  };
}

export async function createCostBudget(params: {
  tenantId: number;
  actorUid: string;
  actorLabel: string;
  name: string;
  scopeType: CostBudgetScopeType;
  scopeValue?: string | null;
  period: CostBudgetPeriod;
  budgetAmount: string | number;
  currency: string;
  warningThresholdPct?: number;
  criticalThresholdPct?: number;
  enabled?: boolean;
}): Promise<{ budget: CostBudgetItem }> {
  const currency = normalizeCurrencyCode(params.currency);
  const warningPct = params.warningThresholdPct ?? 80;
  const criticalPct = params.criticalThresholdPct ?? 100;

  if (warningPct < 1 || criticalPct < warningPct) {
    throw new CostControlError(
      400,
      'Critical threshold percentage must be >= warning threshold percentage (>= 1).'
    );
  }

  let budgetAmountFormatted: string;
  try {
    budgetAmountFormatted = formatScaledBigInt(
      parseDecimalToScaledBigInt(params.budgetAmount, AMOUNT_DECIMALS, {
        allowZero: false,
      }),
      AMOUNT_DECIMALS,
      AMOUNT_DECIMALS
    );
  } catch (err) {
    throw new CostControlError(
      400,
      err instanceof Error ? err.message : 'Invalid budgetAmount.'
    );
  }

  const scopeValue =
    params.scopeType === 'tenant' ? null : params.scopeValue?.trim() || null;
  if (params.scopeType !== 'tenant' && !scopeValue) {
    throw new CostControlError(
      400,
      `scopeValue is required when scopeType is "${params.scopeType}".`
    );
  }

  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(costBudgets)
      .values({
        tenantId: params.tenantId,
        name: params.name.trim(),
        scopeType: params.scopeType,
        scopeValue,
        period: params.period,
        budgetAmount: budgetAmountFormatted,
        currency,
        warningThresholdPct: warningPct,
        criticalThresholdPct: criticalPct,
        enabled: params.enabled !== false,
        createdByUid: params.actorUid,
      })
      .returning();

    await tx.insert(activityLogs).values({
      tenantId: params.tenantId,
      actorUid: params.actorUid,
      actorLabel: params.actorLabel,
      module: 'costs',
      action: 'cost.budget_created',
      entityType: 'cost_budget',
      entityId: String(row!.id),
      summary: `Created ${params.period} cost budget "${row!.name}" (${currency} ${budgetAmountFormatted}).`,
      metadata: {
        scopeType: params.scopeType,
        scopeValue,
        period: params.period,
        budgetAmount: budgetAmountFormatted,
        currency,
        warningThresholdPct: warningPct,
        criticalThresholdPct: criticalPct,
      },
    });

    if (row!.enabled) {
      await evaluateAndPersistBudgetAlerts(
        tx,
        params.tenantId,
        getCurrentBillingPeriod(),
        currency
      );
    }

    return row!;
  });

  return { budget: mapBudget(created) };
}

export async function updateCostBudget(params: {
  tenantId: number;
  budgetId: number;
  actorUid: string;
  actorLabel: string;
  name?: string;
  budgetAmount?: string | number;
  warningThresholdPct?: number;
  criticalThresholdPct?: number;
  enabled?: boolean;
}): Promise<{ budget: CostBudgetItem }> {
  const existingRows = await db
    .select()
    .from(costBudgets)
    .where(
      and(
        eq(costBudgets.id, params.budgetId),
        eq(costBudgets.tenantId, params.tenantId)
      )
    )
    .limit(1);

  const existing = existingRows[0];
  if (!existing) {
    throw new CostControlError(404, 'Cost budget not found.');
  }

  const nextWarning =
    params.warningThresholdPct ?? existing.warningThresholdPct;
  const nextCritical =
    params.criticalThresholdPct ?? existing.criticalThresholdPct;
  if (nextWarning < 1 || nextCritical < nextWarning) {
    throw new CostControlError(
      400,
      'Critical threshold percentage must be >= warning threshold percentage.'
    );
  }

  let nextAmount = String(existing.budgetAmount);
  if (params.budgetAmount !== undefined) {
    try {
      nextAmount = formatScaledBigInt(
        parseDecimalToScaledBigInt(params.budgetAmount, AMOUNT_DECIMALS, {
          allowZero: false,
        }),
        AMOUNT_DECIMALS,
        AMOUNT_DECIMALS
      );
    } catch (err) {
      throw new CostControlError(
        400,
        err instanceof Error ? err.message : 'Invalid budgetAmount.'
      );
    }
  }

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(costBudgets)
      .set({
        name: params.name !== undefined ? params.name.trim() : existing.name,
        budgetAmount: nextAmount,
        warningThresholdPct: nextWarning,
        criticalThresholdPct: nextCritical,
        enabled: params.enabled !== undefined ? params.enabled : existing.enabled,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(costBudgets.id, params.budgetId),
          eq(costBudgets.tenantId, params.tenantId)
        )
      )
      .returning();

    await tx.insert(activityLogs).values({
      tenantId: params.tenantId,
      actorUid: params.actorUid,
      actorLabel: params.actorLabel,
      module: 'costs',
      action: 'cost.budget_updated',
      entityType: 'cost_budget',
      entityId: String(row!.id),
      summary: `Updated cost budget "${row!.name}" (${row!.currency} ${nextAmount}, warn ${nextWarning}%, crit ${nextCritical}%).`,
      metadata: {
        budgetId: row!.id,
        budgetAmount: nextAmount,
        warningThresholdPct: nextWarning,
        criticalThresholdPct: nextCritical,
        enabled: row!.enabled,
      },
    });

    if (row!.enabled) {
      await evaluateAndPersistBudgetAlerts(
        tx,
        params.tenantId,
        getCurrentBillingPeriod(),
        row!.currency
      );
    }

    return row!;
  });

  return { budget: mapBudget(updated) };
}

export async function listCostAlerts(
  tenantId: number,
  statusFilter?: 'active' | 'resolved' | 'all'
): Promise<{ alerts: CostAlertItem[] }> {
  const [alertRows, budgetRows] = await Promise.all([
    db
      .select()
      .from(costAlerts)
      .where(
        statusFilter && statusFilter !== 'all'
          ? and(
              eq(costAlerts.tenantId, tenantId),
              eq(costAlerts.status, statusFilter)
            )
          : eq(costAlerts.tenantId, tenantId)
      )
      .orderBy(desc(costAlerts.triggeredAt)),
    db.select().from(costBudgets).where(eq(costBudgets.tenantId, tenantId)),
  ]);

  const budgetMap = new Map(budgetRows.map((b) => [b.id, mapBudget(b)]));

  return {
    alerts: alertRows.map((a) => {
      const budget = budgetMap.get(a.budgetId);
      return {
        id: a.id,
        tenantId: a.tenantId,
        budgetId: a.budgetId,
        budgetName: budget?.name || `Budget #${a.budgetId}`,
        scopeType: budget?.scopeType ?? 'tenant',
        scopeValue: budget?.scopeValue ?? null,
        billingPeriod: a.billingPeriod,
        alertLevel: a.alertLevel as CostAlertLevel,
        thresholdPct: a.thresholdPct,
        observedAmount: String(a.observedAmount),
        budgetAmount: String(a.budgetAmount),
        currency: a.currency,
        status: a.status as 'active' | 'resolved',
        triggeredAt: a.triggeredAt.toISOString(),
        resolvedAt: a.resolvedAt ? a.resolvedAt.toISOString() : null,
      };
    }),
  };
}

export async function resolveCostAlert(params: {
  tenantId: number;
  alertId: number;
  actorUid: string;
  actorLabel: string;
}): Promise<{ alert: CostAlertItem }> {
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(costAlerts)
      .set({
        status: 'resolved',
        resolvedAt: new Date(),
      })
      .where(
        and(
          eq(costAlerts.id, params.alertId),
          eq(costAlerts.tenantId, params.tenantId)
        )
      )
      .returning();

    if (!row) {
      throw new CostControlError(404, 'Cost alert not found.');
    }

    await tx.insert(activityLogs).values({
      tenantId: params.tenantId,
      actorUid: params.actorUid,
      actorLabel: params.actorLabel,
      module: 'costs',
      action: 'cost.alert_resolved',
      entityType: 'cost_alert',
      entityId: String(row.id),
      summary: `Resolved ${row.alertLevel} cost alert #${row.id} for period ${row.billingPeriod}.`,
      metadata: {
        budgetId: row.budgetId,
        billingPeriod: row.billingPeriod,
        alertLevel: row.alertLevel,
      },
    });

    return row;
  });

  const [budget] = await db
    .select()
    .from(costBudgets)
    .where(eq(costBudgets.id, updated.budgetId))
    .limit(1);

  return {
    alert: {
      id: updated.id,
      tenantId: updated.tenantId,
      budgetId: updated.budgetId,
      budgetName: budget?.name || `Budget #${updated.budgetId}`,
      scopeType: (budget?.scopeType as CostBudgetScopeType) ?? 'tenant',
      scopeValue: budget?.scopeValue ?? null,
      billingPeriod: updated.billingPeriod,
      alertLevel: updated.alertLevel as CostAlertLevel,
      thresholdPct: updated.thresholdPct,
      observedAmount: String(updated.observedAmount),
      budgetAmount: String(updated.budgetAmount),
      currency: updated.currency,
      status: updated.status as 'active' | 'resolved',
      triggeredAt: updated.triggeredAt.toISOString(),
      resolvedAt: updated.resolvedAt ? updated.resolvedAt.toISOString() : null,
    },
  };
}

export async function getUsageEstimates(params: {
  tenantId: number;
  billingPeriod?: string;
}): Promise<{ billingPeriod: string; estimates: CostUsageEstimateItem[] }> {
  const billingPeriod = params.billingPeriod
    ? normalizeBillingPeriod(params.billingPeriod)
    : getCurrentBillingPeriod();

  const [yearStr, monthStr] = billingPeriod.split('-');
  const startDate = new Date(
    Date.UTC(Number(yearStr), Number(monthStr) - 1, 1, 0, 0, 0)
  );
  const endDate = new Date(
    Date.UTC(Number(yearStr), Number(monthStr), 1, 0, 0, 0)
  );

  const [submissionsCount, executionsCount, webhookCount, activePricing] =
    await Promise.all([
      db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(formSubmissions)
        .where(
          and(
            eq(formSubmissions.tenantId, params.tenantId),
            gte(formSubmissions.createdAt, startDate),
            lte(formSubmissions.createdAt, endDate)
          )
        ),
      db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(automationExecutions)
        .where(
          and(
            eq(automationExecutions.tenantId, params.tenantId),
            gte(automationExecutions.createdAt, startDate),
            lte(automationExecutions.createdAt, endDate)
          )
        ),
      db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(providerWebhookLogs)
        .where(
          and(
            eq(providerWebhookLogs.tenantId, params.tenantId),
            gte(providerWebhookLogs.receivedAt, startDate),
            lte(providerWebhookLogs.receivedAt, endDate)
          )
        ),
      db
        .select()
        .from(providerPricingConfigs)
        .where(
          and(
            eq(providerPricingConfigs.tenantId, params.tenantId),
            eq(providerPricingConfigs.active, true)
          )
        )
        .orderBy(desc(providerPricingConfigs.effectiveDate)),
    ]);

  const findPricing = (providerId: string) =>
    activePricing.find((p) => p.providerId === providerId) ?? null;

  const usageSources = [
    {
      providerId: 'google_cloud_run',
      providerName: 'Google Cloud Run & Compute',
      appId: 'forms-studio',
      category: 'infrastructure' as CostCategory,
      serviceName: 'Workspace Intake & Execution Requests',
      usageSource: 'PostgreSQL form_submissions + automation_executions',
      count:
        Number(submissionsCount[0]?.count ?? 0) +
        Number(executionsCount[0]?.count ?? 0),
      defaultUnit: 'request',
    },
    {
      providerId: 'transactional_email_approved',
      providerName: 'Transactional Email Relay',
      appId: 'workflow-automation',
      category: 'messaging' as CostCategory,
      serviceName: 'Workflow & Intake Notification Events',
      usageSource: 'PostgreSQL automation_executions',
      count: Number(executionsCount[0]?.count ?? 0),
      defaultUnit: 'email',
    },
    {
      providerId: 'voice_telephony_approved',
      providerName: 'Voice & Telephony Provider',
      appId: 'integrations-console',
      category: 'telephony' as CostCategory,
      serviceName: 'Provider Webhook & Call Event Traffic',
      usageSource: 'PostgreSQL provider_webhook_logs',
      count: Number(webhookCount[0]?.count ?? 0),
      defaultUnit: 'call',
    },
  ];

  const estimates: CostUsageEstimateItem[] = usageSources.map((src) => {
    const pricing = findPricing(src.providerId);
    const qtyStr = `${src.count}.0000`;
    if (!pricing) {
      return {
        providerId: src.providerId,
        providerName: src.providerName,
        appId: src.appId,
        category: src.category,
        serviceName: src.serviceName,
        usageSource: src.usageSource,
        usageQuantity: String(src.count),
        unit: src.defaultUnit,
        unitPrice: null,
        currency: null,
        estimatedAmount: null,
        pricingStatus: 'missing_pricing',
        note: 'Pricing not configured for this provider. Configure a unit rate in Provider Pricing to compute an estimate.',
      };
    }

    const estimatedAmount = multiplyQuantityByUnitPrice(
      qtyStr,
      String(pricing.unitPrice)
    );

    return {
      providerId: src.providerId,
      providerName: src.providerName,
      appId: src.appId,
      category: src.category,
      serviceName: pricing.serviceName,
      usageSource: src.usageSource,
      usageQuantity: String(src.count),
      unit: pricing.unit,
      unitPrice: String(pricing.unitPrice),
      currency: pricing.currency,
      estimatedAmount,
      pricingStatus: 'configured',
      note: 'Estimated from real recorded workspace usage × configured unit price; excluded from verified actual spend.',
    };
  });

  return { billingPeriod, estimates };
}
