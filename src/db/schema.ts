import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type {
  AutomationAction,
  AutomationCondition,
  FormFieldDefinition,
  WorkspaceOrgConfigData,
} from '../shared/types.ts';
import type { SecretReference } from '../server/integrations/contracts.ts';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  displayName: text('display_name'),
  activeTenantId: integer('active_tenant_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const tenants = pgTable('tenants', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  industry: text('industry').notNull().default('Financial Services & Loan DSA'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const tenantMemberships = pgTable(
  'tenant_memberships',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    userUid: text('user_uid')
      .references(() => users.uid, { onDelete: 'cascade' })
      .notNull(),
    roleKey: text('role_key').notNull().default('admin'),
    departmentName: text('department_name').notNull().default('Operations'),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_tenant_membership_tenant_user').on(table.tenantId, table.userUid),
  ]
);

export const workspaceOrgConfigs = pgTable('workspace_org_configs', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id')
    .references(() => tenants.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  config: jsonb('config').$type<WorkspaceOrgConfigData>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const forms = pgTable('forms', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id')
    .references(() => tenants.id, { onDelete: 'cascade' })
    .notNull(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  category: text('category').notNull().default('Lead Intake'),
  status: text('status').notNull().default('draft'),
  fields: jsonb('fields').$type<FormFieldDefinition[]>().notNull().default([]),
  submitButtonLabel: text('submit_button_label').notNull().default('Submit Enquiry'),
  successMessage: text('success_message')
    .notNull()
    .default('Thank you. Your enquiry has been recorded.'),
  createdByUid: text('created_by_uid').notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const formSubmissions = pgTable(
  'form_submissions',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    formId: integer('form_id')
      .references(() => forms.id, { onDelete: 'cascade' })
      .notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    source: text('source').notNull().default('public_form'),
    answers: jsonb('answers').$type<Record<string, unknown>>().notNull(),
    submitterSummary: text('submitter_summary').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_form_submission_idempotency').on(table.formId, table.idempotencyKey),
  ]
);

export const automations = pgTable('automations', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id')
    .references(() => tenants.id, { onDelete: 'cascade' })
    .notNull(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  triggerType: text('trigger_type').notNull(),
  triggerFormId: integer('trigger_form_id').references(() => forms.id, {
    onDelete: 'set null',
  }),
  conditions: jsonb('conditions').$type<AutomationCondition[]>().notNull().default([]),
  actions: jsonb('actions').$type<AutomationAction[]>().notNull().default([]),
  active: boolean('active').notNull().default(true),
  createdByUid: text('created_by_uid').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const automationExecutions = pgTable(
  'automation_executions',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    automationId: integer('automation_id')
      .references(() => automations.id, { onDelete: 'cascade' })
      .notNull(),
    eventId: text('event_id').notNull(),
    eventType: text('event_type').notNull(),
    sourceEntityType: text('source_entity_type').notNull(),
    sourceEntityId: integer('source_entity_id').notNull(),
    status: text('status').notNull(),
    attempts: integer('attempts').notNull().default(1),
    errorMessage: text('error_message'),
    actionResults: jsonb('action_results')
      .$type<Record<string, unknown>[]>()
      .notNull()
      .default([]),
    eventPayload: jsonb('event_payload').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_automation_execution_event').on(table.automationId, table.eventId),
  ]
);

export const automationActionSteps = pgTable(
  'automation_action_steps',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    automationExecutionId: integer('automation_execution_id')
      .references(() => automationExecutions.id, { onDelete: 'cascade' })
      .notNull(),
    eventId: text('event_id').notNull(),
    actionKey: text('action_key').notNull(),
    actionType: text('action_type').notNull(),
    status: text('status').notNull().default('pending'),
    idempotencyKey: text('idempotency_key').notNull(),
    attempts: integer('attempts').notNull().default(0),
    resultMetadata: jsonb('result_metadata').$type<Record<string, unknown>>(),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_automation_action_steps_exec_key').on(
      table.automationExecutionId,
      table.actionKey
    ),
    uniqueIndex('uq_automation_action_steps_idempotency').on(
      table.tenantId,
      table.idempotencyKey
    ),
    index('idx_automation_action_steps_tenant_status').on(table.tenantId, table.status),
  ]
);

export const leadIntakeRecords = pgTable(
  'lead_intake_records',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    sourceFormId: integer('source_form_id').references(() => forms.id, {
      onDelete: 'set null',
    }),
    sourceSubmissionId: integer('source_submission_id').references(
      () => formSubmissions.id,
      { onDelete: 'set null' }
    ),
    idempotencyKey: text('idempotency_key'),
    applicantName: text('applicant_name').notNull(),
    contactEmail: text('contact_email'),
    contactPhone: text('contact_phone'),
    productInterest: text('product_interest').notNull().default('General Enquiry'),
    workflowStage: text('workflow_stage').notNull().default('Lead acquisition'),
    assignedEmployeeId: text('assigned_employee_id'),
    assignedEmployeeName: text('assigned_employee_name'),
    assignedQueueId: text('assigned_queue_id'),
    assignedQueueName: text('assigned_queue_name'),
    crmSyncStatus: text('crm_sync_status').notNull().default('mock_synced'),
    externalCrmRef: text('external_crm_ref'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_lead_intake_tenant_idempotency').on(
      table.tenantId,
      table.idempotencyKey
    ),
  ]
);

export const followUpTasks = pgTable(
  'follow_up_tasks',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    leadIntakeId: integer('lead_intake_id').references(() => leadIntakeRecords.id, {
      onDelete: 'set null',
    }),
    idempotencyKey: text('idempotency_key'),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    assignedEmployeeId: text('assigned_employee_id'),
    assignedEmployeeName: text('assigned_employee_name'),
    priority: text('priority').notNull().default('normal'),
    status: text('status').notNull().default('pending'),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_follow_up_tasks_tenant_idempotency').on(
      table.tenantId,
      table.idempotencyKey
    ),
  ]
);

export const internalNotifications = pgTable(
  'internal_notifications',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    idempotencyKey: text('idempotency_key'),
    recipientEmployeeId: text('recipient_employee_id'),
    title: text('title').notNull(),
    message: text('message').notNull(),
    read: boolean('read').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_internal_notifications_tenant_idempotency').on(
      table.tenantId,
      table.idempotencyKey
    ),
  ]
);

export const activityLogs = pgTable(
  'activity_logs',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    idempotencyKey: text('idempotency_key'),
    actorUid: text('actor_uid').notNull(),
    actorLabel: text('actor_label').notNull(),
    module: text('module').notNull(),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    summary: text('summary').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_activity_logs_tenant_idempotency').on(
      table.tenantId,
      table.idempotencyKey
    ),
  ]
);

export const eventOutbox = pgTable(
  'event_outbox',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    eventId: text('event_id').notNull(),
    schemaVersion: text('schema_version').notNull().default('1.0'),
    eventType: text('event_type').notNull(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: text('aggregate_id').notNull(),
    correlationId: text('correlation_id').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    availableAt: timestamp('available_at', { withTimezone: true }).defaultNow().notNull(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockOwner: text('lock_owner'),
    lastError: text('last_error'),
    replayCount: integer('replay_count').notNull().default(0),
    lastReplayedAt: timestamp('last_replayed_at', { withTimezone: true }),
    lastReplayedByUid: text('last_replayed_by_uid'),
    lastReplayReason: text('last_replay_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('uq_event_outbox_event_id').on(table.eventId),
    index('idx_event_outbox_pending_poll').on(table.status, table.availableAt),
    index('idx_event_outbox_lease_recovery').on(table.status, table.lockedAt),
    index('idx_event_outbox_tenant_status').on(
      table.tenantId,
      table.status,
      table.createdAt
    ),
  ]
);

export const eventInbox = pgTable(
  'event_inbox',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    consumerName: text('consumer_name').notNull(),
    eventId: text('event_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: text('status').notNull().default('received'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    availableAt: timestamp('available_at', { withTimezone: true }).defaultNow().notNull(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockOwner: text('lock_owner'),
    lastError: text('last_error'),
    replayCount: integer('replay_count').notNull().default(0),
    lastReplayedAt: timestamp('last_replayed_at', { withTimezone: true }),
    lastReplayedByUid: text('last_replayed_by_uid'),
    lastReplayReason: text('last_replay_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('uq_event_inbox_tenant_consumer_event').on(
      table.tenantId,
      table.consumerName,
      table.eventId
    ),
    index('idx_event_inbox_pending_poll').on(table.status, table.availableAt),
    index('idx_event_inbox_lease_recovery').on(table.status, table.lockedAt),
    index('idx_event_inbox_tenant_status').on(
      table.tenantId,
      table.status,
      table.createdAt
    ),
  ]
);

export const eventReplayLogs = pgTable(
  'event_replay_logs',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    source: text('source').notNull(), // 'outbox' | 'inbox'
    targetRowId: integer('target_row_id').notNull(),
    eventId: text('event_id').notNull(),
    consumerName: text('consumer_name'),
    replayedByUid: text('replayed_by_uid').notNull(),
    replayedByLabel: text('replayed_by_label').notNull(),
    reason: text('reason').notNull(),
    previousStatus: text('previous_status').notNull(),
    previousAttempts: integer('previous_attempts').notNull(),
    previousLastError: text('previous_last_error'),
    replayedAt: timestamp('replayed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_event_replay_logs_tenant_at').on(table.tenantId, table.replayedAt),
    index('idx_event_replay_logs_source_row').on(table.source, table.targetRowId),
  ]
);

export const integrationConnections = pgTable(
  'integration_connections',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    providerId: text('provider_id').notNull(),
    connectionName: text('connection_name').notNull(),
    status: text('status').notNull().default('pending'),
    authMode: text('auth_mode').notNull(),
    secretRef: jsonb('secret_ref').$type<SecretReference>().notNull(),
    allowedScopes: jsonb('allowed_scopes').$type<string[]>().notNull().default([]),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    environment: text('environment').notNull().default('development'),
    approvedByUid: text('approved_by_uid'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    lastErrorAt: timestamp('last_error_at', { withTimezone: true }),
    lastErrorSummary: text('last_error_summary'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_integration_conn_tenant_provider_name').on(
      table.tenantId,
      table.providerId,
      table.connectionName
    ),
    index('idx_integration_conn_tenant_status').on(table.tenantId, table.status),
    index('idx_integration_conn_provider_status').on(table.providerId, table.status),
  ]
);

export const externalIdMappings = pgTable(
  'external_id_mappings',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    connectionId: integer('connection_id')
      .references(() => integrationConnections.id, { onDelete: 'cascade' })
      .notNull(),
    providerId: text('provider_id').notNull(),
    internalEntityType: text('internal_entity_type').notNull(),
    internalEntityId: text('internal_entity_id').notNull(),
    externalEntityType: text('external_entity_type').notNull(),
    externalEntityId: text('external_entity_id').notNull(),
    mappingStatus: text('mapping_status').notNull().default('active'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_ext_map_internal').on(
      table.tenantId,
      table.connectionId,
      table.internalEntityType,
      table.internalEntityId
    ),
    uniqueIndex('uq_ext_map_external').on(
      table.tenantId,
      table.connectionId,
      table.externalEntityType,
      table.externalEntityId
    ),
    index('idx_ext_map_tenant_provider').on(table.tenantId, table.providerId),
  ]
);

export const providerWebhookLogs = pgTable(
  'provider_webhook_logs',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    connectionId: integer('connection_id')
      .references(() => integrationConnections.id, { onDelete: 'cascade' })
      .notNull(),
    providerId: text('provider_id').notNull(),
    providerEventId: text('provider_event_id'),
    eventType: text('event_type'),
    payloadSha256: text('payload_sha256').notNull(),
    verificationOutcome: text('verification_outcome').notNull(),
    processingStatus: text('processing_status').notNull(),
    httpStatus: integer('http_status').notNull(),
    sanitizedFailureReason: text('sanitized_failure_reason'),
    receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_webhook_logs_tenant_received').on(table.tenantId, table.receivedAt),
    index('idx_webhook_logs_conn_received').on(table.connectionId, table.receivedAt),
    index('idx_webhook_logs_provider_event').on(table.providerId, table.providerEventId),
  ]
);

export const tenantRolePermissions = pgTable(
  'tenant_role_permissions',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    roleKey: text('role_key').notNull(),
    permissionKey: text('permission_key').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    updatedByUid: text('updated_by_uid'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_tenant_role_perm_tenant_role_key').on(
      table.tenantId,
      table.roleKey,
      table.permissionKey
    ),
    index('idx_tenant_role_perm_tenant_role').on(table.tenantId, table.roleKey),
    index('idx_tenant_role_perm_tenant_updated').on(table.tenantId, table.updatedAt),
    check(
      'chk_tenant_role_perm_role_key',
      sql`${table.roleKey} IN ('admin', 'manager', 'operator', 'viewer')`
    ),
  ]
);

export const userPreferences = pgTable(
  'user_preferences',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    theme: text('theme').notNull().default('light'),
    density: text('density').notNull().default('comfortable'),
    timezone: text('timezone').notNull().default('Asia/Kolkata'),
    dateFormat: text('date_format').notNull().default('locale'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_user_preferences_user_id').on(table.userId),
    check(
      'chk_user_preferences_theme',
      sql`${table.theme} IN ('light', 'dark')`
    ),
    check(
      'chk_user_preferences_density',
      sql`${table.density} IN ('comfortable', 'compact')`
    ),
    check(
      'chk_user_preferences_date_format',
      sql`${table.dateFormat} IN ('locale', 'iso_short', 'day_month_year')`
    ),
  ]
);

export const tenantAppInstallations = pgTable(
  'tenant_app_installations',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    appId: text('app_id').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    enabledByUid: text('enabled_by_uid'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_tenant_app_installations_tenant_app').on(
      table.tenantId,
      table.appId
    ),
    index('idx_tenant_app_installations_tenant_enabled').on(
      table.tenantId,
      table.enabled
    ),
  ]
);

export const costRecords = pgTable(
  'cost_records',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    providerId: text('provider_id').notNull(),
    providerName: text('provider_name').notNull(),
    appId: text('app_id'),
    category: text('category').notNull(),
    recordType: text('record_type').notNull().default('actual'),
    amount: numeric('amount', { precision: 14, scale: 4 }).notNull(),
    currency: text('currency').notNull().default('INR'),
    usageQuantity: numeric('usage_quantity', { precision: 14, scale: 4 }),
    unit: text('unit'),
    unitPrice: numeric('unit_price', { precision: 14, scale: 6 }),
    billingPeriod: text('billing_period').notNull(),
    reference: text('reference'),
    idempotencyKey: text('idempotency_key'),
    sourceType: text('source_type').notNull().default('manual_entry'),
    sourceMetadata: jsonb('source_metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    notes: text('notes').notNull().default(''),
    recordedAt: timestamp('recorded_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdByUid: text('created_by_uid').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('uq_cost_records_tenant_idempotency').on(
      table.tenantId,
      table.idempotencyKey
    ),
    index('idx_cost_records_tenant_period').on(table.tenantId, table.billingPeriod),
    index('idx_cost_records_tenant_category').on(table.tenantId, table.category),
    index('idx_cost_records_tenant_type').on(table.tenantId, table.recordType),
    index('idx_cost_records_tenant_recorded').on(table.tenantId, table.recordedAt),
    check(
      'chk_cost_records_record_type',
      sql`${table.recordType} IN ('actual', 'imported', 'estimated')`
    ),
    check(
      'chk_cost_records_category',
      sql`${table.category} IN ('infrastructure', 'ai_models', 'telephony', 'messaging', 'storage', 'software_services', 'other')`
    ),
  ]
);

export const providerPricingConfigs = pgTable(
  'provider_pricing_configs',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    providerId: text('provider_id').notNull(),
    serviceName: text('service_name').notNull(),
    category: text('category').notNull(),
    unit: text('unit').notNull(),
    unitPrice: numeric('unit_price', { precision: 14, scale: 6 }).notNull(),
    currency: text('currency').notNull().default('INR'),
    effectiveDate: text('effective_date').notNull(),
    active: boolean('active').notNull().default(true),
    updatedByUid: text('updated_by_uid'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('uq_provider_pricing_tenant_service_eff').on(
      table.tenantId,
      table.providerId,
      table.serviceName,
      table.effectiveDate
    ),
    index('idx_provider_pricing_tenant_provider').on(
      table.tenantId,
      table.providerId
    ),
  ]
);

export const costBudgets = pgTable(
  'cost_budgets',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    name: text('name').notNull(),
    scopeType: text('scope_type').notNull().default('tenant'),
    scopeValue: text('scope_value'),
    period: text('period').notNull().default('monthly'),
    budgetAmount: numeric('budget_amount', { precision: 14, scale: 4 }).notNull(),
    currency: text('currency').notNull().default('INR'),
    warningThresholdPct: integer('warning_threshold_pct').notNull().default(80),
    criticalThresholdPct: integer('critical_threshold_pct').notNull().default(100),
    enabled: boolean('enabled').notNull().default(true),
    createdByUid: text('created_by_uid').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('idx_cost_budgets_tenant_enabled').on(table.tenantId, table.enabled),
    check(
      'chk_cost_budgets_scope_type',
      sql`${table.scopeType} IN ('tenant', 'category', 'app')`
    ),
    check(
      'chk_cost_budgets_period',
      sql`${table.period} IN ('monthly', 'yearly')`
    ),
  ]
);

export const costAlerts = pgTable(
  'cost_alerts',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    budgetId: integer('budget_id')
      .references(() => costBudgets.id, { onDelete: 'cascade' })
      .notNull(),
    billingPeriod: text('billing_period').notNull(),
    alertLevel: text('alert_level').notNull(),
    thresholdPct: integer('threshold_pct').notNull(),
    observedAmount: numeric('observed_amount', { precision: 14, scale: 4 }).notNull(),
    budgetAmount: numeric('budget_amount', { precision: 14, scale: 4 }).notNull(),
    currency: text('currency').notNull().default('INR'),
    status: text('status').notNull().default('active'),
    triggeredAt: timestamp('triggered_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('uq_cost_alerts_budget_period_level').on(
      table.tenantId,
      table.budgetId,
      table.billingPeriod,
      table.alertLevel
    ),
    index('idx_cost_alerts_tenant_status').on(table.tenantId, table.status),
    check(
      'chk_cost_alerts_level',
      sql`${table.alertLevel} IN ('warning', 'critical')`
    ),
    check(
      'chk_cost_alerts_status',
      sql`${table.status} IN ('active', 'resolved')`
    ),
  ]
);


