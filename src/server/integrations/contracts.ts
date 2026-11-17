import type { TenantMembershipSummary } from '../../shared/types.ts';

export type DataClassification = 'public' | 'internal' | 'confidential' | 'restricted';

export type AdapterMode = 'mock_adapter' | 'live_api';

export interface ClientCrmLeadSyncInput {
  tenantId: number;
  leadIntakeId: number;
  applicantName: string;
  productInterest: string;
  correlationId?: string;
}

export interface ClientCrmLeadSyncResult {
  adapter: string;
  mode: AdapterMode;
  externalCrmRef: string;
  syncedAt: string;
}

export interface ClientCrmAdapter {
  readonly mode: AdapterMode;
  syncLeadIntake(input: ClientCrmLeadSyncInput): Promise<ClientCrmLeadSyncResult>;
}

export interface CentralCrmAdapter {
  readonly mode: AdapterMode;
  resolvePlatformMemberships(userUid: string): Promise<TenantMembershipSummary[]>;
  isTenantActive(tenantId: number): Promise<boolean>;
}

export interface ExternalProviderActionInput {
  tenantId: number;
  providerId: string;
  capability: string;
  idempotencyKey: string;
  sanitizedPayload: Record<string, unknown>;
}

export interface ExternalProviderActionResult {
  providerId: string;
  mode: AdapterMode;
  externalReferenceId: string;
  acceptedAt: string;
}

export interface ExternalProviderAdapter {
  readonly providerId: string;
  readonly mode: AdapterMode;
  checkHealth(tenantId: number): Promise<{ healthy: boolean; message: string }>;
  executeCapability(
    input: ExternalProviderActionInput
  ): Promise<ExternalProviderActionResult>;
}

export interface IntegrationEventEnvelope<TPayload = Record<string, unknown>> {
  schemaVersion: '1.0';
  eventId: string;
  tenantId: number;
  eventType: string;
  sourceModule: string;
  correlationId: string;
  idempotencyKey: string;
  occurredAt: string;
  payload: TPayload;
}

export interface EventPublisher {
  readonly mode: AdapterMode;
  publish(envelope: IntegrationEventEnvelope): Promise<{ accepted: boolean }>;
}

/**
 * Secrets are ALWAYS stored as external KMS / Secret Manager references
 * (never plaintext credentials in source code or JSONB DB columns).
 */
export interface SecretReference {
  provider: 'gcp_secret_manager' | 'env_dev_only';
  secretName: string;
  version: string;
}

export interface SecretStore {
  resolveSecret(ref: SecretReference): Promise<string>;
}

export interface WebhookVerificationInput {
  rawBody: Buffer | string;
  headers: Record<string, string | undefined>;
  secretRef: SecretReference;
  maxReplayWindowSeconds: number;
}

export interface WebhookVerificationResult {
  verified: boolean;
  providerEventId?: string;
  failureReason?: string;
}

export interface WebhookVerifier {
  readonly providerId: string;
  verify(input: WebhookVerificationInput): Promise<WebhookVerificationResult>;
}

export interface ExternalIdMappingRecord {
  tenantId: number;
  localEntityType: string;
  localEntityId: string;
  providerId: string;
  externalEntityId: string;
}

export interface ExternalIdMappingService {
  getExternalId(
    tenantId: number,
    localEntityType: string,
    localEntityId: string,
    providerId: string
  ): Promise<string | null>;
  upsertMapping(record: ExternalIdMappingRecord): Promise<void>;
}
