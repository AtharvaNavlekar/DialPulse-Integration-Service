import type { AutomationTemplateItem } from './types.ts';

export const AUTOMATION_TEMPLATES: AutomationTemplateItem[] = [
  {
    id: 'tpl-home-loan-route',
    name: 'Home Loan Enquiry -> Assign Inbound Queue & RM Callback',
    category: 'Lead Acquisition',
    description:
      'Routes incoming Home Loan form enquiries to the Inbound Loan Enquiry Queue, assigns an executive, and opens a high-priority 4-hour callback task.',
    triggerType: 'form_submitted',
    conditions: [
      {
        id: 'tpl-c1',
        fieldKey: 'loan_product',
        operator: 'equals',
        value: 'Home Loan',
      },
    ],
    actions: [
      {
        id: 'tpl-a1',
        type: 'assign_lead_queue',
        config: { queueId: 'queue-inbound-dsa' },
      },
      {
        id: 'tpl-a2',
        type: 'assign_lead_employee',
        config: { employeeId: 'emp-ananya' },
      },
      {
        id: 'tpl-a3',
        type: 'create_follow_up_task',
        config: {
          taskTitle: 'Home Loan eligibility callback',
          taskPriority: 'high',
          dueHours: 4,
        },
      },
      {
        id: 'tpl-a4',
        type: 'send_notification',
        config: {
          notificationTitle: 'Home Loan enquiry assigned',
          notificationMessage: 'New synthetic Home Loan enquiry routed for callback.',
        },
      },
    ],
  },
  {
    id: 'tpl-business-loan-prm',
    name: 'Business Loan Enquiry -> Escalate to PRM Review',
    category: 'Partner & RM Operations',
    description:
      'Routes Business Loan submissions to the PRM Eligibility Review Queue, assigns the Relationship Manager, and advances workflow stage to PRM review.',
    triggerType: 'form_submitted',
    conditions: [
      {
        id: 'tpl-c2',
        fieldKey: 'loan_product',
        operator: 'contains',
        value: 'Business',
      },
    ],
    actions: [
      {
        id: 'tpl-a5',
        type: 'assign_lead_queue',
        config: { queueId: 'queue-prm-review' },
      },
      {
        id: 'tpl-a6',
        type: 'assign_lead_employee',
        config: { employeeId: 'emp-rohan' },
      },
      {
        id: 'tpl-a7',
        type: 'change_status',
        config: { targetStatus: 'PRM review' },
      },
      {
        id: 'tpl-a8',
        type: 'record_activity',
        config: {
          activitySummary: 'Business loan enquiry escalated to PRM Eligibility Review Queue.',
        },
      },
    ],
  },
  {
    id: 'tpl-task-complete-audit',
    name: 'Follow-Up Task Completed -> Notify Team & Log Audit Event',
    category: 'SLA & Audit',
    description:
      'Sends an internal completion alert and records a milestone audit log whenever a calling or qualification follow-up task finishes.',
    triggerType: 'task_completed',
    conditions: [],
    actions: [
      {
        id: 'tpl-a9',
        type: 'send_notification',
        config: {
          notificationTitle: 'Follow-up task completed',
          notificationMessage: 'An assigned follow-up callback task was marked completed.',
        },
      },
      {
        id: 'tpl-a10',
        type: 'record_activity',
        config: {
          activitySummary: 'Task completion milestone verified by Automation Lite.',
        },
      },
    ],
  },
  {
    id: 'tpl-general-intake-triage',
    name: 'Any Form Submission -> Triage Queue & Standard Callback',
    category: 'General Operations',
    description:
      'Catch-all workflow for any published form that creates a normal-priority 24-hour follow-up task and logs intake activity.',
    triggerType: 'form_submitted',
    conditions: [
      {
        id: 'tpl-c3',
        fieldKey: 'full_name',
        operator: 'is_present',
      },
    ],
    actions: [
      {
        id: 'tpl-a11',
        type: 'assign_lead_queue',
        config: { queueId: 'queue-inbound-dsa' },
      },
      {
        id: 'tpl-a12',
        type: 'create_follow_up_task',
        config: {
          taskTitle: 'Standard enquiry follow-up',
          taskPriority: 'normal',
          dueHours: 24,
        },
      },
    ],
  },
];
