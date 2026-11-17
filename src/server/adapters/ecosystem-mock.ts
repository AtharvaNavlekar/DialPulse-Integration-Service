/**
 * Explicitly marked Mock Adapters for external DialPulse ecosystem boundaries.
 * DialPulse Workspace NEVER connects directly to Client CRM or Central CRM databases.
 * Replace these adapters with authenticated HTTP/event clients once live contracts are published.
 */

export interface MockCrmSyncResult {
  adapter: 'ClientCrmMockAdapter';
  mode: 'mock_adapter';
  externalCrmRef: string;
  syncedAt: string;
}

export function syncLeadIntakeViaMockClientCrm(input: {
  tenantId: number;
  leadIntakeId: number;
  applicantName: string;
  productInterest: string;
}): MockCrmSyncResult {
  const suffix = String(input.leadIntakeId).padStart(4, '0');
  return {
    adapter: 'ClientCrmMockAdapter',
    mode: 'mock_adapter',
    externalCrmRef: `MOCK-CRM-T${input.tenantId}-L${suffix}`,
    syncedAt: new Date().toISOString(),
  };
}

export function dispatchMockIntegrationEvent(input: {
  tenantId: number;
  eventId: string;
  eventType: string;
}): {
  adapter: 'IntegrationServiceMockAdapter';
  mode: 'mock_adapter';
  accepted: boolean;
} {
  return {
    adapter: 'IntegrationServiceMockAdapter',
    mode: 'mock_adapter',
    accepted: true,
  };
}

export function getEcosystemAdapterStatus() {
  return {
    clientCrm: {
      mode: 'mock_adapter' as const,
      status: 'Mock adapter active (live Client CRM API contract pending)',
    },
    centralCrm: {
      mode: 'mock_adapter' as const,
      status: 'Mock adapter active (live Central CRM platform identity contract pending)',
    },
    integrationService: {
      mode: 'mock_adapter' as const,
      status: 'Mock adapter active (live Integration Service event dispatch pending)',
    },
  };
}
