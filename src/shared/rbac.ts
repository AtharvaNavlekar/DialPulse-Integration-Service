import type {
  PermissionCatalogItem,
  PermissionCategory,
  PermissionKey,
  PermissionRiskLevel,
  RoleConfig,
  RoleKey,
  RolePermissionCapabilities,
  TenantRolePermissionMatrix,
} from './types.ts';

export const VALID_ROLE_KEYS = [
  'admin',
  'manager',
  'operator',
  'viewer',
] as const satisfies readonly RoleKey[];

export const ROLE_LABELS: Record<RoleKey, string> = {
  admin: 'Workspace Admin',
  manager: 'Operations Manager (PRM/RM)',
  operator: 'Calling / Backend Executive',
  viewer: 'Read-Only Auditor',
};

export const PERMISSION_CATEGORIES: readonly PermissionCategory[] = [
  'Workspace',
  'Forms',
  'Automation',
  'Operations',
  'Administration',
  'Finance & Analytics',
  'Platform Security',
];

export const PERMISSION_CATALOG: readonly PermissionCatalogItem[] = [
  // Workspace
  {
    key: 'canViewWorkspace',
    label: 'View Workspace Overview',
    description:
      'Access workspace overview KPIs, My Apps launcher, global search, and notifications.',
    category: 'Workspace',
    riskLevel: 'low',
    defaultRoles: ['admin', 'manager', 'operator', 'viewer'],
    configurable: true,
    protected: false,
  },
  {
    key: 'canManageProfile',
    label: 'Manage Profile & Tenant Switch',
    description:
      'View profile details, active memberships, and switch between authorized tenants.',
    category: 'Workspace',
    riskLevel: 'low',
    defaultRoles: ['admin', 'manager', 'operator', 'viewer'],
    configurable: true,
    protected: false,
  },
  {
    key: 'canManagePreferences',
    label: 'Manage Personal Preferences',
    description:
      'Update personal timezone, date formatting, theme, and table density preferences.',
    category: 'Workspace',
    riskLevel: 'low',
    defaultRoles: ['admin', 'manager', 'operator', 'viewer'],
    configurable: true,
    protected: false,
  },

  // Forms Studio
  {
    key: 'canViewForms',
    label: 'View Forms & Analytics',
    description:
      'Browse Forms Studio definitions, form analytics, and preview test runner.',
    category: 'Forms',
    riskLevel: 'low',
    defaultRoles: ['admin', 'manager', 'operator', 'viewer'],
    configurable: true,
    protected: false,
  },
  {
    key: 'canCreateForms',
    label: 'Create & Duplicate Forms',
    description:
      'Create new intake forms or duplicate existing forms inside the tenant.',
    category: 'Forms',
    riskLevel: 'medium',
    defaultRoles: ['admin', 'manager'],
    configurable: true,
    protected: false,
  },
  {
    key: 'canEditForms',
    label: 'Edit Form Fields & Settings',
    description:
      'Modify form fields, validation rules, descriptions, and submission copy.',
    category: 'Forms',
    riskLevel: 'medium',
    defaultRoles: ['admin', 'manager'],
    configurable: true,
    protected: false,
  },
  {
    key: 'canPublishForms',
    label: 'Publish & Unpublish Forms',
    description:
      'Expose or withdraw public intake URLs (/f/:slug) for external customer submissions.',
    category: 'Forms',
    riskLevel: 'high',
    defaultRoles: ['admin', 'manager'],
    configurable: true,
    protected: false,
  },
  {
    key: 'canDeleteForms',
    label: 'Delete Forms',
    description:
      'Permanently delete forms and cascading submission history from PostgreSQL.',
    category: 'Forms',
    riskLevel: 'high',
    defaultRoles: ['admin', 'manager'],
    configurable: true,
    protected: false,
  },
  {
    key: 'canViewSubmissions',
    label: 'View Form Submissions',
    description:
      'Inspect submitted form payloads and customer enquiry answers in Submissions Inbox.',
    category: 'Forms',
    riskLevel: 'medium',
    defaultRoles: ['admin', 'manager', 'operator', 'viewer'],
    configurable: true,
    protected: false,
  },
  {
    key: 'canExportSubmissions',
    label: 'Export Submissions CSV',
    description:
      'Download sanitized form submissions as CSV spreadsheets.',
    category: 'Forms',
    riskLevel: 'high',
    defaultRoles: ['admin', 'manager'],
    configurable: true,
    protected: false,
  },

  // Workflow Automation
  {
    key: 'canViewAutomations',
    label: 'View Automations & Executions',
    description:
      'Inspect workflow rules, templates, execution history, and action step logs.',
    category: 'Automation',
    riskLevel: 'low',
    defaultRoles: ['admin', 'manager', 'operator', 'viewer'],
    configurable: true,
    protected: false,
  },
  {
    key: 'canManageAutomations',
    label: 'Manage Workflows & Retries',
    description:
      'Create, edit, activate/pause, delete, dry-run, and retry automation workflows.',
    category: 'Automation',
    riskLevel: 'high',
    defaultRoles: ['admin', 'manager'],
    configurable: true,
    protected: false,
  },
  {
    key: 'canReplayEvents',
    label: 'Replay Dead-Letter Events',
    description:
      'Requeue dead_letter outbox/inbox events for asynchronous worker reprocessing.',
    category: 'Automation',
    riskLevel: 'critical',
    defaultRoles: ['admin', 'manager'],
    configurable: true,
    protected: false,
  },

  // Operations
  {
    key: 'canViewTasks',
    label: 'View Leads & Follow-Up Tasks',
    description:
      'View tenant lead intake records and assigned follow-up task queues.',
    category: 'Operations',
    riskLevel: 'low',
    defaultRoles: ['admin', 'manager', 'operator', 'viewer'],
    configurable: true,
    protected: false,
  },
  {
    key: 'canManageTasks',
    label: 'Update Follow-Up Tasks',
    description:
      'Transition follow-up task statuses (pending, in_progress, completed) and emit events.',
    category: 'Operations',
    riskLevel: 'medium',
    defaultRoles: ['admin', 'manager', 'operator'],
    configurable: true,
    protected: false,
  },
  {
    key: 'canManageQueues',
    label: 'Configure Queues & Assignment Rules',
    description:
      'Modify operational queues, SLA minutes, and product-to-employee routing rules.',
    category: 'Operations',
    riskLevel: 'high',
    defaultRoles: ['admin'],
    configurable: true,
    protected: false,
  },
  {
    key: 'canViewActivityLogs',
    label: 'View Audit & Activity Logs',
    description:
      'Inspect tenant-scoped activity, authorization, and integration audit trails.',
    category: 'Operations',
    riskLevel: 'medium',
    defaultRoles: ['admin', 'manager', 'operator', 'viewer'],
    configurable: true,
    protected: false,
  },

  // Administration
  {
    key: 'canManageSettings',
    label: 'Manage Organization Settings',
    description:
      'Modify tenant departments, workflow stages, escalation hours, and org configuration.',
    category: 'Administration',
    riskLevel: 'high',
    defaultRoles: ['admin'],
    configurable: true,
    protected: false,
  },
  {
    key: 'canManageEmployees',
    label: 'Manage Tenant Team Directory',
    description:
      'Add, update, or deactivate team members and role assignments in workspace settings.',
    category: 'Administration',
    riskLevel: 'high',
    defaultRoles: ['admin'],
    configurable: true,
    protected: false,
  },
  {
    key: 'canManageRoles',
    label: 'Govern Role Permissions Matrix',
    description:
      'Modify per-tenant RBAC role capability toggles. Admin always retains this capability.',
    category: 'Administration',
    riskLevel: 'critical',
    defaultRoles: ['admin'],
    configurable: true,
    protected: false,
  },
  {
    key: 'canManageIntegrations',
    label: 'Access Integrations & DLQ Console',
    description:
      'View provider registry, webhook activity logs, durable event queues, and ID mappings.',
    category: 'Administration',
    riskLevel: 'high',
    defaultRoles: ['admin', 'manager'],
    configurable: true,
    protected: false,
  },
  {
    key: 'canManageConnections',
    label: 'Manage Provider Connections',
    description:
      'Create pending integration connections and activate, disable, or revoke connectors.',
    category: 'Administration',
    riskLevel: 'critical',
    defaultRoles: ['admin'],
    configurable: true,
    protected: false,
  },

  // Finance & Analytics
  {
    key: 'canViewAnalytics',
    label: 'View Business Analytics',
    description:
      'Inspect funnel conversion metrics, SLA adherence, and workflow reliability.',
    category: 'Finance & Analytics',
    riskLevel: 'low',
    defaultRoles: ['admin', 'manager', 'operator', 'viewer'],
    configurable: true,
    protected: false,
  },
  {
    key: 'canExportAnalytics',
    label: 'Export Analytics Reports',
    description:
      'Generate and download operational analytics exports.',
    category: 'Finance & Analytics',
    riskLevel: 'high',
    defaultRoles: ['admin', 'manager'],
    configurable: true,
    protected: false,
  },
  {
    key: 'canViewCostCenter',
    label: 'View Cost Control Center',
    description:
      'Inspect software subscription savings and metered integration vendor costs.',
    category: 'Finance & Analytics',
    riskLevel: 'medium',
    defaultRoles: ['admin', 'manager'],
    configurable: true,
    protected: false,
  },
  {
    key: 'canManageCostCenter',
    label: 'Manage Cost Center Budgets',
    description:
      'Update software baseline costs and vendor spend alert thresholds.',
    category: 'Finance & Analytics',
    riskLevel: 'high',
    defaultRoles: ['admin'],
    configurable: true,
    protected: false,
  },

  // Protected Platform Security (Non-Configurable)
  {
    key: 'canAdministerPlatformIdentity',
    label: 'Administer Platform Identity',
    description:
      'Locked Central CRM authority: manage cross-system Firebase & staff identity bindings.',
    category: 'Platform Security',
    riskLevel: 'critical',
    defaultRoles: [],
    configurable: false,
    protected: true,
  },
  {
    key: 'canManageAllTenants',
    label: 'Cross-Tenant Platform Administration',
    description:
      'Locked Central CRM authority: provision or suspend tenants across the ecosystem.',
    category: 'Platform Security',
    riskLevel: 'critical',
    defaultRoles: [],
    configurable: false,
    protected: true,
  },
  {
    key: 'canAccessCentralCrmAdmin',
    label: 'Central CRM Privileged Admin',
    description:
      'Locked Central CRM authority: access platform-wide governance and billing controls.',
    category: 'Platform Security',
    riskLevel: 'critical',
    defaultRoles: [],
    configurable: false,
    protected: true,
  },
] as const;

export const PERMISSION_CATALOG_BY_KEY: Record<PermissionKey, PermissionCatalogItem> =
  Object.fromEntries(
    PERMISSION_CATALOG.map((item) => [item.key, item])
  ) as Record<PermissionKey, PermissionCatalogItem>;

export const ALL_PERMISSION_KEYS: readonly PermissionKey[] = PERMISSION_CATALOG.map(
  (item) => item.key
);

export const CONFIGURABLE_PERMISSION_KEYS: readonly PermissionKey[] =
  PERMISSION_CATALOG.filter((item) => item.configurable && !item.protected).map(
    (item) => item.key
  );

export const PROTECTED_PERMISSION_KEYS: readonly PermissionKey[] =
  PERMISSION_CATALOG.filter((item) => item.protected || !item.configurable).map(
    (item) => item.key
  );

export function isValidRoleKey(value: unknown): value is RoleKey {
  return (
    typeof value === 'string' &&
    (VALID_ROLE_KEYS as readonly string[]).includes(value)
  );
}

export function isValidPermissionKey(value: unknown): value is PermissionKey {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(PERMISSION_CATALOG_BY_KEY, value)
  );
}

export function isProtectedPermission(key: PermissionKey): boolean {
  const item = PERMISSION_CATALOG_BY_KEY[key];
  return !item || item.protected || !item.configurable;
}

export function createFailClosedCapabilities(): RolePermissionCapabilities {
  const caps = {} as RolePermissionCapabilities;
  for (const key of ALL_PERMISSION_KEYS) {
    caps[key] = false;
  }
  return caps;
}

export function getDefaultCapabilitiesForRole(
  roleKey: RoleKey
): RolePermissionCapabilities {
  const caps = createFailClosedCapabilities();
  for (const item of PERMISSION_CATALOG) {
    if (item.protected || !item.configurable) {
      caps[item.key] = false;
    } else {
      caps[item.key] = item.defaultRoles.includes(roleKey);
    }
  }
  return caps;
}

export function buildDefaultTenantRoleMatrix(): TenantRolePermissionMatrix {
  return {
    admin: getDefaultCapabilitiesForRole('admin'),
    manager: getDefaultCapabilitiesForRole('manager'),
    operator: getDefaultCapabilitiesForRole('operator'),
    viewer: getDefaultCapabilitiesForRole('viewer'),
  };
}

export function sanitizeRoleCapabilities(
  rawCapabilities: Partial<Record<PermissionKey, boolean>>
): RolePermissionCapabilities {
  const caps = createFailClosedCapabilities();
  for (const key of ALL_PERMISSION_KEYS) {
    if (isProtectedPermission(key)) {
      caps[key] = false;
    } else {
      caps[key] = rawCapabilities[key] === true;
    }
  }
  return caps;
}

export function buildRoleConfigFromCapabilities(
  roleKey: RoleKey,
  rawCapabilities: Partial<Record<PermissionKey, boolean>>,
  labelOverride?: string
): RoleConfig {
  const capabilities = sanitizeRoleCapabilities(rawCapabilities);
  return {
    key: roleKey,
    label: labelOverride || ROLE_LABELS[roleKey] || ROLE_LABELS.viewer,
    canManageForms: Boolean(
      capabilities.canCreateForms ||
        capabilities.canEditForms ||
        capabilities.canPublishForms ||
        capabilities.canDeleteForms
    ),
    canManageAutomations: capabilities.canManageAutomations,
    canManageSettings: capabilities.canManageSettings,
    canExportSubmissions: capabilities.canExportSubmissions,
    capabilities,
  };
}

export function createFailClosedRoleConfig(roleKey: RoleKey): RoleConfig {
  return buildRoleConfigFromCapabilities(roleKey, createFailClosedCapabilities());
}

export function hasEffectivePermission(
  permissions: RoleConfig | null | undefined,
  permissionKey: PermissionKey | 'canManageForms'
): boolean {
  if (!permissions) return false;

  if (permissionKey === 'canManageForms') {
    if (permissions.capabilities) {
      return Boolean(
        permissions.capabilities.canCreateForms ||
          permissions.capabilities.canEditForms ||
          permissions.capabilities.canPublishForms ||
          permissions.capabilities.canDeleteForms
      );
    }
    return Boolean(permissions.canManageForms);
  }

  if (isProtectedPermission(permissionKey)) {
    return false;
  }

  if (permissions.capabilities) {
    const capEnabled = permissions.capabilities[permissionKey] === true;
    if (permissionKey === 'canManageAutomations') {
      return capEnabled && permissions.canManageAutomations !== false;
    }
    if (permissionKey === 'canManageSettings') {
      return capEnabled && permissions.canManageSettings !== false;
    }
    if (permissionKey === 'canExportSubmissions') {
      return capEnabled && permissions.canExportSubmissions !== false;
    }
    return capEnabled;
  }

  // Legacy minimal RoleConfig fallback (used only when an older test passes 4-boolean RoleConfig)
  if (permissionKey === 'canManageAutomations') {
    return Boolean(permissions.canManageAutomations);
  }
  if (permissionKey === 'canManageSettings') {
    return Boolean(permissions.canManageSettings);
  }
  if (permissionKey === 'canExportSubmissions') {
    return Boolean(permissions.canExportSubmissions);
  }
  if (
    permissionKey === 'canCreateForms' ||
    permissionKey === 'canEditForms' ||
    permissionKey === 'canPublishForms' ||
    permissionKey === 'canDeleteForms'
  ) {
    return Boolean(permissions.canManageForms);
  }
  return false;
}

export function hasAnyEffectivePermission(
  permissions: RoleConfig | null | undefined,
  permissionKeys: ReadonlyArray<PermissionKey | 'canManageForms'>
): boolean {
  return permissionKeys.some((key) => hasEffectivePermission(permissions, key));
}

export interface RolePermissionChangeInput {
  roleKey: string;
  permissionKey: string;
  enabled: boolean;
}

export interface RolePermissionDiff {
  roleKey: RoleKey;
  permissionKey: PermissionKey;
  label: string;
  category: PermissionCategory;
  riskLevel: PermissionRiskLevel;
  previousValue: boolean;
  newValue: boolean;
}

export interface MatrixValidationResult {
  valid: boolean;
  statusCode: 200 | 400 | 403;
  errors: string[];
  warnings: string[];
  diffs: RolePermissionDiff[];
  highRiskChanges: RolePermissionDiff[];
  nextMatrix: TenantRolePermissionMatrix;
}

export function normalizeProposedChanges(
  input:
    | { changes: RolePermissionChangeInput[] }
    | { matrix: Record<string, Record<string, unknown>> },
  currentMatrix: TenantRolePermissionMatrix
): { validFormat: boolean; errors: string[]; changes: RolePermissionChangeInput[] } {
  if ('changes' in input && Array.isArray(input.changes)) {
    const changes: RolePermissionChangeInput[] = [];
    const errors: string[] = [];
    for (const item of input.changes) {
      if (!item || typeof item !== 'object') {
        errors.push('Each permission change entry must be an object.');
        continue;
      }
      if (typeof item.enabled !== 'boolean') {
        errors.push(
          `Permission "${String(item.permissionKey)}" value must be a boolean.`
        );
        continue;
      }
      changes.push({
        roleKey: String(item.roleKey ?? ''),
        permissionKey: String(item.permissionKey ?? ''),
        enabled: item.enabled,
      });
    }
    return { validFormat: errors.length === 0, errors, changes };
  }

  if ('matrix' in input && input.matrix && typeof input.matrix === 'object') {
    const changes: RolePermissionChangeInput[] = [];
    const errors: string[] = [];
    for (const [roleKey, rolePerms] of Object.entries(input.matrix)) {
      if (!isValidRoleKey(roleKey)) {
        errors.push(`Invalid role key "${roleKey}".`);
        continue;
      }
      if (!rolePerms || typeof rolePerms !== 'object' || Array.isArray(rolePerms)) {
        errors.push(`Role "${roleKey}" permissions must be an object.`);
        continue;
      }
      for (const [permKey, val] of Object.entries(rolePerms)) {
        if (typeof val !== 'boolean') {
          errors.push(`Permission "${permKey}" for role "${roleKey}" must be boolean.`);
          continue;
        }
        if (isValidPermissionKey(permKey)) {
          if (currentMatrix[roleKey][permKey] !== val) {
            changes.push({ roleKey, permissionKey: permKey, enabled: val });
          }
        } else {
          changes.push({ roleKey, permissionKey: permKey, enabled: val });
        }
      }
    }
    return { validFormat: errors.length === 0, errors, changes };
  }

  return {
    validFormat: false,
    errors: ['Provide either a "changes" array or a "matrix" map.'],
    changes: [],
  };
}

export function validateRoleMatrixGovernance(params: {
  actorRoleKey: RoleKey;
  actorPermissions: RoleConfig;
  currentMatrix: TenantRolePermissionMatrix;
  changes: RolePermissionChangeInput[];
}): MatrixValidationResult {
  const { actorRoleKey, actorPermissions, currentMatrix, changes } = params;
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!hasEffectivePermission(actorPermissions, 'canManageRoles')) {
    return {
      valid: false,
      statusCode: 403,
      errors: [
        `Forbidden: role "${actorRoleKey}" lacks "canManageRoles" permission.`,
      ],
      warnings: [],
      diffs: [],
      highRiskChanges: [],
      nextMatrix: currentMatrix,
    };
  }

  const nextMatrix: TenantRolePermissionMatrix = {
    admin: { ...currentMatrix.admin },
    manager: { ...currentMatrix.manager },
    operator: { ...currentMatrix.operator },
    viewer: { ...currentMatrix.viewer },
  };

  let statusCode: 200 | 400 | 403 = 200;

  for (const change of changes) {
    if (!isValidRoleKey(change.roleKey)) {
      errors.push(`Unknown role key "${change.roleKey}".`);
      if (statusCode === 200) statusCode = 400;
      continue;
    }

    if (!isValidPermissionKey(change.permissionKey)) {
      errors.push(`Unknown permission key "${change.permissionKey}".`);
      if (statusCode === 200) statusCode = 400;
      continue;
    }

    if (typeof change.enabled !== 'boolean') {
      errors.push(
        `Invalid boolean value for ${change.roleKey}.${change.permissionKey}.`
      );
      if (statusCode === 200) statusCode = 400;
      continue;
    }

    const catalogItem = PERMISSION_CATALOG_BY_KEY[change.permissionKey];
    const previousValue = currentMatrix[change.roleKey][change.permissionKey];

    if (isProtectedPermission(change.permissionKey)) {
      if (change.enabled || previousValue !== change.enabled) {
        errors.push(
          `Forbidden: "${change.permissionKey}" is a protected platform capability and cannot be modified per tenant.`
        );
        statusCode = 403;
      }
      continue;
    }

    if (
      change.roleKey === 'admin' &&
      change.permissionKey === 'canManageRoles' &&
      change.enabled === false
    ) {
      errors.push(
        'Governance violation: "admin" must retain "canManageRoles" to prevent tenant lockout.'
      );
      if (statusCode === 200) statusCode = 400;
      continue;
    }

    // Prevent self-escalation & privilege escalation for non-admin actors
    if (actorRoleKey !== 'admin') {
      if (change.roleKey === 'admin') {
        errors.push(
          'Forbidden: non-admin roles cannot modify Workspace Admin permissions.'
        );
        statusCode = 403;
        continue;
      }
      if (change.roleKey === actorRoleKey) {
        errors.push(
          `Forbidden: self-escalation blocked — role "${actorRoleKey}" cannot modify its own permissions.`
        );
        statusCode = 403;
        continue;
      }
      if (
        change.enabled === true &&
        !hasEffectivePermission(actorPermissions, change.permissionKey)
      ) {
        errors.push(
          `Forbidden: cannot grant "${change.permissionKey}" because your role does not hold it.`
        );
        statusCode = 403;
        continue;
      }
      if (change.permissionKey === 'canManageRoles' && change.enabled === true) {
        errors.push(
          'Forbidden: only Workspace Admin can delegate "canManageRoles".'
        );
        statusCode = 403;
        continue;
      }
    }

    if (
      change.roleKey === 'viewer' &&
      change.enabled === true &&
      (catalogItem.riskLevel === 'high' || catalogItem.riskLevel === 'critical')
    ) {
      warnings.push(
        `High-risk grant: Read-Only Auditor (viewer) is being granted "${catalogItem.label}".`
      );
    }

    nextMatrix[change.roleKey][change.permissionKey] = change.enabled;
  }

  const diffs: RolePermissionDiff[] = [];
  for (const roleKey of VALID_ROLE_KEYS) {
    for (const item of PERMISSION_CATALOG) {
      const prev = currentMatrix[roleKey][item.key];
      const next = nextMatrix[roleKey][item.key];
      if (prev !== next) {
        diffs.push({
          roleKey,
          permissionKey: item.key,
          label: item.label,
          category: item.category,
          riskLevel: item.riskLevel,
          previousValue: prev,
          newValue: next,
        });
      }
    }
  }

  const highRiskChanges = diffs.filter(
    (d) => d.riskLevel === 'high' || d.riskLevel === 'critical'
  );

  if (errors.length > 0) {
    return {
      valid: false,
      statusCode: statusCode === 200 ? 400 : statusCode,
      errors,
      warnings,
      diffs: [],
      highRiskChanges: [],
      nextMatrix: currentMatrix,
    };
  }

  return {
    valid: true,
    statusCode: 200,
    errors: [],
    warnings,
    diffs,
    highRiskChanges,
    nextMatrix,
  };
}
