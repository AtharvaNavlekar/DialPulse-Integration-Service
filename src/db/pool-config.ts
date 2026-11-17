export const DEFAULT_SQL_POOL_CONFIG = {
  max: 10,
  connectionTimeoutMillis: 15_000,
  idleTimeoutMillis: 15_000,
  maxLifetimeSeconds: 1800,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
} as const;

const TRANSIENT_SQLSTATE_CODES = new Set([
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '08003', // connection_does_not_exist
  '08006', // connection_failure
]);

const TRANSIENT_SYSTEM_CODES = new Set([
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ENETUNREACH',
  'EHOSTUNREACH',
]);

const TRANSIENT_MESSAGE_PATTERNS = [
  /connection terminated unexpectedly/i,
  /connection ended unexpectedly/i,
  /server closed the connection unexpectedly/i,
  /terminating connection due to administrator command/i,
  /connection reset by peer/i,
  /socket hang up/i,
  /client has encountered a connection error and is not queryable/i,
];

export function isTransientIdlePoolError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const errObj = error as { code?: unknown; message?: unknown; cause?: unknown };
  const code = typeof errObj.code === 'string' ? errObj.code.toUpperCase() : '';
  if (TRANSIENT_SQLSTATE_CODES.has(code) || TRANSIENT_SYSTEM_CODES.has(code)) {
    return true;
  }

  const message = typeof errObj.message === 'string' ? errObj.message : '';
  if (TRANSIENT_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))) {
    return true;
  }

  if (errObj.cause && errObj.cause !== error) {
    return isTransientIdlePoolError(errObj.cause);
  }

  return false;
}

export interface PoolErrorLogger {
  info: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export function handleIdlePoolError(
  error: unknown,
  logger: PoolErrorLogger = console
): 'transient_recycled' | 'unexpected_error' {
  const message = error instanceof Error ? error.message : String(error);
  if (isTransientIdlePoolError(error)) {
    logger.info(
      `SQL pool recycled idle client after transient disconnect: ${message}`
    );
    return 'transient_recycled';
  }

  logger.error('Unexpected error on idle SQL pool client:', message);
  return 'unexpected_error';
}
