# DialPulse Workspace & Integration Platform — Implementation Roadmap

Unified modular monolith (`AtharvaNavlekar/DialPulse-Integration-Service`) sequencing internal business mini-apps (Workspace Layer) alongside durable connectors & event processing (Integration Layer).

---

## Stage 1 — Platform Stabilization, Security & Integration Foundation (Active)
- **WSP-INT-001 (Baseline Reconciliation):** Unified architecture docs, reconciled 51-view inventory (updated to `24 COMPLETE`, `0 PARTIAL`, `26 NOT STARTED`, `1 BLOCKED`).
- **WSP-INT-002 (Reproducible Bun Setup & CI):** Standardized `bun.lock`, `package.json`, `bun install --frozen-lockfile`, `.github/workflows/ci.yml`.
- **P0 Security Fix:** Production-safe fail-closed demo provisioning (`WORKSPACE_DEMO_PROVISIONING_ENABLED`, `src/db/users.ts`, `src/shared/auth-policy.ts`), inactive-membership guard, and auth boundary tests.
- **Integration Contracts & Egress Policy:** Typed adapter interfaces, Provider Registry, and Sensitive Data Egress Policy (`WSP-INT-015`).
- **WSP-INT-007 & WSP-INT-008 (Durable Event Processing — Implemented):** PostgreSQL transactional `event_outbox`, consumer `event_inbox`, per-action resumable `automation_action_steps`, `SKIP LOCKED` bounded-concurrency worker, lease recovery, exponential backoff/DLQ, separated health checks, and checked-in Drizzle migrations (`drizzle/`).
- **WSP-INT-009, WSP-INT-010 & DLQ Replay (Implemented):** `integration_connections`, `external_id_mappings`, `provider_webhook_logs`, `event_replay_logs` (`drizzle/0002_*`), raw-body HMAC-SHA256 `WebhookVerifier` (`<= 300s` replay window), `GoogleSecretManagerSecretStore` (`@google-cloud/secret-manager` + `GCP_SECRET_MANAGER_PROJECT_ALLOWLIST`), `SafeIntegrationHttpClient`, typed `HttpClientCrmAdapter`/`HttpCentralCrmAdapter` (live contracts pending), integration management APIs (`/api/integrations/*`), and authorized DLQ replay (`POST /api/automations/events/:source/:id/replay`).
- **WSP-INT-013 (Integration & DLQ Operations Console UI — Implemented):** Full `/settings/integrations` workspace console (View #45) covering Overview KPIs, Worker Health, Secret Manager Readiness, Provider Catalog, Connection Lifecycle & 9-Section Details Drawer, Webhook Activity Viewer, Event Processing Monitor, Authorized DLQ Replay, Read-only Mappings Explorer, and Combined Audit History.
- **WSP-INT-019 (Dynamic Tenant RBAC & Permission Governance — Implemented):** Normalized `tenant_role_permissions` schema (`drizzle/0003_*`), 29 granular capabilities across 7 categories with 3 Central CRM protected capability locks, fail-closed request-scoped cache & loader (`rbac-service.ts`), governance APIs (`/api/workspace/rbac/*`), dynamic route guards across `workspace`, `forms`, `automations`, and `integrations` routers, transactional audit logs, and View #42 `RolesPermissionsMatrix` UI.
- **WSP-INT-020 (Persistent Workspace Preferences — Implemented):** User-scoped PostgreSQL `user_preferences` table (`drizzle/0004_*`), `GET/PUT /api/workspace/preferences` with strict Zod validation and atomic upsert, PostgreSQL-backed `PreferencesContext` & `ThemeContext` with coalesced saves, one-time legacy `localStorage` migration, sign-out/account-switch isolation, error/retry UI, and View #6 promoted to `COMPLETE`.
- **WSP-INT-021 (App Management — View #44 Implemented):** Centralized 10-module catalogue (`src/shared/app-catalog.ts`), PostgreSQL `tenant_app_installations` table (`drizzle/0005_*`), `GET/PUT /api/workspace/apps*` with release-status & RBAC guards (`canManageSettings`), transactional `activity_logs` recording, View #44 UI (`/settings/apps`), synchronized `MyAppsView`, sidebar/route guards, dynamic `activeMiniApps` overview count, and `requireAppEnabled` backend enforcement on `/api/forms` & `/api/automations`.
- **WSP-INT-022 (Cost Control Center — View #47 Implemented):** PostgreSQL `cost_records`, `provider_pricing_configs`, `cost_budgets`, and `cost_alerts` tables (`drizzle/0006_*`), fixed-point BigInt decimal cost engine (`src/shared/cost-engine.ts`), strict ISO-4217 currency isolation, manual expense entry + CSV batch import with idempotency deduplication, usage-based estimates derived from real DB execution/submission/webhook logs, transactional threshold budget alerts & internal notifications, dynamic RBAC (`canViewCostCenter` / `canManageCostCenter`), App Management toggle (`/costs`), and explicit `Not connected` external billing states.
- **WSP-INT-023 (Durable Event Processing & Integration Reliability Hardening — Implemented):** Added cross-tenant outbox `eventId` collision guard, Zod consumer payload validation (`INVALID_EVENT_PAYLOAD`), end-to-end `correlationId` propagation, abandoned `processing` action-step crash recovery logging, process-level duplicate-worker startup guard, sanitized public `/api/health/worker` states (`disabled`, `stopped`, `healthy`, `unhealthy`), real PostgreSQL observability metrics (`retryableFailures`, `oldestPendingAgeSeconds`, `lastSuccessfulProcessedAt`) in `/api/integrations/overview` and the Integrations Console, plus multi-worker & HTTP DLQ RBAC integration tests.
- **Remaining Cutover Gate (`WSP-INT-018`):** Live GCP Secret Manager IAM credentials/ADC verification in Cloud Run and confirmed Client CRM / Central CRM live REST contracts prior to live traffic cutover.


---

## Stage 2 — Appointment Scheduler (5 Views)
- Schema tables: `appointment_types`, `employee_availability`, `appointments`.
- Transaction-safe double-booking guard, public booking link `/book/:slug`, cancellation/reschedule flows, and `appointment_booked` outbox event emission.

---

## Stage 3 — Call Operations (5 Views)
- Schema tables: `call_queues`, `call_scripts`, `call_attempts`.
- Calling queues, agent console, script prompts, disposition logging, and pluggable Telephony adapter (requires approved provider, consent/DNC/quiet-hour enforcement, and verified call-event webhook ingestion).

---

## Stage 4 — Support Inbox (4 Views)
- Schema tables: `support_conversations`, `support_messages`, `canned_responses`.
- Queue filters, conversation assignment, internal notes, and SLA rules.

---

## Stage 5 — Document Workflow (4 Views; #35 Blocked Pending Compliance)
- Case document checklists, verification queues, and document templates using synthetic/metadata states.
- **Blocked Gate:** Real KYC and financial document uploads remain blocked until encrypted storage, KMS, malware scanning, retention, and compliance approval are complete.

---

## Stage 6 — Business Analytics (5 Views)
- Lead funnel progression across configurable workflow stages, queue SLA adherence, follow-up completion metrics, automation reliability, and authorized exports.

---

## Stage 7 — Administration, Integration Console & Cost Control (`WSP-INT-013` / `WSP-INT-022`)
- **Completed:** Integration & DLQ Operations Console (View #45 at `/settings/integrations`), `@google-cloud/secret-manager` SDK integration (`GoogleSecretManagerSecretStore`), Dynamic Tenant RBAC & Permission Governance (View #42, `WSP-INT-019`), Persistent Workspace Preferences (View #6, `WSP-INT-020`), Per-Tenant App Management (View #44 at `/settings/apps`, `WSP-INT-021`), and Cost Control Center (View #47 at `/costs`, `WSP-INT-022`, `drizzle/0006_cost_control_center.sql`).
- **Remaining Stage 7 Items:** External vendor billing API connectors remain explicitly flagged `Not connected` until live provider billing credentials and API contracts are approved.

---

## Stage 8 — Knowledge Hub (4 Views)
- SOP articles, checklists, Markdown editor, tenant-scoped search, access permissions, and version history. AI retrieval waits until tenant isolation and source traceability are proven.
