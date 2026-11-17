import React from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  KeyRound,
  Link2,
  PlugZap,
  RefreshCw,
  ShieldAlert,
  Webhook,
} from 'lucide-react';
import type { IntegrationsSubTab } from '../../shared/routes.ts';
import type { IntegrationOverviewPayload } from '../../shared/types.ts';
import { AlertBanner, Button, Card, StatusIndicator } from '../ui/Primitives.tsx';

interface IntegrationOverviewPanelProps {
  overview: IntegrationOverviewPayload | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onNavigateTab: (tab: IntegrationsSubTab) => void;
  formatTimestamp: (iso: string | Date) => string;
}

export function IntegrationOverviewPanel({
  overview,
  loading,
  error,
  onRetry,
  onNavigateTab,
  formatTimestamp,
}: IntegrationOverviewPanelProps) {
  if (error && !overview) {
    return (
      <Card className="p-6 space-y-4">
        <AlertBanner tone="error" message={error} />
        <div>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            Retry Overview
          </Button>
        </div>
      </Card>
    );
  }

  if (loading && !overview) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, idx) => (
          <Card key={idx} className="p-5 space-y-3 animate-pulse">
            <div className="h-3 w-24 bg-[var(--dp-surface-variant)] rounded" />
            <div className="h-7 w-16 bg-[var(--dp-surface-variant)] rounded" />
            <div className="h-3 w-36 bg-[var(--dp-surface-variant)] rounded" />
          </Card>
        ))}
      </div>
    );
  }

  if (!overview) return null;

  const workerStatus =
    overview.worker.status ??
    (!overview.worker.enabled
      ? 'disabled'
      : !overview.worker.running || overview.worker.stopping
        ? 'stopped'
        : overview.worker.healthy
          ? 'healthy'
          : 'unhealthy');

  const workerTone =
    workerStatus === 'disabled'
      ? 'neutral'
      : workerStatus === 'healthy'
        ? 'success'
        : workerStatus === 'stopped'
          ? 'warning'
          : 'error';
  const workerLabel =
    workerStatus === 'disabled'
      ? 'Disabled (Manual / Test Mode)'
      : workerStatus === 'stopped'
        ? 'Stopped (Not Running)'
        : workerStatus === 'healthy'
          ? 'Running & Healthy'
          : 'Degraded / Poll Error';

  const formatQueueAge = (seconds: number | null) => {
    if (seconds === null) return 'Queue empty';
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  };

  const secretTone =
    overview.secretManager.runtimeMode === 'gcp_allowlist_configured_iam_unverified'
      ? 'info'
      : overview.secretManager.runtimeMode === 'development_env_fallback'
        ? 'warning'
        : 'error';

  return (
    <div className="space-y-6">
      {error && <AlertBanner tone="warning" message={error} />}

      {/* KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card className="p-4 space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-[var(--dp-on-surface-variant)]">
            <span>Catalog Providers</span>
            <PlugZap className="w-4 h-4 text-[var(--dp-primary)]" aria-hidden="true" />
          </div>
          <div className="text-[26px] font-semibold text-[var(--dp-on-surface)] font-mono tabular-nums">
            {overview.providersTotal}
          </div>
          <button
            type="button"
            onClick={() => onNavigateTab('providers')}
            className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--dp-primary)] hover:underline cursor-pointer"
          >
            Inspect Catalog <ArrowRight className="w-3 h-3" aria-hidden="true" />
          </button>
        </Card>

        <Card className="p-4 space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-[var(--dp-on-surface-variant)]">
            <span>Connections</span>
            <Link2 className="w-4 h-4 text-[var(--dp-primary)]" aria-hidden="true" />
          </div>
          <div className="text-[26px] font-semibold text-[var(--dp-on-surface)] font-mono tabular-nums">
            {overview.connections.active}
            <span className="text-[13px] font-normal text-[var(--dp-on-surface-variant)] ml-1">
              / {overview.connections.total} active
            </span>
          </div>
          <div className="text-[11px] text-[var(--dp-on-surface-variant)] font-mono tabular-nums">
            {overview.connections.pending} pending · {overview.connections.disabled} disabled ·{' '}
            {overview.connections.revoked} revoked
          </div>
        </Card>

        <Card className="p-4 space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-[var(--dp-on-surface-variant)]">
            <span>Webhooks</span>
            <Webhook className="w-4 h-4 text-[var(--dp-primary)]" aria-hidden="true" />
          </div>
          <div className="text-[26px] font-semibold text-[var(--dp-on-surface)] font-mono tabular-nums">
            {overview.webhooks.total}
          </div>
          <div className="text-[11px] text-[var(--dp-on-surface-variant)] font-mono tabular-nums">
            {overview.webhooks.processed} ok · {overview.webhooks.failed} rejected/err
          </div>
        </Card>

        <Card className="p-4 space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-[var(--dp-on-surface-variant)]">
            <span>Durable Events</span>
            <Activity className="w-4 h-4 text-[var(--dp-primary)]" aria-hidden="true" />
          </div>
          <div className="text-[26px] font-semibold text-[var(--dp-on-surface)] font-mono tabular-nums">
            {overview.events.totalProcessed}
            <span className="text-[13px] font-normal text-[var(--dp-on-surface-variant)] ml-1">
              processed
            </span>
          </div>
          <div className="text-[11px] text-[var(--dp-on-surface-variant)] font-mono tabular-nums">
            {overview.events.outboxPending + overview.events.inboxReceived} queued ·{' '}
            {overview.events.outboxProcessing + overview.events.inboxProcessing} in flight ·{' '}
            {overview.events.retryableFailures} retrying
          </div>
        </Card>

        <Card
          className={`p-4 space-y-1.5 ${
            overview.events.totalDeadLetter > 0
              ? 'border-[var(--dp-error)]/50 bg-[var(--dp-error-container)]/20'
              : ''
          }`}
        >
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-[var(--dp-on-surface-variant)]">
            <span>Dead-Letter Queue</span>
            <AlertTriangle
              className={`w-4 h-4 ${
                overview.events.totalDeadLetter > 0
                  ? 'text-[var(--dp-error)]'
                  : 'text-[var(--dp-on-surface-variant)]'
              }`}
              aria-hidden="true"
            />
          </div>
          <div
            className={`text-[26px] font-semibold font-mono tabular-nums ${
              overview.events.totalDeadLetter > 0
                ? 'text-[var(--dp-error)]'
                : 'text-[var(--dp-on-surface)]'
            }`}
          >
            {overview.events.totalDeadLetter}
          </div>
          <button
            type="button"
            onClick={() => onNavigateTab('dlq')}
            className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--dp-primary)] hover:underline cursor-pointer"
          >
            Open DLQ Queue <ArrowRight className="w-3 h-3" aria-hidden="true" />
          </button>
        </Card>
      </div>

      {/* Runtime Health & Secret Manager Readiness */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[15px] font-semibold text-[var(--dp-on-surface)]">
              Durable Event Worker Health
            </h2>
            <StatusIndicator tone={workerTone} label={workerLabel} />
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
            <div>
              <dt className="text-[var(--dp-on-surface-variant)]">Worker ID</dt>
              <dd className="font-mono text-[var(--dp-on-surface)] truncate">
                {overview.worker.workerId ?? workerStatus}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--dp-on-surface-variant)]">Poll / Concurrency</dt>
              <dd className="font-mono tabular-nums text-[var(--dp-on-surface)]">
                {overview.worker.pollIntervalMs ?? '—'}ms / {overview.worker.maxConcurrency ?? '—'} workers
              </dd>
            </div>
            <div>
              <dt className="text-[var(--dp-on-surface-variant)]">Last Poll</dt>
              <dd className="font-mono tabular-nums text-[var(--dp-on-surface)]">
                {overview.worker.lastPollAt
                  ? formatTimestamp(overview.worker.lastPollAt)
                  : 'Not yet polled'}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--dp-on-surface-variant)]">Last Processed (DB)</dt>
              <dd className="font-mono tabular-nums text-[var(--dp-on-surface)]">
                {overview.events.lastSuccessfulProcessedAt
                  ? formatTimestamp(overview.events.lastSuccessfulProcessedAt)
                  : overview.worker.lastSuccessAt
                    ? formatTimestamp(overview.worker.lastSuccessAt)
                    : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--dp-on-surface-variant)]">Oldest Pending Age</dt>
              <dd className="font-mono tabular-nums text-[var(--dp-on-surface)]">
                {formatQueueAge(overview.events.oldestPendingAgeSeconds)}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--dp-on-surface-variant)]">Retryable Failures</dt>
              <dd className="font-mono tabular-nums text-[var(--dp-on-surface)]">
                {overview.events.retryableFailures} queued for retry
              </dd>
            </div>
          </dl>
          {overview.worker.lastError && (
            <AlertBanner tone="error" message={overview.worker.lastError} />
          )}
        </Card>

        <Card className="p-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-[var(--dp-primary)]" aria-hidden="true" />
              <h2 className="text-[15px] font-semibold text-[var(--dp-on-surface)]">
                Secret Manager Readiness
              </h2>
            </div>
            <StatusIndicator tone={secretTone} label={overview.secretManager.statusLabel} />
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
            <div>
              <dt className="text-[var(--dp-on-surface-variant)]">GCP SDK Installed</dt>
              <dd className="font-mono text-[var(--dp-on-surface)]">
                {overview.secretManager.gcpSdkInstalled
                  ? '@google-cloud/secret-manager'
                  : 'Missing'}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--dp-on-surface-variant)]">Allowlisted Projects</dt>
              <dd className="font-mono tabular-nums text-[var(--dp-on-surface)]">
                {overview.secretManager.gcpProjectAllowlistCount > 0
                  ? overview.secretManager.gcpProjectAllowlist.join(', ')
                  : 'None configured (0)'}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--dp-on-surface-variant)]">Env Dev Fallback</dt>
              <dd className="font-mono text-[var(--dp-on-surface)]">
                {overview.secretManager.envDevOnlyAllowed
                  ? 'Allowed (non-production only)'
                  : 'Blocked in production'}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--dp-on-surface-variant)]">External ID Mappings</dt>
              <dd className="font-mono tabular-nums text-[var(--dp-on-surface)]">
                {overview.mappingsTotal} tenant records
              </dd>
            </div>
          </dl>
          {overview.secretManager.blockerReason && (
            <AlertBanner tone="warning" message={overview.secretManager.blockerReason} />
          )}
        </Card>
      </div>

      {/* Honest Ecosystem Adapter Blockers */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-[var(--dp-warning-text)]" aria-hidden="true" />
          <h2 className="text-[15px] font-semibold text-[var(--dp-on-surface)]">
            External DialPulse CRM Adapter Readiness
          </h2>
        </div>
        <p className="text-[12px] text-[var(--dp-on-surface-variant)]">
          External CRM synchronization runs behind boundary adapters. Live HTTP delivery remains blocked until confirmed REST endpoints and GCP Secret Manager IAM credentials are provisioned.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-[12px]">
          {[
            { label: 'Client CRM Adapter', summary: overview.ecosystemAdapters.clientCrm },
            { label: 'Central CRM Adapter', summary: overview.ecosystemAdapters.centralCrm },
          ].map(({ label, summary }) => (
            <div
              key={summary.providerId}
              className="p-3.5 rounded-[var(--dp-radius-sm)] border border-[var(--dp-outline-variant)] bg-[var(--dp-surface-container-low)] space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-[var(--dp-on-surface)]">{label}</span>
                <StatusIndicator
                  tone={
                    summary.contractStatus === 'contract_configured_for_endpoint'
                      ? 'info'
                      : 'warning'
                  }
                  label={
                    summary.contractStatus === 'contract_configured_for_endpoint'
                      ? 'Endpoint Configured (Dry/Adapter)'
                      : 'Blocked · Pending API Contract'
                  }
                />
              </div>
              {summary.missingContractDetails.length > 0 && (
                <ul className="list-disc pl-4 space-y-0.5 text-[var(--dp-on-surface-variant)]">
                  {summary.missingContractDetails.map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
