import test from 'node:test';
import assert from 'node:assert/strict';
import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { closePool, db } from '../../db/index.ts';
import {
  externalIdMappings,
  integrationConnections,
  tenants,
} from '../../db/schema.ts';
import {
  HttpCentralCrmAdapter,
} from '../adapters/central-crm-http.ts';
import {
  HttpClientCrmAdapter,
  UnconfiguredEcosystemAdapterError,
} from '../adapters/client-crm-http.ts';
import { NonRetryableEventError } from '../events/retry-policy.ts';
import {
  SafeIntegrationHttpClient,
  validateOutboundDestination,
} from './http-client.ts';
import { EnvDevOnlySecretStore } from './secret-store.ts';

let mockServer: Server;
let mockBaseUrl = '';
let testTenantId = 0;
let activeConnectionId = 0;

let capturedRequests: Array<{
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown> | null;
}> = [];

let serverBehavior:
  | 'ok'
  | 'redirect'
  | 'slow'
  | 'flaky_503_then_ok'
  | 'permanent_400' = 'ok';
let flakyAttempts = 0;

test.before(async () => {
  mockServer = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const rawText = Buffer.concat(chunks).toString('utf8');
      const parsedBody = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : null;
      capturedRequests.push({
        method: req.method || 'GET',
        url: req.url || '/',
        headers: req.headers,
        body: parsedBody,
      });

      if (serverBehavior === 'redirect') {
        res.statusCode = 302;
        res.setHeader('Location', 'https://evil.example/steal');
        res.end();
        return;
      }

      if (serverBehavior === 'slow') {
        setTimeout(() => {
          if (!res.writableEnded) {
            res.statusCode = 200;
            res.end(JSON.stringify({ externalCrmRef: 'TOO-LATE' }));
          }
        }, 400);
        return;
      }

      if (serverBehavior === 'flaky_503_then_ok') {
        flakyAttempts += 1;
        if (flakyAttempts < 2) {
          res.statusCode = 503;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'temporary outage' }));
          return;
        }
      }

      if (serverBehavior === 'permanent_400') {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'bad request' }));
        return;
      }

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      if (req.url?.includes('/leads/intake')) {
        res.end(
          JSON.stringify({
            externalCrmRef: `CCRM-LEAD-${parsedBody?.leadIntakeId ?? 1}`,
            syncedAt: '2026-11-16T10:00:00.000Z',
          })
        );
        return;
      }
      if (req.url?.includes('/status')) {
        res.end(JSON.stringify({ active: true }));
        return;
      }
      res.end(JSON.stringify({ memberships: [] }));
    });
  });

  await new Promise<void>((resolve) => {
    mockServer.listen(0, '127.0.0.1', () => {
      const addr = mockServer.address() as AddressInfo;
      mockBaseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });

  const suffix = randomUUID().slice(0, 8);
  const [tenant] = await db
    .insert(tenants)
    .values({
      slug: `test-http-adapter-${suffix}`,
      name: `HTTP Adapter Test Tenant (${suffix})`,
    })
    .returning();
  testTenantId = tenant!.id;

  const [conn] = await db
    .insert(integrationConnections)
    .values({
      tenantId: testTenantId,
      providerId: 'client_crm',
      connectionName: 'Client CRM Mock Server Conn',
      status: 'active',
      authMode: 'service_jwt',
      secretRef: {
        provider: 'env_dev_only',
        secretName: 'CLIENT_CRM_TEST_BEARER',
        version: '1',
      },
      allowedScopes: ['leads:write', 'leads:read'],
      config: { baseUrl: mockBaseUrl },
      environment: 'development',
      approvedByUid: 'test:admin',
      approvedAt: new Date(),
    })
    .returning();
  activeConnectionId = conn!.id;

  await db.insert(integrationConnections).values({
    tenantId: testTenantId,
    providerId: 'central_crm',
    connectionName: 'Central CRM Mock Server Conn',
    status: 'active',
    authMode: 'service_jwt',
    secretRef: {
      provider: 'env_dev_only',
      secretName: 'CENTRAL_CRM_TEST_BEARER',
      version: '1',
    },
    allowedScopes: ['memberships:read', 'tenants:read'],
    config: { baseUrl: mockBaseUrl },
    environment: 'development',
    approvedByUid: 'test:admin',
    approvedAt: new Date(),
  });
});

test.after(async () => {
  await new Promise<void>((resolve) => mockServer.close(() => resolve()));
  if (testTenantId > 0) {
    await db.delete(tenants).where(eq(tenants.id, testTenantId));
  }
  await closePool();
});

test('SafeIntegrationHttpClient enforces destination allowlists, HTTPS in prod, no redirects, timeouts, and secret-free logs', async () => {
  // 1. Arbitrary URL rejected
  assert.throws(
    () =>
      validateOutboundDestination('https://evil-unapproved.example/api', {
        allowedHosts: ['127.0.0.1'],
        nodeEnv: 'development',
      }),
    /not in the approved provider allowlist/
  );

  // 2. HTTP rejected in production even for localhost
  assert.throws(
    () =>
      validateOutboundDestination('http://127.0.0.1:8080/api', {
        allowedHosts: ['127.0.0.1'],
        nodeEnv: 'production',
        allowInsecureLocalhost: true,
      }),
    /HTTPS is required/
  );

  const secretValue = 'super_secret_bearer_token_do_not_log_12345';
  const secretStore = new EnvDevOnlySecretStore({
    nodeEnv: 'test',
    overrides: {
      CLIENT_CRM_TEST_BEARER: secretValue,
      CENTRAL_CRM_TEST_BEARER: secretValue,
    },
  });

  const client = new SafeIntegrationHttpClient({
    providerId: 'client_crm',
    baseUrl: mockBaseUrl,
    allowedHosts: ['127.0.0.1'],
    allowInsecureLocalhost: true,
    nodeEnv: 'test',
    timeoutMs: 120,
    maxRetries: 2,
    backoffOptions: { baseDelayMs: 5, maxDelayMs: 15, jitterRatio: 0 },
    secretStore,
  });

  // 3. Redirects are disabled
  serverBehavior = 'redirect';
  await assert.rejects(
    client.requestJson({
      method: 'GET',
      path: '/v1/ping',
      tenantId: testTenantId,
      secretRef: {
        provider: 'env_dev_only',
        secretName: 'CLIENT_CRM_TEST_BEARER',
        version: '1',
      },
    }),
    /redirects are disabled/
  );

  // 4. Timeout + Abort works cleanly
  serverBehavior = 'slow';
  await assert.rejects(
    client.requestJson({
      method: 'GET',
      path: '/v1/slow',
      tenantId: testTenantId,
    }),
    /timed out/
  );

  // 5. Permanent 400 does NOT retry indefinitely (only 1 attempt)
  capturedRequests = [];
  serverBehavior = 'permanent_400';
  await assert.rejects(
    client.requestJson({
      method: 'POST',
      path: '/v1/leads/intake',
      tenantId: testTenantId,
      idempotencyKey: 'perm-key-1',
      body: { applicantName: 'Permanent Error Test' },
      egressPolicy: {
        maxAllowedClassification: 'confidential',
        approvedFieldAllowlist: ['applicantName'],
        purpose: 'test',
        hasPermission: true,
        providerApproved: true,
      },
    }),
    (err: unknown) => err instanceof NonRetryableEventError && err.code === 'HTTP_400_PERMANENT'
  );
  assert.equal(capturedRequests.length, 1);

  // 6. Retryable 503 retries boundedly and keeps Idempotency-Key & X-Correlation-Id stable, without logging secrets
  capturedRequests = [];
  flakyAttempts = 0;
  serverBehavior = 'flaky_503_then_ok';
  const loggedLines: string[] = [];
  const origInfo = console.info;
  const origWarn = console.warn;
  console.info = (msg: unknown) => loggedLines.push(String(msg));
  console.warn = (msg: unknown) => loggedLines.push(String(msg));
  try {
    const res = await client.requestJson<{ externalCrmRef: string }>({
      method: 'POST',
      path: '/v1/leads/intake',
      tenantId: testTenantId,
      correlationId: 'corr-fixed-999',
      idempotencyKey: 'idem-fixed-999',
      secretRef: {
        provider: 'env_dev_only',
        secretName: 'CLIENT_CRM_TEST_BEARER',
        version: '1',
      },
      body: {
        applicantName: 'Retry Test',
        aadhaar_number: '9999-8888-7777',
      },
      egressPolicy: {
        maxAllowedClassification: 'confidential',
        approvedFieldAllowlist: ['applicantName'],
        purpose: 'test',
        hasPermission: true,
        providerApproved: true,
      },
    });
    assert.equal(res.attempts, 2);
    assert.equal(capturedRequests.length, 2);
    assert.equal(capturedRequests[0]?.headers['idempotency-key'], 'idem-fixed-999');
    assert.equal(capturedRequests[1]?.headers['idempotency-key'], 'idem-fixed-999');
    assert.equal(capturedRequests[0]?.headers['x-correlation-id'], 'corr-fixed-999');
    assert.equal(capturedRequests[1]?.headers['x-correlation-id'], 'corr-fixed-999');
    assert.equal(capturedRequests[0]?.body?.aadhaar_number, undefined);
    assert.equal(
      loggedLines.some((line) => line.includes(secretValue)),
      false
    );
  } finally {
    console.info = origInfo;
    console.warn = origWarn;
  }
});

test('HttpClientCrmAdapter and HttpCentralCrmAdapter report unconfigured status cleanly and persist external_id_mappings only on confirmed 2xx', async () => {
  // 1. Default unconfigured adapters report blocked_pending_api_contract and throw clearly
  const unconfiguredClient = new HttpClientCrmAdapter();
  const unconfiguredCentral = new HttpCentralCrmAdapter();
  assert.equal(unconfiguredClient.getStatusSummary().contractStatus, 'blocked_pending_api_contract');
  assert.equal(unconfiguredCentral.getStatusSummary().contractStatus, 'blocked_pending_api_contract');

  await assert.rejects(
    unconfiguredClient.syncLeadIntake({
      tenantId: testTenantId,
      leadIntakeId: 500,
      applicantName: 'Blocked',
      productInterest: 'Home Loan',
    }),
    (err: unknown) => err instanceof UnconfiguredEcosystemAdapterError
  );
  await assert.rejects(
    unconfiguredCentral.isTenantActive(testTenantId),
    (err: unknown) => err instanceof UnconfiguredEcosystemAdapterError
  );

  // 2. Contract-configured adapter against local mock HTTP server fails cleanly on 400 WITHOUT writing mapping
  const secretStore = new EnvDevOnlySecretStore({
    nodeEnv: 'test',
    overrides: {
      CLIENT_CRM_TEST_BEARER: 'client_bearer_test',
      CENTRAL_CRM_TEST_BEARER: 'central_bearer_test',
    },
  });

  const configuredClient = new HttpClientCrmAdapter({
    secretStore,
    nodeEnv: 'test',
    endpointConfig: {
      contractConfirmed: true,
      baseUrl: mockBaseUrl,
      allowedHosts: ['127.0.0.1'],
      leadIntakePath: '/v1/leads/intake',
      allowInsecureLocalhost: true,
      timeoutMs: 1000,
      maxRetries: 1,
      backoffOptions: { baseDelayMs: 5, maxDelayMs: 10, jitterRatio: 0 },
    },
  });

  serverBehavior = 'permanent_400';
  await assert.rejects(
    configuredClient.syncLeadIntake({
      tenantId: testTenantId,
      leadIntakeId: 777,
      applicantName: 'Failed Sync Lead',
      productInterest: 'Business Loan',
      connectionId: activeConnectionId,
    })
  );

  const mappingsAfterFail = await db
    .select()
    .from(externalIdMappings)
    .where(eq(externalIdMappings.tenantId, testTenantId));
  assert.equal(mappingsAfterFail.length, 0);

  // 3. Confirmed 200 success strips restricted fields & persists external_id_mappings
  serverBehavior = 'ok';
  capturedRequests = [];
  const syncResult = await configuredClient.syncLeadIntake({
    tenantId: testTenantId,
    leadIntakeId: 777,
    applicantName: 'Confirmed Sync Lead',
    productInterest: 'Home Loan',
    connectionId: activeConnectionId,
    extraFields: { pan_number: 'ABCDE1234F', bank_account: '1234567890' },
  });

  assert.equal(syncResult.mode, 'live_api');
  assert.equal(syncResult.externalCrmRef, 'CCRM-LEAD-777');
  assert.equal(capturedRequests[0]?.body?.pan_number, undefined);
  assert.equal(capturedRequests[0]?.body?.bank_account, undefined);

  const mappingsAfterSuccess = await db
    .select()
    .from(externalIdMappings)
    .where(eq(externalIdMappings.tenantId, testTenantId));
  assert.equal(mappingsAfterSuccess.length, 1);
  assert.equal(mappingsAfterSuccess[0]?.externalEntityId, 'CCRM-LEAD-777');

  const configuredCentral = new HttpCentralCrmAdapter({
    secretStore,
    nodeEnv: 'test',
    endpointConfig: {
      contractConfirmed: true,
      baseUrl: mockBaseUrl,
      allowedHosts: ['127.0.0.1'],
      tenantStatusPathTemplate: '/v1/tenants/{tenantId}/status',
      allowInsecureLocalhost: true,
      timeoutMs: 1000,
    },
  });
  const activeFlag = await configuredCentral.isTenantActive(testTenantId);
  assert.equal(activeFlag, true);
});
