import React from 'react';
import { Code2, Copy } from 'lucide-react';
import { useToast } from '../../context/ToastContext.tsx';
import type { FormFieldDefinition, FormRecord } from '../../shared/types.ts';
import { FormRenderer } from '../FormRenderer.tsx';
import { Button, Card } from '../ui/Primitives.tsx';

export function FormPreviewView({
  form,
  title,
  description,
  fields,
  submitButtonLabel,
  successMessage,
  onSubmitPreview,
}: {
  form: FormRecord;
  title: string;
  description: string;
  fields: FormFieldDefinition[];
  submitButtonLabel: string;
  successMessage: string;
  onSubmitPreview: (
    answers: Record<string, unknown>,
    idempotencyKey: string
  ) => Promise<{ successMessage: string; automationsTriggeredCount?: number }>;
}) {
  const { pushToast } = useToast();
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const publicUrl = `${origin}/f/${form.slug}`;
  const embedCode = `<iframe src="${publicUrl}" title="${form.title.replace(/"/g, '&quot;')}" width="100%" height="680" style="border:0;border-radius:12px;"></iframe>`;

  const copyText = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      pushToast(`${label} copied to clipboard.`, 'info');
    } catch {
      pushToast(`Unable to copy ${label.toLowerCase()}.`, 'error');
    }
  };

  return (
    <div className="space-y-6">
      <Card className="p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-[15px] font-semibold text-[var(--dp-on-surface)]">
              Share & Embed Configuration
            </h2>
            <p className="text-[12px] text-[var(--dp-on-surface-variant)]">
              {form.status === 'published'
                ? 'Published and accepting public synthetic submissions.'
                : 'Currently in Draft mode — publish the form to enable the public link.'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-[12px]">
          <div className="p-3 rounded-[var(--dp-radius-sm)] bg-[var(--dp-surface-container-low)] border border-[var(--dp-outline-variant)] space-y-2">
            <div className="font-medium text-[var(--dp-on-surface)]">
              Public Form Link
            </div>
            <div className="flex items-center justify-between gap-2">
              <code className="text-[11px] text-[var(--dp-on-surface-variant)] truncate">
                {publicUrl}
              </code>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void copyText(publicUrl, 'Public link')}
              >
                <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                Copy
              </Button>
            </div>
          </div>

          <div className="p-3 rounded-[var(--dp-radius-sm)] bg-[var(--dp-surface-container-low)] border border-[var(--dp-outline-variant)] space-y-2">
            <div className="font-medium text-[var(--dp-on-surface)]">
              Iframe Embed Snippet
            </div>
            <div className="flex items-center justify-between gap-2">
              <code className="text-[11px] text-[var(--dp-on-surface-variant)] truncate">
                {embedCode}
              </code>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void copyText(embedCode, 'Embed snippet')}
              >
                <Code2 className="w-3.5 h-3.5" aria-hidden="true" />
                Copy
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <FormRenderer
        title={title}
        description={description}
        fields={fields}
        submitButtonLabel={submitButtonLabel}
        successMessage={successMessage}
        isPreview
        onSubmit={onSubmitPreview}
      />
    </div>
  );
}
