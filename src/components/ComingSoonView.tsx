import React from 'react';
import { Button, Card, StatusIndicator } from './ui/Primitives.tsx';
import type { NavSectionId } from '../shared/types.ts';

interface ComingSoonSpec {
  title: string;
  milestone: string;
  inspiredBy: string;
  summary: string;
  plannedCapabilities: string[];
  externalBoundary: string;
}

const SPECS: Record<string, ComingSoonSpec> = {
  'appointment-scheduler': {
    title: 'Appointment Scheduler',
    milestone: 'Milestone E',
    inspiredBy: 'Calendly',
    summary:
      'Scheduled for Milestone E after Forms Studio and Automation Lite pass full acceptance verification.',
    plannedCapabilities: [
      'Employee working hours and slot duration configuration',
      'Public booking page with double-booking prevention',
      'Rescheduling, cancellation, and internal reminders',
    ],
    externalBoundary:
      'SMS, email, and WhatsApp notifications remain pluggable Integration Service provider capabilities.',
  },
  'call-operations': {
    title: 'Call Operations',
    milestone: 'Milestone F',
    inspiredBy: 'Vapi',
    summary:
      'Scheduled for Milestone F to manage Loan-DSA calling queues, scripts, and dispositions.',
    plannedCapabilities: [
      'Tenant calling queues and employee assignment',
      'Call scripts, attempt tracking, and disposition reports',
      'Automated follow-up task creation on call outcomes',
    ],
    externalBoundary:
      'Telephony networks and voice AI inference require an approved Integration Service voice provider adapter.',
  },
  'support-inbox': {
    title: 'Support Inbox',
    milestone: 'Milestone G',
    inspiredBy: 'Crisp',
    summary:
      'Scheduled for Milestone G for centralized customer support conversations and agent assignments.',
    plannedCapabilities: [
      'Open, pending, and resolved conversation queues',
      'Internal notes, canned responses, and customer context',
      'Searchable conversation history and timeline',
    ],
    externalBoundary:
      'External WhatsApp/email channels connect through approved provider adapters.',
  },
  'document-workflow': {
    title: 'Document Workflow',
    milestone: 'Milestone H',
    inspiredBy: 'Google Drive / Box',
    summary:
      'Scheduled for Milestone H with strict encryption, retention, and compliance gates.',
    plannedCapabilities: [
      'Case-specific document checklists and verifier assignment',
      'Requested, uploaded, pending verification, approved, and rejected states',
      'Immutable verification audit trail',
    ],
    externalBoundary:
      'Real KYC or financial documents remain blocked until encrypted object storage and compliance sign-off are completed.',
  },
  'business-analytics': {
    title: 'Business Analytics',
    milestone: 'Milestone I',
    inspiredBy: 'PostHog',
    summary:
      'Scheduled for Milestone I once upstream form, automation, call, and appointment data streams are active.',
    plannedCapabilities: [
      'Lead funnel progression across configured Loan-DSA stages',
      'Assignment SLA and follow-up completion reporting',
      'Automation execution success and failure metrics',
    ],
    externalBoundary:
      'Consumes authorized source records without creating a duplicate customer database.',
  },
};

export function ComingSoonView({
  sectionId,
  onReturnOverview,
}: {
  sectionId: NavSectionId;
  onReturnOverview: () => void;
}) {
  const spec = SPECS[sectionId];
  if (!spec) return null;
  const isBlocked = sectionId === 'document-workflow';

  return (
    <Card className="max-w-3xl p-6 md:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-[var(--dp-outline-variant)] pb-5">
        <div className="space-y-1.5">
          <StatusIndicator
            tone={isBlocked ? 'error' : 'warning'}
            label={
              isBlocked
                ? `Blocked · ${spec.milestone}`
                : `Coming soon · ${spec.milestone}`
            }
          />
          <h1 className="text-[24px] font-semibold text-[var(--dp-on-surface)] tracking-tight">
            {spec.title}
          </h1>
          <p className="text-[12px] text-[var(--dp-on-surface-variant)]">
            Planned scope inspired by {spec.inspiredBy}
          </p>
        </div>
        <Button variant="secondary" onClick={onReturnOverview}>
          Back to Overview
        </Button>
      </div>

      <p className="text-[14px] text-[var(--dp-on-surface)] leading-relaxed">
        {spec.summary}
      </p>

      <div className="space-y-2.5">
        <h2 className="text-[12px] font-semibold text-[var(--dp-on-surface-variant)] uppercase tracking-wider">
          Planned Capabilities
        </h2>
        <ul className="space-y-1.5 text-[14px] text-[var(--dp-on-surface-variant)] list-disc pl-5">
          {spec.plannedCapabilities.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>

      <div className="p-4 rounded-[var(--dp-radius-sm)] bg-[var(--dp-surface-container-low)] border border-[var(--dp-outline-variant)] text-[13px] text-[var(--dp-on-surface-variant)] leading-relaxed">
        <span className="font-semibold text-[var(--dp-on-surface)]">
          Ecosystem & Infrastructure Boundary:{' '}
        </span>
        {spec.externalBoundary}
      </div>
    </Card>
  );
}
