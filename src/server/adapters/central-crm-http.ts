import { and, eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { integrationConnections } from '../../db/schema.ts';
import type { TenantMembershipSummary } from '../../shared/types.ts';
import type {
  AdapterMode,
  CentralCrmAdapter,
  SecretReference,
  SecretStore,
} from '../integrations/contracts.ts';
import {
  SafeIntegrationHttpClient,
  type SafeHttpClientOptions,
} from '../integrations/http-client.ts';
import { NonRetryableEventError, sanitizeEventError } from '../events/retry-policy.ts';
import type { RetryBackoffOptions } from '../events/retry-policy.ts';
import { UnconfiguredEcosystemAdapterError } from './client-crm-http.ts';

export const CENTRAL_CRM_MISSING_CONTRACT_DETAILS = [
  'Confirmed Central CRM production base URL and service-to-service JWT audience/issuer specification.',
  'Confirmed REST endpoint path and schema for resolving platform user memberships by Firebase UID.',
  'Confirmed REST endpoint path and schema for verifying tenant lifecycle active/suspended status.',
] as const;

export interface CentralCrmHttpEndpointConfig {
  contractConfirmed: boolean;
  baseUrl?: string;
  allowedHosts?: string[];
  membershipsPathTemplate?: string;
  tenantStatusPathTemplate?: string;
  allowInsecureLocalhost?: boolean;
  timeoutMs?: number;
  maxRetries?: number;
  backoffOptions?: RetryBackoffOptions;
}

export interface HttpCentralCrmAdapterOptions {
  endpointConfig?: CentralCrmHttpEndpointConfig;
  secretStore?: SecretStore;
  fetchImpl?: SafeHttpClientOptions['fetchImpl'];
  nodeEnv?: string;
}

export class HttpCentralCrmAdapter implements CentralCrmAdapter {
  readonly mode: AdapterMode = 'live_api';
  readonly providerId = 'central_crm';
  readonly contractStatus: 'blocked_pending_api_contract' | 'contract_configured_for_endpoint';
  private readonly endpointConfig: CentralCrmHttpEndpointConfig;
  private readonly secretStore?: SecretStore;
  private readonly fetchImpl?: SafeHttpClientOptions['fetchImpl'];
  private readonly nodeEnv?: string;

  constructor(options: HttpCentralCrmAdapterOptions = {}) {
    this.endpointConfig = options.endpointConfig ?? { contractConfirmed: false };
    this.contractStatus =
      this.endpointConfig.contractConfirmed && Boolean(this.endpointConfig.baseUrl)
        ? 'contract_configured_for_endpoint'
        : 'blocked_pending_api_contract';
    this.secretStore = options.secretStore;
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
          ? [...CENTRAL_CRM_MISSING_CONTRACT_DETAILS]
          : [],
    };
  }

  private assertConfigured() {
    if (
      !this.endpointConfig.contractConfirmed ||
      !this.endpointConfig.baseUrl ||
      !this.endpointConfig.allowedHosts?.length
    ) {
      throw new UnconfiguredEcosystemAdapterError(
        this.providerId,
        'Central CRM live HTTP adapter is blocked: confirmed API endpoint contract and approved credentials are not configured.',
        CENTRAL_CRM_MISSING_CONTRACT_DETAILS
      );
    }
  }

  private async resolveActiveConnection(tenantId: number, requiredScope: string) {
    const rows = await db
      .select()
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.tenantId, tenantId),
          eq(integrationConnections.providerId, this.providerId),
          eq(integrationConnections.status, 'active')
        )
      )
      .limit(1);

    const conn = rows[0];
    if (!conn) {
      throw new NonRetryableEventError(
        `No active central_crm integration connection exists for tenant ${tenantId}.`,
        'NO_ACTIVE_CENTRAL_CRM_CONNECTION'
      );
    }
    if (!(conn.allowedScopes ?? []).includes(requiredScope)) {
      throw new NonRetryableEventError(
        `Active central_crm connection #${conn.id} lacks required scope "${requiredScope}".`,
        'MISSING_REQUIRED_SCOPE'
      );
    }
    return conn;
  }

  private createHttpClient(): SafeIntegrationHttpClient {
    return new SafeIntegrationHttpClient({
      providerId: this.providerId,
      baseUrl: this.endpointConfig.baseUrl!,
      allowedHosts: this.endpointConfig.allowedHosts!,
      allowInsecureLocalhost: this.endpointConfig.allowInsecureLocalhost,
      timeoutMs: this.endpointConfig.timeoutMs,
      maxRetries: this.endpointConfig.maxRetries,
      backoffOptions: this.endpointConfig.backoffOptions,
      secretStore: this.secretStore,
      fetchImpl: this.fetchImpl,
      nodeEnv: this.nodeEnv,
    });
  }

  async resolvePlatformMemberships(
    userUid: string,
    contextTenantId = 0
  ): Promise<TenantMembershipSummary[]> {
    this.assertConfigured();
    if (!this.endpointConfig.membershipsPathTemplate) {
      throw new UnconfiguredEcosystemAdapterError(
        this.providerId,
        'Central CRM memberships endpoint template is unconfigured.',
        CENTRAL_CRM_MISSING_CONTRACT_DETAILS
      );
    }

    const conn =
      contextTenantId > 0
        ? await this.resolveActiveConnection(contextTenantId, 'memberships:read')
        : null;

    const client = this.createHttpClient();
    const path = this.endpointConfig.membershipsPathTemplate.replace(
      '{userUid}',
      encodeURIComponent(userUid)
    );

    const res = await client.requestJson<{ memberships: TenantMembershipSummary[] }>({
      method: 'GET',
      path,
      tenantId: contextTenantId,
      secretRef: conn ? (conn.secretRef as SecretReference) : undefined,
    });

    return Array.isArray(res.data?.memberships) ? res.data.memberships : [];
  }

  async isTenantActive(tenantId: number): Promise<boolean> {
    this.assertConfigured();
    if (!this.endpointConfig.tenantStatusPathTemplate) {
      throw new UnconfiguredEcosystemAdapterError(
        this.providerId,
        'Central CRM tenant status endpoint template is unconfigured.',
        CENTRAL_CRM_MISSING_CONTRACT_DETAILS
      );
    }

    const conn = await this.resolveActiveConnection(tenantId, 'tenants:read');
    const client = this.createHttpClient();
    const path = this.endpointConfig.tenantStatusPathTemplate.replace(
      '{tenantId}',
      encodeURIComponent(String(tenantId))
    );

    try {
      const res = await client.requestJson<{ active: boolean }>({
        method: 'GET',
        path,
        tenantId,
        secretRef: conn.secretRef as SecretReference,
      });

      await db
        .update(integrationConnections)
        .set({ lastSuccessAt: new Date(), lastErrorSummary: null, updatedAt: new Date() })
        .where(
          and(
            eq(integrationConnections.id, conn.id),
            eq(integrationConnections.tenantId, tenantId)
          )
        );

      return Boolean(res.data?.active);
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
            eq(integrationConnections.id, conn.id),
            eq(integrationConnections.tenantId, tenantId)
          )
        );
      throw error;
    }
  }
}
