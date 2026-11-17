# DialPulse Workspace & Integration Platform — Application Inventory

**Reconciled Audit Date:** 2026-11-17  
**Repository:** `AtharvaNavlekar/DialPulse-Integration-Service` (`main` @ `4a55c4edba8b7bd160b8a050256e6ff06dceaf9e` matched 77/77 local files before reconciliation; subsequent milestones WSP-INT-007 through WSP-INT-022 implemented locally)  
**Target Architecture:** 51 Unique Navigable Views across Modules A–J (+ 2 utility entry routes: Sign-In Gate `/` and Public Customer Form `/f/:slug`).  
**Counting Rule:** Sub-tabs, modals, drawers, and helper cards are NOT double-counted as separate pages. Each row (#1–#51) is counted once.

---

## Summary Totals (Verified Codebase Reconciliation)

| Classification | Count | Definition |
| --- | ---: | --- |
| `COMPLETE` | **24** | Functional UI, API, PostgreSQL persistence, validation, RBAC/auth boundaries, and error handling verified |
| `PARTIAL` | **0** | No views remaining with incomplete database backing |
| `UI-ONLY` | **0** | Static controls without functional wiring |
| `MOCKED` | **0** | Views driven solely by hardcoded UI mock arrays *(note: Client CRM sync in backend uses explicit `ClientCrmMockAdapter`)* |
| `NOT STARTED` | **26** | Modules D, E, F, G (#32–34), H, J |
| `BLOCKED` | **1** | #35 Real KYC / Financial Document Upload Gate (pending KMS/encrypted storage & compliance sign-off) |
| **Total Unique Planned Views** | **51** | Exact non-overlapping inventory |

*Utility Routes Outside the 51-View Grid:*
- **Sign-In Gate (`/` unauthenticated)** — `COMPLETE` (`src/App.tsx`, Firebase Google Sign-In; Light/Dark verified via Playwright)
- **Public Customer Form (`/f/:slug`)** — `COMPLETE` (`src/components/PublicFormPage.tsx`, `src/server/routes/public-forms.ts`; end-to-end desktop & mobile validation + submission verified via Playwright & Cloud SQL)

---

## Verified 51-View Inventory (Modules A–J)

### Module A — Workspace Core (6 Views · 6 Complete, 0 Partial)

| # | View Name | URL Route | Verified Source Files & API | Status | Honest Evidence Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | Workspace Overview | `/overview` | `src/components/OverviewView.tsx`, `GET /api/workspace/overview`, `PATCH /api/workspace/tasks/:id/status` | `COMPLETE` | Real PostgreSQL `COUNT(*)` KPIs, category chart, Leads & Tasks tables. Note: leads show `MOCK-CRM-*` refs via `ClientCrmMockAdapter`. |
| 2 | My Apps Launcher | `/apps` | `src/components/MyAppsView.tsx`, `src/shared/app-catalog.ts` | `COMPLETE` | Consumes centralized 10-app catalogue and PostgreSQL `tenant_app_installations` state from `/api/workspace/session`; disables launch for tenant-disabled/unauthorized/blocked/coming-soon modules without fake toggles. |
| 3 | Global Search | Header `<input>` | `src/App.tsx`, `GET /api/workspace/search`, `src/shared/search-utils.ts` | `COMPLETE` | Tenant-isolated PostgreSQL search across 6 entity types (`forms`, `submissions`, `automations`, `leads`, `tasks`, `activity`) + module jump. |
| 4 | Notifications Center | `/notifications` | `src/components/NotificationsView.tsx`, `GET/POST /api/workspace/notifications*` | `COMPLETE` | Dedicated page + header bell popover, All/Unread filters, per-item & bulk mark-read in PostgreSQL. |
| 5 | My Profile | `/profile` | `src/components/ProfileView.tsx`, `GET /api/workspace/session`, `POST /api/workspace/tenant/switch` | `COMPLETE` | Authenticated identity, active tenant RBAC capability list, and verified tenant switcher. |
| 6 | Workspace Preferences | `/preferences` | `src/components/PreferencesView.tsx`, `src/context/PreferencesContext.tsx`, `src/shared/preferences*.ts`, `src/server/services/preferences-service.ts`, `GET/PUT /api/workspace/preferences` | `COMPLETE` | Authoritative PostgreSQL `user_preferences` persistence for theme, density, timezone, and date format with strict Zod validation, atomic upsert, coalesced saves, one-time legacy `localStorage` migration, sign-out/account-switch isolation, error/retry UI, and global CSS `data-density` table spacing. |

### Module B — Forms Studio (6 Views · 6 Complete)

| # | View Name | URL Route | Verified Source Files & API | Status | Honest Evidence Notes |
| --- | --- | --- | --- | --- | --- |
| 7 | Forms List | `/forms` | `src/components/forms/FormsListView.tsx`, `GET/POST/DELETE /api/forms*` | `COMPLETE` | Search, status filter, pagination, publish/unpublish, duplicate, delete, PostgreSQL counts. |
| 8 | Form Builder | `/forms/:id/builder` | `src/components/forms/FormBuilderView.tsx`, `PUT /api/forms/:id`, `src/shared/forms-validation.ts` | `COMPLETE` | 10 field types, reorder up/down, validation rules, client+server restricted KYC guard. Conditional branching/versioning deferred. |
| 9 | Form Settings & Sharing | `/forms/:id/builder` & `/preview` | `src/components/forms/FormBuilderView.tsx`, `FormPreviewView.tsx`, `POST /api/forms/:id/{publish,unpublish}` | `COMPLETE` | Metadata, category, submit/success copy, `/f/:slug` URL copy, `<iframe>` embed snippet. |
| 10 | Customer Form Preview | `/forms/:id/preview` | `src/components/forms/FormPreviewView.tsx`, `POST /api/forms/:id/preview-submit` | `COMPLETE` | Persists `preview_test` submissions to Cloud SQL and triggers active workflows. |
| 11 | Submissions Inbox | `/forms/:id/submissions` | `src/components/forms/SubmissionsInboxView.tsx`, `GET /api/forms/:id/submissions*` | `COMPLETE` | Source filter, search, pagination, modal/drawer details, CSV injection-safe export (`canExportSubmissions`). |
| 12 | Form Analytics | `/forms/:id/analytics` | `src/components/forms/FormAnalyticsView.tsx`, `GET /api/forms/:id/analytics`, `src/shared/form-analytics.ts` | `COMPLETE` | Real PostgreSQL counts, public vs preview breakdown, 7-day trend, per-field fill-rate coverage. |

### Module C — Workflow Automation (5 Views · 5 Complete)

| # | View Name | URL Route | Verified Source Files & API | Status | Honest Evidence Notes |
| --- | --- | --- | --- | --- | --- |
| 13 | Workflows List | `/automations` | `src/components/automations/AutomationListView.tsx`, `GET/PATCH/DELETE /api/automations*` | `COMPLETE` | Search, Active/Paused filter, toggle, edit, RBAC-protected delete. |
| 14 | Workflow Builder | `/automations/new`, `/automations/:id` | `src/components/automations/WorkflowBuilderView.tsx`, `POST/PUT /api/automations`, `POST /api/automations/dry-run` | `COMPLETE` | 5 triggers, 4 operators, 6 actions, explicit Draft/Active toggle, server-side Dry-Run simulator. *(Durable outbox/per-step idempotency tracked in Integration Design.)* |
| 15 | Workflow Templates | `/automations/templates` | `src/components/automations/WorkflowTemplatesView.tsx`, `src/shared/automation-templates.ts` | `COMPLETE` | 4 curated Loan-DSA templates cloning into Draft Builder mode. |
| 16 | Execution History | `/automations/executions` | `src/components/automations/ExecutionHistoryView.tsx`, `POST /api/automations/executions/:id/retry` | `COMPLETE` | Status filters, pagination, `MAX_AUTOMATION_RETRY_ATTEMPTS = 5` ceiling enforced in `automation-runner.ts`. |
| 17 | Execution Detail Inspector | Modal in `/automations/executions` | `src/components/automations/ExecutionDetailModal.tsx` | `COMPLETE` | Inspects trigger `eventPayload`, `actionResults`, errors, and attempt count. |

### Module D — Call Operations (5 Views · Stage 3)

| # | View Name | URL Route | Status | Notes |
| --- | --- | --- | --- | --- |
| 18 | Calling Queues | `/calls` (`ComingSoonView`) | `NOT STARTED` | Stage 3 roadmap placeholder |
| 19 | Agent Call Console / Dialer | — | `NOT STARTED` | Stage 3 (requires approved voice provider) |
| 20 | Call Scripts Library | — | `NOT STARTED` | Stage 3 |
| 21 | Call Disposition Logs | — | `NOT STARTED` | Stage 3 |
| 22 | Telephony Provider Settings | — | `NOT STARTED` | Stage 3 |

### Module E — Appointment Scheduler (5 Views · Stage 2 Next)

| # | View Name | URL Route | Status | Notes |
| --- | --- | --- | --- | --- |
| 23 | Upcoming & Past Bookings | `/appointments` (`ComingSoonView`) | `NOT STARTED` | Stage 2 next vertical slice |
| 24 | Event Types & Slot Config | — | `NOT STARTED` | Planned Stage 2 |
| 25 | Employee Availability Hours | — | `NOT STARTED` | Planned Stage 2 |
| 26 | Public Booking Page | — | `NOT STARTED` | Planned Stage 2 |
| 27 | Reminder & Reschedule Rules | — | `NOT STARTED` | Planned Stage 2 |

### Module F — Support Inbox (4 Views · Stage 4)

| # | View Name | URL Route | Status | Notes |
| --- | --- | --- | --- | --- |
| 28 | Conversation Queue | `/inbox` (`ComingSoonView`) | `NOT STARTED` | Stage 4 roadmap placeholder |
| 29 | Conversation Detail & Notes | — | `NOT STARTED` | Stage 4 |
| 30 | Canned Responses | — | `NOT STARTED` | Stage 4 |
| 31 | Inbox Channel & SLA Rules | — | `NOT STARTED` | Stage 4 |

### Module G — Document Workflow (4 Views · Stage 5)

| # | View Name | URL Route | Status | Notes |
| --- | --- | --- | --- | --- |
| 32 | Case Document Checklists | `/documents` (`ComingSoonView`) | `NOT STARTED` | Stage 5 roadmap placeholder |
| 33 | Document Verification Queue | — | `NOT STARTED` | Stage 5 |
| 34 | Document Templates | — | `NOT STARTED` | Stage 5 |
| 35 | Real KYC / Financial Upload Gate | — | `BLOCKED` | Blocked pending encrypted storage, KMS, malware scan, and compliance sign-off |

### Module H — Business Analytics (5 Views · Stage 6)

| # | View Name | URL Route | Status | Notes |
| --- | --- | --- | --- | --- |
| 36 | Lead Funnel Overview | `/analytics` (`ComingSoonView`) | `NOT STARTED` | Stage 6 roadmap placeholder |
| 37 | Assignment & Queue SLA | — | `NOT STARTED` | Stage 6 |
| 38 | Follow-Up Completion Metrics | — | `NOT STARTED` | Stage 6 |
| 39 | Automation Reliability Report | — | `NOT STARTED` | Stage 6 |
| 40 | Scheduled Report Exports | — | `NOT STARTED` | Stage 6 |

### Module I — Administration & Integration Admin (7 Views · 7 Complete, 0 Not Started)

| # | View Name | URL Route | Verified Source Files & API | Status | Honest Evidence Notes |
| --- | --- | --- | --- | --- | --- |
| 41 | Team Members & Employees | `/settings` | `src/components/SettingsView.tsx`, `PUT /api/workspace/settings/org-config` | `COMPLETE` | Full Employee CRUD persisted to `workspace_org_configs` (`canManageEmployees` or `canManageSettings`). |
| 42 | Roles & Permissions Matrix | `/settings` | `src/components/settings/RolesPermissionsMatrix.tsx`, `src/server/services/rbac-service.ts`, `src/shared/rbac.ts`, `GET/PUT /api/workspace/rbac/matrix`, `POST /api/workspace/rbac/validate`, `GET /api/workspace/rbac/catalog` | `COMPLETE` | Authoritative PostgreSQL `tenant_role_permissions` matrix across 29 granular capabilities and 4 roles (`admin`, `manager`, `operator`, `viewer`), protected platform locks, governance validation, bounded invalidatable request cache with fail-closed semantics, high-risk `ConfirmModal`, and transactional `activity_logs` audit history. |
| 43 | Workspace Org Settings | `/settings` | `src/components/SettingsView.tsx`, `PUT /api/workspace/settings/org-config` | `COMPLETE` | Departments, Queues, Assignment Rules CRUD, and Workflow Stages persisted to PostgreSQL with activity logging. |
| 44 | App Management | `/settings/apps` | `src/components/settings/AppManagementView.tsx`, `src/shared/app-catalog.ts`, `src/server/services/app-management-service.ts`, `GET /api/workspace/apps`, `GET /api/workspace/apps/catalog`, `PUT /api/workspace/apps/:appId` | `COMPLETE` | Central 10-module catalogue, PostgreSQL `tenant_app_installations` persistence (`0005`), search/category/status filtering, details & dependency/blocker panel, RBAC (`canManageSettings`) & release-status activation guards, `ConfirmModal`, transactional `activity_logs` audit trail, and workspace route/API gating (`requireAppEnabled`). |
| 45 | Provider Connections & Health (Integrations & DLQ Console) | `/settings/integrations` | `src/components/SettingsView.tsx`, `src/components/integrations/*`, `src/server/integrations/*`, `src/server/routes/{integrations,webhooks,automations}.ts` | `COMPLETE` | Full 8-tab console (Overview, Provider Catalog, Connections + 9-section Details Drawer, Webhook Activity, Durable Events Monitor, Authorized DLQ Replay, Read-only Mappings Explorer, Combined Audit History) with RBAC gating (`admin`/`manager`), Secret Manager readiness, and zero secret/raw-payload exposure. Live GCP IAM and external CRM contracts remain honestly flagged blocked until provisioned. |
| 46 | Audit Logs | `/activity` | `src/components/ActivityLogsView.tsx`, `GET /api/workspace/activity` | `COMPLETE` | Module filter, date-range filter, search, 25-row pagination, Preferences timestamps. |
| 47 | Cost Control Center | `/costs` | `src/components/costs/CostControlCenterView.tsx`, `src/shared/cost-engine.ts`, `src/server/services/cost-control-service.ts`, `src/server/routes/costs.ts`, `GET/POST /api/workspace/costs/*`, `PUT /api/workspace/costs/providers/pricing`, `PUT /api/workspace/costs/budgets/:id`, `POST /api/workspace/costs/alerts/:id/resolve` | `COMPLETE` | Multi-currency fixed-point BigInt decimal accounting (`numeric(14,4)`/`(14,6)`), actual vs imported vs estimated vs projected separation, manual expense entry + CSV batch import with idempotency deduplication, DB-derived usage estimates, threshold budget alerts + internal notifications, dynamic RBAC (`canViewCostCenter`/`canManageCostCenter`), App Management gating, and explicit `Not connected` external billing states. |

### Module J — Knowledge Hub (4 Views · Stage 8)

| # | View Name | URL Route | Status | Notes |
| --- | --- | --- | --- | --- |
| 48 | Knowledge Base Articles | — | `NOT STARTED` | Stage 8 |
| 49 | Loan-DSA SOPs & Checklists | — | `NOT STARTED` | Stage 8 |
| 50 | Article Editor | — | `NOT STARTED` | Stage 8 |
| 51 | Knowledge Search | — | `NOT STARTED` | Stage 8 |
