import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { z } from 'zod';
import type { SecretReference, SecretStore } from './contracts.ts';

export class SecretResolutionError extends Error {
  readonly code:
    | 'SECRET_STORE_UNCONFIGURED'
    | 'SECRET_ENV_DISALLOWED_IN_PROD'
    | 'SECRET_NOT_FOUND'
    | 'INVALID_SECRET_REFERENCE'
    | 'SECRET_ACCESS_DENIED';

  constructor(
    code: SecretResolutionError['code'],
    message: string
  ) {
    super(message);
    this.name = 'SecretResolutionError';
    this.code = code;
  }
}

export const SecretReferenceSchema = z
  .object({
    provider: z.enum(['gcp_secret_manager', 'env_dev_only']),
    secretName: z
      .string()
      .trim()
      .min(3)
      .max(200)
      .regex(
        /^[A-Za-z0-9_./-]+$/,
        'Secret name must contain only alphanumeric, underscore, dot, hyphen, or slash characters.'
      )
      .refine(
        (v) => !v.includes('..') && !v.startsWith('/') && !v.endsWith('/'),
        'Secret name cannot contain path traversal or leading/trailing slashes.'
      ),
    version: z.string().trim().min(1).max(32).default('latest'),
  })
  .superRefine((val, ctx) => {
    if (val.provider === 'env_dev_only' && val.secretName.includes('/')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['secretName'],
        message: 'env_dev_only secret names cannot contain slashes.',
      });
    }
  });

const SENSITIVE_CONFIG_KEY_PATTERN =
  /secret|token|password|api_?key|private_?key|hmac_?key|passphrase|credential|dsn|connection_?string|auth_?header/i;

const SENSITIVE_CONFIG_VALUE_PATTERN =
  /^(Bearer\s+|postgres(?:ql)?:\/\/|-----BEGIN\s+)/i;

export function assertNonSensitiveConfig(
  config: Record<string, unknown>
): Record<string, unknown> {
  const visit = (obj: Record<string, unknown>, pathPrefix: string) => {
    for (const [key, value] of Object.entries(obj)) {
      const fullPath = pathPrefix ? `${pathPrefix}.${key}` : key;
      if (SENSITIVE_CONFIG_KEY_PATTERN.test(key)) {
        throw new Error(
          `Configuration field "${fullPath}" appears to contain a sensitive credential. Store secrets via SecretReference instead.`
        );
      }
      if (typeof value === 'string' && SENSITIVE_CONFIG_VALUE_PATTERN.test(value.trim())) {
        throw new Error(
          `Configuration field "${fullPath}" contains a credential or DSN literal. Store secrets via SecretReference instead.`
        );
      }
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        visit(value as Record<string, unknown>, fullPath);
      }
    }
  };

  visit(config, '');
  return config;
}

export function maskSecretReference(ref: SecretReference): SecretReference {
  return {
    provider: ref.provider,
    secretName: ref.secretName,
    version: ref.version || 'latest',
  };
}

/**
 * Explicit development/test SecretStore resolving `env_dev_only` references
 * from an explicit test override map or `process.env` in non-production only.
 * Permanently fails closed in `NODE_ENV=production`.
 */
export class EnvDevOnlySecretStore implements SecretStore {
  private readonly overrides: Map<string, string>;
  private readonly nodeEnv: string;

  constructor(options: {
    overrides?: Record<string, string>;
    nodeEnv?: string;
  } = {}) {
    this.overrides = new Map(Object.entries(options.overrides ?? {}));
    this.nodeEnv = (options.nodeEnv ?? process.env.NODE_ENV ?? 'development')
      .trim()
      .toLowerCase();
  }

  setTestSecret(secretName: string, value: string): void {
    if (this.nodeEnv === 'production') {
      throw new SecretResolutionError(
        'SECRET_ENV_DISALLOWED_IN_PROD',
        'In-memory or env_dev_only secrets cannot be configured in production.'
      );
    }
    this.overrides.set(secretName, value);
  }

  async resolveSecret(ref: SecretReference): Promise<string> {
    if (this.nodeEnv === 'production') {
      throw new SecretResolutionError(
        'SECRET_ENV_DISALLOWED_IN_PROD',
        'env_dev_only secret references are permanently disabled in production.'
      );
    }

    const parsed = SecretReferenceSchema.safeParse(ref);
    if (!parsed.success || parsed.data.provider !== 'env_dev_only') {
      throw new SecretResolutionError(
        'INVALID_SECRET_REFERENCE',
        'Invalid env_dev_only SecretReference.'
      );
    }

    const overrideVal = this.overrides.get(parsed.data.secretName);
    if (overrideVal && overrideVal.trim().length > 0) {
      return overrideVal.trim();
    }

    if (/^[A-Z0-9_]{3,80}$/.test(parsed.data.secretName)) {
      const envVal = process.env[parsed.data.secretName];
      if (envVal && envVal.trim().length > 0) {
        return envVal.trim();
      }
    }

    throw new SecretResolutionError(
      'SECRET_NOT_FOUND',
      `Development secret "${parsed.data.secretName}" is not configured.`
    );
  }
}

export interface SecretManagerClientLike {
  accessSecretVersion(request: {
    name: string;
  }): Promise<
    [{ payload?: { data?: Uint8Array | string | null } | null }, ...unknown[]]
  >;
}

const GCP_PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,29}$/;
const GCP_SECRET_ID_PATTERN = /^[A-Za-z0-9_-]{3,120}$/;
const GCP_FULL_SECRET_PATH_PATTERN =
  /^projects\/([a-z][a-z0-9-]{4,29})\/secrets\/([A-Za-z0-9_-]{3,120})$/;
const GCP_VERSION_PATTERN = /^(latest|[1-9][0-9]{0,9})$/;

export function parseProjectAllowlist(raw?: string): string[] {
  if (!raw || !raw.trim()) return [];
  return Array.from(
    new Set(
      raw
        .split(',')
        .map((part) => part.trim())
        .filter((part) => GCP_PROJECT_ID_PATTERN.test(part))
    )
  );
}

export function resolveGcpSecretVersionPath(
  ref: SecretReference,
  projectAllowlist: readonly string[]
): {
  projectId: string;
  secretId: string;
  version: string;
  resourceName: string;
} {
  if (projectAllowlist.length === 0) {
    throw new SecretResolutionError(
      'SECRET_STORE_UNCONFIGURED',
      'GCP Secret Manager project allowlist is not configured (set GCP_SECRET_MANAGER_PROJECT_ALLOWLIST).'
    );
  }

  const parsed = SecretReferenceSchema.safeParse(ref);
  if (!parsed.success || parsed.data.provider !== 'gcp_secret_manager') {
    throw new SecretResolutionError(
      'INVALID_SECRET_REFERENCE',
      'Invalid gcp_secret_manager SecretReference.'
    );
  }

  const version = parsed.data.version;
  if (!GCP_VERSION_PATTERN.test(version)) {
    throw new SecretResolutionError(
      'INVALID_SECRET_REFERENCE',
      'GCP Secret Manager version must be "latest" or a positive integer.'
    );
  }

  const secretName = parsed.data.secretName;
  const fullMatch = GCP_FULL_SECRET_PATH_PATTERN.exec(secretName);
  if (fullMatch) {
    const projectId = fullMatch[1]!;
    const secretId = fullMatch[2]!;
    if (!projectAllowlist.includes(projectId)) {
      throw new SecretResolutionError(
        'SECRET_ACCESS_DENIED',
        `GCP project "${projectId}" is not in the approved Secret Manager allowlist.`
      );
    }
    return {
      projectId,
      secretId,
      version,
      resourceName: `projects/${projectId}/secrets/${secretId}/versions/${version}`,
    };
  }

  if (GCP_SECRET_ID_PATTERN.test(secretName)) {
    if (projectAllowlist.length !== 1) {
      throw new SecretResolutionError(
        'INVALID_SECRET_REFERENCE',
        'Short secret names require a single allowlisted GCP project or full projects/<projectId>/secrets/<secretId> path.'
      );
    }
    const projectId = projectAllowlist[0]!;
    return {
      projectId,
      secretId: secretName,
      version,
      resourceName: `projects/${projectId}/secrets/${secretName}/versions/${version}`,
    };
  }

  throw new SecretResolutionError(
    'INVALID_SECRET_REFERENCE',
    'GCP Secret Manager secretName must be projects/<projectId>/secrets/<secretId> or a valid secret ID.'
  );
}

function extractGrpcStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const maybeCode = (error as { code?: unknown }).code;
  return typeof maybeCode === 'number' ? maybeCode : undefined;
}

/**
 * Production-ready GCP Secret Manager adapter using Application Default Credentials
 * and strict project-allowlist path validation. Fails closed on missing allowlist,
 * unauthorized project references, IAM denial, or missing/empty secret versions.
 * Never persists or logs resolved secret values.
 */
export class GoogleSecretManagerSecretStore implements SecretStore {
  private readonly projectAllowlist: string[];
  private client: SecretManagerClientLike | null;

  constructor(options: {
    client?: SecretManagerClientLike;
    projectAllowlist?: string[];
  } = {}) {
    this.client = options.client ?? null;
    this.projectAllowlist =
      options.projectAllowlist ??
      parseProjectAllowlist(process.env.GCP_SECRET_MANAGER_PROJECT_ALLOWLIST);
  }

  private getClient(): SecretManagerClientLike {
    if (!this.client) {
      this.client = new SecretManagerServiceClient();
    }
    return this.client;
  }

  async resolveSecret(ref: SecretReference): Promise<string> {
    const resolved = resolveGcpSecretVersionPath(ref, this.projectAllowlist);

    try {
      const [response] = await this.getClient().accessSecretVersion({
        name: resolved.resourceName,
      });
      const rawData = response?.payload?.data;
      let decoded = '';
      if (typeof rawData === 'string') {
        decoded = rawData;
      } else if (rawData instanceof Uint8Array) {
        decoded = Buffer.from(rawData).toString('utf8');
      }
      const trimmed = decoded.trim();
      if (!trimmed) {
        throw new SecretResolutionError(
          'SECRET_NOT_FOUND',
          `GCP Secret Manager version "${resolved.resourceName}" returned an empty payload.`
        );
      }
      return trimmed;
    } catch (error) {
      if (error instanceof SecretResolutionError) {
        throw error;
      }
      const code = extractGrpcStatusCode(error);
      if (code === 5) {
        throw new SecretResolutionError(
          'SECRET_NOT_FOUND',
          `GCP secret version "${resolved.resourceName}" was not found.`
        );
      }
      if (code === 7 || code === 16) {
        throw new SecretResolutionError(
          'SECRET_ACCESS_DENIED',
          `GCP Secret Manager access denied for "${resolved.resourceName}" (verify IAM secretmanager.secretAccessor and ADC).`
        );
      }
      throw new SecretResolutionError(
        'SECRET_STORE_UNCONFIGURED',
        `Unable to resolve "${resolved.resourceName}" from GCP Secret Manager (check ADC/IAM connectivity).`
      );
    }
  }
}

/**
 * Legacy fail-closed placeholder kept for backwards compatibility in tests.
 */
export class UnconfiguredGcpSecretManagerStore implements SecretStore {
  async resolveSecret(ref: SecretReference): Promise<string> {
    throw new SecretResolutionError(
      'SECRET_STORE_UNCONFIGURED',
      `GCP Secret Manager retrieval for "${ref.secretName}" is disabled in this unconfigured test store.`
    );
  }
}

export interface SecretStorageReadinessSummary {
  gcpSdkInstalled: boolean;
  gcpProjectAllowlistCount: number;
  gcpProjectAllowlist: string[];
  hasConfiguredProjectAllowlist: boolean;
  envDevOnlyAllowed: boolean;
  runtimeMode:
    | 'development_env_fallback'
    | 'gcp_allowlist_configured_iam_unverified'
    | 'blocked_in_production_unconfigured';
  statusLabel: string;
  blockerReason: string | null;
}

export function getSecretStorageStatus(options: {
  nodeEnv?: string;
  allowlistRaw?: string;
} = {}): SecretStorageReadinessSummary {
  const nodeEnv = (options.nodeEnv ?? process.env.NODE_ENV ?? 'development')
    .trim()
    .toLowerCase();
  const envDevOnlyAllowed = nodeEnv !== 'production';
  const gcpProjectAllowlist = parseProjectAllowlist(
    options.allowlistRaw ?? process.env.GCP_SECRET_MANAGER_PROJECT_ALLOWLIST
  );
  const hasConfiguredProjectAllowlist = gcpProjectAllowlist.length > 0;

  if (hasConfiguredProjectAllowlist) {
    return {
      gcpSdkInstalled: true,
      gcpProjectAllowlistCount: gcpProjectAllowlist.length,
      gcpProjectAllowlist,
      hasConfiguredProjectAllowlist: true,
      envDevOnlyAllowed,
      runtimeMode: 'gcp_allowlist_configured_iam_unverified',
      statusLabel: 'SDK Installed · Allowlist Configured (Live IAM Unverified)',
      blockerReason:
        'Live GCP Secret Manager IAM connectivity is not verified in this environment; runtime resolution uses Google ADC when credentials exist.',
    };
  }

  if (!envDevOnlyAllowed) {
    return {
      gcpSdkInstalled: true,
      gcpProjectAllowlistCount: 0,
      gcpProjectAllowlist: [],
      hasConfiguredProjectAllowlist: false,
      envDevOnlyAllowed: false,
      runtimeMode: 'blocked_in_production_unconfigured',
      statusLabel: 'Blocked — IAM & Project Allowlist Required',
      blockerReason:
        'Production blocks env_dev_only secrets and GCP_SECRET_MANAGER_PROJECT_ALLOWLIST is not configured.',
    };
  }

  return {
    gcpSdkInstalled: true,
    gcpProjectAllowlistCount: 0,
    gcpProjectAllowlist: [],
    hasConfiguredProjectAllowlist: false,
    envDevOnlyAllowed: true,
    runtimeMode: 'development_env_fallback',
    statusLabel: 'Dev/Test Fallback Active · GCP IAM Unconfigured',
    blockerReason:
      'Blocked for GCP Secret Manager until GCP_SECRET_MANAGER_PROJECT_ALLOWLIST and GCP Secret Manager IAM permissions are configured.',
  };
}

export class CompositeSecretStore implements SecretStore {
  private readonly envDevStore: EnvDevOnlySecretStore;
  private readonly gcpStore: SecretStore;

  constructor(options: {
    envDevStore?: EnvDevOnlySecretStore;
    gcpStore?: SecretStore;
  } = {}) {
    this.envDevStore = options.envDevStore ?? new EnvDevOnlySecretStore();
    this.gcpStore = options.gcpStore ?? new GoogleSecretManagerSecretStore();
  }

  async resolveSecret(ref: SecretReference): Promise<string> {
    const parsed = SecretReferenceSchema.safeParse(ref);
    if (!parsed.success) {
      throw new SecretResolutionError(
        'INVALID_SECRET_REFERENCE',
        'Malformed SecretReference.'
      );
    }
    if (parsed.data.provider === 'gcp_secret_manager') {
      return this.gcpStore.resolveSecret(parsed.data);
    }
    return this.envDevStore.resolveSecret(parsed.data);
  }
}

export const defaultEnvDevSecretStore = new EnvDevOnlySecretStore();
export const defaultGcpSecretStore = new GoogleSecretManagerSecretStore();
export const defaultSecretStore = new CompositeSecretStore({
  envDevStore: defaultEnvDevSecretStore,
  gcpStore: defaultGcpSecretStore,
});
