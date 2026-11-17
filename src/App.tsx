import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  BarChart3,
  Bell,
  CalendarClock,
  Check,
  ChevronDown,
  CircleDollarSign,
  FileCheck2,
  FileText,
  Inbox,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  PhoneCall,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  UserCircle2,
  Workflow,
  X,
} from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { PreferencesProvider, usePreferences } from './context/PreferencesContext.tsx';
import { ThemeProvider } from './context/ThemeContext.tsx';
import { ToastProvider, useToast } from './context/ToastContext.tsx';
import { ActivityLogsView } from './components/ActivityLogsView.tsx';
import { AutomationView } from './components/AutomationView.tsx';
import { ComingSoonView } from './components/ComingSoonView.tsx';
import { CostControlCenterView } from './components/costs/CostControlCenterView.tsx';
import { FormsStudioView } from './components/FormsStudioView.tsx';
import { MyAppsView } from './components/MyAppsView.tsx';
import {
  NotificationsView,
  type WorkspaceNotificationItem,
} from './components/NotificationsView.tsx';
import { OverviewView } from './components/OverviewView.tsx';
import { PreferencesView } from './components/PreferencesView.tsx';
import { ProfileView } from './components/ProfileView.tsx';
import { PublicFormPage } from './components/PublicFormPage.tsx';
import { SettingsView } from './components/SettingsView.tsx';
import { DialPulseMark } from './components/ui/DialPulseLogo.tsx';
import {
  AlertBanner,
  Button,
  Card,
  SELECT_BASE_CLASS,
  ThemeToggleButton,
} from './components/ui/Primitives.tsx';
import {
  buildWorkspacePath,
  parseWorkspaceRoute,
  type AutomationSubTab,
  type CostSubTab,
  type FormSubTab,
  type IntegrationsSubTab,
  type ParsedWorkspaceRoute,
  type SettingsSubTab,
} from './shared/routes.ts';
import { isWorkspaceModuleEnabled } from './shared/app-catalog.ts';
import { hasEffectivePermission } from './shared/rbac.ts';
import type { GlobalSearchResultItem, NavSectionId } from './shared/types.ts';

interface NavItem {
  id: NavSectionId;
  label: string;
  keywords: string;
  icon: React.ComponentType<{ className?: string }>;
  comingSoon?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'overview', label: 'Overview', keywords: 'dashboard summary kpi home', icon: LayoutDashboard },
  { id: 'my-apps', label: 'My Apps', keywords: 'launcher catalog mini apps', icon: LayoutGrid },
  { id: 'forms-studio', label: 'Forms Studio', keywords: 'forms builder intake tally jotform', icon: FileText },
  { id: 'workflow-automation', label: 'Workflow Automation', keywords: 'automation triggers actions n8n', icon: Workflow },
  { id: 'appointment-scheduler', label: 'Appointment Scheduler', keywords: 'calendar booking calendly', icon: CalendarClock, comingSoon: true },
  { id: 'call-operations', label: 'Call Operations', keywords: 'calling queue vapi voice', icon: PhoneCall, comingSoon: true },
  { id: 'support-inbox', label: 'Support Inbox', keywords: 'tickets crisp chat support', icon: Inbox, comingSoon: true },
  { id: 'document-workflow', label: 'Document Workflow', keywords: 'checklist drive verification', icon: FileCheck2, comingSoon: true },
  { id: 'business-analytics', label: 'Business Analytics', keywords: 'reports funnel posthog', icon: BarChart3, comingSoon: true },
  { id: 'cost-control-center', label: 'Cost Control Center', keywords: 'costs spend billing budgets alerts pricing finops', icon: CircleDollarSign },
  { id: 'activity-logs', label: 'Activity Logs', keywords: 'audit trail events history', icon: Activity },
  { id: 'settings', label: 'Settings', keywords: 'departments queues roles stages sla employees rules apps management', icon: Settings },
];

const UTILITY_NAV_ITEMS: NavItem[] = [
  { id: 'notifications', label: 'Notifications', keywords: 'alerts inbox unread notices', icon: Bell },
  { id: 'profile', label: 'My Profile', keywords: 'account identity memberships role permissions', icon: UserCircle2 },
  { id: 'preferences', label: 'Preferences', keywords: 'theme timezone date format density', icon: SlidersHorizontal },
];

const ALL_NAV_ITEMS: NavItem[] = [...NAV_ITEMS, ...UTILITY_NAV_ITEMS];

const ENTITY_TYPE_LABEL: Record<GlobalSearchResultItem['entityType'], string> = {
  form: 'Form',
  submission: 'Submission',
  automation: 'Workflow',
  lead: 'Lead',
  task: 'Task',
  activity: 'Audit Log',
};

function WorkspaceShell() {
  const {
    firebaseUser,
    authReady,
    session,
    sessionLoading,
    sessionError,
    signInWithGoogle,
    signOut,
    switchTenant,
    apiFetch,
  } = useAuth();
  const { formatTimestamp } = usePreferences();
  const { pushToast } = useToast();

  const [route, setRoute] = useState<ParsedWorkspaceRoute>(() =>
    parseWorkspaceRoute(
      typeof window !== 'undefined' ? window.location.pathname : '/overview'
    )
  );
  const activeSection = route.section;

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Header search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [remoteSearchResults, setRemoteSearchResults] = useState<
    GlobalSearchResultItem[]
  >([]);
  const [remoteSearchLoading, setRemoteSearchLoading] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Notifications
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<
    WorkspaceNotificationItem[]
  >([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const notificationsRef = useRef<HTMLDivElement>(null);

  // Profile menu
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  const navigateTo = useCallback(
    (
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
    ) => {
      const nextPath = buildWorkspacePath(section, options);
      const nextRoute = parseWorkspaceRoute(nextPath);
      setRoute(nextRoute);
      if (typeof window !== 'undefined' && window.location.pathname !== nextPath) {
        window.history.pushState(null, '', nextPath);
      }
    },
    []
  );

  useEffect(() => {
    const handlePopState = () => {
      setRoute(parseWorkspaceRoute(window.location.pathname));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const loadNotifications = useCallback(async () => {
    if (!session) return;
    setNotificationsLoading(true);
    try {
      const res = await apiFetch<{ notifications: WorkspaceNotificationItem[] }>(
        '/api/workspace/notifications'
      );
      setNotifications(res.notifications);
    } catch {
      // keep silent in background poll
    } finally {
      setNotificationsLoading(false);
    }
  }, [apiFetch, session]);

  useEffect(() => {
    if (session) {
      void loadNotifications();
    }
  }, [session, session?.activeTenant.tenantId, loadNotifications]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (searchContainerRef.current && !searchContainerRef.current.contains(target)) {
        setSearchOpen(false);
      }
      if (notificationsRef.current && !notificationsRef.current.contains(target)) {
        setNotificationsOpen(false);
      }
      if (profileRef.current && !profileRef.current.contains(target)) {
        setProfileOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSearchOpen(false);
        setNotificationsOpen(false);
        setProfileOpen(false);
        setMobileNavOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  // Backend Global Search (forms, submissions, automations, leads, tasks, activity)
  useEffect(() => {
    const q = searchQuery.trim();
    if (!session || q.length < 2) {
      setRemoteSearchResults([]);
      setRemoteSearchLoading(false);
      return;
    }

    let cancelled = false;
    setRemoteSearchLoading(true);
    const timer = window.setTimeout(() => {
      apiFetch<{ results: GlobalSearchResultItem[] }>(
        `/api/workspace/search?q=${encodeURIComponent(q)}`
      )
        .then((res) => {
          if (!cancelled) setRemoteSearchResults(res.results);
        })
        .catch(() => {
          if (!cancelled) setRemoteSearchResults([]);
        })
        .finally(() => {
          if (!cancelled) setRemoteSearchLoading(false);
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [apiFetch, searchQuery, session, session?.activeTenant.tenantId]);

  const formsAppEnabled = isWorkspaceModuleEnabled(session?.apps, 'forms-studio');
  const automationsAppEnabled = isWorkspaceModuleEnabled(
    session?.apps,
    'workflow-automation'
  );
  const costAppEnabled = isWorkspaceModuleEnabled(
    session?.apps,
    'cost-control-center'
  );
  const canViewForms = hasEffectivePermission(session?.permissions, 'canViewForms');
  const canViewAutomations = hasEffectivePermission(
    session?.permissions,
    'canViewAutomations'
  );
  const canViewCosts = hasEffectivePermission(
    session?.permissions,
    'canViewCostCenter'
  );
  const canManageApps = hasEffectivePermission(
    session?.permissions,
    'canManageSettings'
  );

  const isNavItemDisabled = useCallback(
    (id: NavSectionId) => {
      if (id === 'forms-studio') return !formsAppEnabled || !canViewForms;
      if (id === 'workflow-automation')
        return !automationsAppEnabled || !canViewAutomations;
      if (id === 'cost-control-center')
        return !costAppEnabled || !canViewCosts;
      return false;
    },
    [
      formsAppEnabled,
      automationsAppEnabled,
      costAppEnabled,
      canViewForms,
      canViewAutomations,
      canViewCosts,
    ]
  );

  const moduleSearchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const candidates = q
      ? ALL_NAV_ITEMS.filter(
          (item) =>
            item.label.toLowerCase().includes(q) ||
            item.keywords.toLowerCase().includes(q)
        )
      : NAV_ITEMS;
    return candidates
      .filter((item) => !isNavItemDisabled(item.id))
      .slice(0, 6);
  }, [searchQuery, isNavItemDisabled]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications]
  );

  const handleMarkAllRead = async () => {
    try {
      const res = await apiFetch<{ notifications: WorkspaceNotificationItem[] }>(
        '/api/workspace/notifications/mark-read',
        { method: 'POST', body: JSON.stringify({}) }
      );
      setNotifications(res.notifications);
      pushToast('Notifications marked as read.', 'info');
    } catch {
      pushToast('Unable to update notifications.', 'error');
    }
  };

  const handleGoogleSignIn = async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'Google sign-in failed.'
      );
    } finally {
      setAuthBusy(false);
    }
  };

  if (!authReady || (firebaseUser && sessionLoading && !session)) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-[var(--dp-surface)] text-[var(--dp-on-surface)]">
        <DialPulseMark className="w-9 h-9" />
        <div className="text-[14px] text-[var(--dp-on-surface-variant)]">
          Loading DialPulse Workspace...
        </div>
      </div>
    );
  }

  if (!firebaseUser || !session) {
    return (
      <div className="min-h-screen bg-[var(--dp-surface)] text-[var(--dp-on-surface)] flex flex-col">
        <header className="h-14 px-4 sm:px-6 flex items-center justify-between border-b border-[var(--dp-outline-variant)] bg-[var(--dp-background)]">
          <div className="flex items-center gap-2.5">
            <DialPulseMark className="w-7 h-7 shrink-0" />
            <span className="font-heading text-[15px] font-bold tracking-tight text-[var(--dp-on-surface)] whitespace-nowrap">
              DialPulse Workspace
            </span>
          </div>
          <ThemeToggleButton showLabel />
        </header>

        <main className="flex-1 flex flex-col justify-center items-center px-4 py-12">
          <Card className="w-full max-w-md p-8 space-y-6 rounded-[var(--dp-radius-lg)]">
            <div className="space-y-2.5">
              <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--dp-primary)]">
                <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>DialPulse Financial Operations Ecosystem</span>
              </div>
              <h1 className="text-[24px] font-semibold text-[var(--dp-on-surface)] tracking-tight">
                Sign in to DialPulse Workspace
              </h1>
              <p className="text-[14px] text-[var(--dp-on-surface-variant)] leading-relaxed">
                Access Forms Studio, Workflow Automation, configurable Loan-DSA queues, and tenant-isolated operational logs.
              </p>
            </div>

            {(authError || sessionError) && (
              <AlertBanner tone="error" message={authError || sessionError || ''} />
            )}

            <Button
              type="button"
              variant="primary"
              onClick={handleGoogleSignIn}
              disabled={authBusy}
              className="w-full h-10"
            >
              {authBusy ? 'Signing in...' : 'Sign in with Google'}
            </Button>

            <div className="pt-4 border-t border-[var(--dp-outline-variant)] text-[12px] text-[var(--dp-on-surface-variant)] space-y-1.5 leading-relaxed">
              <p>
                First sign-in provisions demo Loan-DSA tenants with synthetic sample records.
              </p>
              <p>
                Client CRM, Central CRM, and Integration Service communicate through mock boundary adapters.
              </p>
            </div>
          </Card>
        </main>
      </div>
    );
  }

  const activeNav =
    ALL_NAV_ITEMS.find((item) => item.id === activeSection) ?? NAV_ITEMS[0]!;
  const initials = (session.user.displayName || session.user.email || 'DP')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  const renderNavItemButton = (item: NavItem, isMobile = false) => {
    const Icon = item.icon;
    const active = activeSection === item.id;
    const disabledByTenantOrRole = isNavItemDisabled(item.id);
    if (disabledByTenantOrRole && activeSection !== item.id) {
      return null;
    }

    return (
      <div key={item.id} className="relative group">
        <button
          type="button"
          onClick={() => {
            navigateTo(item.id);
            if (isMobile) setMobileNavOpen(false);
          }}
          aria-current={active ? 'page' : undefined}
          aria-label={item.label}
          title={sidebarCollapsed && !isMobile ? item.label : undefined}
          className={`w-full flex items-center ${
            sidebarCollapsed && !isMobile
              ? 'justify-center px-2'
              : 'justify-between px-3'
          } ${isMobile ? 'py-2.5' : 'py-2'} text-[13px] font-medium rounded-[var(--dp-radius-sm)] transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dp-primary)] ${
            active
              ? 'bg-[var(--dp-primary-container)] text-[var(--dp-on-primary-container)] font-semibold'
              : 'text-[var(--dp-on-surface-variant)] hover:bg-[var(--dp-surface-variant)] hover:text-[var(--dp-on-surface)]'
          }`}
        >
          <span className="flex items-center gap-2.5 min-w-0">
            <Icon
              className={`w-4 h-4 shrink-0 ${
                active ? 'text-[var(--dp-primary)]' : ''
              }`}
              aria-hidden="true"
            />
            {(!sidebarCollapsed || isMobile) && (
              <span className="truncate">{item.label}</span>
            )}
          </span>
          {(!sidebarCollapsed || isMobile) && disabledByTenantOrRole && (
            <span className="text-[11px] font-normal text-[var(--dp-error)] shrink-0">
              Off
            </span>
          )}
          {(!sidebarCollapsed || isMobile) &&
            !disabledByTenantOrRole &&
            item.comingSoon && (
              <span className="text-[11px] font-normal text-[var(--dp-outline)] shrink-0">
                {item.id === 'document-workflow' ? 'Blocked' : 'Soon'}
              </span>
            )}
          {(!sidebarCollapsed || isMobile) &&
            item.id === 'notifications' &&
            unreadCount > 0 && (
              <span className="text-[11px] font-semibold text-[var(--dp-primary)] tabular-nums shrink-0">
                {unreadCount}
              </span>
            )}
        </button>

        {sidebarCollapsed && !isMobile && (
          <div
            role="tooltip"
            className="pointer-events-none opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150 fixed left-[76px] -translate-y-7 z-50 px-2.5 py-1 rounded-[var(--dp-radius-sm)] bg-[var(--dp-navy)] text-white text-[12px] font-medium whitespace-nowrap shadow-md"
          >
            {item.label}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen flex bg-[var(--dp-surface)] text-[var(--dp-on-surface)]">
      {/* Desktop Persistent Sidebar */}
      <aside
        className={`hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 bg-[var(--dp-background)] border-r border-[var(--dp-outline-variant)] transition-all duration-150 z-30 ${
          sidebarCollapsed ? 'lg:w-[72px]' : 'lg:w-64'
        }`}
      >
        <div className="h-14 px-3.5 flex items-center justify-between border-b border-[var(--dp-outline-variant)] gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <DialPulseMark className="w-7 h-7 shrink-0" />
            {!sidebarCollapsed && (
              <span className="font-heading text-[15px] font-bold tracking-tight text-[var(--dp-on-surface)] truncate">
                DialPulse Workspace
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setSidebarCollapsed((c) => !c)}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="p-1.5 rounded-[var(--dp-radius-sm)] text-[var(--dp-on-surface-variant)] hover:text-[var(--dp-on-surface)] hover:bg-[var(--dp-surface-variant)] transition-colors duration-150 cursor-pointer shrink-0"
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen className="w-4 h-4" aria-hidden="true" />
            ) : (
              <PanelLeftClose className="w-4 h-4" aria-hidden="true" />
            )}
          </button>
        </div>

        <nav
          aria-label="Workspace navigation"
          className="flex-1 overflow-y-auto px-2.5 py-3 space-y-1"
        >
          {NAV_ITEMS.map((item) => renderNavItemButton(item, false))}

          <div className="pt-3 mt-3 border-t border-[var(--dp-outline-variant)] space-y-1">
            {!sidebarCollapsed && (
              <div className="px-3 pb-1 text-[11px] font-semibold text-[var(--dp-outline)] uppercase tracking-wider">
                Account
              </div>
            )}
            {UTILITY_NAV_ITEMS.map((item) => renderNavItemButton(item, false))}
          </div>
        </nav>

        <div className="p-3 border-t border-[var(--dp-outline-variant)]">
          {sidebarCollapsed ? (
            <button
              type="button"
              onClick={() => navigateTo('profile')}
              title={`${session.user.displayName} · ${session.permissions.label}`}
              className="w-9 h-9 mx-auto rounded-full bg-[var(--dp-primary-container)] text-[var(--dp-on-primary-container)] flex items-center justify-center text-[12px] font-semibold cursor-pointer"
            >
              {initials}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => navigateTo('profile')}
              className="w-full text-left space-y-0.5 px-1 py-0.5 rounded-[var(--dp-radius-sm)] hover:bg-[var(--dp-surface-variant)] cursor-pointer transition-colors"
            >
              <div className="text-[12px] font-semibold text-[var(--dp-on-surface)] truncate">
                {session.user.displayName}
              </div>
              <div className="text-[11px] text-[var(--dp-on-surface-variant)] truncate">
                {session.user.email}
              </div>
              <div className="text-[11px] font-medium text-[var(--dp-primary)] pt-0.5">
                {session.permissions.label}
              </div>
            </button>
          )}
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="relative w-72 max-w-[85vw] bg-[var(--dp-background)] h-full border-r border-[var(--dp-outline-variant)] flex flex-col z-50">
            <div className="h-14 px-4 flex items-center justify-between border-b border-[var(--dp-outline-variant)]">
              <div className="flex items-center gap-2.5">
                <DialPulseMark className="w-7 h-7 shrink-0" />
                <span className="font-heading text-[15px] font-bold text-[var(--dp-on-surface)]">
                  DialPulse Workspace
                </span>
              </div>
              <button
                type="button"
                aria-label="Close navigation"
                onClick={() => setMobileNavOpen(false)}
                className="p-1.5 rounded-[var(--dp-radius-sm)] text-[var(--dp-on-surface-variant)] hover:text-[var(--dp-on-surface)] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
              {NAV_ITEMS.map((item) => renderNavItemButton(item, true))}
              <div className="pt-3 mt-3 border-t border-[var(--dp-outline-variant)] space-y-1">
                <div className="px-3 pb-1 text-[11px] font-semibold text-[var(--dp-outline)] uppercase tracking-wider">
                  Account
                </div>
                {UTILITY_NAV_ITEMS.map((item) => renderNavItemButton(item, true))}
              </div>
            </nav>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div
        className={`flex-1 flex flex-col min-w-0 transition-all duration-150 ${
          sidebarCollapsed ? 'lg:pl-[72px]' : 'lg:pl-64'
        }`}
      >
        <header className="h-14 bg-[var(--dp-background)] border-b border-[var(--dp-outline-variant)] px-4 md:px-6 flex items-center justify-between gap-3 sticky top-0 z-20">
          {/* Breadcrumb & Mobile Menu */}
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              aria-label="Open navigation"
              onClick={() => setMobileNavOpen(true)}
              className="lg:hidden p-2 rounded-[var(--dp-radius-sm)] text-[var(--dp-on-surface-variant)] hover:text-[var(--dp-on-surface)] hover:bg-[var(--dp-surface-variant)] cursor-pointer"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-1.5 text-[13px] min-w-0">
              <span className="hidden sm:inline text-[var(--dp-on-surface-variant)] whitespace-nowrap">
                Workspace
              </span>
              <span className="hidden sm:inline text-[var(--dp-outline)]">/</span>
              <span className="font-heading font-semibold text-[var(--dp-on-surface)] truncate">
                {activeSection === 'settings' && route.settingsTab === 'integrations'
                  ? 'Settings / Integrations Console'
                  : activeSection === 'settings' && route.settingsTab === 'apps'
                    ? 'Settings / App Management'
                    : activeNav.label}
              </span>
            </div>
          </div>

          {/* Global Search Bar (Desktop & Tablet) */}
          <div ref={searchContainerRef} className="relative hidden md:block w-64 lg:w-96">
            <div className="relative">
              <Search
                className="w-3.5 h-3.5 text-[var(--dp-outline)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="search"
                aria-label="Global workspace search"
                value={searchQuery}
                onFocus={() => setSearchOpen(true)}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSearchOpen(true);
                }}
                placeholder="Search forms, leads, workflows, or modules..."
                className="w-full h-9 pl-8 pr-3 text-[13px] bg-[var(--dp-surface)] text-[var(--dp-on-surface)] placeholder:text-[var(--dp-outline)] border border-[var(--dp-outline-variant)] rounded-[var(--dp-radius-sm)] focus:outline-none focus:border-[var(--dp-primary)] focus:ring-2 focus:ring-[var(--dp-primary)]/20"
              />
            </div>

            {searchOpen && (
              <div className="absolute left-0 right-0 mt-1.5 bg-[var(--dp-surface-container-lowest)] border border-[var(--dp-outline-variant)] rounded-[var(--dp-radius-md)] shadow-lg py-1.5 z-40 max-h-96 overflow-y-auto">
                {moduleSearchResults.length > 0 && (
                  <div className="pb-1">
                    <div className="px-3.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--dp-outline)]">
                      Workspace Modules
                    </div>
                    {moduleSearchResults.map((item) => {
                      const Icon = item.icon;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            navigateTo(item.id);
                            setSearchOpen(false);
                            setSearchQuery('');
                          }}
                          className="w-full px-3.5 py-2 flex items-center justify-between gap-2 text-left text-[13px] text-[var(--dp-on-surface)] hover:bg-[var(--dp-surface-variant)] cursor-pointer"
                        >
                          <span className="flex items-center gap-2.5 truncate">
                            <Icon className="w-4 h-4 text-[var(--dp-primary)] shrink-0" />
                            <span className="truncate">{item.label}</span>
                          </span>
                          <span className="text-[11px] text-[var(--dp-on-surface-variant)] shrink-0">
                            {item.comingSoon ? 'Roadmap' : 'Open'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {searchQuery.trim().length >= 2 && (
                  <div className="pt-1 border-t border-[var(--dp-outline-variant)]">
                    <div className="px-3.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--dp-outline)]">
                      Tenant Records ({session.activeTenant.tenantName})
                    </div>
                    {remoteSearchLoading ? (
                      <div className="px-3.5 py-2.5 text-[12px] text-[var(--dp-on-surface-variant)]">
                        Searching PostgreSQL records...
                      </div>
                    ) : remoteSearchResults.length === 0 ? (
                      <div className="px-3.5 py-2.5 text-[12px] text-[var(--dp-on-surface-variant)]">
                        No matching forms, submissions, workflows, leads, or tasks.
                      </div>
                    ) : (
                      remoteSearchResults.map((hit) => (
                        <button
                          key={hit.id}
                          type="button"
                          onClick={() => {
                            const parsed = parseWorkspaceRoute(hit.routePath);
                            navigateTo(parsed.section, {
                              formId: parsed.formId,
                              formTab: parsed.formTab,
                              automationId: parsed.automationId,
                              automationTab: parsed.automationTab,
                              costTab: parsed.costTab,
                              settingsTab: parsed.settingsTab,
                              integrationsTab: parsed.integrationsTab,
                            });
                            setSearchOpen(false);
                            setSearchQuery('');
                          }}
                          className="w-full px-3.5 py-2 flex items-start justify-between gap-3 text-left hover:bg-[var(--dp-surface-variant)] cursor-pointer"
                        >
                          <div className="min-w-0">
                            <div className="text-[13px] font-medium text-[var(--dp-on-surface)] truncate">
                              {hit.title}
                            </div>
                            <div className="text-[11px] text-[var(--dp-on-surface-variant)] truncate">
                              {hit.subtitle}
                            </div>
                          </div>
                          <span className="text-[11px] font-medium text-[var(--dp-primary)] shrink-0 pt-0.5">
                            {ENTITY_TYPE_LABEL[hit.entityType]}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}

                {moduleSearchResults.length === 0 &&
                  searchQuery.trim().length < 2 && (
                    <div className="px-3.5 py-2.5 text-[12px] text-[var(--dp-on-surface-variant)]">
                      Type at least 2 characters to search forms, submissions, leads, and workflows.
                    </div>
                  )}
              </div>
            )}
          </div>

          {/* Right Utilities: Tenant Context, Notifications, Theme, Profile */}
          <div className="flex items-center gap-2 shrink-0">
            <select
              aria-label="Active Tenant"
              value={session.activeTenant.tenantId}
              onChange={(e) => void switchTenant(Number(e.target.value))}
              className={`${SELECT_BASE_CLASS} h-9 max-w-44 sm:max-w-56 truncate`}
            >
              {session.memberships.map((m) => (
                <option key={m.tenantId} value={m.tenantId}>
                  {m.tenantName} ({m.roleKey})
                </option>
              ))}
            </select>

            {/* Notifications Popover */}
            <div ref={notificationsRef} className="relative">
              <button
                type="button"
                aria-label={`Notifications (${unreadCount} unread)`}
                onClick={() => {
                  setNotificationsOpen((o) => !o);
                  if (!notificationsOpen) void loadNotifications();
                }}
                className="relative inline-flex items-center justify-center w-9 h-9 rounded-[var(--dp-radius-sm)] border border-[var(--dp-outline-variant)] bg-[var(--dp-surface-container-lowest)] text-[var(--dp-on-surface-variant)] hover:text-[var(--dp-on-surface)] hover:bg-[var(--dp-surface-variant)] transition-colors duration-150 cursor-pointer"
              >
                <Bell className="w-4 h-4" aria-hidden="true" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-[var(--dp-primary)] text-[var(--dp-on-primary)] text-[10px] font-semibold flex items-center justify-center tabular-nums">
                    {unreadCount}
                  </span>
                )}
              </button>

              {notificationsOpen && (
                <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] bg-[var(--dp-surface-container-lowest)] border border-[var(--dp-outline-variant)] rounded-[var(--dp-radius-md)] shadow-lg z-40 overflow-hidden">
                  <div className="px-4 py-3 border-b border-[var(--dp-outline-variant)] flex items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold text-[var(--dp-on-surface)]">
                      Notifications
                    </span>
                    {unreadCount > 0 && (
                      <button
                        type="button"
                        onClick={() => void handleMarkAllRead()}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--dp-primary)] hover:underline cursor-pointer"
                      >
                        <Check className="w-3 h-3" /> Mark all read
                      </button>
                    )}
                  </div>
                  <div className="max-h-72 overflow-y-auto divide-y divide-[var(--dp-outline-variant)]">
                    {notificationsLoading && notifications.length === 0 ? (
                      <div className="p-4 text-[12px] text-[var(--dp-on-surface-variant)]">
                        Loading notifications...
                      </div>
                    ) : notifications.length === 0 ? (
                      <div className="p-5 text-center text-[12px] text-[var(--dp-on-surface-variant)]">
                        No notifications for this tenant yet.
                      </div>
                    ) : (
                      notifications.slice(0, 8).map((notif) => (
                        <div
                          key={notif.id}
                          className={`px-4 py-3 text-[12px] space-y-1 ${
                            notif.read
                              ? 'bg-transparent'
                              : 'bg-[var(--dp-primary-container)]/35'
                          }`}
                        >
                          <div className="font-medium text-[var(--dp-on-surface)]">
                            {notif.title}
                          </div>
                          <div className="text-[var(--dp-on-surface-variant)] leading-snug">
                            {notif.message}
                          </div>
                          <div className="font-mono text-[11px] text-[var(--dp-outline)] tabular-nums">
                            {formatTimestamp(notif.createdAt)}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="px-4 py-2.5 border-t border-[var(--dp-outline-variant)] bg-[var(--dp-surface-container-low)]">
                    <button
                      type="button"
                      onClick={() => {
                        setNotificationsOpen(false);
                        navigateTo('notifications');
                      }}
                      className="w-full text-center text-[12px] font-medium text-[var(--dp-primary)] hover:underline cursor-pointer"
                    >
                      Open Notifications Center
                    </button>
                  </div>
                </div>
              )}
            </div>

            <ThemeToggleButton />

            {/* User Avatar & Profile Menu */}
            <div ref={profileRef} className="relative">
              <button
                type="button"
                aria-label="Open profile menu"
                aria-expanded={profileOpen}
                onClick={() => setProfileOpen((o) => !o)}
                className="inline-flex items-center gap-2 h-9 pl-1.5 pr-2.5 rounded-[var(--dp-radius-sm)] border border-[var(--dp-outline-variant)] bg-[var(--dp-surface-container-lowest)] hover:bg-[var(--dp-surface-variant)] transition-colors duration-150 cursor-pointer"
              >
                {firebaseUser.photoURL ? (
                  <img
                    src={firebaseUser.photoURL}
                    alt={session.user.displayName}
                    referrerPolicy="no-referrer"
                    className="w-6 h-6 rounded-full object-cover"
                  />
                ) : (
                  <span className="w-6 h-6 rounded-full bg-[var(--dp-primary)] text-[var(--dp-on-primary)] text-[11px] font-semibold flex items-center justify-center">
                    {initials}
                  </span>
                )}
                <ChevronDown
                  className="w-3.5 h-3.5 text-[var(--dp-on-surface-variant)] hidden sm:block"
                  aria-hidden="true"
                />
              </button>

              {profileOpen && (
                <div className="absolute right-0 mt-2 w-64 bg-[var(--dp-surface-container-lowest)] border border-[var(--dp-outline-variant)] rounded-[var(--dp-radius-md)] shadow-lg z-40 overflow-hidden">
                  <div className="px-4 py-3 border-b border-[var(--dp-outline-variant)] space-y-0.5">
                    <div className="text-[13px] font-semibold text-[var(--dp-on-surface)] truncate">
                      {session.user.displayName}
                    </div>
                    <div className="text-[12px] text-[var(--dp-on-surface-variant)] truncate">
                      {session.user.email}
                    </div>
                    <div className="text-[11px] font-medium text-[var(--dp-primary)] pt-1">
                      {session.activeTenant.tenantName} · {session.permissions.label}
                    </div>
                  </div>
                  <div className="p-1.5 space-y-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        navigateTo('profile');
                        setProfileOpen(false);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-[var(--dp-on-surface)] hover:bg-[var(--dp-surface-variant)] rounded-[var(--dp-radius-sm)] cursor-pointer"
                    >
                      <UserCircle2 className="w-4 h-4 text-[var(--dp-on-surface-variant)]" />
                      My Profile & Memberships
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        navigateTo('preferences');
                        setProfileOpen(false);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-[var(--dp-on-surface)] hover:bg-[var(--dp-surface-variant)] rounded-[var(--dp-radius-sm)] cursor-pointer"
                    >
                      <SlidersHorizontal className="w-4 h-4 text-[var(--dp-on-surface-variant)]" />
                      Preferences
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        navigateTo('settings');
                        setProfileOpen(false);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-[var(--dp-on-surface)] hover:bg-[var(--dp-surface-variant)] rounded-[var(--dp-radius-sm)] cursor-pointer"
                    >
                      <Settings className="w-4 h-4 text-[var(--dp-on-surface-variant)]" />
                      Workspace Settings
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setProfileOpen(false);
                        void signOut();
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-[var(--dp-error)] hover:bg-[var(--dp-error-container)]/50 rounded-[var(--dp-radius-sm)] cursor-pointer"
                    >
                      <LogOut className="w-4 h-4" />
                      Sign out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 md:p-8 max-w-7xl w-full mx-auto">
          {activeSection === 'overview' && (
            <OverviewView onNavigate={(section) => navigateTo(section)} />
          )}
          {activeSection === 'my-apps' && (
            <MyAppsView
              onSelectApp={(section) => navigateTo(section)}
              onOpenAppManagement={() =>
                navigateTo('settings', { settingsTab: 'apps' })
              }
            />
          )}
          {activeSection === 'forms-studio' &&
            (!formsAppEnabled ? (
              <Card className="max-w-2xl p-6 space-y-4">
                <AlertBanner
                  tone="warning"
                  message={`Forms Studio is currently disabled for ${session.activeTenant.tenantName}. Existing forms and customer submissions remain safely preserved in PostgreSQL.`}
                />
                <div className="flex flex-wrap gap-2.5">
                  {canManageApps && (
                    <Button
                      variant="primary"
                      onClick={() =>
                        navigateTo('settings', { settingsTab: 'apps' })
                      }
                    >
                      Open App Management
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    onClick={() => navigateTo('overview')}
                  >
                    Return to Overview
                  </Button>
                </div>
              </Card>
            ) : !canViewForms ? (
              <Card className="max-w-2xl p-6 space-y-4">
                <AlertBanner
                  tone="error"
                  message={`Access restricted: your current role (${session.permissions.label}) does not include "canViewForms" permission for Forms Studio.`}
                />
                <div>
                  <Button
                    variant="secondary"
                    onClick={() => navigateTo('overview')}
                  >
                    Return to Overview
                  </Button>
                </div>
              </Card>
            ) : (
              <FormsStudioView
                routeFormId={route.formId}
                routeFormTab={route.formTab}
                onNavigateFormRoute={(formId, formTab) =>
                  navigateTo('forms-studio', { formId, formTab })
                }
              />
            ))}
          {activeSection === 'workflow-automation' &&
            (!automationsAppEnabled ? (
              <Card className="max-w-2xl p-6 space-y-4">
                <AlertBanner
                  tone="warning"
                  message={`Workflow Automation is currently disabled for ${session.activeTenant.tenantName}. Existing automation definitions and execution logs remain safely preserved in PostgreSQL.`}
                />
                <div className="flex flex-wrap gap-2.5">
                  {canManageApps && (
                    <Button
                      variant="primary"
                      onClick={() =>
                        navigateTo('settings', { settingsTab: 'apps' })
                      }
                    >
                      Open App Management
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    onClick={() => navigateTo('overview')}
                  >
                    Return to Overview
                  </Button>
                </div>
              </Card>
            ) : !canViewAutomations ? (
              <Card className="max-w-2xl p-6 space-y-4">
                <AlertBanner
                  tone="error"
                  message={`Access restricted: your current role (${session.permissions.label}) does not include "canViewAutomations" permission for Workflow Automation.`}
                />
                <div>
                  <Button
                    variant="secondary"
                    onClick={() => navigateTo('overview')}
                  >
                    Return to Overview
                  </Button>
                </div>
              </Card>
            ) : (
              <AutomationView
                routeAutomationId={route.automationId}
                routeAutomationTab={route.automationTab}
                onNavigateAutomationRoute={(automationId, automationTab) =>
                  navigateTo('workflow-automation', {
                    automationId,
                    automationTab,
                  })
                }
              />
            ))}
          {activeSection === 'cost-control-center' &&
            (!costAppEnabled ? (
              <Card className="max-w-2xl p-6 space-y-4">
                <AlertBanner
                  tone="warning"
                  message={`Cost Control Center is currently disabled for ${session.activeTenant.tenantName}. Historical cost records, pricing rules, and budgets remain safely preserved in PostgreSQL.`}
                />
                <div className="flex flex-wrap gap-2.5">
                  {canManageApps && (
                    <Button
                      variant="primary"
                      onClick={() =>
                        navigateTo('settings', { settingsTab: 'apps' })
                      }
                    >
                      Open App Management
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    onClick={() => navigateTo('overview')}
                  >
                    Return to Overview
                  </Button>
                </div>
              </Card>
            ) : !canViewCosts ? (
              <Card className="max-w-2xl p-6 space-y-4">
                <AlertBanner
                  tone="error"
                  message={`Access restricted: your current role (${session.permissions.label}) does not include "canViewCostCenter" permission for Cost Control Center.`}
                />
                <div>
                  <Button
                    variant="secondary"
                    onClick={() => navigateTo('overview')}
                  >
                    Return to Overview
                  </Button>
                </div>
              </Card>
            ) : (
              <CostControlCenterView
                routeTab={route.costTab}
                onNavigateTab={(costTab) =>
                  navigateTo('cost-control-center', { costTab })
                }
              />
            ))}
          {activeSection === 'activity-logs' && <ActivityLogsView />}
          {activeSection === 'notifications' && (
            <NotificationsView onNotificationsChange={setNotifications} />
          )}
          {activeSection === 'profile' && <ProfileView />}
          {activeSection === 'preferences' && <PreferencesView />}
          {activeSection === 'settings' && (
            <SettingsView
              routeSettingsTab={route.settingsTab}
              routeIntegrationsTab={route.integrationsTab}
              onNavigateSettingsRoute={(settingsTab, integrationsTab) =>
                navigateTo('settings', { settingsTab, integrationsTab })
              }
              onNavigateSection={(section) => navigateTo(section)}
            />
          )}
          {(activeSection === 'appointment-scheduler' ||
            activeSection === 'call-operations' ||
            activeSection === 'support-inbox' ||
            activeSection === 'document-workflow' ||
            activeSection === 'business-analytics') && (
            <ComingSoonView
              sectionId={activeSection}
              onReturnOverview={() => navigateTo('overview')}
            />
          )}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  const pathname =
    typeof window !== 'undefined' ? window.location.pathname : '/';
  const publicMatch = pathname.match(/^\/f\/([^/]+)$/);

  return (
    <ThemeProvider>
      <ToastProvider>
        {publicMatch && publicMatch[1] ? (
          <PublicFormPage slug={decodeURIComponent(publicMatch[1])} />
        ) : (
          <AuthProvider>
            <PreferencesProvider>
              <WorkspaceShell />
            </PreferencesProvider>
          </AuthProvider>
        )}
      </ToastProvider>
    </ThemeProvider>
  );
}
