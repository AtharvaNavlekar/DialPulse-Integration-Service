import type {
  DurableEventRecord,
  IntegrationConnectionRecord,
  IntegrationConnectionStatus,
  ProviderCatalogEntry,
  RoleConfig,
  RoleKey,
} from './types.ts';

import {
  hasAnyEffectivePermission,
  hasEffectivePermission,
} from './rbac.ts';

export type SemanticTone = 'success' | 'warning' | 'error' | 'info' | 'neutral';

export function canViewIntegrationsConsole(
  permissions?:
    | (Pick<RoleConfig, 'canManageSettings' | 'canManageAutomations'> & {
        capabilities?: RoleConfig['capabilities'];
      })
    | null
): boolean {
  if (!permissions) return false;
  if (permissions.capabilities) {
    return hasAnyEffectivePermission(permissions as RoleConfig, [
      'canManageIntegrations',
      'canManageConnections',
      'canReplayEvents',
      'canManageSettings',
      'canManageAutomations',
    ]);
  }
  return Boolean(permissions.canManageSettings || permissions.canManageAutomations);
}

export function canManageConnections(
  permissions?:
    | (Pick<RoleConfig, 'canManageSettings'> & {
        capabilities?: RoleConfig['capabilities'];
      })
    | null
): boolean {
  if (!permissions) return false;
  if (permissions.capabilities) {
    return hasEffectivePermission(permissions as RoleConfig, 'canManageConnections');
  }
  return Boolean(permissions.canManageSettings);
}

export function canReplayDeadLetters(
  roleKey?: RoleKey | string | null,
  permissions?:
    | (Pick<RoleConfig, 'canManageAutomations'> & {
        capabilities?: RoleConfig['capabilities'];
      })
    | null
): boolean {
  if (!permissions) return false;
  if (permissions.capabilities) {
    return hasEffectivePermission(permissions as RoleConfig, 'canReplayEvents');
  }
  return (
    Boolean(permissions.canManageAutomations) &&
    (roleKey === 'admin' || roleKey === 'manager')
  );
}

export function mapConnectionStatusTone(
  status: IntegrationConnectionStatus | string
): SemanticTone {
  switch (status) {
    case 'active':
    case 'verified':
      return 'success';
    case 'pending':
      return 'warning';
    case 'error':
    case 'revoked':
      return 'error';
    case 'disabled':
    default:
      return 'neutral';
  }
}

export function mapWebhookOutcomeTone(outcome: string): SemanticTone {
  if (outcome === 'verified') return 'success';
  if (outcome === 'expired_timestamp') return 'warning';
  if (
    outcome === 'invalid_signature' ||
    outcome === 'malformed_signature' ||
    outcome === 'provider_mismatch' ||
    outcome === 'connection_inactive' ||
    outcome === 'unconfigured_secret' ||
    outcome === 'unsupported_protocol' ||
    outcome === 'invalid_payload'
  ) {
    return 'error';
  }
  return 'neutral';
}

export function mapWebhookProcessingTone(processingStatus: string): SemanticTone {
  if (
    processingStatus === 'accepted' ||
    processingStatus === 'enqueued' ||
    processingStatus === 'duplicate'
  ) {
    return 'success';
  }
  if (processingStatus === 'rejected' || processingStatus === 'error') {
    return 'error';
  }
  return 'neutral';
}

export function mapEventStatusTone(status: string): SemanticTone {
  switch (status) {
    case 'published':
    case 'succeeded':
      return 'success';
    case 'processing':
      return 'info';
    case 'pending':
    case 'received':
      return 'warning';
    case 'dead_letter':
      return 'error';
    default:
      return 'neutral';
  }
}

export function mapProviderStatusLabel(
  status: ProviderCatalogEntry['status']
): { tone: SemanticTone; label: string } {
  switch (status) {
    case 'approved_ready':
      return { tone: 'success', label: 'Approved Ready' };
    case 'mock_adapter':
      return { tone: 'info', label: 'Mock Adapter Boundary' };
    case 'planned_unapproved':
    default:
      return { tone: 'warning', label: 'Planned · Activation Blocked' };
  }
}

export function classifyConnectionActionPermissions(
  connection: Pick<IntegrationConnectionRecord, 'status' | 'providerId'>,
  provider: Pick<ProviderCatalogEntry, 'status'> | null | undefined,
  canManage: boolean
): {
  canActivate: boolean;
  activateDisabledReason: string | null;
  canDisable: boolean;
  canRevoke: boolean;
} {
  if (!canManage) {
    return {
      canActivate: false,
      activateDisabledReason: 'Requires Workspace Admin settings permission.',
      canDisable: false,
      canRevoke: false,
    };
  }

  const isRevoked = connection.status === 'revoked';
  const isPlannedProvider = provider?.status === 'planned_unapproved';

  let activateDisabledReason: string | null = null;
  if (isRevoked) {
    activateDisabledReason =
      'Revoked connections cannot be reactivated. Create a new pending connection.';
  } else if (isPlannedProvider) {
    activateDisabledReason =
      'Provider is planned_unapproved and requires vendor contract & compliance approval.';
  } else if (connection.status === 'active') {
    activateDisabledReason = 'Connection is already active.';
  }

  return {
    canActivate: !activateDisabledReason,
    activateDisabledReason,
    canDisable: !isRevoked && connection.status !== 'disabled',
    canRevoke: !isRevoked,
  };
}

export interface PendingConnectionDraft {
  providerId: string;
  connectionName: string;
  authMode: 'service_jwt' | 'oauth2' | 'api_key_hmac' | 'webhook_hmac';
  secretProvider: 'gcp_secret_manager' | 'env_dev_only';
  secretName: string;
  secretVersion: string;
  allowedScopesText: string;
  configJsonText: string;
  environment: 'development' | 'staging' | 'production';
}

const SENSITIVE_KEY_CHECK =
  /secret|token|password|api_?key|private_?key|hmac_?key|passphrase|credential|dsn|connection_?string|auth_?header/i;

export function validatePendingConnectionDraft(draft: PendingConnectionDraft): {
  valid: boolean;
  error: string | null;
  parsedConfig: Record<string, unknown> | null;
  scopes: string[];
} {
  const name = draft.connectionName.trim();
  if (name.length < 2 || name.length > 120) {
    return {
      valid: false,
      error: 'Connection name must be between 2 and 120 characters.',
      parsedConfig: null,
      scopes: [],
    };
  }

  const secretName = draft.secretName.trim();
  if (secretName.length < 3 || secretName.length > 200) {
    return {
      valid: false,
      error: 'Secret reference name must be between 3 and 200 characters.',
      parsedConfig: null,
      scopes: [],
    };
  }
  if (!/^[A-Za-z0-9_./-]+$/.test(secretName)) {
    return {
      valid: false,
      error:
        'Secret reference name may only contain letters, digits, underscore, dot, hyphen, or slash.',
      parsedConfig: null,
      scopes: [],
    };
  }
  if (
    secretName.includes('..') ||
    secretName.startsWith('/') ||
    secretName.endsWith('/')
  ) {
    return {
      valid: false,
      error: 'Secret reference name cannot contain path traversal or leading/trailing slashes.',
      parsedConfig: null,
      scopes: [],
    };
  }
  if (draft.secretProvider === 'env_dev_only' && secretName.includes('/')) {
    return {
      valid: false,
      error: 'env_dev_only secret names cannot contain slashes.',
      parsedConfig: null,
      scopes: [],
    };
  }
  if (!draft.secretVersion.trim()) {
    return {
      valid: false,
      error: 'Secret version is required (use "latest" or a version number).',
      parsedConfig: null,
      scopes: [],
    };
  }

  let parsedConfig: Record<string, unknown> = {};
  const rawJson = draft.configJsonText.trim();
  if (rawJson) {
    try {
      const candidate = JSON.parse(rawJson);
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        return {
          valid: false,
          error: 'Configuration must be a JSON object.',
          parsedConfig: null,
          scopes: [],
        };
      }
      for (const key of Object.keys(candidate)) {
        if (SENSITIVE_KEY_CHECK.test(key)) {
          return {
            valid: false,
            error: `Config key "${key}" appears sensitive. Use SecretReference instead of storing credentials in config.`,
            parsedConfig: null,
            scopes: [],
          };
        }
      }
      parsedConfig = candidate as Record<string, unknown>;
    } catch {
      return {
        valid: false,
        error: 'Configuration JSON is malformed.',
        parsedConfig: null,
        scopes: [],
      };
    }
  }

  const scopes = Array.from(
    new Set(
      draft.allowedScopesText
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    )
  );

  return {
    valid: true,
    error: null,
    parsedConfig,
    scopes,
  };
}

export function validateReplaySubmission(
  reason: string,
  confirmedAsyncRequeue: boolean
): { valid: boolean; trimmedReason: string; error: string | null } {
  const trimmed = reason.trim();
  if (trimmed.length < 3) {
    return {
      valid: false,
      trimmedReason: trimmed,
      error: 'Enter an operational replay reason (at least 3 characters).',
    };
  }
  if (trimmed.length > 300) {
    return {
      valid: false,
      trimmedReason: trimmed,
      error: 'Replay reason must be 300 characters or fewer.',
    };
  }
  if (!confirmedAsyncRequeue) {
    return {
      valid: false,
      trimmedReason: trimmed,
      error:
        'Confirm that you understand replay requeues the original event for asynchronous worker execution.',
    };
  }
  return { valid: true, trimmedReason: trimmed, error: null };
}

export function buildConsoleQueryString(
  params: Record<string, string | number | undefined | null>
): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const str = String(value).trim();
    if (!str) continue;
    sp.set(key, str);
  }
  const encoded = sp.toString();
  return encoded ? `?${encoded}` : '';
}

export function maskSecretReferenceLabel(ref: {
  provider: string;
  secretName: string;
  version: string;
}): string {
  return `${ref.provider}:${ref.secretName}@${ref.version || 'latest'}`;
}

export function truncateDigest(sha256: string, head = 12): string {
  if (!sha256) return '—';
  if (sha256.length <= head) return sha256;
  return `${sha256.slice(0, head)}…`;
}

export function mergeSortedDurableEvents(
  outbox: DurableEventRecord[],
  inbox: DurableEventRecord[]
): DurableEventRecord[] {
  return [...outbox, ...inbox].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function describeDateRangeWindow(
  preset: 'all' | '24h' | '7d' | '30d',
  now = new Date()
): { from?: string; to?: string } {
  if (preset === 'all') return {};
  const hours = preset === '24h' ? 24 : preset === '7d' ? 24 * 7 : 24 * 30;
  return {
    from: new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString(),
    to: now.toISOString(),
  };
}
