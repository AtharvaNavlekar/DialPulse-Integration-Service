import type { DataClassification } from './contracts.ts';

export type ProviderCategory =
  | 'ecosystem_crm'
  | 'ecosystem_identity'
  | 'ecosystem_web'
  | 'telephony'
  | 'messaging'
  | 'email'
  | 'esignature';

export type ProviderStatus = 'mock_adapter' | 'planned_unapproved' | 'approved_ready';

export interface ProviderRegistryEntry {
  providerId: string;
  name: string;
  category: ProviderCategory;
  authMethod: 'service_jwt' | 'oauth2' | 'api_key_hmac' | 'webhook_hmac';
  requiredScopes: string[];
  capabilities: string[];
  status: ProviderStatus;
  configurationSchema: string[];
  webhookSupport: boolean;
  rateLimitPerMinute: number;
  maxDataClassification: DataClassification;
  connectionLifecycle: Array<'configured' | 'verified' | 'active' | 'paused' | 'revoked'>;
  costModelNote: string;
}

export const PROVIDER_REGISTRY: ProviderRegistryEntry[] = [
  {
    providerId: 'client_crm',
    name: 'DialPulse Client CRM',
    category: 'ecosystem_crm',
    authMethod: 'service_jwt',
    requiredScopes: ['leads:write', 'leads:read'],
    capabilities: ['sync_lead_intake', 'fetch_lead_stage'],
    status: 'mock_adapter',
    configurationSchema: ['baseUrl', 'serviceAudience', 'secretRef'],
    webhookSupport: true,
    rateLimitPerMinute: 300,
    maxDataClassification: 'confidential',
    connectionLifecycle: ['configured', 'verified', 'active', 'paused', 'revoked'],
    costModelNote: 'Internal DialPulse service boundary; no external vendor charge.',
  },
  {
    providerId: 'central_crm',
    name: 'DialPulse Central CRM',
    category: 'ecosystem_identity',
    authMethod: 'service_jwt',
    requiredScopes: ['memberships:read', 'tenants:read'],
    capabilities: ['resolve_memberships', 'verify_tenant_status'],
    status: 'mock_adapter',
    configurationSchema: ['baseUrl', 'serviceAudience', 'secretRef'],
    webhookSupport: true,
    rateLimitPerMinute: 300,
    maxDataClassification: 'internal',
    connectionLifecycle: ['configured', 'verified', 'active', 'paused', 'revoked'],
    costModelNote: 'Internal DialPulse identity/governance boundary.',
  },
  {
    providerId: 'dialpulse_web',
    name: 'DialPulse Public Website Intake',
    category: 'ecosystem_web',
    authMethod: 'webhook_hmac',
    requiredScopes: ['intake:submit'],
    capabilities: ['submit_public_enquiry'],
    status: 'mock_adapter',
    configurationSchema: ['allowedOrigins', 'hmacSecretRef'],
    webhookSupport: true,
    rateLimitPerMinute: 120,
    maxDataClassification: 'confidential',
    connectionLifecycle: ['configured', 'verified', 'active', 'paused', 'revoked'],
    costModelNote: 'Internal DialPulse acquisition website.',
  },
  {
    providerId: 'voice_telephony_approved',
    name: 'Voice & Telephony Provider (Slot)',
    category: 'telephony',
    authMethod: 'api_key_hmac',
    requiredScopes: ['calls:initiate', 'calls:webhooks'],
    capabilities: ['place_outbound_call', 'ingest_call_disposition'],
    status: 'planned_unapproved',
    configurationSchema: ['accountId', 'callerId', 'secretRef', 'dncPolicyEnabled'],
    webhookSupport: true,
    rateLimitPerMinute: 60,
    maxDataClassification: 'confidential',
    connectionLifecycle: ['configured', 'verified', 'active', 'paused', 'revoked'],
    costModelNote: 'Carrier telephony minutes and STT/TTS inference remain metered vendor costs.',
  },
  {
    providerId: 'whatsapp_business_approved',
    name: 'WhatsApp Business Messaging (Slot)',
    category: 'messaging',
    authMethod: 'oauth2',
    requiredScopes: ['whatsapp_business_messaging'],
    capabilities: ['send_approved_template', 'ingest_delivery_status'],
    status: 'planned_unapproved',
    configurationSchema: ['wabaId', 'phoneNumberId', 'secretRef'],
    webhookSupport: true,
    rateLimitPerMinute: 120,
    maxDataClassification: 'confidential',
    connectionLifecycle: ['configured', 'verified', 'active', 'paused', 'revoked'],
    costModelNote: 'Per-conversation WhatsApp template charges still apply.',
  },
  {
    providerId: 'transactional_email_approved',
    name: 'Transactional Email Provider (Slot)',
    category: 'email',
    authMethod: 'api_key_hmac',
    requiredScopes: ['mail:send'],
    capabilities: ['send_appointment_reminder', 'ingest_bounce_events'],
    status: 'planned_unapproved',
    configurationSchema: ['senderDomain', 'secretRef'],
    webhookSupport: true,
    rateLimitPerMinute: 240,
    maxDataClassification: 'confidential',
    connectionLifecycle: ['configured', 'verified', 'active', 'paused', 'revoked'],
    costModelNote: 'External email relay delivery charges apply based on volume.',
  },
  {
    providerId: 'esign_provider_approved',
    name: 'Approved E-Signature Provider (Slot)',
    category: 'esignature',
    authMethod: 'oauth2',
    requiredScopes: ['signature_requests:write'],
    capabilities: ['create_signing_request', 'ingest_signed_webhook'],
    status: 'planned_unapproved',
    configurationSchema: ['accountId', 'secretRef', 'legalJurisdiction'],
    webhookSupport: true,
    rateLimitPerMinute: 30,
    maxDataClassification: 'restricted',
    connectionLifecycle: ['configured', 'verified', 'active', 'paused', 'revoked'],
    costModelNote: 'Requires compliance approval and legal e-signature provider fees.',
  },
];

export function getProviderRegistryEntry(
  providerId: string
): ProviderRegistryEntry | undefined {
  return PROVIDER_REGISTRY.find((entry) => entry.providerId === providerId);
}
