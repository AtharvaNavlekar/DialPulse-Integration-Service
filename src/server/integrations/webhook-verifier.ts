import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type {
  SecretStore,
  WebhookVerificationInput,
  WebhookVerificationResult,
  WebhookVerifier,
} from './contracts.ts';
import { classifyFieldSensitivity } from './egress-policy.ts';
import { defaultSecretStore } from './secret-store.ts';

export const DEFAULT_MAX_REPLAY_WINDOW_SECONDS = 300;
export const MAX_FUTURE_CLOCK_SKEW_SECONDS = 60;

export type WebhookVerificationOutcome =
  | 'verified'
  | 'invalid_signature'
  | 'expired_timestamp'
  | 'malformed_signature'
  | 'connection_inactive'
  | 'provider_mismatch'
  | 'unconfigured_secret'
  | 'unsupported_protocol'
  | 'invalid_payload';

export function computePayloadSha256(rawBody: Buffer | string): string {
  const buf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Signed string format for DialPulse internal ecosystem HMAC webhooks:
 *   HMAC-SHA256(secret, `${timestampSeconds}.${rawBodyBytes}`)
 * Header `x-dialpulse-signature`: `v1=<64 lowercase hex chars>`
 * Header `x-dialpulse-timestamp`: `<unix_epoch_seconds>`
 */
export function computeWebhookHmacSignature(
  secret: string,
  timestampSeconds: number,
  rawBody: Buffer | string
): string {
  const bodyBuf = Buffer.isBuffer(rawBody)
    ? rawBody
    : Buffer.from(rawBody, 'utf8');
  const prefix = Buffer.from(`${timestampSeconds}.`, 'utf8');
  const digest = createHmac('sha256', secret)
    .update(Buffer.concat([prefix, bodyBuf]))
    .digest('hex');
  return `v1=${digest}`;
}

function readHeaderCaseInsensitive(
  headers: Record<string, string | undefined>,
  name: string
): string | undefined {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target && typeof value === 'string') {
      return value;
    }
  }
  return undefined;
}

export class DialPulseHmacSha256Verifier implements WebhookVerifier {
  readonly providerId: string;
  private readonly secretStore: SecretStore;
  private readonly nowFn: () => number;

  constructor(
    providerId: string,
    options: { secretStore?: SecretStore; nowFn?: () => number } = {}
  ) {
    this.providerId = providerId;
    this.secretStore = options.secretStore ?? defaultSecretStore;
    this.nowFn = options.nowFn ?? (() => Math.floor(Date.now() / 1000));
  }

  async verify(
    input: WebhookVerificationInput
  ): Promise<WebhookVerificationResult & { outcome: WebhookVerificationOutcome }> {
    const rawSigHeader = readHeaderCaseInsensitive(
      input.headers,
      'x-dialpulse-signature'
    );
    const rawTsHeader = readHeaderCaseInsensitive(
      input.headers,
      'x-dialpulse-timestamp'
    );
    const providerEventIdHeader = readHeaderCaseInsensitive(
      input.headers,
      'x-dialpulse-event-id'
    )?.trim();

    if (!rawSigHeader || !rawSigHeader.trim()) {
      return {
        verified: false,
        outcome: 'malformed_signature',
        failureReason: 'Missing x-dialpulse-signature header.',
      };
    }

    if (!rawTsHeader || !/^\d{9,13}$/.test(rawTsHeader.trim())) {
      return {
        verified: false,
        outcome: 'expired_timestamp',
        failureReason: 'Missing or invalid x-dialpulse-timestamp header.',
      };
    }

    const timestampSeconds = Number(rawTsHeader.trim());
    const maxWindow = Math.min(
      DEFAULT_MAX_REPLAY_WINDOW_SECONDS,
      Math.max(1, input.maxReplayWindowSeconds || DEFAULT_MAX_REPLAY_WINDOW_SECONDS)
    );
    const nowSeconds = this.nowFn();
    const ageSeconds = nowSeconds - timestampSeconds;

    if (ageSeconds > maxWindow) {
      return {
        verified: false,
        outcome: 'expired_timestamp',
        failureReason: `Webhook timestamp expired (${ageSeconds}s old; max ${maxWindow}s).`,
      };
    }

    if (timestampSeconds - nowSeconds > MAX_FUTURE_CLOCK_SKEW_SECONDS) {
      return {
        verified: false,
        outcome: 'expired_timestamp',
        failureReason: 'Webhook timestamp is too far in the future.',
      };
    }

    // Strict v1=<64-hex-chars> check prevents algorithm downgrade or malformed encoding
    const sigMatch = /^v1=([0-9a-fA-F]{64})$/.exec(rawSigHeader.trim());
    if (!sigMatch) {
      return {
        verified: false,
        outcome: 'malformed_signature',
        failureReason:
          'Malformed signature format; expected v1=<64-hex-sha256>.',
      };
    }

    let secret: string;
    try {
      secret = await this.secretStore.resolveSecret(input.secretRef);
    } catch (error) {
      return {
        verified: false,
        outcome: 'unconfigured_secret',
        failureReason:
          error instanceof Error
            ? error.message
            : 'Unable to resolve webhook verification secret.',
      };
    }

    const rawBodyBuf = Buffer.isBuffer(input.rawBody)
      ? input.rawBody
      : Buffer.from(input.rawBody, 'utf8');

    const expectedHex = createHmac('sha256', secret)
      .update(Buffer.concat([Buffer.from(`${timestampSeconds}.`, 'utf8'), rawBodyBuf]))
      .digest('hex');

    const providedBuf = Buffer.from(sigMatch[1]!.toLowerCase(), 'hex');
    const expectedBuf = Buffer.from(expectedHex, 'hex');

    if (
      providedBuf.length !== expectedBuf.length ||
      !timingSafeEqual(providedBuf, expectedBuf)
    ) {
      return {
        verified: false,
        outcome: 'invalid_signature',
        failureReason: 'Webhook HMAC signature mismatch.',
      };
    }

    return {
      verified: true,
      outcome: 'verified',
      providerEventId: providerEventIdHeader || undefined,
    };
  }
}

export const DOCUMENTED_WEBHOOK_EVENT_ALLOWLIST: Record<string, readonly string[]> = {
  dialpulse_web: ['web_enquiry_submitted', 'callback_requested'],
  client_crm: ['lead_stage_changed', 'lead_assigned', 'lead_synced_ack'],
  central_crm: ['tenant_status_updated', 'membership_changed'],
};

export function createWebhookVerifierRegistry(options: {
  secretStore?: SecretStore;
  nowFn?: () => number;
} = {}): Map<string, DialPulseHmacSha256Verifier> {
  const registry = new Map<string, DialPulseHmacSha256Verifier>();
  for (const providerId of Object.keys(DOCUMENTED_WEBHOOK_EVENT_ALLOWLIST)) {
    registry.set(
      providerId,
      new DialPulseHmacSha256Verifier(providerId, options)
    );
  }
  return registry;
}

export function getWebhookVerifier(
  providerId: string,
  options: { secretStore?: SecretStore; nowFn?: () => number } = {}
): DialPulseHmacSha256Verifier | null {
  return createWebhookVerifierRegistry(options).get(providerId) ?? null;
}

export const InboundWebhookPayloadSchema = z.object({
  eventId: z.string().trim().min(3).max(160).optional(),
  eventType: z.string().trim().min(2).max(120),
  occurredAt: z.string().trim().max(80).optional(),
  data: z.record(z.string(), z.unknown()).default({}),
});

export interface InboundSanitizationResult {
  allowed: boolean;
  sanitizedData: Record<string, unknown>;
  strippedKeys: string[];
  rejectedReason?: string;
}

const INBOUND_ALLOWED_DATA_KEYS: Record<string, readonly string[]> = {
  dialpulse_web: [
    'applicantName',
    'full_name',
    'email',
    'phone',
    'loan_product',
    'productInterest',
    'requested_amount_lakhs',
    'preferred_callback_date',
    'utmSource',
    'utmCampaign',
    'landingPage',
    'externalEnquiryId',
  ],
  client_crm: [
    'externalLeadId',
    'internalLeadId',
    'workflowStage',
    'assignedOwnerName',
    'syncStatus',
    'updatedAt',
  ],
  central_crm: [
    'tenantStatus',
    'userUid',
    'externalStaffId',
    'roleKey',
    'departmentName',
    'membershipStatus',
  ],
};

export function sanitizeInboundWebhookData(
  providerId: string,
  data: Record<string, unknown>
): InboundSanitizationResult {
  const allowedKeys = new Set(INBOUND_ALLOWED_DATA_KEYS[providerId] ?? []);
  const sanitizedData: Record<string, unknown> = {};
  const strippedKeys: string[] = [];

  for (const [key, value] of Object.entries(data)) {
    const sensitivity = classifyFieldSensitivity(key);
    if (sensitivity === 'restricted') {
      return {
        allowed: false,
        sanitizedData: {},
        strippedKeys: [key],
        rejectedReason: `Restricted KYC/financial field "${key}" is not permitted in inbound webhooks.`,
      };
    }
    if (!allowedKeys.has(key)) {
      strippedKeys.push(key);
      continue;
    }
    sanitizedData[key] = value;
  }

  return {
    allowed: true,
    sanitizedData,
    strippedKeys,
  };
}
