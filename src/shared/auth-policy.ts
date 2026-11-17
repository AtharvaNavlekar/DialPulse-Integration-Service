export interface DemoProvisioningPolicyInput {
  nodeEnv?: string;
  demoProvisioningFlag?: string;
}

export interface DemoProvisioningPolicyResult {
  allowed: boolean;
  reason: string;
}

/**
 * Security Policy: Automatic demo tenant creation and default admin role
 * assignment is strictly restricted to non-production environments when
 * WORKSPACE_DEMO_PROVISIONING_ENABLED is explicitly set to "true".
 *
 * Production ALWAYS fails closed regardless of environment flag values.
 */
export function evaluateDemoProvisioningPolicy(
  input: DemoProvisioningPolicyInput
): DemoProvisioningPolicyResult {
  const normalizedEnv = (input.nodeEnv ?? '').trim().toLowerCase();
  const normalizedFlag = (input.demoProvisioningFlag ?? '').trim().toLowerCase();

  if (normalizedEnv === 'production') {
    return {
      allowed: false,
      reason:
        'Automatic demo tenant provisioning is permanently disabled in production.',
    };
  }

  if (normalizedFlag !== 'true') {
    return {
      allowed: false,
      reason:
        'Automatic demo tenant provisioning is disabled unless WORKSPACE_DEMO_PROVISIONING_ENABLED=true in non-production.',
    };
  }

  return {
    allowed: true,
    reason: 'Explicit non-production demo provisioning enabled.',
  };
}
