import { randomUUID } from 'node:crypto';
import { logPipelineEvent } from '../events/logger.ts';
import {
  NonRetryableEventError,
  computeRetryBackoffMs,
  sanitizeEventError,
  type RetryBackoffOptions,
} from '../events/retry-policy.ts';
import type { DataClassification, SecretReference, SecretStore } from './contracts.ts';
import { evaluateDataEgressPolicy } from './egress-policy.ts';
import { defaultSecretStore } from './secret-store.ts';

export class SafeHttpClientError extends Error {
  readonly statusCode?: number;
  readonly retryable: boolean;
  readonly code: string;

  constructor(
    message: string,
    options: { statusCode?: number; retryable: boolean; code: string }
  ) {
    super(message);
    this.name = 'SafeHttpClientError';
    this.statusCode = options.statusCode;
    this.retryable = options.retryable;
    this.code = options.code;
  }
}

export interface SafeHttpClientOptions {
  providerId: string;
  baseUrl: string;
  allowedHosts: string[];
  nodeEnv?: string;
  allowInsecureLocalhost?: boolean;
  timeoutMs?: number;
  maxRetries?: number;
  backoffOptions?: RetryBackoffOptions;
  secretStore?: SecretStore;
  fetchImpl?: typeof fetch;
}

export interface SafeHttpRequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH';
  path: string;
  tenantId: number;
  correlationId?: string;
  idempotencyKey?: string;
  secretRef?: SecretReference;
  body?: Record<string, unknown>;
  egressPolicy?: {
    maxAllowedClassification: DataClassification;
    approvedFieldAllowlist: string[];
    purpose: string;
    hasPermission: boolean;
    providerApproved: boolean;
  };
  headers?: Record<string, string>;
}

export interface SafeHttpResponse<T = unknown> {
  status: number;
  correlationId: string;
  attempts: number;
  data: T;
  blockedEgressFields: Array<{
    key: string;
    reason: string;
    classification: DataClassification;
  }>;
}

const RETRYABLE_HTTP_STATUSES = new Set([429, 502, 503, 504]);

function isLocalhostHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return lower === '127.0.0.1' || lower === 'localhost' || lower === '::1';
}

export function validateOutboundDestination(
  rawUrl: string,
  options: {
    allowedHosts: string[];
    nodeEnv?: string;
    allowInsecureLocalhost?: boolean;
  }
): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new NonRetryableEventError(
      'Invalid outbound destination URL.',
      'INVALID_DESTINATION_URL'
    );
  }

  if (parsed.username || parsed.password) {
    throw new NonRetryableEventError(
      'Embedded URL credentials are prohibited in outbound integration requests.',
      'DISALLOWED_URL_CREDENTIALS'
    );
  }

  const normalizedEnv = (options.nodeEnv ?? process.env.NODE_ENV ?? 'development')
    .trim()
    .toLowerCase();
  const normalizedAllowed = new Set(
    options.allowedHosts.map((h) => h.trim().toLowerCase()).filter(Boolean)
  );
  const hostname = parsed.hostname.toLowerCase();

  if (!normalizedAllowed.has(hostname)) {
    throw new NonRetryableEventError(
      `Destination host "${hostname}" is not in the approved provider allowlist.`,
      'DESTINATION_HOST_NOT_ALLOWED'
    );
  }

  if (parsed.protocol === 'https:') {
    return parsed;
  }

  if (
    parsed.protocol === 'http:' &&
    normalizedEnv !== 'production' &&
    options.allowInsecureLocalhost === true &&
    isLocalhostHostname(hostname)
  ) {
    return parsed;
  }

  throw new NonRetryableEventError(
    `Insecure protocol "${parsed.protocol}" rejected for "${hostname}"; HTTPS is required.`,
    'HTTPS_REQUIRED'
  );
}

export class SafeIntegrationHttpClient {
  private readonly providerId: string;
  private readonly baseUrl: URL;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly backoffOptions: RetryBackoffOptions;
  private readonly secretStore: SecretStore;
  private readonly fetchImpl: typeof fetch;

  constructor(options: SafeHttpClientOptions) {
    this.providerId = options.providerId;
    this.baseUrl = validateOutboundDestination(options.baseUrl, {
      allowedHosts: options.allowedHosts,
      nodeEnv: options.nodeEnv,
      allowInsecureLocalhost: options.allowInsecureLocalhost,
    });
    this.timeoutMs = Math.max(50, Math.min(30_000, options.timeoutMs ?? 8_000));
    this.maxRetries = Math.max(0, Math.min(5, options.maxRetries ?? 2));
    this.backoffOptions = options.backoffOptions ?? {
      baseDelayMs: 250,
      maxDelayMs: 2_000,
      jitterRatio: 0.1,
    };
    this.secretStore = options.secretStore ?? defaultSecretStore;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async requestJson<T = unknown>(
    req: SafeHttpRequestOptions
  ): Promise<SafeHttpResponse<T>> {
    const correlationId = req.correlationId || randomUUID();
    const targetUrl = new URL(req.path, this.baseUrl);
    if (targetUrl.origin !== this.baseUrl.origin) {
      throw new NonRetryableEventError(
        'Request path attempted to escape configured provider base origin.',
        'ORIGIN_ESCAPE_REJECTED'
      );
    }

    let outboundBody: Record<string, unknown> | undefined = req.body;
    let blockedEgressFields: SafeHttpResponse['blockedEgressFields'] = [];

    if (req.body) {
      if (!req.egressPolicy) {
        throw new NonRetryableEventError(
          'Outbound JSON requests require an explicit Sensitive Data Egress Policy.',
          'MISSING_EGRESS_POLICY'
        );
      }
      const evaluation = evaluateDataEgressPolicy({
        payload: req.body,
        destinationProviderId: this.providerId,
        maxAllowedClassification: req.egressPolicy.maxAllowedClassification,
        approvedFieldAllowlist: req.egressPolicy.approvedFieldAllowlist,
        purpose: req.egressPolicy.purpose,
        hasPermission: req.egressPolicy.hasPermission,
        providerApproved: req.egressPolicy.providerApproved,
      });

      if (!evaluation.allowed) {
        throw new NonRetryableEventError(
          evaluation.denialReason || 'Outbound payload denied by egress policy.',
          'EGRESS_POLICY_DENIED'
        );
      }

      outboundBody = evaluation.sanitizedPayload;
      blockedEgressFields = evaluation.blockedFields;
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Correlation-Id': correlationId,
      ...(req.headers ?? {}),
    };

    if (req.idempotencyKey) {
      headers['Idempotency-Key'] = req.idempotencyKey;
    }
    if (outboundBody) {
      headers['Content-Type'] = 'application/json';
    }

    if (req.secretRef) {
      const secret = await this.secretStore.resolveSecret(req.secretRef);
      headers.Authorization = `Bearer ${secret}`;
    }

    const canRetry = req.method === 'GET' || Boolean(req.idempotencyKey);
    const maxAttempts = canRetry ? 1 + this.maxRetries : 1;

    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await this.fetchImpl(targetUrl.toString(), {
          method: req.method,
          headers,
          body: outboundBody ? JSON.stringify(outboundBody) : undefined,
          redirect: 'manual',
          signal: controller.signal,
        });

        if (response.status >= 300 && response.status < 400) {
          throw new NonRetryableEventError(
            `Provider "${this.providerId}" returned HTTP ${response.status} redirect; redirects are disabled.`,
            'HTTP_REDIRECT_DISALLOWED'
          );
        }

        if (response.ok) {
          const text = await response.text();
          const data = (text ? JSON.parse(text) : {}) as T;

          logPipelineEvent({
            event: 'outbound_http_succeeded',
            tenantId: req.tenantId,
            providerId: this.providerId,
            correlationId,
            status: String(response.status),
            attempt,
          });

          return {
            status: response.status,
            correlationId,
            attempts: attempt,
            data,
            blockedEgressFields,
          };
        }

        const retryable = RETRYABLE_HTTP_STATUSES.has(response.status);
        const err = new SafeHttpClientError(
          `Provider "${this.providerId}" HTTP ${response.status} error.`,
          {
            statusCode: response.status,
            retryable,
            code: retryable ? `HTTP_${response.status}_RETRYABLE` : `HTTP_${response.status}_PERMANENT`,
          }
        );

        logPipelineEvent({
          level: retryable ? 'warn' : 'error',
          event: 'outbound_http_failed',
          tenantId: req.tenantId,
          providerId: this.providerId,
          correlationId,
          status: String(response.status),
          attempt,
          reason: err.message,
        });

        if (!retryable || attempt >= maxAttempts) {
          if (!retryable) {
            throw new NonRetryableEventError(err.message, err.code);
          }
          throw err;
        }

        lastError = err;
      } catch (error) {
        if (error instanceof NonRetryableEventError) {
          throw error;
        }

        const isAbort =
          error instanceof Error &&
          (error.name === 'AbortError' || error.message.toLowerCase().includes('abort'));

        const wrapped =
          error instanceof SafeHttpClientError
            ? error
            : new SafeHttpClientError(
                isAbort
                  ? `Provider "${this.providerId}" request timed out after ${this.timeoutMs}ms.`
                  : sanitizeEventError(error),
                {
                  retryable: true,
                  code: isAbort ? 'HTTP_TIMEOUT' : 'HTTP_NETWORK_ERROR',
                }
              );

        logPipelineEvent({
          level: 'warn',
          event: 'outbound_http_error',
          tenantId: req.tenantId,
          providerId: this.providerId,
          correlationId,
          attempt,
          reason: wrapped.message,
        });

        if (!wrapped.retryable || attempt >= maxAttempts) {
          throw wrapped;
        }

        lastError = wrapped;
      } finally {
        clearTimeout(timeoutHandle);
      }

      const delayMs = computeRetryBackoffMs(attempt, this.backoffOptions);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    throw lastError instanceof Error
      ? lastError
      : new SafeHttpClientError('Outbound HTTP request failed.', {
          retryable: true,
          code: 'HTTP_EXHAUSTED',
        });
  }
}
