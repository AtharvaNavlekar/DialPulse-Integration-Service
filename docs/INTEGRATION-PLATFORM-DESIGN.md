# DialPulse Integration Layer — Architecture & Specification (`WSP-INT-004` to `WSP-INT-018`)

This specification defines the internal **Integration Layer** inside the unified `DialPulse Workspace & Integration Platform` modular monolith (`AtharvaNavlekar/DialPulse-Integration-Service`).

---

## `WSP-INT-004` — Service Identity & Tenant Context
- **User Requests (Workspace UI):** Authenticated via Firebase ID Token (`requireAuth`) and strictly mapped to verified active `tenant_memberships` rows (`resolveVerifiedTenantMembership`).
- **Service-to-Service Calls (Client CRM / Central CRM / DialPulse Web):** Authenticated via signed service JWTs / HMAC service tokens with explicit `audience`, `issuer`, `serviceId`, and `correlationId`. Never trust an unverified `x-tenant-id` or body `tenantId`; derive or validate tenant ownership server-side against registered tenant connections.
- **Central CRM Alignment:** Workspace Firebase Auth (`uid`) is NOT assumed to equal Central CRM staff identity (`staffId`); maintain explicit `external_id_mappings` when live Central CRM identity sync is connected.

## `WSP-INT-005` — Versioned Ecosystem API & Event Contracts
- Every cross-system event uses the versioned `IntegrationEventEnvelope` (`src/server/integrations/contracts.ts`):
  - `schemaVersion: '1.0'`
  - `eventId`, `tenantId`, `eventType`, `sourceModule`, `correlationId`, `idempotencyKey`, `occurredAt`, `payload`.
- Backward-incompatible payload changes increment `schemaVersion` (`'2.0'`).
- Lead intake sync (`ClientCrmLeadSyncInput`) passes explicit allowlisted fields and receives `externalCrmRef` without exposing internal Client CRM database identifiers.

## `WSP-INT-006` — Provider Registry & Secrets Abstraction
- Implemented types & catalog in `src/server/integrations/provider-registry.ts` and `contracts.ts`:
  - `PROVIDER_REGISTRY` defines `providerId`, `category`, `authMethod`, `requiredScopes`, `capabilities`, `status` (`mock_adapter` | `planned_unapproved` | `approved_ready`), `configurationSchema`, `webhookSupport`, `rateLimitPerMinute`, `maxDataClassification`, and `connectionLifecycle`.
- **Secrets Policy:** Never store plaintext API keys, client secrets, or signing keys in source code or JSONB DB columns. Store `SecretReference` (`provider: 'gcp_secret_manager'`, `secretName`, `version`) resolved at runtime via `SecretStore`.

## `WSP-INT-007` — Durable Inbox / Outbox (PostgreSQL Transactional Implementation)
Implemented in `src/db/schema.ts`, `drizzle/0001_durable_outbox_inbox_action_steps.sql`, and `src/server/events/`:
- **Delivery Semantics:** **At-least-once delivery with idempotent processing** (never claims distributed exactly-once delivery).
- **Implemented Tables:**
  1. `event_outbox`: `id`, `tenant_id`, `event_id` (`uq_event_outbox_event_id`), `schema_version`, `event_type`, `aggregate_type`, `aggregate_id`, `correlation_id`, `payload`, `status` (`pending` | `processing` | `published` | `dead_letter`), `attempts`, `max_attempts`, `available_at`, `locked_at`, `lock_owner`, `last_error`, `created_at`, `updated_at`, `published_at`. Indexed on `(status, available_at)`, `(status, locked_at)`, and `(tenant_id, status, created_at)`.
  2. `event_inbox`: `id`, `tenant_id`, `consumer_name`, `event_id`, `event_type`, `payload`, `status` (`received` | `processing` | `succeeded` | `dead_letter`), `attempts`, `max_attempts`, `available_at`, `locked_at`, `lock_owner`, `last_error`, `created_at`, `updated_at`, `processed_at`. Unique `(tenant_id, consumer_name, event_id)` (`uq_event_inbox_tenant_consumer_event`) ensures deduplication per consumer without blocking independent consumers.
  3. `automation_action_steps`: `id`, `tenant_id`, `automation_execution_id`, `event_id`, `action_key`, `action_type`, `status` (`pending` | `processing` | `succeeded` | `failed` | `skipped`), `idempotency_key`, `attempts`, `result_metadata`, `error_message`, `started_at`, `completed_at`, `created_at`, `updated_at`. Unique constraints on `(automation_execution_id, action_key)` and `(tenant_id, idempotency_key)`.
  4. Nullable `idempotency_key` + unique `(tenant_id, idempotency_key)` indexes on `lead_intake_records`, `follow_up_tasks`, `internal_notifications`, and `activity_logs` protect against crash-recovery duplicates.
- **Atomic Write Pattern (`public-forms.ts`, `forms.ts`, `workspace.ts`) & Cross-Tenant Outbox Guard:**
  - Inside `db.transaction(async (tx) => ...)`, insert `form_submissions` (`onConflictDoNothing` on `(form_id, idempotency_key)`), insert `activity_logs`, and insert `event_outbox` (`pending`).
  - `enqueueOutboxEvent` validates identity/payload structure and rejects cross-tenant `event_id` collisions (`NonRetryableEventError`, `CROSS_TENANT_EVENT_ID_COLLISION`).
  - HTTP `201` means submission & event were durably persisted — NOT that automation or CRM sync completed. Concurrent/duplicate replays return `200 { duplicate: true }` without creating duplicate events.

## `WSP-INT-008` — Workers, Action-Step Resumption, Backoff & Dead-Letter Queue
Implemented in `src/server/events/event-publisher.ts`, `event-worker.ts`, `retry-policy.ts`, `worker-config.ts`, and `src/server/services/automation-runner.ts`:
- **Outbox Publisher & Inbox Consumer:** Uses `FOR UPDATE SKIP LOCKED` CTEs (`claimPendingOutboxBatch`, `claimPendingInboxBatch`) so concurrent instances cannot claim the same active lease, and `recoverExpiredOutboxLeases` / `recoverExpiredInboxLeases` to recover crashed workers. Outbox transitions to `published` only after durable `event_inbox` insertion succeeds, propagating `correlationId` into consumer payloads and structured logs while validating consumer payloads via Zod (`INVALID_EVENT_PAYLOAD`).
- **Per-Action Idempotency & Crash Recovery:** Each action uses deterministic `actionKey = step_${index}:${action.id}` and `idempotencyKey = exec:${executionId}:action:${actionKey}`. Previously `succeeded` steps are skipped on retry, while `failed` or abandoned `processing` steps emit `action_step_abandoned_recovered` logs and resume safely with the same idempotency key.
- **External Provider Risk Note:** Internal DB operations use transactional/unique idempotency guards. External providers that lack native idempotency keys remain vulnerable to duplicate side effects on crash-before-ack and will require external-ID/reconciliation checks prior to live cutover.
- **Retry Classification, Backoff & DLQ:**
  - `MAX_EVENT_ATTEMPTS = 5` (`MAX_AUTOMATION_RETRY_ATTEMPTS = 5`).
  - Retryable transient infrastructure/PG errors schedule exponential backoff + jitter (`computeRetryBackoffMs`).
  - Non-retryable config/validation/auth failures (`NonRetryableEventError`, `AuthorizationError`) or exhausted events (`attempts >= maxAttempts`) transition cleanly to `dead_letter` (never deleted) and are inspectable per tenant via `listDeadLetterEventsByTenant` / `GET /api/automations/events`.
- **Worker Runtime Controls & Startup Guard:** Configured via `EVENT_WORKER_ENABLED` (auto-defaults `false` in `NODE_ENV=test`), `EVENT_WORKER_POLL_INTERVAL_MS`, `EVENT_WORKER_BATCH_SIZE`, `EVENT_WORKER_MAX_CONCURRENCY`, `EVENT_WORKER_LEASE_MS`, enforcing a process-level active-worker guard (preventing accidental duplicate polling loops inside one Node process) and graceful `SIGTERM`/`SIGINT` shutdown in `server.ts`.

## `WSP-INT-009` — Connection Lifecycle, Secret Management & Webhook Security (Implemented)
Implemented in `src/db/schema.ts`, `drizzle/0002_integration_connections_external_mappings_webhook_logs.sql`, `src/server/integrations/`:
- **Connection Lifecycle (`connections-service.ts`, `routes/integrations.ts`):**
  - Database-backed `integration_connections` (`pending | verified | active | disabled | error | revoked`) separated from static catalog entries (`PROVIDER_REGISTRY`).
  - Connections start in `pending` state; `planned_unapproved` catalog entries cannot become `active`.
  - Activation requires matching `authMethod`, all `requiredScopes`, verified `WebhookVerifier` (when `webhookSupport: true`), non-sensitive config (`assertNonSensitiveConfig`), and non-empty `SecretStore.resolveSecret(secretRef)`.
  - State transitions (`created`, `activated`, `disabled`, `revoked`) record `approvedByUid`, `approvedAt`, and `activity_logs` audit entries.
- **Secret Management (`secret-store.ts`):**
  - Database stores `SecretReference` (`gcp_secret_manager` | `env_dev_only`) — never plaintext secrets or raw credentials.
  - `EnvDevOnlySecretStore` resolves non-production secrets and fails closed in `NODE_ENV=production`.
  - `GoogleSecretManagerSecretStore` uses `@google-cloud/secret-manager` (`SecretManagerServiceClient` via Google ADC) with strict `GCP_SECRET_MANAGER_PROJECT_ALLOWLIST` path validation and gRPC error mapping (`SECRET_STORE_UNCONFIGURED`, `SECRET_NOT_FOUND`, `SECRET_ACCESS_DENIED`). Live Cloud IAM connectivity remains unverified until deployed with ADC and IAM permissions.
- **Public Raw-Body Webhook Ingress (`POST /api/integrations/webhooks/:providerId/:connectionId`):**
  - Mounted BEFORE `express.json()` using route-scoped `express.raw({ limit: '256kb' })` (`413` on oversize, `415` on non-JSON).
  - Resolves `tenantId` strictly from `connectionId` (never from request body/headers) and verifies `providerId` match and `status === 'active'`.
  - Verifies HMAC-SHA256 (`v1=<64-hex>`) over `${timestamp}.${rawBodyBytes}` via `crypto.timingSafeEqual` (`DialPulseHmacSha256Verifier`) with `<= 300s` replay window and `<= 60s` clock skew guard.
  - Parses JSON ONLY after signature verification, enforces per-provider event allowlists and inbound `sanitizeInboundWebhookData` (rejects restricted KYC fields), and transactionally writes `provider_webhook_logs` + `event_inbox` (`uq_event_inbox_tenant_consumer_event`).
  - Returns `202` for newly accepted events, `200 { duplicate: true }` for replays/redeliveries, `401` on invalid signature/timestamp, `403` on inactive/mismatched connection, `400` on invalid payload, and `500` on temporary persistence error.

## `WSP-INT-010` — External ID Mapping Service & Authorized DLQ Replay (Implemented)
- **External Identity Mapping (`external_id_mappings`, `external-mappings.ts`):**
  - Enforces bidirectional uniqueness inside `(tenant_id, connection_id)`: `(internal_entity_type, internal_entity_id)` (`uq_ext_map_internal`) and `(external_entity_type, external_entity_id)` (`uq_ext_map_external`).
  - Refuses silent reassignment (`ExternalMappingConflictError` / `409`) if an external ID already maps to another internal entity.
- **Authorized DLQ Replay (`replay-service.ts`, `event_replay_logs`, `POST /api/automations/events/:source/:id/replay`):**
  - Requires Firebase Auth + verified tenant membership + `canManageAutomations` + role in `['admin', 'manager']` (`401` unauthenticated, `403` unauthorized role or cross-tenant ID/header).
  - Requires a `reason` (`3..300` chars), locks the target `outbox` or `inbox` row with `FOR UPDATE`, verifies `status === 'dead_letter'` (`409` on concurrent replay or non-DLQ row), preserves `event_id` and prior `last_error`, appends to `event_replay_logs` and `activity_logs`, increments `replay_count`, and requeues (`pending` for outbox, `received` for inbox).
  - `GET /api/automations/events` returns operational summaries (`source`, `status`, `eventType`, `eventId`, `attempts`, `lastError`, `replayCount`, `lastReplayedAt`) without exposing raw payloads.

## `WSP-INT-011` — Typed Adapter Framework & Ecosystem HTTP Clients
- Business services depend on interfaces in `src/server/integrations/contracts.ts`.
- `SafeIntegrationHttpClient` (`src/server/integrations/http-client.ts`) enforces HTTPS in production, strict hostname allowlists, disabled redirects (`redirect: 'manual'`), `AbortController` timeouts, bounded retries with constant `Idempotency-Key` and `X-Correlation-Id`, redacted logging, and mandatory `evaluateDataEgressPolicy(...)`.
- `HttpClientCrmAdapter` (`src/server/adapters/client-crm-http.ts`) and `HttpCentralCrmAdapter` (`src/server/adapters/central-crm-http.ts`) implement the typed boundary and `external_id_mappings` persistence on confirmed `2xx` success, while remaining explicitly marked `blocked_pending_api_contract` until confirmed Client CRM and Central CRM REST endpoints/OpenAPI schemas and service-JWT audience specs are published. Mock adapters (`ecosystem-mock.ts`) remain explicitly tagged `mode: 'mock_adapter'`.

## `WSP-INT-012` — Health Probes & Structured Pipeline Observability
- **Health Endpoints (`src/server/routes/health.ts`):**
  - `GET /api/health` & `/api/health/live` — Express process liveness.
  - `GET /api/health/ready` — executes `SELECT 1` on PostgreSQL (`503` if unreachable).
  - `GET /api/health/worker` — reports sanitized public worker status distinguishing `disabled` (`200`), `stopped` (`503`), `healthy` (`200`), and `unhealthy` (`503`); strips internal `workerId`/PID and raw `lastError` from unauthenticated responses (full diagnostics stay inside RBAC-protected `/api/integrations/overview`).
- **Real PostgreSQL Observability Metrics (`getIntegrationOverview`):** Computes live DB counts for queued/in-flight/succeeded/dead-lettered events, `retryableFailures`, `oldestPendingAt`/`oldestPendingAgeSeconds`, and `lastSuccessfulProcessedAt` across `event_outbox`, `event_inbox`, and `automation_executions`.
- **Structured Logs (`src/server/events/logger.ts`):** Correlated JSON logs (`tenantId`, `eventId`, `correlationId`, `consumerName`, `automationExecutionId`, `actionKey`) with automatic redaction of Bearer tokens, DSNs, and restricted KYC keys.

## `WSP-INT-013` — Integration & DLQ Operations Console (Implemented)
- **Backend Management APIs (`/api/integrations/*`, `/api/automations/events*`):**
  - `GET /api/integrations/overview`, `GET /api/integrations/providers` (including `secretManager` + `ecosystemAdapters` readiness), `GET/POST /api/integrations/connections`, `GET /api/integrations/connections/:id`, `GET /api/integrations/connections/:id/details`, `POST /api/integrations/connections/:id/{activate,disable,revoke}`, `GET /api/integrations/mappings` (search/filters/pagination), `GET /api/integrations/webhooks/logs` (filters/pagination, zero raw payloads/signatures), `GET /api/integrations/audit` (combined `activity_logs` + `event_replay_logs`), `GET /api/automations/events` (filters/pagination, zero raw payloads), `POST /api/automations/events/:source/:id/replay`.
  - All read routes enforce `canManageSettings || canManageAutomations` (`operator`/`viewer` receive `403`); connection lifecycle mutations require `canManageSettings`; DLQ replay requires `admin`/`manager` + `canManageAutomations`.
- **Workspace UI (`/settings/integrations`, `src/components/integrations/`):** Module I `#45` implemented with 8 navigable sub-tabs (Overview, Provider Catalog, Connections + 9-Section Details Drawer, Webhook Activity, Event Processing Monitor, Dead-Letter Queue & Authorized Replay, Read-only Mappings Explorer, Audit History).

## `WSP-INT-014` — DialPulse Web Acquisition Intake
- Supports both Workspace public forms (`/f/:slug`) and cryptographically verified `dialpulse_web` webhooks (`web_enquiry_submitted`, `callback_requested`) routed into `event_inbox` (`webhook:dialpulse_web`) with KYC safety filtering, external ID mapping (`web_enquiry`), and idempotent `lead_intake_records` creation.

## `WSP-INT-015` — Sensitive Data Egress Policy (Implemented in `egress-policy.ts`)
- **4 Tiers:** `public`, `internal`, `confidential`, `restricted` (`Aadhaar`, `PAN`, bank statements/accounts, IFSC, salary slips, ITR, CVV, KYC records).
- **Default Policy:** `restricted` data MUST NOT leave DialPulse boundaries to external AI models, voice AI, messaging vendors, or third-party analytics.
- Every external transmission calls `evaluateDataEgressPolicy(...)` requiring explicit `hasPermission`, `providerApproved`, documented `purpose`, ceiling check, and strict `approvedFieldAllowlist`.

## `WSP-INT-016` — Failure-Path Testing Requirements
- Covered across unit, database, HTTP webhook, DLQ replay, and local-mock-server HTTP adapter test suites: auth/tenant boundaries, validation errors, concurrent duplicate submissions, transaction rollback, `SKIP LOCKED` exclusivity across two concurrent `DurableEventWorker` instances, lease expiry & abandoned `processing` action-step recovery, retry/backoff `availableAt` progression & secret redaction, cross-tenant outbox collision guard, inbox multi-consumer isolation, partial step-3 failure resumption, non-retryable/invalid-payload dead-lettering, raw-body HMAC signature/timestamp failures, oversized/malformed webhook rejections, RBAC/cross-tenant DLQ replay isolation (`401`/`403`/`409`/`200`), worker duplicate-startup guard, `/api/health/ready` & sanitized `/api/health/worker` states, HTTP redirect/timeout/retry bounds, external mapping conflict protection, and egress stripping.

## `WSP-INT-017` — Deployment, Migrations & Disaster Recovery
- Single container image (`node server.ts` serving API + compiled `/dist` SPA).
- Checked-in Drizzle SQL migrations live under `drizzle/` (`0000` through `0006_cost_control_center.sql`) generated via `bun run db:generate`. Never run unverified destructive DDL on production Cloud SQL.
- Production cutover requires configuring `GCP_SECRET_MANAGER_PROJECT_ALLOWLIST`, Cloud IAM `secretmanager.secretAccessor` bindings for ADC (`gcp_secret_manager` `SecretReference`, never `env_dev_only`), and confirmed Client/Central CRM API contracts.

## `WSP-INT-018` — First Approved Real Provider Cutover Gate
- No real external provider adapter is activated until all prerequisites are verified:
  1. Approved vendor & cost tracking enabled in Cost Control Center.
  2. Credentials stored in GCP Secret Manager (`gcp_secret_manager` `SecretReference`) and wired into `CompositeSecretStore`.
  3. Confirmed external API contract (URLs, OpenAPI schemas, JWT audience/issuer, native idempotency semantics) for Client CRM / Central CRM / external vendors.
  4. Signature verification (`WSP-INT-009`), `external_id_mappings` (`WSP-INT-010`), & Egress Allowlist (`WSP-INT-015`) verified.
  5. Transactional outbox + DLQ replay (`WSP-INT-007/008/010`) applied & verified in staging & production Cloud SQL.
  6. Compliance sign-off obtained if touching confidential/restricted workflows.

