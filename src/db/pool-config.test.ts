import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SQL_POOL_CONFIG,
  handleIdlePoolError,
  isTransientIdlePoolError,
} from './pool-config.ts';

test('DEFAULT_SQL_POOL_CONFIG enables TCP keepalive and bounded idle/lifetime recycling', () => {
  assert.equal(DEFAULT_SQL_POOL_CONFIG.keepAlive, true);
  assert.ok(DEFAULT_SQL_POOL_CONFIG.keepAliveInitialDelayMillis > 0);
  assert.ok(DEFAULT_SQL_POOL_CONFIG.idleTimeoutMillis > 0);
  assert.ok(DEFAULT_SQL_POOL_CONFIG.maxLifetimeSeconds > 0);
  assert.equal(DEFAULT_SQL_POOL_CONFIG.max, 10);
});

test('isTransientIdlePoolError detects Cloud SQL idle disconnects and transient network/admin codes', () => {
  assert.equal(
    isTransientIdlePoolError(new Error('Connection terminated unexpectedly')),
    true
  );
  assert.equal(
    isTransientIdlePoolError(
      Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })
    ),
    true
  );
  assert.equal(
    isTransientIdlePoolError(
      Object.assign(new Error('terminating connection due to administrator command'), {
        code: '57P01',
      })
    ),
    true
  );
  assert.equal(
    isTransientIdlePoolError(
      new Error('wrapped', {
        cause: new Error('Connection terminated unexpectedly'),
      })
    ),
    true
  );
});

test('isTransientIdlePoolError does not mask non-transient errors', () => {
  assert.equal(
    isTransientIdlePoolError(new Error('password authentication failed for user app')),
    false
  );
  assert.equal(
    isTransientIdlePoolError(
      Object.assign(new Error('permission denied for table forms'), { code: '42501' })
    ),
    false
  );
  assert.equal(isTransientIdlePoolError(null), false);
});

test('handleIdlePoolError routes transient disconnects to info without emitting console errors', () => {
  const infoCalls: unknown[][] = [];
  const errorCalls: unknown[][] = [];
  const logger = {
    info: (...args: unknown[]) => infoCalls.push(args),
    error: (...args: unknown[]) => errorCalls.push(args),
  };

  const transientOutcome = handleIdlePoolError(
    new Error('Connection terminated unexpectedly'),
    logger
  );
  assert.equal(transientOutcome, 'transient_recycled');
  assert.equal(infoCalls.length, 1);
  assert.equal(errorCalls.length, 0);

  const unexpectedOutcome = handleIdlePoolError(
    new Error('fatal protocol state corruption'),
    logger
  );
  assert.equal(unexpectedOutcome, 'unexpected_error');
  assert.equal(errorCalls.length, 1);
});
