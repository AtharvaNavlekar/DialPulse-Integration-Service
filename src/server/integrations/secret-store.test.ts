import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CompositeSecretStore,
  EnvDevOnlySecretStore,
  GoogleSecretManagerSecretStore,
  SecretResolutionError,
  getSecretStorageStatus,
  parseProjectAllowlist,
  resolveGcpSecretVersionPath,
  type SecretManagerClientLike,
} from './secret-store.ts';

test('parseProjectAllowlist filters invalid project IDs and deduplicates', () => {
  assert.deepEqual(parseProjectAllowlist(undefined), []);
  assert.deepEqual(parseProjectAllowlist(''), []);
  assert.deepEqual(
    parseProjectAllowlist(
      'dialpulse-prod-01, INVALID_UPPER, dialpulse-prod-01, dialpulse-staging'
    ),
    ['dialpulse-prod-01', 'dialpulse-staging']
  );
});

test('resolveGcpSecretVersionPath validates allowlist, paths, and versions fail-closed', () => {
  assert.throws(
    () =>
      resolveGcpSecretVersionPath(
        {
          provider: 'gcp_secret_manager',
          secretName: 'projects/dialpulse-prod/secrets/client-crm-whsec',
          version: 'latest',
        },
        []
      ),
    (err: unknown) =>
      err instanceof SecretResolutionError &&
      err.code === 'SECRET_STORE_UNCONFIGURED'
  );

  assert.throws(
    () =>
      resolveGcpSecretVersionPath(
        {
          provider: 'gcp_secret_manager',
          secretName: 'projects/rogue-project-99/secrets/client-crm-whsec',
          version: 'latest',
        },
        ['dialpulse-prod']
      ),
    (err: unknown) =>
      err instanceof SecretResolutionError && err.code === 'SECRET_ACCESS_DENIED'
  );

  assert.throws(
    () =>
      resolveGcpSecretVersionPath(
        {
          provider: 'gcp_secret_manager',
          secretName: 'client-crm-whsec',
          version: 'latest',
        },
        ['dialpulse-prod', 'dialpulse-staging']
      ),
    (err: unknown) =>
      err instanceof SecretResolutionError &&
      err.code === 'INVALID_SECRET_REFERENCE'
  );

  assert.throws(
    () =>
      resolveGcpSecretVersionPath(
        {
          provider: 'gcp_secret_manager',
          secretName: 'client-crm-whsec',
          version: '0',
        },
        ['dialpulse-prod']
      ),
    (err: unknown) =>
      err instanceof SecretResolutionError &&
      err.code === 'INVALID_SECRET_REFERENCE'
  );

  assert.deepEqual(
    resolveGcpSecretVersionPath(
      {
        provider: 'gcp_secret_manager',
        secretName: 'client-crm-whsec',
        version: '3',
      },
      ['dialpulse-prod']
    ),
    {
      projectId: 'dialpulse-prod',
      secretId: 'client-crm-whsec',
      version: '3',
      resourceName: 'projects/dialpulse-prod/secrets/client-crm-whsec/versions/3',
    }
  );
});

test('GoogleSecretManagerSecretStore resolves Uint8Array and string payloads and maps gRPC errors accurately', async () => {
  const seenNames: string[] = [];
  const mockClient: SecretManagerClientLike = {
    async accessSecretVersion({ name }) {
      seenNames.push(name);
      if (name.endsWith('/versions/1')) {
        return [{ payload: { data: Buffer.from('  whsec_gcp_byte_secret_1  ', 'utf8') } }];
      }
      if (name.endsWith('/versions/2')) {
        return [{ payload: { data: 'whsec_gcp_string_secret_2' } }];
      }
      if (name.endsWith('/versions/3')) {
        return [{ payload: { data: Buffer.from('   ', 'utf8') } }];
      }
      if (name.includes('missing-secret')) {
        const err = Object.assign(new Error('NOT_FOUND'), { code: 5 });
        throw err;
      }
      if (name.includes('denied-secret')) {
        const err = Object.assign(new Error('PERMISSION_DENIED'), { code: 7 });
        throw err;
      }
      throw new Error('Network unreachable');
    },
  };

  const store = new GoogleSecretManagerSecretStore({
    client: mockClient,
    projectAllowlist: ['dialpulse-prod'],
  });

  const val1 = await store.resolveSecret({
    provider: 'gcp_secret_manager',
    secretName: 'projects/dialpulse-prod/secrets/client-crm-whsec',
    version: '1',
  });
  assert.equal(val1, 'whsec_gcp_byte_secret_1');

  const val2 = await store.resolveSecret({
    provider: 'gcp_secret_manager',
    secretName: 'client-crm-whsec',
    version: '2',
  });
  assert.equal(val2, 'whsec_gcp_string_secret_2');
  assert.deepEqual(seenNames, [
    'projects/dialpulse-prod/secrets/client-crm-whsec/versions/1',
    'projects/dialpulse-prod/secrets/client-crm-whsec/versions/2',
  ]);

  await assert.rejects(
    store.resolveSecret({
      provider: 'gcp_secret_manager',
      secretName: 'client-crm-whsec',
      version: '3',
    }),
    (err: unknown) =>
      err instanceof SecretResolutionError && err.code === 'SECRET_NOT_FOUND'
  );

  await assert.rejects(
    store.resolveSecret({
      provider: 'gcp_secret_manager',
      secretName: 'missing-secret',
      version: 'latest',
    }),
    (err: unknown) =>
      err instanceof SecretResolutionError && err.code === 'SECRET_NOT_FOUND'
  );

  await assert.rejects(
    store.resolveSecret({
      provider: 'gcp_secret_manager',
      secretName: 'denied-secret',
      version: 'latest',
    }),
    (err: unknown) =>
      err instanceof SecretResolutionError && err.code === 'SECRET_ACCESS_DENIED'
  );

  await assert.rejects(
    store.resolveSecret({
      provider: 'gcp_secret_manager',
      secretName: 'transient-secret',
      version: 'latest',
    }),
    (err: unknown) =>
      err instanceof SecretResolutionError &&
      err.code === 'SECRET_STORE_UNCONFIGURED'
  );
});

test('EnvDevOnlySecretStore blocks production usage and CompositeSecretStore routes by provider', async () => {
  const prodEnvStore = new EnvDevOnlySecretStore({
    nodeEnv: 'production',
    overrides: { DEV_KEY: 'should-fail' },
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

  const devEnvStore = new EnvDevOnlySecretStore({
    nodeEnv: 'development',
    overrides: { DEV_KEY: 'dev_secret_value' },
  });
  const gcpStore = new GoogleSecretManagerSecretStore({
    projectAllowlist: ['dialpulse-prod'],
    client: {
      async accessSecretVersion() {
        return [{ payload: { data: 'gcp_secret_value' } }];
      },
    },
  });

  const composite = new CompositeSecretStore({
    envDevStore: devEnvStore,
    gcpStore,
  });

  assert.equal(
    await composite.resolveSecret({
      provider: 'env_dev_only',
      secretName: 'DEV_KEY',
      version: '1',
    }),
    'dev_secret_value'
  );
  assert.equal(
    await composite.resolveSecret({
      provider: 'gcp_secret_manager',
      secretName: 'projects/dialpulse-prod/secrets/web-whsec',
      version: 'latest',
    }),
    'gcp_secret_value'
  );
});

test('getSecretStorageStatus reports honest readiness across dev, allowlist-configured, and unconfigured production', () => {
  const devStatus = getSecretStorageStatus({
    nodeEnv: 'development',
    allowlistRaw: '',
  });
  assert.equal(devStatus.gcpSdkInstalled, true);
  assert.equal(devStatus.runtimeMode, 'development_env_fallback');
  assert.equal(devStatus.envDevOnlyAllowed, true);
  assert.ok(devStatus.blockerReason?.includes('GCP_SECRET_MANAGER_PROJECT_ALLOWLIST'));

  const gcpConfigured = getSecretStorageStatus({
    nodeEnv: 'production',
    allowlistRaw: 'dialpulse-prod-01',
  });
  assert.equal(gcpConfigured.runtimeMode, 'gcp_allowlist_configured_iam_unverified');
  assert.equal(gcpConfigured.envDevOnlyAllowed, false);
  assert.deepEqual(gcpConfigured.gcpProjectAllowlist, ['dialpulse-prod-01']);

  const prodBlocked = getSecretStorageStatus({
    nodeEnv: 'production',
    allowlistRaw: '',
  });
  assert.equal(prodBlocked.runtimeMode, 'blocked_in_production_unconfigured');
  assert.equal(prodBlocked.envDevOnlyAllowed, false);
});
