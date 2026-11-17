# DialPulse Workspace & Integration Platform — Architecture

**Repository:** `AtharvaNavlekar/DialPulse-Integration-Service`  
**Pattern:** Unified Modular Monolith (two clean internal layers inside one deployable Node.js 22 / Vite / Express / PostgreSQL application).

---

## 1. Ecosystem Ownership & Boundaries

| System | Repository | Authority & Ownership |
| --- | --- | --- |
| **DialPulse Workspace & Integration Platform** | `AtharvaNavlekar/DialPulse-Integration-Service` | Workspace mini-apps, Forms Studio, Workflow Automation, integration adapters, provider registry, webhooks, durable event inbox/outbox, external ID mappings |
| **Client CRM** | `AtharvaNavlekar/Client-CRM` | Canonical leads, customer records, CRM business rules, tenant CRM workflows |
| **Central CRM** | `AtharvaNavlekar/DialPulse-Central-CRM` | Platform staff identity, platform administration, tenant lifecycle, privileged permissions |
| **DialPulse Web** | `AtharvaNavlekar/DialPulse-Web` | Public marketing website and acquisition intake |

**Hard Ownership Rules:**
1. Never connect directly to Client CRM, Central CRM, or DialPulse Web production databases.
2. Communicate strictly via authenticated APIs and versioned event contracts.
3. Never treat `lead_intake_records` as a second canonical CRM database; it holds tenant-scoped intake state and `externalCrmRef` until synced with Client CRM.
4. Never assume Workspace Firebase Auth equals Central CRM platform staff identity.
5. Keep all mock adapters explicitly tagged `mode: 'mock_adapter'` until real authenticated APIs are verified.

---

## 2. Two Internal Layers (Modular Monolith)

### A. Workspace Layer (`src/components/`, `src/context/`, `src/server/routes/workspace|forms|public-forms|automations|costs.ts`)
- **Workspace Core:** Overview, My Apps Launcher, Global Search, Notifications Center, My Profile, PostgreSQL-backed Workspace Preferences (`GET/PUT /api/workspace/preferences`).
- **Forms Studio:** Form Builder, Settings & Sharing, Public Form `/f/:slug`, Preview, Submissions Inbox, CSV Export, Form Analytics.
- **Workflow Automation:** Workflows List, Builder (Draft/Active + Dry-Run), Loan-DSA Templates, Execution History, Execution Detail Inspector.
- **Administration & FinOps:** Employees CRUD, Departments, Queues, Assignment Rules, Workflow Stages, Interactive Dynamic Roles & Permissions Matrix (`src/components/settings/RolesPermissionsMatrix.tsx`), Per-Tenant App Management (`/settings/apps`, `src/components/settings/AppManagementView.tsx`), Cost Control Center (`/costs`, `src/components/costs/CostControlCenterView.tsx`), Audit Logs, and Integrations & DLQ Operations Console (`/settings/integrations`, `src/components/integrations/`).
- **Planned Mini-Apps (Stages 2–8):** Appointment Scheduler, Call Operations, Support Inbox, Document Workflow (blocked on KMS/compliance), Business Analytics, Knowledge Hub.

### B. Integration Layer (`src/server/integrations/`, `src/server/events/`, `src/server/adapters/`, `src/server/routes/integrations.ts|webhooks.ts`)
- **Typed Adapter Contracts (`contracts.ts`):** `ClientCrmAdapter`, `CentralCrmAdapter`, `ExternalProviderAdapter`, `EventPublisher`, `SecretStore`, `WebhookVerifier`, `ExternalIdMappingService`.
- **Provider Registry & Connection Lifecycle (`provider-registry.ts`, `connections-service.ts`):** Separates static provider catalog entries from tenant-scoped `integration_connections` (`pending -> active -> disabled/revoked`), enforcing scope, auth mode, verifier presence, `SecretStore` checks, `planned_unapproved` activation blocks, overview KPIs, 9-section connection details, and combined audit history.
- **Secret Store (`secret-store.ts`):** Stores only `SecretReference` in PostgreSQL; provides fail-closed `EnvDevOnlySecretStore` (blocked in `NODE_ENV=production`) and `GoogleSecretManagerSecretStore` (`@google-cloud/secret-manager` using Google ADC and `GCP_SECRET_MANAGER_PROJECT_ALLOWLIST`). Live Cloud IAM connectivity remains unverified until deployed with runtime IAM bindings.
- **Raw-Body Webhook Security (`webhook-verifier.ts`, `routes/webhooks.ts`):** Pre-JSON `express.raw` ingress verifying `x-dialpulse-signature` (`v1=<sha256>`), `x-dialpulse-timestamp` (`<= 300s`), inbound allowlists, KYC restrictions, and transactional `provider_webhook_logs` + `event_inbox` persistence.
- **External ID Mapping (`external-mappings.ts`):** Bidirectional `(tenantId, connectionId)` mappings preventing duplicate external identity reassignment.
- **Safe HTTP Client & Ecosystem Adapters (`http-client.ts`, `client-crm-http.ts`, `central-crm-http.ts`, `ecosystem-mock.ts`):** Enforces HTTPS in production, host allowlists, disabled redirects, timeouts, bounded retries, redacted logs, and egress filtering. Live `HttpClientCrmAdapter` / `HttpCentralCrmAdapter` remain explicitly marked `blocked_pending_api_contract` until live REST contracts are published.
- **Sensitive Data Egress Policy (`egress-policy.ts`):** Data classification (`public`, `internal`, `confidential`, `restricted`) with allowlist filtering blocking Aadhaar, PAN, banking, and KYC fields from unapproved external transmission.
- **Durable Event Processing & DLQ Replay (`src/server/events/`, `WSP-INT-023`):** PostgreSQL transactional `event_outbox` (`FOR UPDATE SKIP LOCKED`) with cross-tenant `eventId` collision guard, consumer `event_inbox` (`uq_event_inbox_tenant_consumer_event`), Zod-validated consumer payloads, webhook consumers (`webhook:*`), `correlationId` trace propagation, bounded-concurrency `DurableEventWorker` with process-level duplicate startup prevention, exponential backoff/DLQ (`retry-policy.ts`), authorized transactional DLQ replay (`replay-service.ts`, `event_replay_logs`), action-level idempotency with abandoned `processing` step recovery (`automation_action_steps`), and real PostgreSQL queue-age / retryable-failure observability metrics.

---

## 3. Runtime, Tooling & Database

- **Server Entry (`/server.ts`):** Express 4 serving raw-body `/api/integrations/webhooks` (before `express.json`), authenticated API routes, and Vite middleware (dev) or `/dist` (prod) on port `3000`. Exports `createApp()` cleanly without starting workers on import; handles `SIGTERM`/`SIGINT` graceful shutdown and separated health checks (`/api/health/live`, `/api/health/ready`, and sanitized `/api/health/worker` distinguishing `disabled`, `stopped`, `healthy`, and `unhealthy`).
- **Package Manager & CI:** Bun `1.4.4` (`bun.lock`, `bun install --frozen-lockfile`, `bun run lint`, `bun run test`, `bun run build`, `bun run db:generate`) + Node.js `22`.
- **PostgreSQL Schema (`src/db/schema.ts` — 26 live tables & `drizzle/` migrations):**
  - Core & Workspace: `users`, `tenants`, `tenant_memberships`, `workspace_org_configs`, `forms`, `form_submissions` (unique `(form_id, idempotency_key)`), `automations`, `automation_executions` (unique `(automation_id, event_id)`), `lead_intake_records`, `follow_up_tasks`, `internal_notifications`, `activity_logs`
  - Cost Control Center (`0006_cost_control_center.sql`): `cost_records` (FK `tenant_id` -> `tenants.id` `ON DELETE CASCADE`, `numeric(14,4)`, unique `(tenant_id, idempotency_key)`), `provider_pricing_configs` (`numeric(14,6)`, unique `(tenant_id, service_key, effective_from)`), `cost_budgets` (`numeric(14,4)`), `cost_alerts` (unique `(budget_id, period_key, alert_level)`)
  - Tenant App Management (`0005_tenant_app_installations.sql`): `tenant_app_installations` (FK `tenant_id` -> `tenants.id` `ON DELETE CASCADE`, unique `(tenant_id, app_id)`, index `(tenant_id, enabled)`)
  - Persistent User Preferences (`0004_user_preferences.sql`): `user_preferences` (FK `user_id` -> `users.id` `ON DELETE CASCADE`, unique `user_id`, `CHECK` constraints on `theme`, `density`, `date_format`)
  - Dynamic Tenant RBAC (`0003_tenant_role_permissions.sql`): `tenant_role_permissions` (unique `(tenant_id, role_key, permission_key)` with CHECK constraint on valid roles)
  - Durable Event Processing (`0001_durable_outbox_inbox_action_steps.sql`): `event_outbox`, `event_inbox`, `automation_action_steps`, plus nullable `idempotency_key` unique indexes on internal side-effect tables.
  - Integration Connections, Mappings, Webhook Logs & Replay History (`0002_integration_connections_external_mappings_webhook_logs.sql`): `integration_connections`, `external_id_mappings`, `provider_webhook_logs`, `event_replay_logs`, plus `replay_count`/`last_replayed_*` columns on `event_outbox` and `event_inbox`.

---

## 4. Security, Auth & Tenant Isolation

1. **Firebase Token Verification (`src/server/middleware/auth.ts`):** Validates `Authorization: Bearer <token>` on `/api/workspace/*`, `/api/forms/*`, `/api/automations/*`, and `/api/integrations/*` (`401` if missing/empty/expired).
2. **Fail-Closed Membership & Demo Guard (`src/db/users.ts`, `src/shared/auth-policy.ts`):**
   - Active `tenant_memberships` rows resolve normally.
   - Inactive/suspended users fail closed with HTTP `403`.
   - Unprovisioned users fail closed with HTTP `403` in `NODE_ENV=production` (even if `WORKSPACE_DEMO_PROVISIONING_ENABLED=true`) and in non-production unless `WORKSPACE_DEMO_PROVISIONING_ENABLED=true` is explicitly configured.
3. **Tenant Guard (`src/server/middleware/tenant-guard.ts`):** Validates optional `x-tenant-id` header against verified active memberships (`403` on cross-tenant attempt, `400` on invalid header). Every SQL query filters by `tenant_id`.
4. **Dynamic Tenant RBAC (`src/server/services/rbac-service.ts`, `src/shared/rbac.ts`, `requirePermission` / `requireAnyPermission`):** Loads authoritative per-tenant role capabilities from `tenant_role_permissions` on every authenticated request via a bounded (`200` tenants, `5s` TTL) invalidatable cache, **failing closed** on uninitialized/corrupt/DB-error states.
5. **User-Scoped Preferences Isolation (`WSP-INT-020`):** `GET/PUT /api/workspace/preferences` derive user ownership exclusively from verified `req.authContext.user` (`users.id`), reject unknown/spoofed fields via strict Zod validation, stay completely independent of tenant switching and tenant RBAC matrix failures, and migrate legacy browser `localStorage` values at most once when no persisted DB row exists.
6. **Tenant App Governance (`WSP-INT-021`):** `GET/PUT /api/workspace/apps*` & `requireAppEnabled` enforce catalog implementation status (`coming_soon` / `blocked` cannot be activated), RBAC (`canManageSettings` to toggle), core anti-lockout (`app-management` non-disableable), bounded cache invalidation, transactional `activity_logs`, and clean workspace gating on `/api/forms/*`, `/api/automations/*`, and `/api/workspace/costs/*` while keeping `/api/public/forms/:slug*` and stored PostgreSQL records intact.
7. **Public Endpoint Isolation:** `/api/public/forms/:slug*` accesses only `published` forms and is IP rate-limited (`25/min`). `/api/integrations/webhooks/:providerId/:connectionId` derives tenant strictly from `connectionId` and requires valid raw-body HMAC signatures (`<= 300s` replay window).

### 4.1 Dynamic Tenant RBAC & Governance Reference (`WSP-INT-019`)

- **Permission Catalog (`src/shared/rbac.ts`):** 29 stable capability keys across 7 categories (`Workspace`, `Forms`, `Automation`, `Operations`, `Administration`, `Finance & Analytics`, `Platform Security`), each annotated with label, description, risk level (`low | medium | high | critical`), default roles, `configurable`, and `protected` flags.
- **Tenant-Scoped Storage (`tenant_role_permissions`):** Normalized rows `(tenant_id, role_key, permission_key, enabled, updated_by_uid, created_at, updated_at)` with cascade delete FK to `tenants`, `CHECK` constraint on valid roles (`admin`, `manager`, `operator`, `viewer`), unique index on `(tenant_id, role_key, permission_key)`, and tenant/updated indexes.
- **Effective Permission Resolution & Cache Behavior:** `requireAuth` resolves permissions once per authenticated request via `resolveTenantRolePermissionsForRequest(tenantId, roleKey)` and binds them to `req.authContext.permissions`. An LRU-bounded per-tenant cache (`MAX_TENANT_CACHE_ENTRIES = 200`, `CACHE_TTL_MS = 5000`) avoids repeated SQL queries within a tenant while immediately invalidating on `PUT /api/workspace/rbac/matrix` and `seedTenantRolePermissions`. Tenant switching (`x-tenant-id` or `POST /api/workspace/tenant/switch`) always resolves against the newly selected tenant; demoted or revoked memberships fail immediately on the next request (`ensureUserMemberships`).
- **Protected Platform Permissions:** `canAdministerPlatformIdentity`, `canManageAllTenants`, and `canAccessCentralCrmAdmin` belong to Central CRM (`DialPulse-Central-CRM`). Both `sanitizeRoleCapabilities`, `buildMatrixFromStoredRows`, and `validateRoleMatrixGovernance` force these keys to `false` and return HTTP `403` on tamper attempts.
- **Role Governance Rules (`validateRoleMatrixGovernance`):** Requires `canManageRoles` (`403` otherwise); blocks disabling `admin.canManageRoles` (`400` anti-lockout); prevents non-admin delegated managers from modifying `admin`, modifying their own role (anti-self-escalation), granting capabilities they lack, or delegating `canManageRoles` (`403`); rejects unknown role/permission keys (`400`); strips incoming `roles` overrides in `PUT /api/workspace/settings/org-config`.
- **Audit History:** `updateTenantRolePermissions` executes inside `db.transaction`, batching changed rows and inserting immutable `activity_logs` records (`action = 'rbac.permission_updated'`, `roleKey`, `permissionKey`, `previousValue`, `newValue`, `riskLevel`, `correlationId`) atomically with the matrix update and `workspace_org_configs.config.roles` read-projection sync.
- **Migration & Recovery Behavior:** Migration `drizzle/0003_tenant_role_permissions.sql` creates `tenant_role_permissions` and idempotently backfills default capability rows for existing tenants (`ON CONFLICT DO NOTHING`). If a tenant has missing, empty, or corrupt rows or PostgreSQL is unavailable during lookup, `resolveRolePermissionsWithLoader` **fails closed** (`createFailClosedRoleConfig`: all 29 capabilities `false`) without elevating privileges. Recovery for a newly added or unseeded tenant runs `seedTenantRolePermissions(tenantId, actorUid)` (executed automatically during starter/demo provisioning).

### 4.2 Cost Control Center Architecture & Financial Honesty Guarantees (`WSP-INT-022`)

- **Fixed-Point BigInt Decimal Engine (`src/shared/cost-engine.ts`):** All monetary calculations use scaled `BigInt` fixed-point arithmetic (`AMOUNT_SCALE = 10_000n` for 4-decimal ledger totals, `UNIT_PRICE_SCALE = 1_000_000n` for 6-decimal unit rates) paired with PostgreSQL `numeric(14,4)` and `numeric(14,6)` columns. Floating-point `number` math is prohibited for financial persistence or aggregation.
- **Strict Multi-Currency Isolation:** `aggregateCurrencyTotals` groups balances strictly by ISO-4217 currency code (`INR`, `USD`, `EUR`, etc.) and never silently sums mixed currencies into an artificial single figure.
- **Clear Provenance Separation (`actual` vs `imported` vs `estimated` vs `projected`):** Manual/API-recorded expenses (`actual`), CSV batch imports (`imported`), DB-derived usage estimates (`estimated`), and linear end-of-month pacing (`projected`) are tracked and surfaced independently. Usage estimates multiply real PostgreSQL counts (`form_submissions`, `automation_executions`, `provider_webhook_logs`) against tenant-configured `provider_pricing_configs` unit prices.
- **Deduplicated Ingestion & Transactional Alerts:** CSV imports generate deterministic `SHA-256` row fingerprints stored under `(tenant_id, idempotency_key)` to block duplicate charges cleanly. Budget saves and expense writes atomically run `evaluateAndPersistBudgetAlerts` (`cost_alerts` unique on `(budget_id, period_key, alert_level)` + `internal_notifications` + auto-resolution when raised caps restore utilization below threshold) and record immutable `activity_logs` entries (`module: 'costs'`).
- **Explicit Provider Billing Status:** All 11 cataloged providers in `COST_PROVIDER_CATALOG` maintain `billingIntegrationStatus: 'not_connected'` and render explicit `Not connected · Manual / CSV Import` badges until live vendor billing contracts and credentials are provisioned.

