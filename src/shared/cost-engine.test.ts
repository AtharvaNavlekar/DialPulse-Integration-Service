import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateCurrencyTotals,
  buildCostBreakdown,
  buildDailyCostTrend,
  buildMonthlyCostTrend,
  evaluateBudgetStatus,
  formatCurrencyAmount,
  multiplyQuantityByUnitPrice,
  normalizeBillingPeriod,
  normalizeCurrencyCode,
  parseCsvCostImport,
  parseDecimalToScaledBigInt,
  projectMonthlySpend,
} from './cost-engine.ts';
import type { CostBudgetItem } from './types.ts';

test('BigInt decimal engine prevents floating-point drift and multiplies unit prices cleanly', () => {
  // 0.1 + 0.2 in JS float is 0.30000000000000004; BigInt engine must be exact
  const a = parseDecimalToScaledBigInt('0.10');
  const b = parseDecimalToScaledBigInt('0.20');
  assert.equal(a + b, 3000n);

  const computed = multiplyQuantityByUnitPrice('1250.5000', '0.004500');
  assert.equal(computed, '5.6273'); // 1250.5 * 0.0045 = 5.62725 -> half-up 5.6273

  assert.equal(formatCurrencyAmount('12345.67', 'INR'), '₹12,345.67');
  assert.equal(formatCurrencyAmount('99.50', 'USD'), '$99.50');

  assert.throws(() => parseDecimalToScaledBigInt('-10.00'));
  assert.throws(() => parseDecimalToScaledBigInt('0.00'));
  assert.throws(() => normalizeCurrencyCode('INVALID'));
  assert.throws(() => normalizeBillingPeriod('2026-13'));
});

test('aggregateCurrencyTotals isolates currencies and separates actual, imported, and estimated spend', () => {
  const records = [
    {
      providerId: 'google_cloud_run',
      providerName: 'Google Cloud Run',
      appId: 'forms-studio',
      category: 'infrastructure' as const,
      recordType: 'actual' as const,
      amount: '1000.2500',
      currency: 'INR',
      billingPeriod: '2026-11',
      recordedAt: '2026-11-05T10:00:00.000Z',
    },
    {
      providerId: 'voice_telephony_approved',
      providerName: 'Voice Telephony',
      appId: 'call-operations',
      category: 'telephony' as const,
      recordType: 'imported' as const,
      amount: '500.7500',
      currency: 'INR',
      billingPeriod: '2026-11',
      recordedAt: '2026-11-06T10:00:00.000Z',
    },
    {
      providerId: 'gemini_ai',
      providerName: 'Gemini AI',
      appId: 'workflow-automation',
      category: 'ai_models' as const,
      recordType: 'estimated' as const,
      amount: '250.0000',
      currency: 'INR',
      billingPeriod: '2026-11',
      recordedAt: '2026-11-06T12:00:00.000Z',
    },
    {
      providerId: 'external_saas_tools',
      providerName: 'External SaaS',
      appId: null,
      category: 'software_services' as const,
      recordType: 'actual' as const,
      amount: '49.9900',
      currency: 'USD',
      billingPeriod: '2026-11',
      recordedAt: '2026-11-07T09:00:00.000Z',
    },
  ];

  const refDate = new Date('2026-11-15T12:00:00.000Z');
  const agg = aggregateCurrencyTotals(records, '2026-11', refDate);

  assert.equal(agg.hasMixedCurrencies, true);
  assert.deepEqual(agg.availableCurrencies, ['INR', 'USD']);

  const inr = agg.currencyTotals.find((c) => c.currency === 'INR')!;
  const usd = agg.currencyTotals.find((c) => c.currency === 'USD')!;

  assert.equal(inr.actualTotal, '1000.25');
  assert.equal(inr.importedTotal, '500.75');
  assert.equal(inr.verifiedTotal, '1501.00'); // actual + imported ONLY
  assert.equal(inr.estimatedTotal, '250.00'); // kept strictly separate
  assert.equal(inr.projectedMonthlySpend, '3002.00'); // 1501 * 30 / 15
  assert.equal(inr.recordCount, 3);

  assert.equal(usd.actualTotal, '49.99');
  assert.equal(usd.verifiedTotal, '49.99');
  assert.equal(usd.recordCount, 1);

  const daily = buildDailyCostTrend(records, 'INR', '2026-11');
  assert.equal(daily.length, 2);
  assert.equal(daily[1]!.verifiedTotalAmount, '500.75');
  assert.equal(daily[1]!.estimatedAmount, '250.00');

  const monthly = buildMonthlyCostTrend(records, 'INR');
  assert.equal(monthly.length, 1);
  assert.equal(monthly[0]!.verifiedTotalAmount, '1501.00');

  const byCat = buildCostBreakdown(records, 'INR', 'category');
  assert.equal(byCat.length, 3);
  const aiCat = byCat.find((c) => c.key === 'ai_models')!;
  assert.equal(aiCat.verifiedTotalAmount, '0.00');
  assert.equal(aiCat.estimatedAmount, '250.00');
  assert.equal(aiCat.sharePct, 0);
});

test('evaluateBudgetStatus checks verified spend only and handles completed/future monthly projections', () => {
  const budget: CostBudgetItem = {
    id: 10,
    tenantId: 1,
    name: 'Telephony Monthly Cap',
    scopeType: 'category',
    scopeValue: 'telephony',
    period: 'monthly',
    budgetAmount: '1000.0000',
    currency: 'INR',
    warningThresholdPct: 80,
    criticalThresholdPct: 100,
    enabled: true,
    createdByUid: 'admin-1',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  };

  const records = [
    {
      providerId: 'voice_telephony_approved',
      providerName: 'Voice Telephony',
      appId: null,
      category: 'telephony' as const,
      recordType: 'actual' as const,
      amount: '850.0000',
      currency: 'INR',
      billingPeriod: '2026-11',
      recordedAt: '2026-11-10T00:00:00.000Z',
    },
    // Estimated spend must not trigger false critical breach
    {
      providerId: 'voice_telephony_approved',
      providerName: 'Voice Telephony',
      appId: null,
      category: 'telephony' as const,
      recordType: 'estimated' as const,
      amount: '500.0000',
      currency: 'INR',
      billingPeriod: '2026-11',
      recordedAt: '2026-11-10T00:00:00.000Z',
    },
  ];

  const evalResult = evaluateBudgetStatus({
    budget,
    records,
    targetBillingPeriod: '2026-11',
    referenceDate: new Date('2026-11-15T00:00:00.000Z'),
  });

  assert.equal(evalResult.observedVerifiedSpend, '850.00');
  assert.equal(evalResult.estimatedSpend, '500.00');
  assert.equal(evalResult.utilizationPct, 85);
  assert.equal(evalResult.alertState, 'warning');

  assert.equal(
    projectMonthlySpend({
      verifiedScaled: 0n,
      billingPeriod: '2026-11',
      referenceDate: new Date('2026-11-15T00:00:00.000Z'),
    }),
    null
  );
  assert.equal(
    projectMonthlySpend({
      verifiedScaled: 100_0000n,
      billingPeriod: '2026-12',
      referenceDate: new Date('2026-11-15T00:00:00.000Z'),
    }),
    null
  );
  assert.equal(
    projectMonthlySpend({
      verifiedScaled: 100_0000n,
      billingPeriod: '2026-10',
      referenceDate: new Date('2026-11-15T00:00:00.000Z'),
    }),
    100_0000n
  );
});

test('parseCsvCostImport parses billing statements and builds deterministic dedup keys', () => {
  const csv = [
    'providerId,providerName,category,amount,currency,billingPeriod,recordedAt,reference,appId,notes',
    'google_cloud_run,Google Cloud Run,infrastructure,1425.50,INR,2026-11,2026-11-12,GCP-INV-01,forms-studio,Compute',
    'gemini_ai,Gemini AI,ai_models,12.3456,USD,2026-11,2026-11-13,,workflow-automation,Inference batch',
    'bad_provider,Bad Provider,infrastructure,-5,INR,2026-11,2026-11-14,ERR-1,,Negative rejected',
  ].join('\n');

  const parsed1 = parseCsvCostImport(csv);
  const parsed2 = parseCsvCostImport(csv);

  assert.equal(parsed1.rows.length, 2);
  assert.equal(parsed1.errors.length, 1);
  assert.equal(parsed1.rows[0]!.amount, '1425.5000');
  assert.equal(parsed1.rows[0]!.idempotencyKey, 'csv-ref:google_cloud_run:gcp-inv-01');
  assert.equal(parsed1.rows[1]!.idempotencyKey, parsed2.rows[1]!.idempotencyKey);
});
