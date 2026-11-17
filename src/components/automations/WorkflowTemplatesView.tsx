import React from 'react';
import { CopyPlus } from 'lucide-react';
import { AUTOMATION_TEMPLATES } from '../../shared/automation-templates.ts';
import type { AutomationTemplateItem } from '../../shared/types.ts';
import { Button, Card } from '../ui/Primitives.tsx';

export function WorkflowTemplatesView({
  canManage,
  onUseTemplate,
}: {
  canManage: boolean;
  onUseTemplate: (template: AutomationTemplateItem) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-[13px] text-[var(--dp-on-surface-variant)]">
        Select a pre-configured DialPulse Loan-DSA workflow template to customize in the Workflow Builder. Templates start in Draft/Paused mode until you activate them.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {AUTOMATION_TEMPLATES.map((tpl) => (
          <Card key={tpl.id} className="p-5 flex flex-col justify-between gap-4">
            <div className="space-y-2">
              <div className="text-[11px] font-medium text-[var(--dp-primary)]">
                {tpl.category} · Trigger: <span className="font-mono">{tpl.triggerType}</span>
              </div>
              <h2 className="text-[16px] font-semibold text-[var(--dp-on-surface)]">
                {tpl.name}
              </h2>
              <p className="text-[13px] text-[var(--dp-on-surface-variant)] leading-relaxed">
                {tpl.description}
              </p>
              <div className="text-[12px] font-mono text-[var(--dp-on-surface-variant)] pt-1">
                {tpl.conditions.length} condition(s) · {tpl.actions.length} sequential action(s)
              </div>
            </div>

            {canManage && (
              <Button
                variant="secondary"
                onClick={() => onUseTemplate(tpl)}
                className="w-full"
              >
                <CopyPlus className="w-4 h-4" aria-hidden="true" />
                Use Template in Builder
              </Button>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
