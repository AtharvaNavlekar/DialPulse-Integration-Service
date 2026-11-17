import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertNonSensitiveConfig,
  CompositeSecretStore,
  EnvDevOnlySecretStore,
  SecretResolutionError,
  UnconfiguredGcpSecretManagerStore,
} from './secret-store.ts';
import {
  computeWebhookHmacSignature,
  DialPulseHmacSha256Verifier,
  getWebhookVerifier,
  sanitizeInboundWebhookData,
} from './webhook-verifier.ts';

test('HMAC-SHA256 verifier accepts valid raw-body signatures and rejects tampered, malformed, or stale requests', async () => {
  const secretStore = new EnvDevOnlySecretStore({
    nodeEnv: 'test',
    overrides: { TEST_WEBHOOK_SECRET: 'whsec_synthetic_test_key_99887766' },
  });
  let fixedNow = 1_760_000_000;
  const verifier = new DialPulseHmacSha256Verifier('dialpulse_web', {
    secretStore,
    nowFn: () => fixedNow,
  });

  const rawBody = Buffer.from(
    '{"eventType":"web_enquiry_submitted","data":{"full_name":"Aarav Test"}}',
    'utf8'
  );
  const sig = computeWebhookHmacSignature(
    'whsec_synthetic_test_key_99887766',
    fixedNow - 10,
    rawBody
  );

  // 1. Valid request passes
  const validResult = await verifier.verify({
    rawBody,
    headers: {
      'x-dialpulse-signature': sig,
      'x-dialpulse-timestamp': String(fixedNow - 10),
      'x-dialpulse-event-id': 'evt_web_1001',
    },
    secretRef: {
      provider: 'env_dev_only',
      secretName: 'TEST_WEBHOOK_SECRET',
      version: '1',
    },
    maxReplayWindowSeconds: 300,
  });
  assert.equal(validResult.verified, true);
  assert.equal(validResult.outcome, 'verified');
  assert.equal(validResult.providerEventId, 'evt_web_1001');

  // 2. Modified raw bytes (single extra space) fails even with identical parsed JSON
  const mutatedRawBody = Buffer.from(
    '{ "eventType":"web_enquiry_submitted","data":{"full_name":"Aarav Test"}}',
    'utf8'
  );
  const tamperedResult = await verifier.verify({
    rawBody: mutatedRawBody,
    headers: {
      'x-dialpulse-signature': sig,
      'x-dialpulse-timestamp': String(fixedNow - 10),
    },
    secretRef: {
      provider: 'env_dev_only',
      secretName: 'TEST_WEBHOOK_SECRET',
      version: '1',
    },
    maxReplayWindowSeconds: 300,
  });
  assert.equal(tamperedResult.verified, false);
  assert.equal(tamperedResult.outcome, 'invalid_signature');

  // 3. Missing signature fails
  const missingResult = await verifier.verify({
    rawBody,
    headers: { 'x-dialpulse-timestamp': String(fixedNow) },
    secretRef: {
      provider: 'env_dev_only',
      secretName: 'TEST_WEBHOOK_SECRET',
      version: '1',
    },
    maxReplayWindowSeconds: 300,
  });
  assert.equal(missingResult.verified, false);
  assert.equal(missingResult.outcome, 'malformed_signature');

  // 4. Algorithm downgrade / malformed encoding fails
  const downgradeResult = await verifier.verify({
    rawBody,
    headers: {
      'x-dialpulse-signature': 'sha1=deadbeef',
      'x-dialpulse-timestamp': String(fixedNow - 5),
    },
    secretRef: {
      provider: 'env_dev_only',
      secretName: 'TEST_WEBHOOK_SECRET',
      version: '1',
    },
    maxReplayWindowSeconds: 300,
  });
  assert.equal(downgradeResult.verified, false);
  assert.equal(downgradeResult.outcome, 'malformed_signature');

  // 5. Expired timestamp (> 300s) fails
  const staleTs = fixedNow - 301;
  const staleSig = computeWebhookHmacSignature(
    'whsec_synthetic_test_key_99887766',
    staleTs,
    rawBody
  );
  const expiredResult = await verifier.verify({
    rawBody,
    headers: {
      'x-dialpulse-signature': staleSig,
      'x-dialpulse-timestamp': String(staleTs),
    },
    secretRef: {
      provider: 'env_dev_only',
      secretName: 'TEST_WEBHOOK_SECRET',
      version: '1',
    },
    maxReplayWindowSeconds: 300,
  });
  assert.equal(expiredResult.verified, false);
  assert.equal(expiredResult.outcome, 'expired_timestamp');

  // 6. Unverified/planned provider returns null verifier
  assert.equal(getWebhookVerifier('voice_telephony_approved'), null);
});

test('SecretStore enforces fail-closed production guards and config sanitizer blocks credential literals', async () => {
  const prodEnvStore = new EnvDevOnlySecretStore({
    nodeEnv: 'production',
    overrides: { DEV_KEY: 'should_not_resolve' },
  });
  await assert.rejects(
    prodEnvStore.resolveSecret({
      provider: 'env_dev_only',
      secretName: 'DEV_KEY',
      version: '1',
    }),
    (err: unknown) =>
      err instanceof SecretResolutionError &&
      err.code === 'SECRET_ENV_DISALLOWED_IN_PROD'
  );

  const composite = new CompositeSecretStore({
    gcpStore: new UnconfiguredGcpSecretManagerStore(),
  });
  await assert.rejects(
    composite.resolveSecret({
      provider: 'gcp_secret_manager',
      secretName: 'projects/demo/secrets/crm',
      version: '1',
    }),
    (err: unknown) =>
      err instanceof SecretResolutionError &&
      err.code === 'SECRET_STORE_UNCONFIGURED'
  );

  assert.throws(
    () => assertNonSensitiveConfig({ baseUrl: 'https://crm.example', apiKey: 'raw-key' }),
    /sensitive credential/
  );
  assert.throws(
    () =>
      assertNonSensitiveConfig({
        endpoint: 'postgresql://user:pass@localhost:5432/db',
      }),
    /credential or DSN literal/
  );

  const restrictedCheck = sanitizeInboundWebhookData('dialpulse_web', {
    full_name: 'Demo User',
    aadhaar_number: '1234-5678-9012',
  });
  assert.equal(restrictedCheck.allowed, false);

  const allowlistCheck = sanitizeInboundWebhookData('dialpulse_web', {
    full_name: 'Demo User',
    loan_product: 'Home Loan',
    arbitrary_extra: 'strip_me',
  });
  assert.equal(allowlistCheck.allowed, true);
  assert.deepEqual(allowlistCheck.sanitizedData, {
    full_name: 'Demo User',
    loan_product: 'Home Loan',
  });
  assert.deepEqual(allowlistCheck.strippedKeys, ['arbitrary_extra']);
});
