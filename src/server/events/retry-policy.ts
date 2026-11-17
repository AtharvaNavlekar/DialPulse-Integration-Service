import {
  MAX_AUTOMATION_RETRY_ATTEMPTS,
  isRetryableAutomationError,
} from '../../shared/automation-engine.ts';
import { AuthorizationError } from '../middleware/tenant-guard.ts';

export const MAX_EVENT_ATTEMPTS = MAX_AUTOMATION_RETRY_ATTEMPTS;

export class NonRetryableEventError extends Error {
  readonly code: string;

  constructor(message: string, code = 'NON_RETRYABLE_EVENT_ERROR') {
    super(message);
    this.name = 'NonRetryableEventError';
    this.code = code;
  }
}

export interface ErrorClassification {
  retryable: boolean;
  reason: string;
  sanitizedMessage: string;
}

export interface RetryBackoffOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  randomFn?: () => number;
}

const TRANSIENT_PG_CODES = new Set([
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '53300', // too_many_connections
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '08006', // connection_failure
  '08001', // sqlclient_unable_to_establish_sqlconnection
]);

const PERMANENT_MESSAGE_MARKERS = [
  'does not exist in tenant org config',
  'is not permitted in tenant config',
  'invalid',
  'forbidden',
  'unauthorized',
  'unsupported action',
  'schema validation',
  'violates foreign key',
  'violates not-null',
];

const TRANSIENT_MESSAGE_MARKERS = [
  'timeout',
  'timed out',
  'temporarily unavailable',
  'econnreset',
  'econnrefused',
  'epipe',
  'etimedout',
  'connection terminated',
  'too many connections',
  'rate limit',
  '429',
  '503',
  'deadlock',
];

export function sanitizeEventError(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unexpected event processing error.';

  return raw
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, '[REDACTED_DSN]')
    .replace(/(password|secret|token|key)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .trim()
    .slice(0, 500) || 'Unexpected event processing error.';
}

export function classifyEventError(error: unknown): ErrorClassification {
  const sanitizedMessage = sanitizeEventError(error);

  if (error instanceof NonRetryableEventError) {
    return {
      retryable: false,
      reason: error.code,
      sanitizedMessage,
    };
  }

  if (error instanceof AuthorizationError) {
    return {
      retryable: false,
      reason: 'authorization_error',
      sanitizedMessage,
    };
  }

  if (error && typeof error === 'object') {
    const pgCode = (error as { code?: unknown }).code;
    if (typeof pgCode === 'string' && TRANSIENT_PG_CODES.has(pgCode)) {
      return {
        retryable: true,
        reason: `transient_pg_${pgCode}`,
        sanitizedMessage,
      };
    }
  }

  const lower = sanitizedMessage.toLowerCase();
  if (PERMANENT_MESSAGE_MARKERS.some((marker) => lower.includes(marker))) {
    return {
      retryable: false,
      reason: 'permanent_validation_or_config_error',
      sanitizedMessage,
    };
  }

  if (
    isRetryableAutomationError(error) ||
    TRANSIENT_MESSAGE_MARKERS.some((marker) => lower.includes(marker))
  ) {
    return {
      retryable: true,
      reason: 'transient_infrastructure_error',
      sanitizedMessage,
    };
  }

  return {
    retryable: true,
    reason: 'unknown_transient_error',
    sanitizedMessage,
  };
}

export function computeRetryBackoffMs(
  attempt: number,
  options: RetryBackoffOptions = {}
): number {
  const baseDelayMs = Math.max(100, options.baseDelayMs ?? 5_000);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 15 * 60_000);
  const jitterRatio = Math.min(0.5, Math.max(0, options.jitterRatio ?? 0.2));
  const randomFn = options.randomFn ?? Math.random;

  const exponent = Math.max(0, Math.min(16, attempt - 1));
  const rawDelay = Math.min(maxDelayMs, baseDelayMs * 2 ** exponent);
  const jitterFactor = 1 + (randomFn() * 2 - 1) * jitterRatio;
  return Math.max(50, Math.min(maxDelayMs, Math.round(rawDelay * jitterFactor)));
}

export function computeNextAttemptDate(
  attempt: number,
  now = new Date(),
  options?: RetryBackoffOptions
): Date {
  return new Date(now.getTime() + computeRetryBackoffMs(attempt, options));
}
