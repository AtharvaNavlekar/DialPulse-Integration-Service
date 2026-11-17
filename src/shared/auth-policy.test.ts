import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDemoProvisioningPolicy } from './auth-policy.ts';

test('denies demo provisioning in production even when flag is disabled', () => {
  const res = evaluateDemoProvisioningPolicy({
    nodeEnv: 'production',
    demoProvisioningFlag: 'false',
  });
  assert.equal(res.allowed, false);
});

test('denies demo provisioning in production even when flag is accidentally enabled', () => {
  const res = evaluateDemoProvisioningPolicy({
    nodeEnv: 'production',
    demoProvisioningFlag: 'true',
  });
  assert.equal(res.allowed, false);
  assert.match(res.reason, /production/i);
});

test('denies demo provisioning in development when flag is omitted or false', () => {
  assert.equal(
    evaluateDemoProvisioningPolicy({ nodeEnv: 'development' }).allowed,
    false
  );
  assert.equal(
    evaluateDemoProvisioningPolicy({
      nodeEnv: 'development',
      demoProvisioningFlag: 'false',
    }).allowed,
    false
  );
  assert.equal(
    evaluateDemoProvisioningPolicy({
      nodeEnv: 'development',
      demoProvisioningFlag: '1',
    }).allowed,
    false
  );
});

test('allows demo provisioning only in non-production when flag is explicitly true', () => {
  const res = evaluateDemoProvisioningPolicy({
    nodeEnv: 'development',
    demoProvisioningFlag: 'true',
  });
  assert.equal(res.allowed, true);
});
