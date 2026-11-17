# DialPulse Workspace & Integration Platform

Unified modular monolith (`AtharvaNavlekar/DialPulse-Integration-Service`) combining internal financial-services/loan-DSA business mini-apps (**Workspace Layer**) and durable connector/event infrastructure (**Integration Layer**).

## Ecosystem Ownership

| System | Repository | Authority |
| --- | --- | --- |
| **DialPulse Workspace & Integration Platform** | `AtharvaNavlekar/DialPulse-Integration-Service` | Internal mini-apps, Forms Studio, Automation Lite, provider registry, webhooks, durable event inbox/outbox, external ID mappings |
| **Client CRM** | `AtharvaNavlekar/Client-CRM` | Canonical leads, customer records, tenant CRM workflows |
| **Central CRM** | `AtharvaNavlekar/DialPulse-Central-CRM` | Platform staff identity, tenant lifecycle, privileged governance |
| **DialPulse Web** | `AtharvaNavlekar/DialPulse-Web` | Public marketing website & acquisition intake |

**Boundary Rule:** This platform never connects directly to Client CRM or Central CRM production databases. Cross-system integrations use typed internal adapter contracts (`src/server/integrations/`) and explicitly flagged mock adapters (`src/server/adapters/ecosystem-mock.ts`) until verified live contracts are connected.

---

## Architecture & Runtime

- **Runtime:** Node.js `>=22.14.0` (strip-only TypeScript execution via `node server.ts`) and Bun `>=1.4.4` (`bun.lock` is the standard lockfile).
- **Frontend:** React 19, TypeScript, Tailwind CSS v4, Vite (`src/`), adhering strictly to the official DialPulse Light (`#00695C` / `#F8FAF9`) and Dark (`#80D5C4` / `#0B0F0E`) design tokens.
- **Backend:** Express 4 (`server.ts`, `src/server/`) serving REST APIs and Vite/static assets on port `3000`.
- **Database:** Cloud SQL (PostgreSQL) via Drizzle ORM (`src/db/schema.ts`, `src/db/index.ts`, `src/db/drizzle.config.ts`).
- **Authentication & Security:**
  - Server-side Firebase ID token verification via `firebase-admin` (`src/server/middleware/auth.ts`).
  - Strict tenant isolation via verified `tenant_memberships` (`src/server/middleware/tenant-guard.ts`) and dynamic PostgreSQL RBAC (`tenant_role_permissions`, `requirePermission` / `requireAnyPermission`).
  - Fail-closed demo provisioning (`WORKSPACE_DEMO_PROVISIONING_ENABLED`, permanently disabled in `NODE_ENV=production`).
  - KYC/financial field safety guard (`src/shared/forms-validation.ts`) and sensitive data egress allowlists (`src/server/integrations/egress-policy.ts`).

---

## Installation, Migrations & Verification (Bun Standard)

```bash
bun install --frozen-lockfile
bun run lint
bun run test
bun run build
```

Generate checked-in Drizzle SQL migrations under `drizzle/` after schema edits:

```bash
bun run db:generate --name=<migration_name>
```

Production start:

```bash
NODE_ENV=production node server.ts
```

### Worker, Health & Integration Endpoints
- Configure the internal durable event worker via `EVENT_WORKER_ENABLED` (`"true"` in runtime, defaults `"false"` in `NODE_ENV=test`), `EVENT_WORKER_POLL_INTERVAL_MS`, `EVENT_WORKER_BATCH_SIZE`, `EVENT_WORKER_MAX_CONCURRENCY`, and `EVENT_WORKER_LEASE_MS`. A process-level guard prevents accidental duplicate worker polling loops inside one Node process.
- Health probes: `/api/health/live` (process liveness), `/api/health/ready` (PostgreSQL `SELECT 1`), and sanitized `/api/health/worker` (reports `disabled` / `stopped` / `healthy` / `unhealthy` without leaking PIDs or raw errors; returns `503` when enabled worker is stopped, stale, or errored). Event delivery guarantees are **at-least-once with idempotent PostgreSQL consumers**.
- **Integration & Console Endpoints:** `/api/integrations/*` (overview with live PostgreSQL queue-age & retryable metrics, provider catalog, connection lifecycle + details, external ID mappings, webhook logs, combined audit history), `/settings/integrations` (Integrations & DLQ Operations Console), `/api/workspace/costs/*` & `/costs` (Cost Control Center with fixed-point BigInt decimal ledger, CSV import deduplication, usage estimates, and budget alerts), raw-body HMAC-SHA256 ingress at `POST /api/integrations/webhooks/:providerId/:connectionId`, and authorized DLQ replay at `POST /api/automations/events/:source/:id/replay`.
- **Production Cutover Notes:** `env_dev_only` secrets are blocked in `NODE_ENV=production`. `@google-cloud/secret-manager` (`GoogleSecretManagerSecretStore`) is installed and uses Google ADC with `GCP_SECRET_MANAGER_PROJECT_ALLOWLIST`, while live Cloud IAM permissions and `HttpClientCrmAdapter` / `HttpCentralCrmAdapter` live REST API contracts remain pending before live cutover.

*(Note: Keep `WORKSPACE_DEMO_PROVISIONING_ENABLED=false` outside local development. In `NODE_ENV=production`, unprovisioned users are always denied with HTTP `403` regardless of environment flags.)*

---

## Documentation Index

- `docs/APP-INVENTORY.md` — Verified 51-view platform inventory (24 Complete, 0 Partial, 26 Not Started, 1 Blocked)
- `docs/ARCHITECTURE.md` — Unified Workspace + Integration Layer modular monolith architecture
- `docs/INTEGRATION-PLATFORM-DESIGN.md` — Detailed design specs for `WSP-INT-004` through `WSP-INT-018`
- `docs/IMPLEMENTATION-ROADMAP.md` — Stages 1–8 incremental vertical-slice roadmap
- `docs/DESIGN-SYSTEM.md` — Official DialPulse Light & Dark tokens and UI primitives
- `docs/TECHNICAL-DEBT.md` — Audited security, reliability, and scalability debt register
