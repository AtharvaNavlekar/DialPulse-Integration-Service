import type { NavSectionId } from './types.ts';

export type FormSubTab = 'list' | 'builder' | 'preview' | 'submissions' | 'analytics';
export type AutomationSubTab = 'workflows' | 'templates' | 'executions' | 'editor';
export type CostSubTab = 'overview' | 'analytics' | 'records' | 'budgets' | 'providers';
export type SettingsSubTab = 'organization' | 'apps' | 'integrations';
export type IntegrationsSubTab =
  | 'overview'
  | 'providers'
  | 'connections'
  | 'webhooks'
  | 'events'
  | 'dlq'
  | 'mappings'
  | 'audit';

export interface ParsedWorkspaceRoute {
  section: NavSectionId;
  formId: number | null;
  formTab: FormSubTab;
  automationId: number | null;
  automationTab: AutomationSubTab;
  costTab: CostSubTab;
  settingsTab: SettingsSubTab;
  integrationsTab: IntegrationsSubTab;
}

const VALID_INTEGRATION_TABS = new Set<IntegrationsSubTab>([
  'overview',
  'providers',
  'connections',
  'webhooks',
  'events',
  'dlq',
  'mappings',
  'audit',
]);

const VALID_COST_TABS = new Set<CostSubTab>([
  'overview',
  'analytics',
  'records',
  'budgets',
  'providers',
]);

const SECTION_PATH_MAP: Record<NavSectionId, string> = {
  overview: '/overview',
  'my-apps': '/apps',
  'forms-studio': '/forms',
  'workflow-automation': '/automations',
  'appointment-scheduler': '/appointments',
  'call-operations': '/calls',
  'support-inbox': '/inbox',
  'document-workflow': '/documents',
  'business-analytics': '/analytics',
  'cost-control-center': '/costs',
  'activity-logs': '/activity',
  notifications: '/notifications',
  profile: '/profile',
  preferences: '/preferences',
  settings: '/settings',
};

function defaultRoute(section: NavSectionId): ParsedWorkspaceRoute {
  return {
    section,
    formId: null,
    formTab: 'list',
    automationId: null,
    automationTab: 'workflows',
    costTab: 'overview',
    settingsTab: 'organization',
    integrationsTab: 'overview',
  };
}

export function parseWorkspaceRoute(pathname: string): ParsedWorkspaceRoute {
  const clean = pathname.replace(/\/+$/, '') || '/';

  const formMatch = clean.match(/^\/forms\/(\d+)(?:\/(builder|preview|submissions|analytics))?$/);
  if (formMatch) {
    return {
      ...defaultRoute('forms-studio'),
      formId: Number(formMatch[1]),
      formTab: (formMatch[2] as FormSubTab) || 'builder',
    };
  }

  if (clean === '/forms') {
    return defaultRoute('forms-studio');
  }

  if (clean === '/automations/templates') {
    return {
      ...defaultRoute('workflow-automation'),
      automationTab: 'templates',
    };
  }

  if (clean === '/automations/executions') {
    return {
      ...defaultRoute('workflow-automation'),
      automationTab: 'executions',
    };
  }

  if (clean === '/automations/new') {
    return {
      ...defaultRoute('workflow-automation'),
      automationTab: 'editor',
    };
  }

  const autoMatch = clean.match(/^\/automations\/(\d+)$/);
  if (autoMatch) {
    return {
      ...defaultRoute('workflow-automation'),
      automationId: Number(autoMatch[1]),
      automationTab: 'editor',
    };
  }

  if (clean === '/automations') {
    return defaultRoute('workflow-automation');
  }

  const costMatch = clean.match(/^\/costs(?:\/([a-z-]+))?$/);
  if (costMatch) {
    const rawSub = costMatch[1] as CostSubTab | undefined;
    const costTab = rawSub && VALID_COST_TABS.has(rawSub) ? rawSub : 'overview';
    return {
      ...defaultRoute('cost-control-center'),
      costTab,
    };
  }

  if (clean === '/settings/apps') {
    return {
      ...defaultRoute('settings'),
      settingsTab: 'apps',
    };
  }

  const intMatch = clean.match(/^\/settings\/integrations(?:\/([a-z-]+))?$/);
  if (intMatch) {
    const rawSub = intMatch[1] as IntegrationsSubTab | undefined;
    const integrationsTab =
      rawSub && VALID_INTEGRATION_TABS.has(rawSub) ? rawSub : 'overview';
    return {
      ...defaultRoute('settings'),
      settingsTab: 'integrations',
      integrationsTab,
    };
  }

  const matchedEntry = (Object.entries(SECTION_PATH_MAP) as Array<[NavSectionId, string]>).find(
    ([, path]) => path === clean
  );

  if (matchedEntry) {
    return defaultRoute(matchedEntry[0]);
  }

  return defaultRoute('overview');
}

export function buildWorkspacePath(
  section: NavSectionId,
  options?: {
    formId?: number | null;
    formTab?: FormSubTab;
    automationId?: number | null;
    automationTab?: AutomationSubTab;
    costTab?: CostSubTab;
    settingsTab?: SettingsSubTab;
    integrationsTab?: IntegrationsSubTab;
  }
): string {
  if (section === 'forms-studio') {
    if (options?.formId && options.formTab && options.formTab !== 'list') {
      return `/forms/${options.formId}/${options.formTab}`;
    }
    return '/forms';
  }

  if (section === 'workflow-automation') {
    if (options?.automationTab === 'templates') return '/automations/templates';
    if (options?.automationTab === 'executions') return '/automations/executions';
    if (options?.automationTab === 'editor') {
      return options.automationId ? `/automations/${options.automationId}` : '/automations/new';
    }
    return '/automations';
  }

  if (section === 'cost-control-center') {
    if (options?.costTab && options.costTab !== 'overview') {
      return `/costs/${options.costTab}`;
    }
    return '/costs';
  }

  if (section === 'settings') {
    if (options?.settingsTab === 'apps') {
      return '/settings/apps';
    }
    if (options?.settingsTab === 'integrations') {
      if (options.integrationsTab && options.integrationsTab !== 'overview') {
        return `/settings/integrations/${options.integrationsTab}`;
      }
      return '/settings/integrations';
    }
    return '/settings';
  }

  return SECTION_PATH_MAP[section] || '/overview';
}
