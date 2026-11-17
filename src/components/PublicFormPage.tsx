import React, { useEffect, useState } from 'react';
import { FormRenderer } from './FormRenderer.tsx';
import { DialPulseMark } from './ui/DialPulseLogo.tsx';
import { AlertBanner, Card, ThemeToggleButton } from './ui/Primitives.tsx';
import type { FormFieldDefinition } from '../shared/types.ts';

interface PublicFormPayload {
  id: number;
  slug: string;
  title: string;
  description: string;
  category: string;
  fields: FormFieldDefinition[];
  submitButtonLabel: string;
  successMessage: string;
}

export function PublicFormPage({ slug }: { slug: string }) {
  const [form, setForm] = useState<PublicFormPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/public/forms/${encodeURIComponent(slug)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || 'Published form not found.');
        }
        return (await res.json()) as { form: PublicFormPayload };
      })
      .then((data) => {
        if (active) setForm(data.form);
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : 'Unable to load form.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [slug]);

  return (
    <div className="min-h-screen bg-[var(--dp-surface)] text-[var(--dp-on-surface)] pb-12">
      <header className="h-14 bg-[var(--dp-background)] border-b border-[var(--dp-outline-variant)] px-4 sm:px-6 mb-8">
        <div className="max-w-2xl mx-auto h-full flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <DialPulseMark className="w-7 h-7 shrink-0" />
            <span className="font-heading text-[14px] font-bold text-[var(--dp-on-surface)] whitespace-nowrap">
              DialPulse Workspace
            </span>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <ThemeToggleButton />
            <a
              href="/"
              className="text-[12px] font-medium text-[var(--dp-primary)] hover:underline whitespace-nowrap"
            >
              Workspace Sign In
            </a>
          </div>
        </div>
      </header>

      <div className="px-4">
        {loading && (
          <Card className="max-w-2xl mx-auto p-8 text-[14px] text-[var(--dp-on-surface-variant)]">
            Loading form...
          </Card>
        )}

        {error && (
          <div className="max-w-2xl mx-auto">
            <AlertBanner tone="error" message={error} />
          </div>
        )}

        {form && (
          <FormRenderer
            title={form.title}
            description={form.description}
            fields={form.fields}
            submitButtonLabel={form.submitButtonLabel}
            successMessage={form.successMessage}
            onSubmit={async (answers, idempotencyKey) => {
              const res = await fetch(
                `/api/public/forms/${encodeURIComponent(slug)}/submissions`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ answers, idempotencyKey }),
                }
              );
              const body = await res.json().catch(() => ({}));
              if (!res.ok) {
                const err = new Error(body?.error || 'Submission failed.') as Error & {
                  fieldErrors?: Record<string, string>;
                };
                err.fieldErrors = body?.fieldErrors;
                throw err;
              }
              return { successMessage: body?.successMessage };
            }}
          />
        )}
      </div>
    </div>
  );
}
