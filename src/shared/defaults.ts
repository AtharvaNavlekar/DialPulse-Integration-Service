import type {
  FormFieldDefinition,
  RoleConfig,
  RoleKey,
  WorkspaceOrgConfigData,
} from './types.ts';

import {
  buildRoleConfigFromCapabilities,
  getDefaultCapabilitiesForRole,
} from './rbac.ts';

export const DEFAULT_ROLES: RoleConfig[] = [
  buildRoleConfigFromCapabilities('admin', getDefaultCapabilitiesForRole('admin')),
  buildRoleConfigFromCapabilities('manager', getDefaultCapabilitiesForRole('manager')),
  buildRoleConfigFromCapabilities('operator', getDefaultCapabilitiesForRole('operator')),
  buildRoleConfigFromCapabilities('viewer', getDefaultCapabilitiesForRole('viewer')),
];

export function getRolePermissions(
  roleKey: RoleKey,
  roles: RoleConfig[] = DEFAULT_ROLES
): RoleConfig {
  const matched =
    roles.find((r) => r.key === roleKey) ??
    DEFAULT_ROLES.find((r) => r.key === 'viewer')!;
  if (matched.capabilities) {
    return matched;
  }
  const caps = getDefaultCapabilitiesForRole(matched.key);
  return buildRoleConfigFromCapabilities(
    matched.key,
    {
      ...caps,
      canCreateForms: matched.canManageForms,
      canEditForms: matched.canManageForms,
      canPublishForms: matched.canManageForms,
      canDeleteForms: matched.canManageForms,
      canManageAutomations: matched.canManageAutomations,
      canManageSettings: matched.canManageSettings,
      canExportSubmissions: matched.canExportSubmissions,
    },
    matched.label
  );
}

export function createDefaultOrgConfig(): WorkspaceOrgConfigData {
  return {
    departments: [
      { id: 'dept-acquisition', name: 'Lead Acquisition & Calling', leadRoleKey: 'manager' },
      { id: 'dept-prm', name: 'Partner Relationship (PRM)', leadRoleKey: 'manager' },
      { id: 'dept-rm', name: 'Relationship Management (RM)', leadRoleKey: 'manager' },
      { id: 'dept-backend', name: 'Backend Operations & Login', leadRoleKey: 'admin' },
    ],
    roles: DEFAULT_ROLES,
    employees: [
      {
        id: 'emp-ananya',
        name: 'Ananya Deshmukh',
        email: 'ananya.demo@dialpulse.example',
        departmentId: 'dept-acquisition',
        roleKey: 'operator',
        active: true,
      },
      {
        id: 'emp-rohan',
        name: 'Rohan Kulkarni',
        email: 'rohan.demo@dialpulse.example',
        departmentId: 'dept-rm',
        roleKey: 'manager',
        active: true,
      },
      {
        id: 'emp-meera',
        name: 'Meera Nair',
        email: 'meera.demo@dialpulse.example',
        departmentId: 'dept-backend',
        roleKey: 'operator',
        active: true,
      },
    ],
    queues: [
      {
        id: 'queue-inbound-dsa',
        name: 'Inbound Loan Enquiry Queue',
        departmentId: 'dept-acquisition',
        slaMinutes: 30,
      },
      {
        id: 'queue-prm-review',
        name: 'PRM Eligibility Review Queue',
        departmentId: 'dept-prm',
        slaMinutes: 120,
      },
      {
        id: 'queue-sanction-ops',
        name: 'Sanction & Disbursement Follow-Up',
        departmentId: 'dept-backend',
        slaMinutes: 240,
      },
    ],
    workflowStages: [
      { id: 'stage-1', name: 'Lead acquisition', order: 1, ownerRoleKey: 'operator', escalationHours: 2 },
      { id: 'stage-2', name: 'Lead assignment', order: 2, ownerRoleKey: 'manager', escalationHours: 4 },
      { id: 'stage-3', name: 'Calling', order: 3, ownerRoleKey: 'operator', escalationHours: 6 },
      { id: 'stage-4', name: 'Customer interest', order: 4, ownerRoleKey: 'operator', escalationHours: 12 },
      { id: 'stage-5', name: 'PRM review', order: 5, ownerRoleKey: 'manager', escalationHours: 24 },
      { id: 'stage-6', name: 'Backend checklist', order: 6, ownerRoleKey: 'operator', escalationHours: 24 },
      { id: 'stage-7', name: 'RM handling', order: 7, ownerRoleKey: 'manager', escalationHours: 24 },
      { id: 'stage-8', name: 'Loan login', order: 8, ownerRoleKey: 'operator', escalationHours: 48 },
      { id: 'stage-9', name: 'Sanction', order: 9, ownerRoleKey: 'manager', escalationHours: 48 },
      { id: 'stage-10', name: 'Disbursement', order: 10, ownerRoleKey: 'admin', escalationHours: 72 },
      { id: 'stage-11', name: 'Follow-up', order: 11, ownerRoleKey: 'operator', escalationHours: 72 },
    ],
    assignmentRules: [
      {
        id: 'rule-home-loan',
        name: 'Home & LAP Enquiries -> Ananya',
        productMatch: 'Home Loan',
        targetQueueId: 'queue-inbound-dsa',
        targetEmployeeId: 'emp-ananya',
      },
      {
        id: 'rule-business-loan',
        name: 'Business Loan -> Rohan',
        productMatch: 'Business Loan',
        targetQueueId: 'queue-prm-review',
        targetEmployeeId: 'emp-rohan',
      },
    ],
  };
}

export const STARTER_ENQUIRY_FIELDS: FormFieldDefinition[] = [
  {
    id: 'fld-name',
    key: 'full_name',
    type: 'short_text',
    label: 'Applicant Full Name',
    helpText: 'Use synthetic test names only during workspace validation.',
    placeholder: 'e.g. Aarav Sharma (Demo)',
    required: true,
    validation: { minLength: 2, maxLength: 100 },
  },
  {
    id: 'fld-email',
    key: 'email',
    type: 'email',
    label: 'Work or Personal Email',
    placeholder: 'applicant.demo@example.com',
    required: true,
  },
  {
    id: 'fld-phone',
    key: 'phone',
    type: 'phone',
    label: 'Contact Phone Number',
    placeholder: '+91 98000 00000',
    required: true,
  },
  {
    id: 'fld-product',
    key: 'loan_product',
    type: 'dropdown',
    label: 'Loan Product Interest',
    required: true,
    options: ['Home Loan', 'Loan Against Property', 'Business Loan', 'Personal Loan'],
  },
  {
    id: 'fld-amount',
    key: 'requested_amount_lakhs',
    type: 'number',
    label: 'Approximate Requirement (INR Lakhs)',
    helpText: 'Indicative range only — do not upload financial statements.',
    placeholder: '25',
    required: false,
    validation: { min: 1, max: 5000 },
  },
  {
    id: 'fld-preferred-slot',
    key: 'preferred_callback_date',
    type: 'date',
    label: 'Preferred Callback Date',
    required: false,
  },
  {
    id: 'fld-consent',
    key: 'callback_consent',
    type: 'checkbox',
    label: 'I consent to a synthetic follow-up callback from the DialPulse team.',
    required: true,
  },
];
