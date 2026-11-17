import type {
  CostBreakdownItem,
  CostBudgetEvaluationItem,
  CostBudgetItem,
  CostCategory,
  CostCurrencyTotals,
  CostRecordType,
  CostTrendPoint,
} from './types.ts';

export const AMOUNT_DECIMALS = 4;
export const AMOUNT_SCALE = 10_000n;
export const UNIT_PRICE_DECIMALS = 6;
export const UNIT_PRICE_SCALE = 1_000_000n;

export const COST_CATEGORIES: readonly { id: CostCategory; label: string }[] = [
  { id: 'infrastructure', label: 'Cloud Infrastructure & Hosting' },
  { id: 'ai_models', label: 'AI Model & Inference' },
  { id: 'telephony', label: 'Voice & Telephony' },
  { id: 'messaging', label: 'Messaging & Notifications' },
  { id: 'storage', label: 'Database & Object Storage' },
  { id: 'software_services', label: 'External Software & Services' },
  { id: 'other', label: 'Other Operational Costs' },
] as const;

export const VALID_COST_CATEGORIES = new Set<CostCategory>(
  COST_CATEGORIES.map((c) => c.id)
);

export const VALID_COST_RECORD_TYPES = new Set<CostRecordType>([
  'actual',
  'imported',
  'estimated',
]);

export const SUPPORTED_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD'] as const;

export interface CostCalculationRecordInput {
  id?: number;
  providerId: string;
  providerName: string;
  appId: string | null;
  category: CostCategory;
  recordType: CostRecordType;
  amount: string;
  currency: string;
  billingPeriod: string;
  recordedAt: string | Date;
}

export function normalizeCurrencyCode(raw: string): string {
  const code = String(raw || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new Error(`Invalid ISO-4217 currency code "${raw}". Expected a 3-letter uppercase code (e.g., INR, USD).`);
  }
  return code;
}

export function normalizeBillingPeriod(raw: string): string {
  const clean = String(raw || '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(clean)) {
    throw new Error(`Invalid billing period "${raw}". Expected YYYY-MM format.`);
  }
  return clean;
}

export function getCurrentBillingPeriod(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function parseDecimalToScaledBigInt(
  raw: string | number,
  decimals: number = AMOUNT_DECIMALS,
  options: { allowNegative?: boolean; allowZero?: boolean } = {}
): bigint {
  const str = typeof raw === 'number' ? raw.toString() : String(raw ?? '').trim();
  if (!str) {
    throw new Error('Decimal value is required.');
  }
  const cleaned = str.replace(/,/g, '');
  const match = cleaned.match(/^(-)?(\d+)(?:\.(\d+))?$/);
  if (!match) {
    throw new Error(`Invalid decimal numeric value "${raw}".`);
  }

  const isNegative = Boolean(match[1]);
  if (isNegative && !options.allowNegative) {
    throw new Error(`Negative value "${raw}" is not allowed.`);
  }

  const intPart = BigInt(match[2]!);
  const rawFrac = match[3] || '';
  const scale = 10n ** BigInt(decimals);

  // Truncate extra digits with half-up rounding if input exceeds target decimals
  let fracVal = 0n;
  if (rawFrac.length > 0) {
    const padded = rawFrac.slice(0, decimals).padEnd(decimals, '0');
    fracVal = BigInt(padded);
    if (rawFrac.length > decimals) {
      const nextDigit = Number(rawFrac[decimals]);
      if (nextDigit >= 5) {
        fracVal += 1n;
      }
    }
  }

  let scaled = intPart * scale + fracVal;
  if (isNegative) {
    scaled = -scaled;
  }

  if (!options.allowZero && scaled === 0n) {
    throw new Error('Amount must be greater than zero.');
  }

  return scaled;
}

export function formatScaledBigInt(
  scaled: bigint,
  decimals: number = AMOUNT_DECIMALS,
  displayDecimals: number = decimals
): string {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const scale = 10n ** BigInt(decimals);
  let normalized = abs;

  if (displayDecimals < decimals) {
    const divisor = 10n ** BigInt(decimals - displayDecimals);
    const remainder = abs % divisor;
    const quotient = abs / divisor;
    const rounded = remainder * 2n >= divisor ? quotient + 1n : quotient;
    const intPart = rounded / 10n ** BigInt(displayDecimals);
    const fracPart = rounded % 10n ** BigInt(displayDecimals);
    const body = `${intPart.toString()}.${fracPart.toString().padStart(displayDecimals, '0')}`;
    return negative && rounded > 0n ? `-${body}` : body;
  }

  const intPart = normalized / scale;
  const fracPart = normalized % scale;
  const body = `${intPart.toString()}.${fracPart.toString().padStart(decimals, '0')}`;
  return negative && abs > 0n ? `-${body}` : body;
}

export function formatCurrencyAmount(
  amount: string | bigint,
  currency: string,
  displayDecimals: number = 2
): string {
  const scaled =
    typeof amount === 'bigint'
      ? amount
      : parseDecimalToScaledBigInt(amount, AMOUNT_DECIMALS, {
          allowNegative: true,
          allowZero: true,
        });
  const formatted = formatScaledBigInt(scaled, AMOUNT_DECIMALS, displayDecimals);
  const [intStr, fracStr] = formatted.split('.');
  const isNeg = intStr!.startsWith('-');
  const absInt = isNeg ? intStr!.slice(1) : intStr!;
  const groupedInt = absInt.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const prefix = currency === 'INR' ? '₹' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : `${currency} `;
  return `${isNeg ? '-' : ''}${prefix}${groupedInt}.${fracStr ?? '00'}`;
}

export function multiplyQuantityByUnitPrice(
  usageQuantity: string,
  unitPrice: string
): string {
  const qtyScaled = parseDecimalToScaledBigInt(usageQuantity, AMOUNT_DECIMALS, {
    allowZero: true,
  });
  const priceScaled = parseDecimalToScaledBigInt(
    unitPrice,
    UNIT_PRICE_DECIMALS,
    { allowZero: true }
  );

  // qty (10^4) * price (10^6) = 10^10; divide by 10^6 (half-up) -> 10^4 scale
  const product = qtyScaled * priceScaled;
  const quotient = product / UNIT_PRICE_SCALE;
  const remainder = product % UNIT_PRICE_SCALE;
  const rounded = remainder * 2n >= UNIT_PRICE_SCALE ? quotient + 1n : quotient;
  return formatScaledBigInt(rounded, AMOUNT_DECIMALS, AMOUNT_DECIMALS);
}

export function calculatePercentScaled(
  numeratorScaled: bigint,
  denominatorScaled: bigint
): number {
  if (denominatorScaled <= 0n || numeratorScaled <= 0n) {
    return 0;
  }
  // Compute percentage with 2 decimal precision: (num * 10_000) / den -> divide by 100
  const basisPoints = (numeratorScaled * 10_000n) / denominatorScaled;
  return Number(basisPoints) / 100;
}

export function getCostCategoryLabel(category: string): string {
  return (
    COST_CATEGORIES.find((c) => c.id === category)?.label ?? category
  );
}

export function aggregateCurrencyTotals(
  records: readonly CostCalculationRecordInput[],
  billingPeriod: string,
  referenceDate: Date = new Date()
): {
  currencyTotals: CostCurrencyTotals[];
  availableCurrencies: string[];
  hasMixedCurrencies: boolean;
} {
  const map = new Map<
    string,
    {
      actual: bigint;
      imported: bigint;
      estimated: bigint;
      count: number;
      dates: Set<string>;
    }
  >();

  for (const r of records) {
    const currency = normalizeCurrencyCode(r.currency);
    let bucket = map.get(currency);
    if (!bucket) {
      bucket = {
        actual: 0n,
        imported: 0n,
        estimated: 0n,
        count: 0,
        dates: new Set<string>(),
      };
      map.set(currency, bucket);
    }
    const amt = parseDecimalToScaledBigInt(r.amount, AMOUNT_DECIMALS, {
      allowZero: true,
    });
    if (r.recordType === 'actual') {
      bucket.actual += amt;
    } else if (r.recordType === 'imported') {
      bucket.imported += amt;
    } else {
      bucket.estimated += amt;
    }
    bucket.count += 1;
    const d = r.recordedAt instanceof Date ? r.recordedAt : new Date(r.recordedAt);
    if (!Number.isNaN(d.getTime())) {
      bucket.dates.add(d.toISOString().slice(0, 10));
    }
  }

  const availableCurrencies = Array.from(map.keys()).sort();
  const currencyTotals: CostCurrencyTotals[] = availableCurrencies.map(
    (currency) => {
      const b = map.get(currency)!;
      const verified = b.actual + b.imported;
      const projected = projectMonthlySpend({
        verifiedScaled: verified,
        billingPeriod,
        referenceDate,
      });
      return {
        currency,
        actualTotal: formatScaledBigInt(b.actual, AMOUNT_DECIMALS, 2),
        importedTotal: formatScaledBigInt(b.imported, AMOUNT_DECIMALS, 2),
        verifiedTotal: formatScaledBigInt(verified, AMOUNT_DECIMALS, 2),
        estimatedTotal: formatScaledBigInt(b.estimated, AMOUNT_DECIMALS, 2),
        projectedMonthlySpend:
          projected !== null
            ? formatScaledBigInt(projected, AMOUNT_DECIMALS, 2)
            : null,
        recordCount: b.count,
      };
    }
  );

  return {
    currencyTotals,
    availableCurrencies,
    hasMixedCurrencies: availableCurrencies.length > 1,
  };
}

export function projectMonthlySpend(params: {
  verifiedScaled: bigint;
  billingPeriod: string;
  referenceDate?: Date;
}): bigint | null {
  const { verifiedScaled, billingPeriod } = params;
  if (verifiedScaled <= 0n) return null;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(billingPeriod)) return null;

  const [yearStr, monthStr] = billingPeriod.split('-');
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const ref = params.referenceDate ?? new Date();
  const currentPeriod = getCurrentBillingPeriod(ref);

  if (billingPeriod > currentPeriod) {
    return null;
  }
  if (billingPeriod < currentPeriod) {
    // Completed billing month: verified spend IS the completed period spend (no speculative projection needed)
    return verifiedScaled;
  }

  const elapsedDays = Math.max(1, Math.min(daysInMonth, ref.getUTCDate()));
  return (verifiedScaled * BigInt(daysInMonth)) / BigInt(elapsedDays);
}

export function buildDailyCostTrend(
  records: readonly CostCalculationRecordInput[],
  currency: string,
  billingPeriod: string
): CostTrendPoint[] {
  const targetCurrency = normalizeCurrencyCode(currency);
  const dayMap = new Map<
    string,
    { actual: bigint; imported: bigint; estimated: bigint }
  >();

  for (const rec of records) {
    if (normalizeCurrencyCode(rec.currency) !== targetCurrency) continue;
    const d =
      rec.recordedAt instanceof Date ? rec.recordedAt : new Date(rec.recordedAt);
    if (Number.isNaN(d.getTime())) continue;
    const dateKey = d.toISOString().slice(0, 10);
    let slot = dayMap.get(dateKey);
    if (!slot) {
      slot = { actual: 0n, imported: 0n, estimated: 0n };
      dayMap.set(dateKey, slot);
    }
    const amt = parseDecimalToScaledBigInt(rec.amount, AMOUNT_DECIMALS, {
      allowZero: true,
    });
    if (rec.recordType === 'actual') slot.actual += amt;
    else if (rec.recordType === 'imported') slot.imported += amt;
    else slot.estimated += amt;
  }

  // Ensure ordered day keys inside billingPeriod if non-empty
  const keys = Array.from(dayMap.keys())
    .filter((k) => !billingPeriod || k.startsWith(billingPeriod))
    .sort();

  const sourceKeys = keys.length > 0 ? keys : Array.from(dayMap.keys()).sort();

  return sourceKeys.map((dateKey) => {
    const slot = dayMap.get(dateKey)!;
    const verified = slot.actual + slot.imported;
    return {
      key: dateKey,
      label: dateKey.slice(5),
      actualAmount: formatScaledBigInt(slot.actual, AMOUNT_DECIMALS, 2),
      importedAmount: formatScaledBigInt(slot.imported, AMOUNT_DECIMALS, 2),
      verifiedTotalAmount: formatScaledBigInt(verified, AMOUNT_DECIMALS, 2),
      estimatedAmount: formatScaledBigInt(slot.estimated, AMOUNT_DECIMALS, 2),
    };
  });
}

export function buildMonthlyCostTrend(
  records: readonly CostCalculationRecordInput[],
  currency: string
): CostTrendPoint[] {
  const targetCurrency = normalizeCurrencyCode(currency);
  const monthMap = new Map<
    string,
    { actual: bigint; imported: bigint; estimated: bigint }
  >();

  for (const rec of records) {
    if (normalizeCurrencyCode(rec.currency) !== targetCurrency) continue;
    const monthKey = rec.billingPeriod;
    let slot = monthMap.get(monthKey);
    if (!slot) {
      slot = { actual: 0n, imported: 0n, estimated: 0n };
      monthMap.set(monthKey, slot);
    }
    const amt = parseDecimalToScaledBigInt(rec.amount, AMOUNT_DECIMALS, {
      allowZero: true,
    });
    if (rec.recordType === 'actual') slot.actual += amt;
    else if (rec.recordType === 'imported') slot.imported += amt;
    else slot.estimated += amt;
  }

  return Array.from(monthMap.keys())
    .sort()
    .map((monthKey) => {
      const slot = monthMap.get(monthKey)!;
      const verified = slot.actual + slot.imported;
      return {
        key: monthKey,
        label: monthKey,
        actualAmount: formatScaledBigInt(slot.actual, AMOUNT_DECIMALS, 2),
        importedAmount: formatScaledBigInt(slot.imported, AMOUNT_DECIMALS, 2),
        verifiedTotalAmount: formatScaledBigInt(verified, AMOUNT_DECIMALS, 2),
        estimatedAmount: formatScaledBigInt(slot.estimated, AMOUNT_DECIMALS, 2),
      };
    });
}

export function buildCostBreakdown(
  records: readonly CostCalculationRecordInput[],
  currency: string,
  groupBy: 'provider' | 'category' | 'app'
): CostBreakdownItem[] {
  const targetCurrency = normalizeCurrencyCode(currency);
  const groups = new Map<
    string,
    {
      label: string;
      actual: bigint;
      imported: bigint;
      estimated: bigint;
      count: number;
    }
  >();

  let grandVerifiedTotal = 0n;

  for (const rec of records) {
    if (normalizeCurrencyCode(rec.currency) !== targetCurrency) continue;

    let key: string;
    let label: string;
    if (groupBy === 'provider') {
      key = rec.providerId;
      label = rec.providerName;
    } else if (groupBy === 'category') {
      key = rec.category;
      label = getCostCategoryLabel(rec.category);
    } else {
      key = rec.appId || 'shared_platform';
      label = rec.appId || 'Shared Platform / Infrastructure';
    }

    let bucket = groups.get(key);
    if (!bucket) {
      bucket = {
        label,
        actual: 0n,
        imported: 0n,
        estimated: 0n,
        count: 0,
      };
      groups.set(key, bucket);
    }

    const amt = parseDecimalToScaledBigInt(rec.amount, AMOUNT_DECIMALS, {
      allowZero: true,
    });
    if (rec.recordType === 'actual') {
      bucket.actual += amt;
      grandVerifiedTotal += amt;
    } else if (rec.recordType === 'imported') {
      bucket.imported += amt;
      grandVerifiedTotal += amt;
    } else {
      bucket.estimated += amt;
    }
    bucket.count += 1;
  }

  return Array.from(groups.entries())
    .map(([key, b]) => {
      const verified = b.actual + b.imported;
      return {
        key,
        label: b.label,
        actualAmount: formatScaledBigInt(b.actual, AMOUNT_DECIMALS, 2),
        importedAmount: formatScaledBigInt(b.imported, AMOUNT_DECIMALS, 2),
        verifiedTotalAmount: formatScaledBigInt(verified, AMOUNT_DECIMALS, 2),
        estimatedAmount: formatScaledBigInt(b.estimated, AMOUNT_DECIMALS, 2),
        recordCount: b.count,
        sharePct: calculatePercentScaled(verified, grandVerifiedTotal),
        _sortVal: verified + b.estimated,
      };
    })
    .sort((a, b) => (b._sortVal > a._sortVal ? 1 : b._sortVal < a._sortVal ? -1 : 0))
    .map(({ _sortVal: _ignored, ...rest }) => rest);
}

export function evaluateBudgetStatus(params: {
  budget: CostBudgetItem;
  records: readonly CostCalculationRecordInput[];
  targetBillingPeriod: string;
  activeAlertCount?: number;
  referenceDate?: Date;
}): CostBudgetEvaluationItem {
  const { budget, records, targetBillingPeriod } = params;
  const budgetCurrency = normalizeCurrencyCode(budget.currency);
  const budgetScaled = parseDecimalToScaledBigInt(
    budget.budgetAmount,
    AMOUNT_DECIMALS,
    { allowZero: false }
  );

  const yearPrefix = targetBillingPeriod.slice(0, 4);
  let verifiedScaled = 0n;
  let estimatedScaled = 0n;

  for (const rec of records) {
    if (normalizeCurrencyCode(rec.currency) !== budgetCurrency) continue;

    const periodMatches =
      budget.period === 'yearly'
        ? rec.billingPeriod.startsWith(`${yearPrefix}-`)
        : rec.billingPeriod === targetBillingPeriod;
    if (!periodMatches) continue;

    if (budget.scopeType === 'category' && rec.category !== budget.scopeValue) {
      continue;
    }
    if (
      budget.scopeType === 'app' &&
      (rec.appId || 'shared_platform') !== budget.scopeValue
    ) {
      continue;
    }

    const amt = parseDecimalToScaledBigInt(rec.amount, AMOUNT_DECIMALS, {
      allowZero: true,
    });
    if (rec.recordType === 'estimated') {
      estimatedScaled += amt;
    } else {
      verifiedScaled += amt;
    }
  }

  const utilizationPct = calculatePercentScaled(verifiedScaled, budgetScaled);
  const projectedScaled =
    budget.period === 'monthly'
      ? projectMonthlySpend({
          verifiedScaled,
          billingPeriod: targetBillingPeriod,
          referenceDate: params.referenceDate,
        })
      : null;

  let alertState: 'nominal' | 'warning' | 'critical' = 'nominal';
  if (utilizationPct >= budget.criticalThresholdPct) {
    alertState = 'critical';
  } else if (utilizationPct >= budget.warningThresholdPct) {
    alertState = 'warning';
  }

  return {
    ...budget,
    observedVerifiedSpend: formatScaledBigInt(verifiedScaled, AMOUNT_DECIMALS, 2),
    estimatedSpend: formatScaledBigInt(estimatedScaled, AMOUNT_DECIMALS, 2),
    utilizationPct,
    projectedSpend:
      projectedScaled !== null
        ? formatScaledBigInt(projectedScaled, AMOUNT_DECIMALS, 2)
        : null,
    projectedUtilizationPct:
      projectedScaled !== null
        ? calculatePercentScaled(projectedScaled, budgetScaled)
        : null,
    alertState,
    activeAlertCount: params.activeAlertCount ?? 0,
  };
}

export interface ParsedCsvCostRow {
  rowNumber: number;
  providerId: string;
  providerName: string;
  appId: string | null;
  category: CostCategory;
  amount: string;
  currency: string;
  billingPeriod: string;
  recordedAt: string;
  reference: string | null;
  usageQuantity: string | null;
  unit: string | null;
  unitPrice: string | null;
  notes: string;
  idempotencyKey: string;
}

function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

export function buildImportRowFingerprint(input: {
  providerId: string;
  category: string;
  amount: string;
  currency: string;
  billingPeriod: string;
  recordedAt: string;
  reference?: string | null;
}): string {
  const canonical = [
    input.providerId.trim().toLowerCase(),
    input.category.trim().toLowerCase(),
    input.amount.trim(),
    input.currency.trim().toUpperCase(),
    input.billingPeriod.trim(),
    input.recordedAt.trim().slice(0, 10),
    (input.reference || '').trim(),
  ].join('|');

  // Deterministic 64-bit FNV-1a double hash (browser + Node compatible)
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < canonical.length; i += 1) {
    const code = canonical.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= code + i;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `csv-${input.billingPeriod}-${hex1}${hex2}`;
}

export function parseCsvCostImport(
  csvText: string,
  defaults: { defaultCurrency?: string; defaultBillingPeriod?: string } = {}
): { rows: ParsedCsvCostRow[]; errors: string[] } {
  const lines = String(csvText || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    return {
      rows: [],
      errors: [
        'CSV must contain a header row and at least one billing record row.',
      ],
    };
  }

  const headers = splitCsvLine(lines[0]!).map((h) =>
    h.toLowerCase().replace(/[^a-z0-9]/g, '')
  );

  const findCol = (...aliases: string[]): number =>
    headers.findIndex((h) => aliases.includes(h));

  const idxProviderId = findCol('providerid', 'provider');
  const idxProviderName = findCol('providername', 'vendor', 'service');
  const idxAppId = findCol('appid', 'app', 'module');
  const idxCategory = findCol('category', 'costcategory');
  const idxAmount = findCol('amount', 'cost', 'total');
  const idxCurrency = findCol('currency', 'curr');
  const idxPeriod = findCol('billingperiod', 'period', 'month');
  const idxDate = findCol('recordedat', 'date', 'usageDate'.toLowerCase());
  const idxReference = findCol('reference', 'invoiceid', 'externalid', 'id');
  const idxQty = findCol('usagequantity', 'quantity', 'usage');
  const idxUnit = findCol('unit');
  const idxUnitPrice = findCol('unitprice', 'rate');
  const idxNotes = findCol('notes', 'description', 'memo');

  if (idxAmount === -1 || (idxProviderId === -1 && idxProviderName === -1)) {
    return {
      rows: [],
      errors: [
        'CSV header must include at least "providerId" (or "provider") and "amount" columns.',
      ],
    };
  }

  const rows: ParsedCsvCostRow[] = [];
  const errors: string[] = [];

  for (let r = 1; r < lines.length; r += 1) {
    const cols = splitCsvLine(lines[r]!);
    const rowNumber = r + 1;
    try {
      const rawProvider =
        (idxProviderId >= 0 ? cols[idxProviderId] : '') ||
        (idxProviderName >= 0 ? cols[idxProviderName] : '') ||
        '';
      const providerId = rawProvider
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_');
      if (!providerId) {
        throw new Error('Missing provider identifier.');
      }

      const providerName =
        (idxProviderName >= 0 ? cols[idxProviderName] : '')?.trim() ||
        rawProvider.trim();

      const rawCategory = (
        (idxCategory >= 0 ? cols[idxCategory] : '') || 'other'
      )
        .trim()
        .toLowerCase() as CostCategory;
      const category = VALID_COST_CATEGORIES.has(rawCategory)
        ? rawCategory
        : 'other';

      const amountScaled = parseDecimalToScaledBigInt(
        cols[idxAmount] || '',
        AMOUNT_DECIMALS,
        { allowZero: false }
      );
      const amount = formatScaledBigInt(
        amountScaled,
        AMOUNT_DECIMALS,
        AMOUNT_DECIMALS
      );

      const currency = normalizeCurrencyCode(
        (idxCurrency >= 0 ? cols[idxCurrency] : '') ||
          defaults.defaultCurrency ||
          'INR'
      );

      const rawDate = idxDate >= 0 ? cols[idxDate] : '';
      let recordedIso = new Date().toISOString();
      if (rawDate) {
        const parsedDate = new Date(rawDate);
        if (Number.isNaN(parsedDate.getTime())) {
          throw new Error(`Invalid recordedAt date "${rawDate}".`);
        }
        recordedIso = parsedDate.toISOString();
      }

      const derivedPeriod = recordedIso.slice(0, 7);
      const billingPeriod = normalizeBillingPeriod(
        (idxPeriod >= 0 ? cols[idxPeriod] : '') ||
          defaults.defaultBillingPeriod ||
          derivedPeriod
      );

      const reference =
        idxReference >= 0 && cols[idxReference] ? cols[idxReference]! : null;
      const appId =
        idxAppId >= 0 && cols[idxAppId] ? cols[idxAppId]!.trim() : null;

      const rawQty = idxQty >= 0 ? cols[idxQty] : '';
      const rawUnitPrice = idxUnitPrice >= 0 ? cols[idxUnitPrice] : '';
      const usageQuantity = rawQty
        ? formatScaledBigInt(
            parseDecimalToScaledBigInt(rawQty, AMOUNT_DECIMALS, {
              allowZero: true,
            }),
            AMOUNT_DECIMALS,
            AMOUNT_DECIMALS
          )
        : null;
      const unitPrice = rawUnitPrice
        ? formatScaledBigInt(
            parseDecimalToScaledBigInt(rawUnitPrice, UNIT_PRICE_DECIMALS, {
              allowZero: true,
            }),
            UNIT_PRICE_DECIMALS,
            UNIT_PRICE_DECIMALS
          )
        : null;
      const unit = idxUnit >= 0 && cols[idxUnit] ? cols[idxUnit]!.trim() : null;
      const notes =
        idxNotes >= 0 && cols[idxNotes] ? cols[idxNotes]!.trim() : '';

      const idempotencyKey = reference
        ? `csv-ref:${providerId}:${reference.toLowerCase()}`
        : buildImportRowFingerprint({
            providerId,
            category,
            amount,
            currency,
            billingPeriod,
            recordedAt: recordedIso,
            reference: `${notes}:${rowNumber}`,
          });

      rows.push({
        rowNumber,
        providerId,
        providerName,
        appId,
        category,
        amount,
        currency,
        billingPeriod,
        recordedAt: recordedIso,
        reference,
        usageQuantity,
        unit,
        unitPrice,
        notes,
        idempotencyKey,
      });
    } catch (err) {
      errors.push(
        `Row ${rowNumber}: ${err instanceof Error ? err.message : 'Invalid row format.'}`
      );
    }
  }

  return { rows, errors };
}
