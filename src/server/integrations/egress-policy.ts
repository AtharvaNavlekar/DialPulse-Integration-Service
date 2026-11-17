import type { DataClassification } from './contracts.ts';

const CLASSIFICATION_RANK: Record<DataClassification, number> = {
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
};

const RESTRICTED_FIELD_PATTERNS: RegExp[] = [
  /aadhaar/i,
  /aadhar/i,
  /\bpan\b/i,
  /pan[_\s-]?(card|number|num)/i,
  /bank[_\s-]?(account|acct|statement)/i,
  /account[_\s-]?number/i,
  /\bifsc\b/i,
  /salary[_\s-]?slip/i,
  /\bpayslip\b/i,
  /\bitr\b/i,
  /income[_\s-]?tax/i,
  /credit[_\s-]?card/i,
  /\bcvv\b/i,
  /\bkyc\b/i,
  /passport/i,
];

const CONFIDENTIAL_FIELD_PATTERNS: RegExp[] = [
  /email/i,
  /phone/i,
  /mobile/i,
  /full_?name/i,
  /applicant/i,
  /amount/i,
  /income/i,
];

export function classifyFieldSensitivity(
  fieldKey: string,
  fieldLabel = ''
): DataClassification {
  const combined = `${fieldKey} ${fieldLabel}`;
  if (RESTRICTED_FIELD_PATTERNS.some((rx) => rx.test(combined))) {
    return 'restricted';
  }
  if (CONFIDENTIAL_FIELD_PATTERNS.some((rx) => rx.test(combined))) {
    return 'confidential';
  }
  return 'internal';
}

export interface EgressPolicyEvaluationInput {
  payload: Record<string, unknown>;
  destinationProviderId: string;
  maxAllowedClassification: DataClassification;
  approvedFieldAllowlist: string[];
  purpose: string;
  hasPermission: boolean;
  providerApproved: boolean;
}

export interface EgressPolicyEvaluationResult {
  allowed: boolean;
  sanitizedPayload: Record<string, unknown>;
  blockedFields: Array<{ key: string; reason: string; classification: DataClassification }>;
  denialReason?: string;
}

/**
 * WSP-INT-015 Sensitive Data Egress Policy:
 * Uses strict field allowlists (never unrestricted payload forwarding) and
 * blocks restricted KYC/financial fields by default from external egress.
 */
export function evaluateDataEgressPolicy(
  input: EgressPolicyEvaluationInput
): EgressPolicyEvaluationResult {
  if (!input.hasPermission) {
    return {
      allowed: false,
      sanitizedPayload: {},
      blockedFields: [],
      denialReason: 'Caller lacks permission for external data egress.',
    };
  }

  if (!input.providerApproved) {
    return {
      allowed: false,
      sanitizedPayload: {},
      blockedFields: [],
      denialReason: `Provider "${input.destinationProviderId}" is not approved for live external egress.`,
    };
  }

  if (!input.purpose.trim()) {
    return {
      allowed: false,
      sanitizedPayload: {},
      blockedFields: [],
      denialReason: 'A documented business purpose is required for external egress.',
    };
  }

  const allowSet = new Set(input.approvedFieldAllowlist);
  const maxRank = CLASSIFICATION_RANK[input.maxAllowedClassification];
  const sanitizedPayload: Record<string, unknown> = {};
  const blockedFields: EgressPolicyEvaluationResult['blockedFields'] = [];

  for (const [key, value] of Object.entries(input.payload)) {
    const classification = classifyFieldSensitivity(key);

    if (classification === 'restricted' && input.maxAllowedClassification !== 'restricted') {
      blockedFields.push({
        key,
        classification,
        reason: 'Restricted KYC/financial field cannot leave DialPulse boundary.',
      });
      continue;
    }

    if (CLASSIFICATION_RANK[classification] > maxRank) {
      blockedFields.push({
        key,
        classification,
        reason: `Classification "${classification}" exceeds destination ceiling "${input.maxAllowedClassification}".`,
      });
      continue;
    }

    if (!allowSet.has(key)) {
      blockedFields.push({
        key,
        classification,
        reason: 'Field is not in the approved egress allowlist.',
      });
      continue;
    }

    sanitizedPayload[key] = value;
  }

  return {
    allowed: true,
    sanitizedPayload,
    blockedFields,
  };
}
