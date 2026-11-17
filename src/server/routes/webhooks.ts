import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { integrationConnections, providerWebhookLogs } from '../../db/schema.ts';
import { buildWebhookConsumerName } from '../events/event-publisher.ts';
import { deliverEventToInbox } from '../events/inbox-repository.ts';
import { logPipelineEvent } from '../events/logger.ts';
import { sanitizeEventError } from '../events/retry-policy.ts';
import type { SecretStore } from '../integrations/contracts.ts';
import { getProviderRegistryEntry } from '../integrations/provider-registry.ts';
import { defaultSecretStore } from '../integrations/secret-store.ts';
import {
  DEFAULT_MAX_REPLAY_WINDOW_SECONDS,
  DOCUMENTED_WEBHOOK_EVENT_ALLOWLIST,
  InboundWebhookPayloadSchema,
  computePayloadSha256,
  getWebhookVerifier,
  sanitizeInboundWebhookData,
} from '../integrations/webhook-verifier.ts';
import { createRateLimiter } from '../middleware/rate-limit.ts';

export const WEBHOOK_MAX_BODY_BYTES = 256 * 1024; // 256 KB strict limit

export interface CreateWebhookRouterOptions {
  secretStore?: SecretStore;
  nowFn?: () => number;
  maxReplayWindowSeconds?: number;
}

export function createWebhookRouter(
  options: CreateWebhookRouterOptions = {}
): Router {
  const router = Router();
  const secretStore = options.secretStore ?? defaultSecretStore;
  const maxReplayWindowSeconds =
    options.maxReplayWindowSeconds ?? DEFAULT_MAX_REPLAY_WINDOW_SECONDS;

  const webhookRateLimiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 120,
  });

  // Capture exact raw request bytes BEFORE any JSON parsing.
  router.use(
    express.raw({
      type: '*/*',
      limit: WEBHOOK_MAX_BODY_BYTES,
    })
  );

  // Convert body-parser size limit or buffer errors into clean JSON responses
  router.use(
    (err: unknown, _req: Request, res: Response, next: NextFunction) => {
      if (
        err &&
        typeof err === 'object' &&
        ((err as { type?: string }).type === 'entity.too.large' ||
          (err as { status?: number }).status === 413)
      ) {
        res.status(413).json({ error: 'Webhook payload exceeds maximum allowed size.' });
        return;
      }
      if (err) {
        res.status(400).json({ error: 'Invalid webhook request stream.' });
        return;
      }
      next();
    }
  );

  router.post('/:providerId/:connectionId', webhookRateLimiter, async (req, res) => {
    const providerId = String(req.params.providerId ?? '').trim();
    const connectionId = Number(req.params.connectionId);

    if (!providerId || !Number.isInteger(connectionId) || connectionId <= 0) {
      res.status(400).json({ error: 'Invalid webhook provider or connection identifier.' });
      return;
    }

    const contentType = String(req.headers['content-type'] ?? '').toLowerCase();
    if (!contentType.includes('application/json')) {
      res.status(415).json({ error: 'Webhook Content-Type must be application/json.' });
      return;
    }

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: 'Empty webhook payload is not allowed.' });
      return;
    }

    const rawBody: Buffer = req.body;
    const payloadSha256 = computePayloadSha256(rawBody);
    const providerEntry = getProviderRegistryEntry(providerId);

    if (!providerEntry || !providerEntry.webhookSupport) {
      res.status(404).json({ error: 'Webhook provider is unsupported.' });
      return;
    }

    try {
      // Resolve tenant ONLY from the server-side connection record; never trust body/headers
      const connRows = await db
        .select()
        .from(integrationConnections)
        .where(eq(integrationConnections.id, connectionId))
        .limit(1);

      const connection = connRows[0];
      if (!connection) {
        res.status(404).json({ error: 'Integration connection not found.' });
        return;
      }

      if (connection.providerId !== providerId) {
        await db.insert(providerWebhookLogs).values({
          tenantId: connection.tenantId,
          connectionId: connection.id,
          providerId,
          payloadSha256,
          verificationOutcome: 'provider_mismatch',
          processingStatus: 'rejected',
          httpStatus: 403,
          sanitizedFailureReason: 'Provider route parameter does not match connection provider.',
        });
        res.status(403).json({ error: 'Connection provider mismatch.' });
        return;
      }

      if (connection.status !== 'active') {
        await db.insert(providerWebhookLogs).values({
          tenantId: connection.tenantId,
          connectionId: connection.id,
          providerId,
          payloadSha256,
          verificationOutcome: 'connection_inactive',
          processingStatus: 'rejected',
          httpStatus: 403,
          sanitizedFailureReason: `Connection is "${connection.status}" and cannot accept webhooks.`,
        });
        res.status(403).json({
          error: 'Integration connection is not active.',
        });
        return;
      }

      const verifier = getWebhookVerifier(providerId, {
        secretStore,
        nowFn: options.nowFn,
      });

      if (!verifier) {
        await db.insert(providerWebhookLogs).values({
          tenantId: connection.tenantId,
          connectionId: connection.id,
          providerId,
          payloadSha256,
          verificationOutcome: 'unsupported_protocol',
          processingStatus: 'rejected',
          httpStatus: 403,
          sanitizedFailureReason: `No verified webhook protocol is registered for "${providerId}".`,
        });
        res.status(403).json({
          error: 'Provider webhook verification protocol is not configured.',
        });
        return;
      }

      const normalizedHeaders: Record<string, string | undefined> = {};
      for (const [key, val] of Object.entries(req.headers)) {
        normalizedHeaders[key.toLowerCase()] = Array.isArray(val) ? val[0] : val;
      }

      const verification = await verifier.verify({
        rawBody,
        headers: normalizedHeaders,
        secretRef: connection.secretRef,
        maxReplayWindowSeconds,
      });

      if (!verification.verified) {
        const failureReason = sanitizeEventError(
          verification.failureReason ?? 'Signature verification failed.'
        );
        await db.insert(providerWebhookLogs).values({
          tenantId: connection.tenantId,
          connectionId: connection.id,
          providerId,
          providerEventId: verification.providerEventId ?? null,
          payloadSha256,
          verificationOutcome: verification.outcome,
          processingStatus: 'rejected',
          httpStatus: 401,
          sanitizedFailureReason: failureReason,
        });

        logPipelineEvent({
          level: 'warn',
          event: 'webhook_verification_failed',
          tenantId: connection.tenantId,
          providerId,
          connectionId: connection.id,
          outcome: verification.outcome,
        });

        res.status(401).json({ error: 'Invalid webhook signature or timestamp.' });
        return;
      }

      // Parse validated JSON bytes ONLY AFTER cryptographic signature verification succeeds
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(rawBody.toString('utf8'));
      } catch {
        await db.insert(providerWebhookLogs).values({
          tenantId: connection.tenantId,
          connectionId: connection.id,
          providerId,
          providerEventId: verification.providerEventId ?? null,
          payloadSha256,
          verificationOutcome: 'verified',
          processingStatus: 'rejected',
          httpStatus: 400,
          sanitizedFailureReason: 'Malformed JSON body.',
        });
        res.status(400).json({ error: 'Malformed JSON webhook payload.' });
        return;
      }

      const schemaResult = InboundWebhookPayloadSchema.safeParse(parsedJson);
      if (!schemaResult.success) {
        await db.insert(providerWebhookLogs).values({
          tenantId: connection.tenantId,
          connectionId: connection.id,
          providerId,
          providerEventId: verification.providerEventId ?? null,
          payloadSha256,
          verificationOutcome: 'verified',
          processingStatus: 'rejected',
          httpStatus: 400,
          sanitizedFailureReason: 'Webhook payload failed schema validation.',
        });
        res.status(400).json({ error: 'Invalid webhook payload schema.' });
        return;
      }

      const payload = schemaResult.data;
      const allowedEventTypes = DOCUMENTED_WEBHOOK_EVENT_ALLOWLIST[providerId] ?? [];
      if (!allowedEventTypes.includes(payload.eventType)) {
        await db.insert(providerWebhookLogs).values({
          tenantId: connection.tenantId,
          connectionId: connection.id,
          providerId,
          providerEventId: verification.providerEventId ?? payload.eventId ?? null,
          eventType: payload.eventType,
          payloadSha256,
          verificationOutcome: 'verified',
          processingStatus: 'rejected',
          httpStatus: 400,
          sanitizedFailureReason: `Event type "${payload.eventType}" is not allowlisted for "${providerId}".`,
        });
        res.status(400).json({ error: 'Unsupported or unapproved webhook event type.' });
        return;
      }

      const sanitization = sanitizeInboundWebhookData(providerId, payload.data);
      if (!sanitization.allowed) {
        await db.insert(providerWebhookLogs).values({
          tenantId: connection.tenantId,
          connectionId: connection.id,
          providerId,
          providerEventId: verification.providerEventId ?? payload.eventId ?? null,
          eventType: payload.eventType,
          payloadSha256,
          verificationOutcome: 'verified',
          processingStatus: 'rejected',
          httpStatus: 400,
          sanitizedFailureReason:
            sanitization.rejectedReason ?? 'Restricted payload fields rejected.',
        });
        res.status(400).json({
          error:
            sanitization.rejectedReason ??
            'Webhook payload contains restricted KYC/financial fields.',
        });
        return;
      }

      const providerEventId =
        verification.providerEventId ||
        payload.eventId ||
        `sha256:${providerId}:${connection.id}:${payloadSha256}`;
      const inboxEventId = `webhook:${providerId}:${connection.id}:${providerEventId}`;
      const consumerName = buildWebhookConsumerName(providerId);
      const now = new Date();

      const txOutcome = await db.transaction(async (tx) => {
        const delivery = await deliverEventToInbox(
          {
            tenantId: connection.tenantId,
            consumerName,
            eventId: inboxEventId,
            eventType: payload.eventType,
            payload: {
              providerId,
              connectionId: connection.id,
              providerEventId,
              occurredAt: payload.occurredAt ?? now.toISOString(),
              data: sanitization.sanitizedData,
            },
            availableAt: now,
          },
          tx
        );

        const httpStatus = delivery.inserted ? 202 : 200;
        const processingStatus = delivery.inserted ? 'accepted' : 'duplicate';

        await tx.insert(providerWebhookLogs).values({
          tenantId: connection.tenantId,
          connectionId: connection.id,
          providerId,
          providerEventId,
          eventType: payload.eventType,
          payloadSha256,
          verificationOutcome: 'verified',
          processingStatus,
          httpStatus,
          processedAt: now,
        });

        return {
          inserted: delivery.inserted,
          inboxId: delivery.record.id,
          httpStatus,
        };
      });

      logPipelineEvent({
        event: txOutcome.inserted
          ? 'webhook_event_accepted'
          : 'webhook_duplicate_ignored',
        tenantId: connection.tenantId,
        providerId,
        connectionId: connection.id,
        eventId: inboxEventId,
        eventType: payload.eventType,
        inboxId: txOutcome.inboxId,
      });

      res.status(txOutcome.httpStatus).json({
        accepted: true,
        duplicate: !txOutcome.inserted,
        eventId: inboxEventId,
        inboxId: txOutcome.inboxId,
      });
    } catch (error) {
      logPipelineEvent({
        level: 'error',
        event: 'webhook_persistence_error',
        providerId,
        connectionId,
        reason: sanitizeEventError(error),
      });
      res.status(500).json({ error: 'Temporary webhook persistence failure.' });
    }
  });

  return router;
}

export default createWebhookRouter();
