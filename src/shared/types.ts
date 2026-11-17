export type RoleKey = 'admin' | 'manager' | 'operator' | 'viewer';

export type NavSectionId =
  | 'overview'
  | 'my-apps'
  | 'forms-studio'
  | 'workflow-automation'
  | 'appointment-scheduler'
  | 'call-operations'
  | 'support-inbox'
  | 'document-workflow'
  | 'business-analytics'
  | 'cost-control-center'
  | 'activity-logs'
  | 'notifications'
  | 'profile'
  | 'preferences'
  | 'settings';

export type FormFieldType =
  | 'short_text'
  | 'long_text'
  | 'email'
  | 'phone'
  | 'number'
  | 'dropdown'
  | 'single_choice'
  | 'multiple_choice'
  | 'date'
  | 'checkbox';

export interface FormFieldValidation {
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: string;
}

export interface FormFieldDefinition {
  id: string;
  key: string;
  type: FormFieldType;
  label: string;
  helpText?: string;
  placeholder?: string;
  required: boolean;
  options?: string[];
  validation?: FormFieldValidation;
}

export interface FormRecord {
  id: number;
  tenantId: number;
  slug: string;
  title: string;
  description: string;
  category: string;
  status: 'draft' | 'published';
  fields: FormFieldDefinition[];
  submitButtonLabel: string;
  successMessage: string;
  submissionCount?: number;
  createdByUid: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FormSubmissionRecord {
  id: number;
  tenantId: number;
  formId: number;
  formTitle?: string;
  idempotencyKey: string;
  source: 'public_form' | 'preview_test';
  answers: Record<string, unknown>;
  submitterSummary: string;
  createdAt: string;
}

export type AutomationTriggerType =
  | 'form_submitted'
  | 'lead_created'
  | 'task_completed'
  | 'appointment_booked'
  | 'status_changed';

export type ConditionOperator = 'equals' | 'contains' | 'is_present' | 'is_empty';

export interface AutomationCondition {
  id: string;
  fieldKey: string;
  operator: ConditionOperator;
  value?: string;
}

export type AutomationActionType =
  | 'assign_lead_employee'
  | 'assign_lead_queue'
  | 'create_follow_up_task'
  | 'change_status'
  | 'send_notification'
  | 'record_activity';

export interface AutomationAction {
  id: string;
  type: AutomationActionType;
  config: {
    employeeId?: string;
    queueId?: string;
    taskTitle?: string;
    taskPriority?: 'low' | 'normal' | 'high';
    dueHours?: number;
    targetStatus?: string;
    notificationTitle?: string;
    notificationMessage?: string;
    activitySummary?: string;
  };
}

export interface AutomationRecord {
  id: number;
  tenantId: number;
  name: string;
  description: string;
  triggerType: AutomationTriggerType;
  triggerFormId: number | null;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  active: boolean;
  createdByUid: string;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationExecutionRecord {
  id: number;
  tenantId: number;
  automationId: number;
  automationName?: string;
  eventId: string;
  eventType: AutomationTriggerType;
  sourceEntityType: string;
  sourceEntityId: number;
  status: 'succeeded' | 'skipped' | 'failed' | 'retrying';
  attempts: number;
  errorMessage: string | null;
  actionResults: Record<string, unknown>[];
  eventPayload: Record<string, unknown>;
  createdAt: string;
}

export interface DepartmentConfig {
  id: string;
  name: string;
  leadRoleKey: RoleKey;
}

export type PermissionCategory =
  | 'Workspace'
  | 'Forms'
  | 'Automation'
  | 'Operations'
  | 'Administration'
  | 'Finance & Analytics'
  | 'Platform Security';

export type PermissionRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type PermissionKey =
  | 'canViewWorkspace'
  | 'canManageProfile'
  | 'canManagePreferences'
  | 'canViewForms'
  | 'canCreateForms'
  | 'canEditForms'
  | 'canPublishForms'
  | 'canDeleteForms'
  | 'canViewSubmissions'
  | 'canExportSubmissions'
  | 'canViewAutomations'
  | 'canManageAutomations'
  | 'canReplayEvents'
  | 'canViewTasks'
  | 'canManageTasks'
  | 'canManageQueues'
  | 'canViewActivityLogs'
  | 'canManageSettings'
  | 'canManageEmployees'
  | 'canManageRoles'
  | 'canManageIntegrations'
  | 'canManageConnections'
  | 'canViewAnalytics'
  | 'canExportAnalytics'
  | 'canViewCostCenter'
  | 'canManageCostCenter'
  | 'canAdministerPlatformIdentity'
  | 'canManageAllTenants'
  | 'canAccessCentralCrmAdmin';

export type RolePermissionCapabilities = Record<PermissionKey, boolean>;

export interface PermissionCatalogItem {
  key: PermissionKey;
  label: string;
  description: string;
  category: PermissionCategory;
  riskLevel: PermissionRiskLevel;
  defaultRoles: RoleKey[];
  configurable: boolean;
  protected: boolean;
}

export type TenantRolePermissionMatrix = Record<RoleKey, RolePermissionCapabilities>;

export interface TenantRoleMatrixMetadata {
  tenantId: number;
  lastUpdatedAt: string | null;
  lastUpdatedByUid: string | null;
}

export interface RoleConfig {
  key: RoleKey;
  label: string;
  canManageForms: boolean;
  canManageAutomations: boolean;
  canManageSettings: boolean;
  canExportSubmissions: boolean;
  capabilities?: RolePermissionCapabilities;
}

export interface EmployeeConfig {
  id: string;
  name: string;
  email: string;
  departmentId: string;
  roleKey: RoleKey;
  active: boolean;
}

export interface QueueConfig {
  id: string;
  name: string;
  departmentId: string;
  slaMinutes: number;
}

export interface WorkflowStageConfig {
  id: string;
  name: string;
  order: number;
  ownerRoleKey: RoleKey;
  escalationHours: number;
}

export interface AssignmentRuleConfig {
  id: string;
  name: string;
  productMatch: string;
  targetQueueId: string;
  targetEmployeeId: string;
}

export interface WorkspaceOrgConfigData {
  departments: DepartmentConfig[];
  roles: RoleConfig[];
  employees: EmployeeConfig[];
  queues: QueueConfig[];
  workflowStages: WorkflowStageConfig[];
  assignmentRules: AssignmentRuleConfig[];
}

export interface LeadIntakeRecord {
  id: number;
  tenantId: number;
  sourceFormId: number | null;
  sourceSubmissionId: number | null;
  applicantName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  productInterest: string;
  workflowStage: string;
  assignedEmployeeId: string | null;
  assignedEmployeeName: string | null;
  assignedQueueId: string | null;
  assignedQueueName: string | null;
  crmSyncStatus: string;
  externalCrmRef: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FollowUpTaskRecord {
  id: number;
  tenantId: number;
  leadIntakeId: number | null;
  title: string;
  description: string;
  assignedEmployeeId: string | null;
  assignedEmployeeName: string | null;
  priority: 'low' | 'normal' | 'high';
  status: 'pending' | 'in_progress' | 'completed';
  dueAt: string;
  createdAt: string;
}

export interface ActivityLogRecord {
  id: number;
  tenantId: number;
  actorUid: string;
  actorLabel: string;
  module: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface TenantMembershipSummary {
  tenantId: number;
  tenantSlug: string;
  tenantName: string;
  industry: string;
  roleKey: RoleKey;
  departmentName: string;
}

export interface WorkspaceSessionPayload {
  user: {
    uid: string;
    email: string;
    displayName: string;
  };
  activeTenant: TenantMembershipSummary;
  memberships: TenantMembershipSummary[];
  orgConfig: WorkspaceOrgConfigData;
  permissions: RoleConfig;
  apps?: TenantAppState[];
  ecosystemAdapters: {
    clientCrm: { mode: 'mock_adapter'; status: string };
    centralCrm: { mode: 'mock_adapter'; status: string };
    integrationService: { mode: 'mock_adapter'; status: string };
  };
}

export type GlobalSearchEntityType =
  | 'form'
  | 'submission'
  | 'automation'
  | 'lead'
  | 'task'
  | 'activity';

export interface GlobalSearchResultItem {
  id: string;
  entityType: GlobalSearchEntityType;
  title: string;
  subtitle: string;
  routePath: string;
}

export interface FormAnalyticsFieldStat {
  key: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  responseCount: number;
  fillRatePercent: number;
}

export interface FormAnalyticsDailyPoint {
  date: string;
  label: string;
  count: number;
}

export interface FormAnalyticsSummary {
  formId: number;
  totalSubmissions: number;
  publicSubmissions: number;
  previewSubmissions: number;
  lastSubmittedAt: string | null;
  dailyTrend: FormAnalyticsDailyPoint[];
  fieldStats: FormAnalyticsFieldStat[];
}

export interface AutomationDryRunConditionResult {
  conditionId: string;
  fieldKey: string;
  operator: ConditionOperator;
  expectedValue?: string;
  passed: boolean;
}

export interface AutomationDryRunActionPreview {
  actionId: string;
  type: AutomationActionType;
  valid: boolean;
  summary: string;
  warning?: string;
}

export interface AutomationDryRunResult {
  wouldExecute: boolean;
  conditionResults: AutomationDryRunConditionResult[];
  plannedActions: AutomationDryRunActionPreview[];
  warnings: string[];
}

export interface AutomationTemplateItem {
  id: string;
  name: string;
  category: string;
  description: string;
  triggerType: AutomationTriggerType;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
}

export type ThemeMode = 'light' | 'dark';
export type PreferenceDensity = 'comfortable' | 'compact';
export type PreferenceDateFormat = 'locale' | 'iso_short' | 'day_month_year';

export interface UserPreferencesData {
  theme: ThemeMode;
  density: PreferenceDensity;
  timezone: string;
  dateFormat: PreferenceDateFormat;
}

export interface UserPreferencesPayload {
  preferences: UserPreferencesData;
  persisted: boolean;
  updatedAt: string | null;
}

export type IntegrationConnectionStatus =
  | 'pending'
  | 'verified'
  | 'active'
  | 'disabled'
  | 'error'
  | 'revoked';

export interface IntegrationSecretReference {
  provider: 'gcp_secret_manager' | 'env_dev_only';
  secretName: string;
  version: string;
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

export interface EcosystemAdapterStatusSummary {
  providerId: string;
  mode: 'mock_adapter' | 'live_api';
  contractStatus: 'blocked_pending_api_contract' | 'contract_configured_for_endpoint';
  missingContractDetails: string[];
}

export interface ProviderCatalogEntry {
  providerId: string;
  name: string;
  category: string;
  authMethod: 'service_jwt' | 'oauth2' | 'api_key_hmac' | 'webhook_hmac';
  requiredScopes: string[];
  capabilities: string[];
  status: 'mock_adapter' | 'planned_unapproved' | 'approved_ready';
  configurationSchema: string[];
  webhookSupport: boolean;
  rateLimitPerMinute: number;
  maxDataClassification: 'public' | 'internal' | 'confidential' | 'restricted';
  connectionLifecycle: string[];
  costModelNote: string;
}

export interface IntegrationConnectionRecord {
  id: number;
  tenantId: number;
  providerId: string;
  connectionName: string;
  status: IntegrationConnectionStatus;
  authMode: 'service_jwt' | 'oauth2' | 'api_key_hmac' | 'webhook_hmac';
  secretRef: IntegrationSecretReference;
  allowedScopes: string[];
  config: Record<string, unknown>;
  environment: 'development' | 'staging' | 'production';
  approvedByUid: string | null;
  approvedAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorSummary: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookLogRecord {
  id: number;
  tenantId: number;
  connectionId: number;
  connectionName: string | null;
  providerId: string;
  providerEventId: string | null;
  eventType: string | null;
  payloadSha256: string;
  verificationOutcome: string;
  processingStatus: string;
  httpStatus: number;
  sanitizedFailureReason: string | null;
  receivedAt: string;
  processedAt: string | null;
}

export interface DurableEventRecord {
  id: number;
  source: 'outbox' | 'inbox';
  consumerName?: string;
  status: 'pending' | 'received' | 'processing' | 'published' | 'succeeded' | 'dead_letter';
  eventType: string;
  eventId: string;
  aggregateType?: string;
  aggregateId?: string;
  createdAt: string;
  availableAt: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  replayCount: number;
  lastReplayedAt: string | null;
  lastReplayedByUid: string | null;
  lastReplayReason: string | null;
  publishedAt?: string | null;
  processedAt?: string | null;
}

export interface ExternalMappingRecord {
  id: number;
  tenantId: number;
  connectionId: number;
  connectionName: string | null;
  providerId: string;
  internalEntityType: string;
  internalEntityId: string;
  externalEntityType: string;
  externalEntityId: string;
  mappingStatus: string;
  metadata: Record<string, unknown>;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationAuditEntryRecord {
  id: string;
  entryType: 'activity' | 'replay';
  timestamp: string;
  actorUid: string;
  actorLabel: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  reason: string | null;
  source: string | null;
  eventId: string | null;
  consumerName: string | null;
  previousStatus: string | null;
  previousAttempts: number | null;
  previousLastError: string | null;
  metadata: Record<string, unknown>;
}

export interface IntegrationWorkerHealth {
  status?: 'disabled' | 'stopped' | 'healthy' | 'unhealthy';
  workerId?: string;
  enabled: boolean;
  running: boolean;
  stopping: boolean;
  healthy: boolean;
  pollIntervalMs?: number;
  maxConcurrency?: number;
  leaseDurationMs?: number;
  lastPollAt: string | null;
  lastSuccessAt: string | null;
  lastError?: string | null;
  hasError?: boolean;
}

export interface IntegrationOverviewPayload {
  providersTotal: number;
  connections: {
    total: number;
    active: number;
    pending: number;
    verified: number;
    disabled: number;
    revoked: number;
    error: number;
  };
  webhooks: {
    total: number;
    verified: number;
    rejected: number;
    processed: number;
    failed: number;
    lastReceivedAt: string | null;
  };
  events: {
    outboxPending: number;
    outboxProcessing: number;
    outboxPublished: number;
    outboxDeadLetter: number;
    inboxReceived: number;
    inboxProcessing: number;
    inboxSucceeded: number;
    inboxDeadLetter: number;
    totalProcessed: number;
    totalDeadLetter: number;
    retryableFailures: number;
    oldestPendingAt: string | null;
    oldestPendingAgeSeconds: number | null;
    lastSuccessfulProcessedAt: string | null;
  };
  mappingsTotal: number;
  worker: IntegrationWorkerHealth;
  secretManager: SecretStorageReadinessSummary;
  ecosystemAdapters: {
    clientCrm: EcosystemAdapterStatusSummary;
    centralCrm: EcosystemAdapterStatusSummary;
  };
}

export interface ConnectionDetailsPayload {
  connection: IntegrationConnectionRecord;
  provider: ProviderCatalogEntry | null;
  recentWebhooks: WebhookLogRecord[];
  webhookTotal: number;
  relatedMappings: Array<{
    id: number;
    tenantId: number;
    connectionId: number;
    providerId: string;
    internalEntityType: string;
    internalEntityId: string;
    externalEntityType: string;
    externalEntityId: string;
    mappingStatus: string;
    lastSyncedAt: string | null;
    updatedAt: string;
  }>;
  auditHistory: ActivityLogRecord[];
}

export type AppImplementationStatus =
  | 'available'
  | 'coming_soon'
  | 'blocked'
  | 'deprecated';

export type AppCategory =
  | 'Core Operations'
  | 'Automation & Workflows'
  | 'Customer Engagement'
  | 'Compliance & Documents'
  | 'Intelligence & Governance';

export interface WorkspaceAppCatalogEntry {
  id: string;
  name: string;
  shortDescription: string;
  description: string;
  category: AppCategory;
  status: AppImplementationStatus;
  availableToTenants: boolean;
  supportsTenantActivation: boolean;
  defaultEnabled: boolean;
  inspiredBy: string;
  milestone: string;
  navSectionId: NavSectionId | null;
  launchPath: string | null;
  requiredPermission: PermissionKey;
  managePermission?: PermissionKey;
  dependencies: string[];
  blockerReason: string | null;
}

export interface TenantAppState extends WorkspaceAppCatalogEntry {
  enabled: boolean;
  persisted: boolean;
  canToggle: boolean;
  canLaunch: boolean;
  toggleDisabledReason: string | null;
  enabledByUid: string | null;
  updatedAt: string | null;
}

export interface TenantAppsOverview {
  totalCatalogApps: number;
  availableCount: number;
  enabledCount: number;
  comingSoonCount: number;
  blockedCount: number;
  deprecatedCount: number;
  toggleableCount: number;
  activeMiniAppsCount: number;
}

export interface TenantAppsPayload {
  tenantId: number;
  apps: TenantAppState[];
  overview: TenantAppsOverview;
  categories: AppCategory[];
  canManageApps: boolean;
}

export type CostCategory =
  | 'infrastructure'
  | 'ai_models'
  | 'telephony'
  | 'messaging'
  | 'storage'
  | 'software_services'
  | 'other';

export type CostRecordType = 'actual' | 'imported' | 'estimated';

export type CostBudgetPeriod = 'monthly' | 'yearly';

export type CostBudgetScopeType = 'tenant' | 'category' | 'app';

export type CostAlertLevel = 'warning' | 'critical';

export type CostAlertStatus = 'active' | 'resolved';

export interface CostRecordItem {
  id: number;
  tenantId: number;
  providerId: string;
  providerName: string;
  appId: string | null;
  category: CostCategory;
  recordType: CostRecordType;
  amount: string;
  currency: string;
  usageQuantity: string | null;
  unit: string | null;
  unitPrice: string | null;
  billingPeriod: string;
  reference: string | null;
  idempotencyKey: string | null;
  sourceType: string;
  sourceMetadata: Record<string, unknown>;
  notes: string;
  recordedAt: string;
  createdByUid: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderPricingConfigItem {
  id: number;
  tenantId: number;
  providerId: string;
  serviceName: string;
  category: CostCategory;
  unit: string;
  unitPrice: string;
  currency: string;
  effectiveDate: string;
  active: boolean;
  updatedByUid: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CostProviderCatalogSummary {
  providerId: string;
  name: string;
  category: CostCategory;
  registryProviderId: string | null;
  billingIntegrationStatus: 'not_connected';
  billingIntegrationNote: string;
  supportedUnits: string[];
  pricingConfigs: ProviderPricingConfigItem[];
  lastImportedAt: string | null;
  lastRecordedAt: string | null;
  verifiedSpendTotal: string;
  estimatedSpendTotal: string;
}

export interface CostBudgetItem {
  id: number;
  tenantId: number;
  name: string;
  scopeType: CostBudgetScopeType;
  scopeValue: string | null;
  period: CostBudgetPeriod;
  budgetAmount: string;
  currency: string;
  warningThresholdPct: number;
  criticalThresholdPct: number;
  enabled: boolean;
  createdByUid: string;
  createdAt: string;
  updatedAt: string;
}

export interface CostBudgetEvaluationItem extends CostBudgetItem {
  observedVerifiedSpend: string;
  estimatedSpend: string;
  utilizationPct: number;
  projectedSpend: string | null;
  projectedUtilizationPct: number | null;
  alertState: 'nominal' | 'warning' | 'critical';
  activeAlertCount: number;
}

export interface CostAlertItem {
  id: number;
  tenantId: number;
  budgetId: number;
  budgetName: string;
  scopeType: CostBudgetScopeType;
  scopeValue: string | null;
  billingPeriod: string;
  alertLevel: CostAlertLevel;
  thresholdPct: number;
  observedAmount: string;
  budgetAmount: string;
  currency: string;
  status: CostAlertStatus;
  triggeredAt: string;
  resolvedAt: string | null;
}

export interface CostTrendPoint {
  key: string;
  label: string;
  actualAmount: string;
  importedAmount: string;
  verifiedTotalAmount: string;
  estimatedAmount: string;
}

export interface CostBreakdownItem {
  key: string;
  label: string;
  actualAmount: string;
  importedAmount: string;
  verifiedTotalAmount: string;
  estimatedAmount: string;
  recordCount: number;
  sharePct: number;
}

export interface CostCurrencyTotals {
  currency: string;
  actualTotal: string;
  importedTotal: string;
  verifiedTotal: string;
  estimatedTotal: string;
  projectedMonthlySpend: string | null;
  recordCount: number;
}

export interface CostUsageEstimateItem {
  providerId: string;
  providerName: string;
  appId: string | null;
  category: CostCategory;
  serviceName: string;
  usageSource: string;
  usageQuantity: string;
  unit: string;
  unitPrice: string | null;
  currency: string | null;
  estimatedAmount: string | null;
  pricingStatus: 'configured' | 'missing_pricing';
  note: string;
}

export interface CostSummaryPayload {
  tenantId: number;
  billingPeriod: string;
  selectedCurrency: string;
  availableCurrencies: string[];
  hasMixedCurrencies: boolean;
  currencyTotals: CostCurrencyTotals[];
  totals: CostCurrencyTotals;
  totalBudgetConfigured: string | null;
  budgetUtilizationPct: number | null;
  activeAlertsCount: number;
  incompleteDataIndicators: string[];
  dailyTrend: CostTrendPoint[];
  monthlyTrend: CostTrendPoint[];
  byProvider: CostBreakdownItem[];
  byCategory: CostBreakdownItem[];
  byApp: CostBreakdownItem[];
  budgets: CostBudgetEvaluationItem[];
  recentAlerts: CostAlertItem[];
  canManageCosts: boolean;
}


