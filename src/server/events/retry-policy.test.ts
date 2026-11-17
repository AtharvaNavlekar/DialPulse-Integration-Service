import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthorizationError } from '../middleware/tenant-guard.ts';
import {
  MAX_EVENT_ATTEMPTS,
  NonRetryableEventError,
  classifyEventError,
  computeRetryBackoffMs,
  sanitizeEventError,
} from './retry-policy.ts';
import { loadEventWorkerConfig } from './worker-config.ts';

test('classifies transient vs permanent errors accurately', () => {
  assert.equal(MAX_EVENT_ATTEMPTS, 5);

  const nonRetryable = classifyEventError(
    new NonRetryableEventError('Configured employee "emp-x" does not exist in tenant org config.')
  );
  assert.equal(nonRetryable.retryable, false);

  const authErr = classifyEventError(new AuthorizationError(403, 'Tenant suspended'));
  assert.equal(authErr.retryable, false);

  const pgDeadlock = classifyEventError(Object.assign(new Error('deadlock detected'), { code: '40P01' }));
  assert.equal(pgDeadlock.retryable, true);
  assert.equal(pgDeadlock.reason, 'transient_pg_40P01');

  const timeoutErr = classifyEventError(new Error('Database timeout ECONNRESET'));
  assert.equal(timeoutErr.retryable, true);
});

test('sanitizes Bearer tokens, DSNs, and secrets out of persisted errors', () => {
  const sanitized = sanitizeEventError(
    new Error(
      'Request failed with Bearer eyJhbGci.secret.sig connecting to postgresql://admin:superpass@10.0.0.1:5432/db token=abc123'
    )
  );
  assert.equal(sanitized.includes('eyJhbGci'), false);
  assert.equal(sanitized.includes('superpass'), false);
  assert.equal(sanitized.includes('abc123'), false);
  assert.equal(sanitized.includes('[REDACTED]'), true);
  assert.equal(sanitized.includes('[REDACTED_DSN]'), true);
});

test('computes bounded exponential backoff with jitter', () => {
  const d1 = computeRetryBackoffMs(1, {
    baseDelayMs: 1000,
    maxDelayMs: 10000,
    jitterRatio: 0,
  });
  const d2 = computeRetryBackoffMs(2, {
    baseDelayMs: 1000,
    maxDelayMs: 10000,
    jitterRatio: 0,
  });
  const d5 = computeRetryBackoffMs(5, {
    baseDelayMs: 1000,
    maxDelayMs: 10000,
    jitterRatio: 0,
  });

  assert.equal(d1, 1000);
  assert.equal(d2, 2000);
  assert.equal(d5, 10000);
});

test('validates worker env config and disables worker by default in NODE_ENV=test', () => {
  const testCfg = loadEventWorkerConfig({ NODE_ENV: 'test' });
  assert.equal(testCfg.enabled, false);
  assert.equal(testCfg.maxConcurrency, 3);

  const devCfg = loadEventWorkerConfig({
    NODE_ENV: 'development',
    EVENT_WORKER_ENABLED: 'true',
    EVENT_WORKER_BATCH_SIZE: '25',
    EVENT_WORKER_MAX_CONCURRENCY: '4',
  });
  assert.equal(devCfg.enabled, true);
  assert.equal(devCfg.batchSize, 25);
  assert.equal(devCfg.maxConcurrency, 4);

  assert.throws(
    () => loadEventWorkerConfig({ EVENT_WORKER_POLL_INTERVAL_MS: '10' }),
    /Invalid event worker configuration/
  );
});
