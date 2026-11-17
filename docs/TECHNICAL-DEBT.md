# DialPulse Workspace & Integration Platform — Technical Debt & Risk Register

This register tracks audited security, reliability, data-ownership, and scalability findings in the unified codebase (`AtharvaNavlekar/DialPulse-Integration-Service`).

---

## Resolved P0 & High-Priority Items

1. **P0 — Unconditional Demo Admin Provisioning (`src/db/users.ts`) — RESOLVED**
   - *Finding:* `ensureUserMemberships()` previously created two demo tenants and granted `admin` / `manager` roles to any new Firebase user even in `NODE_ENV=production`.
   - *Fix:* Implemented `evaluateDemoProvisioningPolicy()` (`src/shared/auth-policy.ts`) and `resolveOrProvisionMemberships()` (`src/db/users.ts`): production (`NODE_ENV=production`) ALWAYS fails closed with HTTP `403`, inactive memberships fail closed with HTTP `403`, and dev demo provisioning requires explicit `WORKSPACE_DEMO_PROVISIONING_ENABLED=true`. Verified with 10 unit tests (`src/shared/auth-policy.test.ts`, `src/db/users.test.ts`).

2. **Package Naming, Bun Lockfile Parity & CI (`package.json`, `.github/workflows/ci.yml`) — RESOLVED**
   - *Fix:* Renamed `react-example` -> `dialpulse-workspace-integration-platform`, added `engines` (`bun >=1.4.4`, `node >=22.14.0`), added `typecheck`/`verify` scripts, and created GitHub Actions workflow (`bun install --frozen-lockfile`, lint, test, build). *(GitHub remote workflow execution stays `NOT VERIFIED` until pushed to GitHub.)*

3. **Sensitive Data Egress Rules (`WSP-INT-015`) — RESOLVED (Policy Module Added)**
   - *Fix:* Implemented allowlist-based classification & egress filtering (`src/server/integrations/egress-policy.ts`) blocking `restricted` KYC/financial fields by default from external transmission.

4. **Overview KPI Count Accuracy, Global Search, URL Routing & Modularization — RESOLVED**
   - *Fix:* Real SQL `COUNT(*)` overview metrics, `/api/workspace/search`, `history.pushState` URL router, modular Forms & Automations UI, Draft/Active save + Dry-Run simulator + retry limit (5).

---

## Open Architectural & Production-Readiness Risks (Prioritized)

5. **P1 — Synchronous Form Submission -> Automation Coupling (`WSP-INT-007` & `WSP-INT-008`) — RESOLVED**
   - *Fix:* `public-forms.ts`, `forms.ts`, and `workspace.ts` now commit domain writes and `event_outbox` rows atomically inside `db.transaction`; `DurableEventWorker` (`FOR UPDATE SKIP LOCKED`) publishes idempotently to `event_inbox`, executes resumable `automation_action_steps` with DB-level `idempotency_key` deduplication, applies exponential backoff + jitter, and moves exhausted/non-retryable events to `dead_letter`.

6. **P1 — Missing Versioned Drizzle SQL Migrations — RESOLVED**
   - *Fix:* Added `drizzle/0000_baseline_existing_tables.sql`, `drizzle/0001_durable_outbox_inbox_action_steps.sql`, `drizzle/meta/_journal.json`, and `bun run db:generate`. *(Production Cloud SQL migration application remains unapplied pending deployment authorization.)*

7. **Live Express HTTP & DB Integration Test Suite — RESOLVED**
   - *Fix:* Added `src/server/events/durable-pipeline.test.ts` and `src/server/routes/http-integration.test.ts` running against isolated synthetic PostgreSQL tenants and ephemeral Express instances.

---

## Open Architectural & Production-Readiness Risks (Prioritized)

8. **WSP-INT-009 / WSP-INT-010 / DLQ Replay Infrastructure — RESOLVED (Internal & Contract-Test Foundation)**
   - *Fix:* Implemented `integration_connections`, `external_id_mappings`, `provider_webhook_logs`, `event_replay_logs` (`drizzle/0002_*.sql`), raw-body HMAC-SHA256 `WebhookVerifier` (`<= 300s` replay window), `SafeIntegrationHttpClient`, typed `HttpClientCrmAdapter` & `HttpCentralCrmAdapter`, and transactional `POST /api/automations/events/:source/:id/replay`.

9. **P1 — Unconfigured Live Client CRM / Central CRM API Contracts & Unverified Live GCP Secret Manager IAM**
   - *Finding:* `@google-cloud/secret-manager` (`^8.0.0`) is now installed and wired via `GoogleSecretManagerSecretStore` + `GCP_SECRET_MANAGER_PROJECT_ALLOWLIST`, verified against mocked gRPC clients. However, live GCP IAM connectivity (Cloud Run service account `secretmanager.secretAccessor` & ADC) is not verified in this sandbox, and confirmed external Client CRM / Central CRM REST endpoint URLs, service-JWT audience/issuer claims, and OpenAPI response schemas are not present (`blocked_pending_api_contract`). External providers without native idempotency keys also still require external-ID reconciliation before cutover.

10. **P2 — Hardcoded Role Permission Enforcement (`WSP-INT-019`) — RESOLVED**
    - *Finding:* `SettingsView.tsx` previously displayed static `orgConfig.roles` JSONB while `tenant-guard.ts` enforced hardcoded `getRolePermissions(roleKey)` defaults.
    - *Fix:* Implemented normalized `tenant_role_permissions` PostgreSQL storage (`drizzle/0003_tenant_role_permissions.sql`), 29 granular capabilities (`src/shared/rbac.ts`), fail-closed request-scoped loader with bounded invalidatable cache (`src/server/services/rbac-service.ts`), governance validation APIs (`/api/workspace/rbac/*`), granular `requirePermission` / `requireAnyPermission` enforcement across all routers, role stripping in `PUT /api/workspace/settings/org-config`, and interactive `RolesPermissionsMatrix` UI (`src/components/settings/RolesPermissionsMatrix.tsx`). View #42 is now `COMPLETE`.

11. **P2 — Browser-Local User Preferences (`WSP-INT-020`) — RESOLVED**
    - *Finding:* Theme, timezone, date format, and table density were previously stored only in browser `localStorage`, causing cross-device drift and stale state across account switches.
    - *Fix:* Implemented `user_preferences` PostgreSQL table (`drizzle/0004_user_preferences.sql`), strict user-scoped `GET/PUT /api/workspace/preferences` endpoints (`src/server/services/preferences-service.ts`), `PreferencesController` (`src/shared/preferences-controller.ts`), PostgreSQL-backed `PreferencesContext` + `ThemeContext`, one-time legacy `localStorage` migration (only when unpersisted), error+retry UI, sign-out/account-switch isolation, and global CSS `data-density` grid spacing. View #6 is now `COMPLETE`.

12. **P2 — Hardcoded App Launcher & Missing Per-Tenant App Governance (`WSP-INT-021`) — RESOLVED**
    - *Finding:* `MyAppsView.tsx` hardcoded a 7-item local array and `workspace.ts` hardcoded `activeMiniApps = 2` without tenant-scoped PostgreSQL persistence or route/API enforcement.
    - *Fix:* Implemented centralized 10-module catalogue (`src/shared/app-catalog.ts`), `tenant_app_installations` table (`drizzle/0005_tenant_app_installations.sql`), `app-management-service.ts`, `GET/PUT /api/workspace/apps*` with release-status & RBAC guards, `requireAppEnabled` middleware on `/api/forms` and `/api/automations`, dynamic `OverviewView`/`MyAppsView`/sidebar/route enforcement, and View #44 `AppManagementView` (`/settings/apps`).

13. **P2 — Cost Control Center & Metered Spend Governance (`WSP-INT-022`) — RESOLVED (Local Ledger, Budgets & Manual/CSV Ingestion)**
    - *Finding:* View #47 (`Cost Control Center`) was previously unimplemented (`NOT STARTED`), leaving tenants without multi-currency expense tracking, usage-derived metering estimates, or budget threshold alerts.
    - *Fix:* Implemented `cost_records`, `provider_pricing_configs`, `cost_budgets`, and `cost_alerts` (`drizzle/0006_cost_control_center.sql`) with `numeric(14,4)`/`(14,6)` columns, fixed-point BigInt decimal engine (`src/shared/cost-engine.ts`), strict ISO-4217 currency isolation, CSV batch import deduplication, usage estimates derived from real PostgreSQL logs, transactional budget alerts + `internal_notifications`, dynamic RBAC (`canViewCostCenter`/`canManageCostCenter`), App Management gating (`/costs`), and View #47 UI (`src/components/costs/CostControlCenterView.tsx`).
    - *Remaining Boundary:* External vendor billing APIs remain explicitly flagged `Not connected` (`billingIntegrationStatus: 'not_connected'`) until live provider billing contracts and credentials are provisioned.

14. **P2 — Durable Event Hardening, Health Sanitization & Queue Observability (`WSP-INT-023`) — RESOLVED (Internal Monolith)**
    - *Fix:* Added cross-tenant `eventId` outbox collision protection, Zod consumer payload validation, end-to-end `correlationId` trace propagation, abandoned `processing` action-step recovery logging, process-level duplicate-worker startup guard, sanitized public `/api/health/worker` states (`disabled`/`stopped`/`healthy`/`unhealthy` without exposing PID/raw errors), real PostgreSQL `retryableFailures`, `oldestPendingAgeSeconds`, and `lastSuccessfulProcessedAt` metrics, plus concurrent multi-worker & RBAC HTTP integration tests.
    - *Honest Delivery Semantics:* Delivery guarantees are **at-least-once with idempotent internal PostgreSQL consumers** (never distributed exactly-once). External third-party providers without native idempotency keys remain vulnerable to duplicate side effects on crash-before-ack and are gated behind `blocked_pending_api_contract` until live reconciliation/idempotency contracts are added.

15. **P2 — In-Memory Public Rate Limiter (`src/server/middleware/rate-limit.ts`)**
    - *Finding:* Expired-bucket pruning runs every 200 requests, but counters reset on restart and are local to a single Cloud Run instance. Replace with PostgreSQL / Redis rate limiting prior to horizontal scaling.

16. **P2 — Unpaginated Backend List Queries (`forms.ts`, `automations.ts`, `workspace.ts`)**
    - *Finding:* UI paginates client-side, while API endpoints still cap queries (`limit(100)` / `limit(200)`). Add server-side cursor/offset pagination for high-volume tenants.

