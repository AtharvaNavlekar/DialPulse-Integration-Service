import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import {
  HttpCentralCrmAdapter,
} from '../adapters/central-crm-http.ts';
import {
  HttpClientCrmAdapter,
} from '../adapters/client-crm-http.ts';
import type { WorkerHealthSnapshot } from '../events/event-worker.ts';
import type { SecretStore } from '../integrations/contracts.ts';
import {
  ConnectionLifecycleError,
  activateConnection,
  createPendingConnection,
  getConnectionByIdForTenant,
  getConnectionDetailsForTenant,
  getIntegrationOverview,
  listConnectionsByTenant,
  listIntegrationAuditHistory,
  queryWebhookLogsByTenant,
  transitionConnectionStatus,
} from '../integrations/connections-service.ts';
import { externalIdMappingService } from '../integrations/external-mappings.ts';
import { PROVIDER_REGISTRY } from '../integrations/provider-registry.ts';
import {
  SecretReferenceSchema,
  defaultSecretStore,
  getSecretStorageStatus,
} from '../integrations/secret-store.ts';
import {
  requireAnyPermission,
  requireAuth,
  requirePermission,
  type AuthRequest,
} from '../middleware/auth.ts';

const CreateConnectionSchema = z.object({
  providerId: z.string().trim().min(2).max(80),
  connectionName: z.string().trim().min(2).max(120),
  authMode: z.enum(['service_jwt', 'oauth2', 'api_key_hmac', 'webhook_hmac']),
  secretRef: SecretReferenceSchema,
  allowedScopes: z.array(z.string().trim().min(1)).default([]),
  config: z.record(z.string(), z.unknown()).default({}),
  environment: z.enum(['development', 'staging', 'production']).default('development'),
});

const StatusTransitionSchema = z.object({
  reason: z.string().trim().max(300).optional(),
});

const DEFAULT_DISABLED_WORKER_HEALTH: WorkerHealthSnapshot = {
  status: 'disabled',
  workerId: 'unstarted',
  enabled: false,
  running: false,
  stopping: false,
  healthy: true,
  pollIntervalMs: 2000,
  maxConcurrency: 3,
  leaseDurationMs: 60000,
  lastPollAt: null,
  lastSuccessAt: null,
  lastError: null,
};

function parseOptionalIsoDate(raw: unknown): Date | undefined | 'invalid' {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const d = new Date(raw.trim());
  if (Number.isNaN(d.getTime())) return 'invalid';
  return d;
}

function parseBoundedInt(
  raw: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

const requireIntegrationConsoleAccess = requireAnyPermission([
  'canManageIntegrations',
  'canManageConnections',
  'canManageSettings',
  'canReplayEvents',
]);

export interface CreateIntegrationsRouterOptions {
  authMiddleware?: RequestHandler;
  secretStore?: SecretStore;
  getWorkerHealth?: () => WorkerHealthSnapshot;
}

export function createIntegrationsRouter(
  options: CreateIntegrationsRouterOptions = {}
): Router {
  const router = Router();
  const authMiddleware = options.authMiddleware ?? requireAuth;
  const secretStore = options.secretStore ?? defaultSecretStore;
  const getWorkerHealth =
    options.getWorkerHealth ?? (() => DEFAULT_DISABLED_WORKER_HEALTH);

  router.use(authMiddleware);
  router.use(requireIntegrationConsoleAccess);

  router.get('/overview', async (req: AuthRequest, res) => {
    try {
      const tenantId = req.authContext!.activeMembership.tenantId;
      const overview = await getIntegrationOverview(tenantId, getWorkerHealth());
      res.json(overview);
    } catch (error) {
      console.error('Failed to load integration overview:', error);
      res.status(500).json({ error: 'Failed to load integration overview.' });
    }
  });

  router.get('/providers', (_req: AuthRequest, res) => {
    const clientCrm = new HttpClientCrmAdapter();
    const centralCrm = new HttpCentralCrmAdapter();
    res.json({
      providers: PROVIDER_REGISTRY,
      ecosystemAdapters: {
        clientCrm: clientCrm.getStatusSummary(),
        centralCrm: centralCrm.getStatusSummary(),
      },
      secretManager: getSecretStorageStatus(),
    });
  });

  router.get('/connections', async (req: AuthRequest, res) => {
    try {
      const tenantId = req.authContext!.activeMembership.tenantId;
      const providerId =
        typeof req.query.providerId === 'string' && req.query.providerId.trim()
          ? req.query.providerId.trim()
          : undefined;
      const status =
        typeof req.query.status === 'string' && req.query.status.trim()
          ? req.query.status.trim()
          : undefined;
      const limit = parseBoundedInt(req.query.limit, 50, 1, 100);

      const connections = await listConnectionsByTenant(tenantId, {
        providerId,
        status,
        limit,
      });
      res.json({ connections });
    } catch (error) {
      console.error('Failed to list integration connections:', error);
      res.status(500).json({ error: 'Failed to load integration connections.' });
    }
  });

  router.post(
    '/connections',
    requirePermission('canManageConnections'),
    async (req: AuthRequest, res) => {
      const parsed = CreateConnectionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error:
            parsed.error.issues[0]?.message ??
            'Invalid integration connection payload.',
        });
        return;
      }

      try {
        const ctx = req.authContext!;
        const connection = await createPendingConnection({
          tenantId: ctx.activeMembership.tenantId,
          providerId: parsed.data.providerId,
          connectionName: parsed.data.connectionName,
          authMode: parsed.data.authMode,
          secretRef: parsed.data.secretRef,
          allowedScopes: parsed.data.allowedScopes,
          config: parsed.data.config,
          environment: parsed.data.environment,
          actorUid: ctx.user.uid,
          actorLabel: ctx.user.displayName,
        });
        res.status(201).json({ connection });
      } catch (error) {
        if (error instanceof ConnectionLifecycleError) {
          res.status(error.statusCode).json({ error: error.message });
          return;
        }
        console.error('Failed to create pending connection:', error);
        res.status(500).json({ error: 'Failed to create integration connection.' });
      }
    }
  );

  router.get('/connections/:id', async (req: AuthRequest, res) => {
    const connectionId = Number(req.params.id);
    if (!Number.isInteger(connectionId) || connectionId <= 0) {
      res.status(400).json({ error: 'Invalid connection ID.' });
      return;
    }

    try {
      const tenantId = req.authContext!.activeMembership.tenantId;
      const connection = await getConnectionByIdForTenant(tenantId, connectionId);
      if (!connection) {
        res.status(404).json({ error: 'Integration connection not found.' });
        return;
      }
      res.json({ connection });
    } catch (error) {
      console.error('Failed to load connection:', error);
      res.status(500).json({ error: 'Failed to load integration connection.' });
    }
  });

  router.get('/connections/:id/details', async (req: AuthRequest, res) => {
    const connectionId = Number(req.params.id);
    if (!Number.isInteger(connectionId) || connectionId <= 0) {
      res.status(400).json({ error: 'Invalid connection ID.' });
      return;
    }

    try {
      const tenantId = req.authContext!.activeMembership.tenantId;
      const details = await getConnectionDetailsForTenant(tenantId, connectionId);
      if (!details) {
        res.status(404).json({ error: 'Integration connection not found.' });
        return;
      }
      res.json(details);
    } catch (error) {
      console.error('Failed to load connection details:', error);
      res.status(500).json({ error: 'Failed to load connection details.' });
    }
  });

  router.post(
    '/connections/:id/activate',
    requirePermission('canManageConnections'),
    async (req: AuthRequest, res) => {
      const connectionId = Number(req.params.id);
      if (!Number.isInteger(connectionId) || connectionId <= 0) {
        res.status(400).json({ error: 'Invalid connection ID.' });
        return;
      }

      try {
        const ctx = req.authContext!;
        const connection = await activateConnection({
          tenantId: ctx.activeMembership.tenantId,
          connectionId,
          actorUid: ctx.user.uid,
          actorLabel: ctx.user.displayName,
          secretStore,
        });
        res.json({ connection });
      } catch (error) {
        if (error instanceof ConnectionLifecycleError) {
          res.status(error.statusCode).json({ error: error.message });
          return;
        }
        console.error('Failed to activate connection:', error);
        res.status(500).json({ error: 'Failed to activate integration connection.' });
      }
    }
  );

  router.post(
    '/connections/:id/disable',
    requirePermission('canManageConnections'),
    async (req: AuthRequest, res) => {
      const connectionId = Number(req.params.id);
      const parsed = StatusTransitionSchema.safeParse(req.body ?? {});
      if (!Number.isInteger(connectionId) || connectionId <= 0 || !parsed.success) {
        res.status(400).json({ error: 'Invalid disable connection request.' });
        return;
      }

      try {
        const ctx = req.authContext!;
        const connection = await transitionConnectionStatus({
          tenantId: ctx.activeMembership.tenantId,
          connectionId,
          targetStatus: 'disabled',
          actorUid: ctx.user.uid,
          actorLabel: ctx.user.displayName,
          reason: parsed.data.reason,
        });
        res.json({ connection });
      } catch (error) {
        if (error instanceof ConnectionLifecycleError) {
          res.status(error.statusCode).json({ error: error.message });
          return;
        }
        console.error('Failed to disable connection:', error);
        res.status(500).json({ error: 'Failed to disable integration connection.' });
      }
    }
  );

  router.post(
    '/connections/:id/revoke',
    requirePermission('canManageConnections'),
    async (req: AuthRequest, res) => {
      const connectionId = Number(req.params.id);
      const parsed = StatusTransitionSchema.safeParse(req.body ?? {});
      if (!Number.isInteger(connectionId) || connectionId <= 0 || !parsed.success) {
        res.status(400).json({ error: 'Invalid revoke connection request.' });
        return;
      }

      try {
        const ctx = req.authContext!;
        const connection = await transitionConnectionStatus({
          tenantId: ctx.activeMembership.tenantId,
          connectionId,
          targetStatus: 'revoked',
          actorUid: ctx.user.uid,
          actorLabel: ctx.user.displayName,
          reason: parsed.data.reason,
        });
        res.json({ connection });
      } catch (error) {
        if (error instanceof ConnectionLifecycleError) {
          res.status(error.statusCode).json({ error: error.message });
          return;
        }
        console.error('Failed to revoke connection:', error);
        res.status(500).json({ error: 'Failed to revoke integration connection.' });
      }
    }
  );

  router.get('/mappings', async (req: AuthRequest, res) => {
    try {
      const tenantId = req.authContext!.activeMembership.tenantId;
      const connectionIdNum = req.query.connectionId
        ? Number(req.query.connectionId)
        : undefined;
      if (
        req.query.connectionId &&
        (!Number.isInteger(connectionIdNum) || (connectionIdNum ?? 0) <= 0)
      ) {
        res.status(400).json({ error: 'Invalid connectionId filter.' });
        return;
      }

      const limit = parseBoundedInt(req.query.limit, 25, 1, 100);
      const offset = parseBoundedInt(req.query.offset, 0, 0, 100_000);

      const result = await externalIdMappingService.queryMappingsByTenant(tenantId, {
        providerId:
          typeof req.query.providerId === 'string' && req.query.providerId.trim()
            ? req.query.providerId.trim()
            : undefined,
        connectionId: connectionIdNum,
        internalEntityType:
          typeof req.query.internalEntityType === 'string' &&
          req.query.internalEntityType.trim()
            ? req.query.internalEntityType.trim()
            : undefined,
        internalEntityId:
          typeof req.query.internalEntityId === 'string' &&
          req.query.internalEntityId.trim()
            ? req.query.internalEntityId.trim()
            : undefined,
        externalEntityType:
          typeof req.query.externalEntityType === 'string' &&
          req.query.externalEntityType.trim()
            ? req.query.externalEntityType.trim()
            : undefined,
        externalEntityId:
          typeof req.query.externalEntityId === 'string' &&
          req.query.externalEntityId.trim()
            ? req.query.externalEntityId.trim()
            : undefined,
        entityType:
          typeof req.query.entityType === 'string' && req.query.entityType.trim()
            ? req.query.entityType.trim()
            : undefined,
        search:
          typeof req.query.search === 'string' && req.query.search.trim()
            ? req.query.search.trim()
            : undefined,
        limit,
        offset,
      });

      res.json({
        mappings: result.mappings,
        total: result.total,
        limit,
        offset,
      });
    } catch (error) {
      console.error('Failed to load external ID mappings:', error);
      res.status(500).json({ error: 'Failed to load external ID mappings.' });
    }
  });

  router.get(
    '/webhooks/logs',
    requireAnyPermission(['canManageIntegrations', 'canManageAutomations']),
    async (req: AuthRequest, res) => {
      try {
        const tenantId = req.authContext!.activeMembership.tenantId;
        const connectionIdNum = req.query.connectionId
          ? Number(req.query.connectionId)
          : undefined;
        if (
          req.query.connectionId &&
          (!Number.isInteger(connectionIdNum) || (connectionIdNum ?? 0) <= 0)
        ) {
          res.status(400).json({ error: 'Invalid connectionId filter.' });
          return;
        }

        const from = parseOptionalIsoDate(req.query.from);
        const to = parseOptionalIsoDate(req.query.to);
        if (from === 'invalid' || to === 'invalid') {
          res.status(400).json({ error: 'Invalid date range filter.' });
          return;
        }

        const limit = parseBoundedInt(req.query.limit, 25, 1, 100);
        const offset = parseBoundedInt(req.query.offset, 0, 0, 100_000);

        const result = await queryWebhookLogsByTenant(tenantId, {
          connectionId: connectionIdNum,
          providerId:
            typeof req.query.providerId === 'string' && req.query.providerId.trim()
              ? req.query.providerId.trim()
              : undefined,
          verificationOutcome:
            typeof req.query.verificationOutcome === 'string' &&
            req.query.verificationOutcome.trim()
              ? req.query.verificationOutcome.trim()
              : undefined,
          processingStatus:
            typeof req.query.processingStatus === 'string' &&
            req.query.processingStatus.trim()
              ? req.query.processingStatus.trim()
              : undefined,
          eventType:
            typeof req.query.eventType === 'string' && req.query.eventType.trim()
              ? req.query.eventType.trim()
              : undefined,
          from,
          to,
          limit,
          offset,
        });
        res.json({
          logs: result.logs,
          total: result.total,
          limit,
          offset,
        });
      } catch (error) {
        console.error('Failed to load webhook operational logs:', error);
        res.status(500).json({ error: 'Failed to load webhook operational logs.' });
      }
    }
  );

  router.get('/audit', async (req: AuthRequest, res) => {
    try {
      const tenantId = req.authContext!.activeMembership.tenantId;
      const entryTypeRaw = String(req.query.entryType ?? 'all').trim();
      const entryType =
        entryTypeRaw === 'activity' || entryTypeRaw === 'replay'
          ? entryTypeRaw
          : 'all';

      const connectionIdNum = req.query.connectionId
        ? Number(req.query.connectionId)
        : undefined;
      if (
        req.query.connectionId &&
        (!Number.isInteger(connectionIdNum) || (connectionIdNum ?? 0) <= 0)
      ) {
        res.status(400).json({ error: 'Invalid connectionId filter.' });
        return;
      }

      const from = parseOptionalIsoDate(req.query.from);
      const to = parseOptionalIsoDate(req.query.to);
      if (from === 'invalid' || to === 'invalid') {
        res.status(400).json({ error: 'Invalid date range filter.' });
        return;
      }

      const limit = parseBoundedInt(req.query.limit, 25, 1, 100);
      const offset = parseBoundedInt(req.query.offset, 0, 0, 100_000);

      const result = await listIntegrationAuditHistory(tenantId, {
        entryType,
        connectionId: connectionIdNum,
        eventId:
          typeof req.query.eventId === 'string' && req.query.eventId.trim()
            ? req.query.eventId.trim()
            : undefined,
        search:
          typeof req.query.search === 'string' && req.query.search.trim()
            ? req.query.search.trim()
            : undefined,
        from,
        to,
        limit,
        offset,
      });

      res.json({
        entries: result.entries,
        total: result.total,
        limit,
        offset,
      });
    } catch (error) {
      console.error('Failed to load integration audit history:', error);
      res.status(500).json({ error: 'Failed to load integration audit history.' });
    }
  });

  return router;
}

export default createIntegrationsRouter();
