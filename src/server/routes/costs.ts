import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { hasEffectivePermission } from '../../shared/rbac.ts';
import {
  COST_CATEGORIES,
  normalizeBillingPeriod,
  normalizeCurrencyCode,
} from '../../shared/cost-engine.ts';
import type { CostCategory, CostRecordType } from '../../shared/types.ts';
import { requireAuth, requirePermission, type AuthRequest } from '../middleware/auth.ts';
import { requireAppEnabled } from '../services/app-management-service.ts';
import {
  CostControlError,
  createCostBudget,
  createCostRecord,
  getCostSummary,
  getUsageEstimates,
  importCostRecordsBatch,
  listCostAlerts,
  listCostBudgets,
  listCostProvidersWithPricing,
  listCostRecords,
  resolveCostAlert,
  updateCostBudget,
  upsertProviderPricing,
} from '../services/cost-control-service.ts';

const COST_CATEGORY_VALUES = COST_CATEGORIES.map((c) => c.id) as [
  CostCategory,
  ...CostCategory[],
];

const CreateManualCostSchema = z
  .object({
    mode: z.literal('manual').optional(),
    providerId: z.string().trim().min(1).max(80),
    providerName: z.string().trim().min(1).max(120).optional(),
    appId: z.string().trim().max(80).nullable().optional(),
    category: z.enum(COST_CATEGORY_VALUES),
    recordType: z.enum(['actual', 'estimated']).default('actual'),
    amount: z.union([z.string().trim().min(1), z.number().positive()]).optional(),
    currency: z.string().trim().length(3).default('INR'),
    usageQuantity: z
      .union([z.string().trim().min(1), z.number().positive()])
      .nullable()
      .optional(),
    unit: z.string().trim().max(40).nullable().optional(),
    unitPrice: z
      .union([z.string().trim().min(1), z.number().positive()])
      .nullable()
      .optional(),
    billingPeriod: z.string().trim().optional(),
    reference: z.string().trim().max(120).nullable().optional(),
    idempotencyKey: z.string().trim().max(160).nullable().optional(),
    notes: z.string().trim().max(500).optional(),
    recordedAt: z.string().trim().optional(),
  })
  .strict();

const ImportCostRowSchema = z
  .object({
    providerId: z.string().trim().min(1).max(80),
    providerName: z.string().trim().min(1).max(120).optional(),
    appId: z.string().trim().max(80).nullable().optional(),
    category: z.enum(COST_CATEGORY_VALUES),
    amount: z.union([z.string().trim().min(1), z.number().positive()]),
    currency: z.string().trim().length(3).optional(),
    billingPeriod: z.string().trim().optional(),
    recordedAt: z.string().trim().optional(),
    reference: z.string().trim().max(120).nullable().optional(),
    usageQuantity: z
      .union([z.string().trim().min(1), z.number().nonnegative()])
      .nullable()
      .optional(),
    unit: z.string().trim().max(40).nullable().optional(),
    unitPrice: z
      .union([z.string().trim().min(1), z.number().nonnegative()])
      .nullable()
      .optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .strict();

const ImportCostBatchSchema = z
  .object({
    mode: z.literal('import').optional(),
    csvText: z.string().trim().min(1).max(200_000).optional(),
    defaultCurrency: z.string().trim().length(3).optional(),
    defaultBillingPeriod: z.string().trim().optional(),
    rows: z.array(ImportCostRowSchema).min(1).max(500).optional(),
  })
  .strict();

const UpsertPricingSchema = z
  .object({
    providerId: z.string().trim().min(1).max(80),
    serviceName: z.string().trim().min(1).max(120),
    category: z.enum(COST_CATEGORY_VALUES),
    unit: z.string().trim().min(1).max(40),
    unitPrice: z.union([z.string().trim().min(1), z.number().positive()]),
    currency: z.string().trim().length(3).default('INR'),
    effectiveDate: z.string().trim().optional(),
    active: z.boolean().optional(),
  })
  .strict();

const CreateBudgetSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    scopeType: z.enum(['tenant', 'category', 'app']).default('tenant'),
    scopeValue: z.string().trim().max(80).nullable().optional(),
    period: z.enum(['monthly', 'yearly']).default('monthly'),
    budgetAmount: z.union([z.string().trim().min(1), z.number().positive()]),
    currency: z.string().trim().length(3).default('INR'),
    warningThresholdPct: z.number().int().min(1).max(1000).default(80),
    criticalThresholdPct: z.number().int().min(1).max(1000).default(100),
    enabled: z.boolean().default(true),
  })
  .strict();

const UpdateBudgetSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    budgetAmount: z
      .union([z.string().trim().min(1), z.number().positive()])
      .optional(),
    warningThresholdPct: z.number().int().min(1).max(1000).optional(),
    criticalThresholdPct: z.number().int().min(1).max(1000).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

function handleCostError(res: Parameters<RequestHandler>[1], error: unknown) {
  if (error instanceof CostControlError) {
    res.status(error.statusCode).json({
      error: error.message,
      ...(error.details ? { details: error.details } : {}),
    });
    return;
  }
  if (error instanceof Error && /Invalid (ISO-4217|billing period|decimal|Negative|Amount)/i.test(error.message)) {
    res.status(400).json({ error: error.message });
    return;
  }
  console.error('Cost Control route error:', error);
  res.status(500).json({ error: 'Cost Control operation failed.' });
}

export function createCostsRouter(authMiddleware: RequestHandler = requireAuth) {
  const router = Router();
  router.use(authMiddleware);
  router.use(requireAppEnabled('cost-control-center'));

  router.get(
    '/summary',
    requirePermission('canViewCostCenter'),
    async (req: AuthRequest, res) => {
      try {
        const ctx = req.authContext!;
        const billingPeriod =
          typeof req.query.billingPeriod === 'string' && req.query.billingPeriod.trim()
            ? normalizeBillingPeriod(req.query.billingPeriod)
            : undefined;
        const currency =
          typeof req.query.currency === 'string' && req.query.currency.trim()
            ? normalizeCurrencyCode(req.query.currency)
            : undefined;
        const canManageCosts = hasEffectivePermission(
          ctx.permissions,
          'canManageCostCenter'
        );

        const summary = await getCostSummary({
          tenantId: ctx.activeMembership.tenantId,
          billingPeriod,
          currency,
          canManageCosts,
        });
        res.json(summary);
      } catch (error) {
        handleCostError(res, error);
      }
    }
  );

  router.get(
    '/records',
    requirePermission('canViewCostCenter'),
    async (req: AuthRequest, res) => {
      try {
        const ctx = req.authContext!;
        const q = req.query;
        const page = q.page ? Number(q.page) : 1;
        const pageSize = q.pageSize ? Number(q.pageSize) : 25;
        const result = await listCostRecords({
          tenantId: ctx.activeMembership.tenantId,
          search: typeof q.search === 'string' ? q.search : undefined,
          from: typeof q.from === 'string' ? q.from : undefined,
          to: typeof q.to === 'string' ? q.to : undefined,
          billingPeriod:
            typeof q.billingPeriod === 'string' && q.billingPeriod.trim()
              ? q.billingPeriod
              : undefined,
          providerId:
            typeof q.providerId === 'string' && q.providerId.trim()
              ? q.providerId
              : undefined,
          category:
            typeof q.category === 'string' && q.category.trim()
              ? q.category
              : undefined,
          recordType:
            typeof q.recordType === 'string' && q.recordType.trim()
              ? q.recordType
              : undefined,
          currency:
            typeof q.currency === 'string' && q.currency.trim()
              ? q.currency
              : undefined,
          page: Number.isFinite(page) ? page : 1,
          pageSize: Number.isFinite(pageSize) ? pageSize : 25,
        });
        res.json(result);
      } catch (error) {
        handleCostError(res, error);
      }
    }
  );

  router.post(
    '/records',
    requirePermission('canManageCostCenter'),
    async (req: AuthRequest, res) => {
      const ctx = req.authContext!;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const isImport =
        body.mode === 'import' ||
        typeof body.csvText === 'string' ||
        Array.isArray(body.rows);

      try {
        if (isImport) {
          const parsed = ImportCostBatchSchema.safeParse(body);
          if (!parsed.success) {
            res.status(400).json({
              error:
                parsed.error.issues[0]?.message ||
                'Invalid batch import payload.',
            });
            return;
          }
          const result = await importCostRecordsBatch({
            tenantId: ctx.activeMembership.tenantId,
            actorUid: ctx.user.uid,
            actorLabel: ctx.user.displayName,
            csvText: parsed.data.csvText,
            defaultCurrency: parsed.data.defaultCurrency,
            defaultBillingPeriod: parsed.data.defaultBillingPeriod,
            rows: parsed.data.rows,
          });
          res.status(201).json(result);
          return;
        }

        const parsed = CreateManualCostSchema.safeParse(body);
        if (!parsed.success) {
          res.status(400).json({
            error:
              parsed.error.issues[0]?.message ||
              'Invalid cost record payload.',
          });
          return;
        }

        const result = await createCostRecord({
          tenantId: ctx.activeMembership.tenantId,
          actorUid: ctx.user.uid,
          actorLabel: ctx.user.displayName,
          providerId: parsed.data.providerId,
          providerName: parsed.data.providerName,
          appId: parsed.data.appId ?? null,
          category: parsed.data.category,
          recordType: parsed.data.recordType as CostRecordType,
          amount: parsed.data.amount,
          currency: parsed.data.currency,
          usageQuantity: parsed.data.usageQuantity ?? null,
          unit: parsed.data.unit ?? null,
          unitPrice: parsed.data.unitPrice ?? null,
          billingPeriod: parsed.data.billingPeriod,
          reference: parsed.data.reference ?? null,
          idempotencyKey: parsed.data.idempotencyKey ?? null,
          notes: parsed.data.notes,
          recordedAt: parsed.data.recordedAt,
        });
        res.status(201).json(result);
      } catch (error) {
        handleCostError(res, error);
      }
    }
  );

  router.get(
    '/providers',
    requirePermission('canViewCostCenter'),
    async (req: AuthRequest, res) => {
      try {
        const result = await listCostProvidersWithPricing(
          req.authContext!.activeMembership.tenantId
        );
        res.json(result);
      } catch (error) {
        handleCostError(res, error);
      }
    }
  );

  const handleUpsertPricing: RequestHandler = async (req: AuthRequest, res) => {
    const parsed = UpsertPricingSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error:
          parsed.error.issues[0]?.message ||
          'Invalid provider pricing configuration payload.',
      });
      return;
    }

    try {
      const ctx = req.authContext!;
      const result = await upsertProviderPricing({
        tenantId: ctx.activeMembership.tenantId,
        actorUid: ctx.user.uid,
        actorLabel: ctx.user.displayName,
        providerId: parsed.data.providerId,
        serviceName: parsed.data.serviceName,
        category: parsed.data.category,
        unit: parsed.data.unit,
        unitPrice: parsed.data.unitPrice,
        currency: parsed.data.currency,
        effectiveDate: parsed.data.effectiveDate,
        active: parsed.data.active,
      });
      res.json(result);
    } catch (error) {
      handleCostError(res, error);
    }
  };

  router.put(
    '/providers/pricing',
    requirePermission('canManageCostCenter'),
    handleUpsertPricing
  );
  router.post(
    '/providers/pricing',
    requirePermission('canManageCostCenter'),
    handleUpsertPricing
  );

  router.get(
    '/usage-estimates',
    requirePermission('canViewCostCenter'),
    async (req: AuthRequest, res) => {
      try {
        const billingPeriod =
          typeof req.query.billingPeriod === 'string' && req.query.billingPeriod.trim()
            ? normalizeBillingPeriod(req.query.billingPeriod)
            : undefined;
        const result = await getUsageEstimates({
          tenantId: req.authContext!.activeMembership.tenantId,
          billingPeriod,
        });
        res.json(result);
      } catch (error) {
        handleCostError(res, error);
      }
    }
  );

  router.get(
    '/budgets',
    requirePermission('canViewCostCenter'),
    async (req: AuthRequest, res) => {
      try {
        const billingPeriod =
          typeof req.query.billingPeriod === 'string' && req.query.billingPeriod.trim()
            ? normalizeBillingPeriod(req.query.billingPeriod)
            : undefined;
        const result = await listCostBudgets(
          req.authContext!.activeMembership.tenantId,
          billingPeriod
        );
        res.json(result);
      } catch (error) {
        handleCostError(res, error);
      }
    }
  );

  router.post(
    '/budgets',
    requirePermission('canManageCostCenter'),
    async (req: AuthRequest, res) => {
      const parsed = CreateBudgetSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message || 'Invalid budget payload.',
        });
        return;
      }

      try {
        const ctx = req.authContext!;
        const result = await createCostBudget({
          tenantId: ctx.activeMembership.tenantId,
          actorUid: ctx.user.uid,
          actorLabel: ctx.user.displayName,
          name: parsed.data.name,
          scopeType: parsed.data.scopeType,
          scopeValue: parsed.data.scopeValue ?? null,
          period: parsed.data.period,
          budgetAmount: parsed.data.budgetAmount,
          currency: parsed.data.currency,
          warningThresholdPct: parsed.data.warningThresholdPct,
          criticalThresholdPct: parsed.data.criticalThresholdPct,
          enabled: parsed.data.enabled,
        });
        res.status(201).json(result);
      } catch (error) {
        handleCostError(res, error);
      }
    }
  );

  router.put(
    '/budgets/:id',
    requirePermission('canManageCostCenter'),
    async (req: AuthRequest, res) => {
      const budgetId = Number(req.params.id);
      if (!Number.isInteger(budgetId) || budgetId <= 0) {
        res.status(400).json({ error: 'Invalid budget ID.' });
        return;
      }
      const parsed = UpdateBudgetSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error:
            parsed.error.issues[0]?.message || 'Invalid budget update payload.',
        });
        return;
      }

      try {
        const ctx = req.authContext!;
        const result = await updateCostBudget({
          tenantId: ctx.activeMembership.tenantId,
          budgetId,
          actorUid: ctx.user.uid,
          actorLabel: ctx.user.displayName,
          name: parsed.data.name,
          budgetAmount: parsed.data.budgetAmount,
          warningThresholdPct: parsed.data.warningThresholdPct,
          criticalThresholdPct: parsed.data.criticalThresholdPct,
          enabled: parsed.data.enabled,
        });
        res.json(result);
      } catch (error) {
        handleCostError(res, error);
      }
    }
  );

  router.get(
    '/alerts',
    requirePermission('canViewCostCenter'),
    async (req: AuthRequest, res) => {
      try {
        const statusParam =
          req.query.status === 'active' || req.query.status === 'resolved'
            ? req.query.status
            : 'all';
        const result = await listCostAlerts(
          req.authContext!.activeMembership.tenantId,
          statusParam
        );
        res.json(result);
      } catch (error) {
        handleCostError(res, error);
      }
    }
  );

  router.post(
    '/alerts/:id/resolve',
    requirePermission('canManageCostCenter'),
    async (req: AuthRequest, res) => {
      const alertId = Number(req.params.id);
      if (!Number.isInteger(alertId) || alertId <= 0) {
        res.status(400).json({ error: 'Invalid alert ID.' });
        return;
      }

      try {
        const ctx = req.authContext!;
        const result = await resolveCostAlert({
          tenantId: ctx.activeMembership.tenantId,
          alertId,
          actorUid: ctx.user.uid,
          actorLabel: ctx.user.displayName,
        });
        res.json(result);
      } catch (error) {
        handleCostError(res, error);
      }
    }
  );

  return router;
}

export default createCostsRouter();
