import { and, eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { integrationConnections } from '../../db/schema.ts';
import type {
  AdapterMode,
  ClientCrmAdapter,
  ClientCrmLeadSyncInput,
  ClientCrmLeadSyncResult,
  SecretReference,
  SecretStore,
} from '../integrations/contracts.ts';
import {
  DbExternalIdMappingService,
  externalIdMappingService,
} from '../integrations/external-mappings.ts';
import {
  SafeIntegrationHttpClient,
  type SafeHttpClientOptions,
} from '../integrations/http-client.ts';
import { getProviderRegistryEntry } from '../integrations/provider-registry.ts';
import { NonRetryableEventError, sanitizeEventError } from '../events/retry-policy.ts';
import type { RetryBackoffOptions } from '../events/retry-policy.ts';

export const CLIENT_CRM_MISSING_CONTRACT_DETAILS = [
  'Confirmed Client CRM production base URL and service audience claim for service JWT authentication.',
  'Confirmed REST endpoint path and OpenAPI schema for lead-intake creation/upsert.',
  'Confirmed external response payload shape and native idempotency key support contract.',
] as const;

export class UnconfiguredEcosystemAdapterError extends NonRetryableEventError {
  readonly missingContractDetails: readonly string[];

  constructor(
    providerId: string,
    message: string,
    missingContractDetails: readonly string[]
  ) {
    super(message, `UNCONFIGURED_ADAPTER_${providerId.toUpperCase()}`);
    this.name = 'UnconfiguredEcosystemAdapterError';
    this.missingContractDetails = missingContractDetails;
  }
}

export interface ClientCrmHttpEndpointConfig {
  contractConfirmed: boolean;
  baseUrl?: string;
  allowedHosts?: string[];
  leadIntakePath?: string;
  allowInsecureLocalhost?: boolean;
  timeoutMs?: number;
  maxRetries?: number;
  backoffOptions?: RetryBackoffOptions;
}

export interface HttpClientCrmAdapterOptions {
  endpointConfig?: ClientCrmHttpEndpointConfig;
  secretStore?: SecretStore;
  mappingService?: DbExternalIdMappingService;
  fetchImpl?: SafeHttpClientOptions['fetchImpl'];
  nodeEnv?: string;
}

export class HttpClientCrmAdapter implements ClientCrmAdapter {
  readonly mode: AdapterMode = 'live_api';
  readonly providerId = 'client_crm';
  readonly contractStatus: 'blocked_pending_api_contract' | 'contract_configured_for_endpoint';
  private readonly endpointConfig: ClientCrmHttpEndpointConfig;
  private readonly secretStore?: SecretStore;
  private readonly mappingService: DbExternalIdMappingService;
  private readonly fetchImpl?: SafeHttpClientOptions['fetchImpl'];
  private readonly nodeEnv?: string;

  constructor(options: HttpClientCrmAdapterOptions = {}) {
    this.endpointConfig = options.endpointConfig ?? { contractConfirmed: false };
    this.contractStatus =
      this.endpointConfig.contractConfirmed && Boolean(this.endpointConfig.baseUrl)
        ? 'contract_configured_for_endpoint'
        : 'blocked_pending_api_contract';
    this.secretStore = options.secretStore;
    this.mappingService = options.mappingService ?? externalIdMappingService;
    this.fetchImpl = options.fetchImpl;
    this.nodeEnv = options.nodeEnv;
  }

  getStatusSummary() {
    return {
      providerId: this.providerId,
      mode: this.mode,
      contractStatus: this.contractStatus,
      missingContractDetails:
        this.contractStatus === 'blocked_pending_api_contract'
          ? [...CLIENT_CRM_MISSING_CONTRACT_DETAILS]
          : [],
    };
  }

  async syncLeadIntake(
    input: ClientCrmLeadSyncInput & {
      connectionId?: number;
      idempotencyKey?: string;
      extraFields?: Record<string, unknown>;
    }
  ): Promise<ClientCrmLeadSyncResult> {
    if (
      !this.endpointConfig.contractConfirmed ||
      !this.endpointConfig.baseUrl ||
      !this.endpointConfig.leadIntakePath ||
      !this.endpointConfig.allowedHosts?.length
    ) {
      throw new UnconfiguredEcosystemAdapterError(
        this.providerId,
        'Client CRM live HTTP adapter is blocked: confirmed API endpoint contract and approved credentials are not configured.',
        CLIENT_CRM_MISSING_CONTRACT_DETAILS
      );
    }

    const connections = await db
      .select()
      .from(integrationConnections)
      .where(
        input.connectionId
          ? and(
              eq(integrationConnections.id, input.connectionId),
              eq(integrationConnections.tenantId, input.tenantId),
              eq(integrationConnections.providerId, this.providerId),
              eq(integrationConnections.status, 'active')
            )
          : and(
              eq(integrationConnections.tenantId, input.tenantId),
              eq(integrationConnections.providerId, this.providerId),
              eq(integrationConnections.status, 'active')
            )
      )
      .limit(1);

    const connection = connections[0];
    if (!connection) {
      throw new NonRetryableEventError(
        `No active client_crm integration connection exists for tenant ${input.tenantId}.`,
        'NO_ACTIVE_CLIENT_CRM_CONNECTION'
      );
    }

    const provider = getProviderRegistryEntry(this.providerId);
    const scopeSet = new Set(connection.allowedScopes ?? []);
    if (!scopeSet.has('leads:write')) {
      throw new NonRetryableEventError(
        `Active client_crm connection #${connection.id} lacks required scope "leads:write".`,
        'MISSING_REQUIRED_SCOPE'
      );
    }

    const client = new SafeIntegrationHttpClient({
      providerId: this.providerId,
      baseUrl: this.endpointConfig.baseUrl,
      allowedHosts: this.endpointConfig.allowedHosts,
      allowInsecureLocalhost: this.endpointConfig.allowInsecureLocalhost,
      timeoutMs: this.endpointConfig.timeoutMs,
      maxRetries: this.endpointConfig.maxRetries,
      backoffOptions: this.endpointConfig.backoffOptions,
      secretStore: this.secretStore,
      fetchImpl: this.fetchImpl,
      nodeEnv: this.nodeEnv,
    });

    const idempotencyKey =
      input.idempotencyKey ||
      `client_crm:t${input.tenantId}:lead:${input.leadIntakeId}`;

    try {
      const response = await client.requestJson<{
        externalCrmRef: string;
        syncedAt?: string;
      }>({
        method: 'POST',
        path: this.endpointConfig.leadIntakePath,
        tenantId: input.tenantId,
        correlationId: input.correlationId,
        idempotencyKey,
        secretRef: connection.secretRef as SecretReference,
        body: {
          ...(input.extraFields ?? {}),
          tenantId: input.tenantId,
          leadIntakeId: input.leadIntakeId,
          applicantName: input.applicantName,
          productInterest: input.productInterest,
        },
        egressPolicy: {
          maxAllowedClassification: provider?.maxDataClassification ?? 'confidential',
          approvedFieldAllowlist: [
            'tenantId',
            'leadIntakeId',
            'applicantName',
            'productInterest',
          ],
          purpose: 'client_crm_lead_intake_sync',
          hasPermission: true,
          providerApproved: true,
        },
      });

      const externalCrmRef = String(response.data?.externalCrmRef ?? '').trim();
      if (!externalCrmRef) {
        throw new NonRetryableEventError(
          'Client CRM response did not contain a valid externalCrmRef.',
          'INVALID_CLIENT_CRM_RESPONSE'
        );
      }

      const syncedAt = response.data?.syncedAt ?? new Date().toISOString();

      await this.mappingService.upsertConnectionMapping({
        tenantId: input.tenantId,
        connectionId: connection.id,
        providerId: this.providerId,
        internalEntityType: 'lead_intake',
        internalEntityId: String(input.leadIntakeId),
        externalEntityType: 'client_crm_lead',
        externalEntityId: externalCrmRef,
        lastSyncedAt: new Date(syncedAt),
      });

      await db
        .update(integrationConnections)
        .set({ lastSuccessAt: new Date(), lastErrorSummary: null, updatedAt: new Date() })
        .where(
          and(
            eq(integrationConnections.id, connection.id),
            eq(integrationConnections.tenantId, input.tenantId)
          )
        );

      return {
        adapter: 'HttpClientCrmAdapter',
        mode: this.mode,
        externalCrmRef,
        syncedAt,
      };
    } catch (error) {
      await db
        .update(integrationConnections)
        .set({
          lastErrorAt: new Date(),
          lastErrorSummary: sanitizeEventError(error).slice(0, 300),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(integrationConnections.id, connection.id),
            eq(integrationConnections.tenantId, input.tenantId)
          )
        );
      throw error;
    }
  }
}
