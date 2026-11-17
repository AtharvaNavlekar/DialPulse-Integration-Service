import { hasEffectivePermission } from './rbac.ts';
import type {
  AppCategory,
  NavSectionId,
  RoleConfig,
  TenantAppState,
  TenantAppsOverview,
  WorkspaceAppCatalogEntry,
} from './types.ts';

export const APP_CATEGORIES: readonly AppCategory[] = [
  'Core Operations',
  'Automation & Workflows',
  'Customer Engagement',
  'Compliance & Documents',
  'Intelligence & Governance',
];

export interface StoredTenantAppRow {
  appId: string;
  enabled: boolean;
  enabledByUid: string | null;
  updatedAt: Date | string | null;
}

export const WORKSPACE_APP_CATALOG: readonly WorkspaceAppCatalogEntry[] = [
  {
    id: 'forms-studio',
    name: 'Forms Studio',
    shortDescription:
      'Build, publish, preview, and collect customer intake forms.',
    description:
      'Build, publish, preview, and manage intake forms with 10 field types, validation, PostgreSQL submissions, analytics, and sanitized CSV export.',
    category: 'Core Operations',
    status: 'available',
    availableToTenants: true,
    supportsTenantActivation: true,
    defaultEnabled: true,
    inspiredBy: 'Tally / Jotform',
    milestone: 'Milestone B',
    navSectionId: 'forms-studio',
    launchPath: '/forms',
    requiredPermission: 'canViewForms',
    dependencies: ['PostgreSQL Submissions Store'],
    blockerReason: null,
  },
  {
    id: 'workflow-automation',
    name: 'Workflow Automation',
    shortDescription:
      'Event-driven triggers, conditions, queues, and follow-up tasks.',
    description:
      'Configure event-driven triggers, field conditions, queue/employee assignment, follow-up task creation, dry-run simulation, and durable execution history.',
    category: 'Automation & Workflows',
    status: 'available',
    availableToTenants: true,
    supportsTenantActivation: true,
    defaultEnabled: true,
    inspiredBy: 'n8n / Activepieces',
    milestone: 'Milestone C',
    navSectionId: 'workflow-automation',
    launchPath: '/automations',
    requiredPermission: 'canViewAutomations',
    dependencies: ['Forms Studio (trigger source)', 'Durable Event Outbox'],
    blockerReason: null,
  },
  {
    id: 'app-management',
    name: 'App Management',
    shortDescription:
      'Central workspace module catalogue and tenant activation control plane.',
    description:
      'Inspect all DialPulse workspace applications, review release availability and dependencies, and enable or disable tenant-configurable modules.',
    category: 'Intelligence & Governance',
    status: 'available',
    availableToTenants: true,
    supportsTenantActivation: false,
    defaultEnabled: true,
    inspiredBy: 'Workspace Control Plane',
    milestone: 'Stage 7 · View #44',
    navSectionId: 'settings',
    launchPath: '/settings/apps',
    requiredPermission: 'canViewWorkspace',
    managePermission: 'canManageSettings',
    dependencies: ['Dynamic Tenant RBAC', 'Activity Logs'],
    blockerReason: null,
  },
  {
    id: 'appointment-scheduler',
    name: 'Appointment Scheduler',
    shortDescription:
      'Employee working hours, slot booking pages, and reminders.',
    description:
      'Manage employee working hours, slot availability, customer booking pages, double-booking prevention, and pluggable reminder hooks.',
    category: 'Customer Engagement',
    status: 'coming_soon',
    availableToTenants: false,
    supportsTenantActivation: false,
    defaultEnabled: false,
    inspiredBy: 'Calendly',
    milestone: 'Milestone E · Stage 2',
    navSectionId: 'appointment-scheduler',
    launchPath: '/appointments',
    requiredPermission: 'canViewWorkspace',
    dependencies: ['Calendar Availability Schema', 'Notification Provider'],
    blockerReason: null,
  },
  {
    id: 'call-operations',
    name: 'Call Operations',
    shortDescription:
      'Calling queues, agent scripts, call attempts, and dispositions.',
    description:
      'Manage calling queues, script prompts, call attempt tracking, disposition logging, and pluggable telephony provider adapters.',
    category: 'Customer Engagement',
    status: 'coming_soon',
    availableToTenants: false,
    supportsTenantActivation: false,
    defaultEnabled: false,
    inspiredBy: 'Vapi',
    milestone: 'Milestone F · Stage 3',
    navSectionId: 'call-operations',
    launchPath: '/calls',
    requiredPermission: 'canViewWorkspace',
    dependencies: ['Approved Voice & Telephony Provider Adapter'],
    blockerReason: null,
  },
  {
    id: 'support-inbox',
    name: 'Support Inbox',
    shortDescription:
      'Customer support conversation queues, notes, and canned replies.',
    description:
      'Coordinate open, pending, and resolved support queues with customer context, internal notes, canned responses, and resolution timelines.',
    category: 'Customer Engagement',
    status: 'coming_soon',
    availableToTenants: false,
    supportsTenantActivation: false,
    defaultEnabled: false,
    inspiredBy: 'Crisp',
    milestone: 'Milestone G · Stage 4',
    navSectionId: 'support-inbox',
    launchPath: '/inbox',
    requiredPermission: 'canViewWorkspace',
    dependencies: ['WhatsApp / Email Channel Adapter'],
    blockerReason: null,
  },
  {
    id: 'document-workflow',
    name: 'Document Workflow',
    shortDescription:
      'Case document checklists, verification queues, and KYC gates.',
    description:
      'Coordinate case checklists, requested/verified/rejected statuses, verifier assignment, and immutable document verification logs.',
    category: 'Compliance & Documents',
    status: 'blocked',
    availableToTenants: false,
    supportsTenantActivation: false,
    defaultEnabled: false,
    inspiredBy: 'Google Drive / Box',
    milestone: 'Milestone H · Stage 5',
    navSectionId: 'document-workflow',
    launchPath: '/documents',
    requiredPermission: 'canViewWorkspace',
    dependencies: [
      'Encrypted Object Storage',
      'KMS Key Management',
      'Malware Scanning Pipeline',
      'Compliance Sign-Off',
    ],
    blockerReason:
      'Blocked pending encrypted object storage, KMS key management, malware scanning, and compliance sign-off for real KYC/financial documents.',
  },
  {
    id: 'business-analytics',
    name: 'Business Analytics',
    shortDescription:
      'Lead funnel conversion, queue SLAs, and automation reliability metrics.',
    description:
      'Analyze Loan-DSA lead funnel progression, assignment SLA adherence, follow-up completion metrics, and scheduled analytics exports.',
    category: 'Intelligence & Governance',
    status: 'coming_soon',
    availableToTenants: false,
    supportsTenantActivation: false,
    defaultEnabled: false,
    inspiredBy: 'PostHog',
    milestone: 'Milestone I · Stage 6',
    navSectionId: 'business-analytics',
    launchPath: '/analytics',
    requiredPermission: 'canViewAnalytics',
    dependencies: ['Forms Studio', 'Workflow Automation', 'Reporting Aggregator'],
    blockerReason: null,
  },
  {
    id: 'cost-control-center',
    name: 'Cost Control Center',
    shortDescription:
      'Vendor expense ledger, unit pricing estimates, budgets, and threshold alerts.',
    description:
      'Track verified vendor spend, import billing CSV records, configure provider unit pricing, inspect application and category breakdowns, and monitor tenant cost budgets.',
    category: 'Intelligence & Governance',
    status: 'available',
    availableToTenants: true,
    supportsTenantActivation: true,
    defaultEnabled: true,
    inspiredBy: 'Internal FinOps Ledger',
    milestone: 'Stage 7 · View #47',
    navSectionId: 'cost-control-center',
    launchPath: '/costs',
    requiredPermission: 'canViewCostCenter',
    managePermission: 'canManageCostCenter',
    dependencies: [
      'PostgreSQL Cost Ledger',
      'Dynamic Tenant RBAC',
      'Budget Alert Engine',
    ],
    blockerReason: null,
  },
  {
    id: 'knowledge-hub',
    name: 'Internal Knowledge Hub',
    shortDescription:
      'Loan-DSA SOPs, compliance checklists, and searchable playbooks.',
    description:
      'Author and search internal operational SOPs, product eligibility guides, and Loan-DSA verification checklists inside the workspace.',
    category: 'Core Operations',
    status: 'coming_soon',
    availableToTenants: false,
    supportsTenantActivation: false,
    defaultEnabled: false,
    inspiredBy: 'Notion / Internal Wiki',
    milestone: 'Stage 8 · Views #48–#51',
    navSectionId: null,
    launchPath: null,
    requiredPermission: 'canViewWorkspace',
    dependencies: ['Knowledge Article Schema', 'Tenant Full-Text Index'],
    blockerReason: null,
  },
] as const;

export const APP_CATALOG_BY_ID: Record<string, WorkspaceAppCatalogEntry> =
  Object.fromEntries(WORKSPACE_APP_CATALOG.map((entry) => [entry.id, entry]));

export function getAppCatalog(): WorkspaceAppCatalogEntry[] {
  return WORKSPACE_APP_CATALOG.map((entry) => ({
    ...entry,
    dependencies: [...entry.dependencies],
  }));
}

export function getAppCatalogEntry(
  appId: string
): WorkspaceAppCatalogEntry | null {
  return APP_CATALOG_BY_ID[appId] ?? null;
}

export function isValidAppId(appId: string): boolean {
  return Object.prototype.hasOwnProperty.call(APP_CATALOG_BY_ID, appId);
}

export function canActivateApp(entry: WorkspaceAppCatalogEntry): boolean {
  return (
    entry.status === 'available' &&
    entry.availableToTenants &&
    entry.supportsTenantActivation
  );
}

export function getToggleDisabledReason(
  entry: WorkspaceAppCatalogEntry,
  canManageApps: boolean
): string | null {
  if (entry.status === 'coming_soon') {
    return `${entry.name} is planned for ${entry.milestone} and is not yet available to enable.`;
  }
  if (entry.status === 'blocked') {
    return (
      entry.blockerReason ||
      `${entry.name} is currently blocked pending infrastructure and compliance readiness.`
    );
  }
  if (entry.status === 'deprecated') {
    return `${entry.name} is deprecated and cannot be activated.`;
  }
  if (!entry.availableToTenants || !entry.supportsTenantActivation) {
    return `${entry.name} is a core workspace control plane module and remains enabled for authorized users.`;
  }
  if (!canManageApps) {
    return 'Requires Workspace Settings management permission (canManageSettings) to change tenant activation.';
  }
  return null;
}

export function validateAppToggleRequest(params: {
  entry: WorkspaceAppCatalogEntry | null;
  enabled: boolean;
  canManageApps: boolean;
}): {
  valid: boolean;
  statusCode: 200 | 400 | 403 | 404;
  error?: string;
} {
  const { entry, enabled, canManageApps } = params;

  if (!entry) {
    return {
      valid: false,
      statusCode: 404,
      error: 'Application not found in DialPulse Workspace catalogue.',
    };
  }

  if (!canManageApps) {
    return {
      valid: false,
      statusCode: 403,
      error: 'Forbidden: missing "canManageSettings" permission to manage tenant applications.',
    };
  }

  if (entry.status !== 'available') {
    return {
      valid: false,
      statusCode: 400,
      error:
        entry.blockerReason ||
        `Application "${entry.name}" cannot be ${enabled ? 'enabled' : 'modified'} because its availability status is "${entry.status}".`,
    };
  }

  if (!entry.availableToTenants || !entry.supportsTenantActivation) {
    return {
      valid: false,
      statusCode: 400,
      error: `Application "${entry.name}" is a core workspace administration module and cannot be disabled per tenant.`,
    };
  }

  return { valid: true, statusCode: 200 };
}

export function resolveEffectiveTenantApps(params: {
  storedRows: readonly StoredTenantAppRow[];
  permissions?: RoleConfig | null;
  canManageApps?: boolean;
}): TenantAppState[] {
  const canManageApps =
    params.canManageApps ??
    hasEffectivePermission(params.permissions, 'canManageSettings');

  const rowMap = new Map<string, StoredTenantAppRow>();
  for (const row of params.storedRows) {
    rowMap.set(row.appId, row);
  }

  return WORKSPACE_APP_CATALOG.map((entry) => {
    const stored = rowMap.get(entry.id);
    const toggleable = canActivateApp(entry);

    let effectiveEnabled = false;
    if (entry.status === 'available' && entry.availableToTenants) {
      if (!entry.supportsTenantActivation) {
        effectiveEnabled = true;
      } else if (stored) {
        effectiveEnabled = stored.enabled === true;
      } else {
        effectiveEnabled = entry.defaultEnabled;
      }
    }

    const canLaunch =
      effectiveEnabled &&
      entry.status === 'available' &&
      Boolean(entry.launchPath) &&
      (!params.permissions ||
        hasEffectivePermission(params.permissions, entry.requiredPermission));

    const updatedAt = stored?.updatedAt
      ? stored.updatedAt instanceof Date
        ? stored.updatedAt.toISOString()
        : new Date(stored.updatedAt).toISOString()
      : null;

    return {
      ...entry,
      dependencies: [...entry.dependencies],
      enabled: effectiveEnabled,
      persisted: Boolean(stored),
      canToggle: toggleable && canManageApps,
      canLaunch,
      toggleDisabledReason: getToggleDisabledReason(entry, canManageApps),
      enabledByUid: stored?.enabledByUid ?? null,
      updatedAt,
    };
  });
}

export function computeTenantAppsOverview(
  apps: readonly TenantAppState[]
): TenantAppsOverview {
  const availableCount = apps.filter((a) => a.status === 'available').length;
  const enabledCount = apps.filter((a) => a.enabled).length;
  const comingSoonCount = apps.filter((a) => a.status === 'coming_soon').length;
  const blockedCount = apps.filter((a) => a.status === 'blocked').length;
  const deprecatedCount = apps.filter((a) => a.status === 'deprecated').length;
  const toggleableCount = apps.filter((a) => a.supportsTenantActivation).length;
  const activeMiniAppsCount = apps.filter(
    (a) => a.status === 'available' && a.supportsTenantActivation && a.enabled
  ).length;

  return {
    totalCatalogApps: apps.length,
    availableCount,
    enabledCount,
    comingSoonCount,
    blockedCount,
    deprecatedCount,
    toggleableCount,
    activeMiniAppsCount,
  };
}

export function getTenantAppByNavSection(
  apps: readonly TenantAppState[] | undefined,
  sectionId: NavSectionId
): TenantAppState | null {
  if (!apps) return null;
  if (sectionId === 'forms-studio') {
    return apps.find((a) => a.id === 'forms-studio') ?? null;
  }
  if (sectionId === 'workflow-automation') {
    return apps.find((a) => a.id === 'workflow-automation') ?? null;
  }
  if (sectionId === 'cost-control-center') {
    return apps.find((a) => a.id === 'cost-control-center') ?? null;
  }
  return apps.find((a) => a.navSectionId === sectionId) ?? null;
}

export function isWorkspaceModuleEnabled(
  apps: readonly TenantAppState[] | undefined,
  appId: 'forms-studio' | 'workflow-automation' | 'cost-control-center'
): boolean {
  if (!apps || apps.length === 0) return true;
  const entry = apps.find((a) => a.id === appId);
  return entry ? entry.enabled : true;
}

export function filterAppCatalogItems(
  apps: readonly TenantAppState[],
  options: {
    searchQuery?: string;
    category?: string;
    status?: string;
  }
): TenantAppState[] {
  const q = (options.searchQuery ?? '').trim().toLowerCase();
  const category = options.category ?? 'all';
  const status = options.status ?? 'all';

  return apps.filter((app) => {
    if (category !== 'all' && app.category !== category) {
      return false;
    }
    if (status === 'enabled' && !app.enabled) {
      return false;
    }
    if (status === 'disabled' && (!app.supportsTenantActivation || app.enabled)) {
      return false;
    }
    if (
      status !== 'all' &&
      status !== 'enabled' &&
      status !== 'disabled' &&
      app.status !== status
    ) {
      return false;
    }
    if (!q) return true;
    return (
      app.name.toLowerCase().includes(q) ||
      app.id.toLowerCase().includes(q) ||
      app.shortDescription.toLowerCase().includes(q) ||
      app.description.toLowerCase().includes(q) ||
      app.category.toLowerCase().includes(q) ||
      app.inspiredBy.toLowerCase().includes(q)
    );
  });
}
