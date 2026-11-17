import React, { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { validateSubmissionAnswers } from '../shared/forms-validation.ts';
import {
  AlertBanner,
  Button,
  Card,
  INPUT_BASE_CLASS,
  SELECT_BASE_CLASS,
} from './ui/Primitives.tsx';
import type { FormFieldDefinition } from '../shared/types.ts';

interface FormRendererProps {
  title: string;
  description: string;
  fields: FormFieldDefinition[];
  submitButtonLabel: string;
  successMessage: string;
  isPreview?: boolean;
  onSubmit: (answers: Record<string, unknown>, idempotencyKey: string) => Promise<{
    successMessage?: string;
    automationsTriggeredCount?: number;
  }>;
}

export function FormRenderer({
  title,
  description,
  fields,
  submitButtonLabel,
  successMessage,
  isPreview = false,
  onSubmit,
}: FormRendererProps) {
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submittedInfo, setSubmittedInfo] = useState<{
    message: string;
    automationsTriggeredCount?: number;
  } | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID()
  );

  const handleFieldChange = (key: string, value: unknown) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
    if (fieldErrors[key]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const toggleMultiChoice = (key: string, option: string) => {
    const current = Array.isArray(answers[key]) ? (answers[key] as string[]) : [];
    const next = current.includes(option)
      ? current.filter((item) => item !== option)
      : [...current, option];
    handleFieldChange(key, next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    const validation = validateSubmissionAnswers(fields, answers);
    if (!validation.valid) {
      setFieldErrors(validation.fieldErrors);
      setSubmitError('Please review the highlighted fields before submitting.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await onSubmit(validation.sanitizedAnswers, idempotencyKey);
      setSubmittedInfo({
        message: result.successMessage || successMessage,
        automationsTriggeredCount: result.automationsTriggeredCount,
      });
    } catch (err) {
      const typed = err as Error & { fieldErrors?: Record<string, string> };
      if (typed.fieldErrors) {
        setFieldErrors(typed.fieldErrors);
      }
      setSubmitError(typed.message || 'Unable to submit form.');
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setAnswers({});
    setFieldErrors({});
    setSubmitError(null);
    setSubmittedInfo(null);
    setIdempotencyKey(crypto.randomUUID());
  };

  if (submittedInfo) {
    return (
      <Card className="p-8 max-w-2xl mx-auto">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="w-6 h-6 text-[var(--dp-success)] shrink-0 mt-0.5" />
          <div className="space-y-3">
            <h3 className="text-[18px] font-semibold text-[var(--dp-on-surface)]">
              Submission recorded
            </h3>
            <p className="text-[14px] text-[var(--dp-on-surface-variant)] leading-relaxed">
              {submittedInfo.message}
            </p>
            {isPreview && submittedInfo.automationsTriggeredCount !== undefined && (
              <p className="text-[12px] text-[var(--dp-on-surface-variant)]">
                Automation Lite evaluated {submittedInfo.automationsTriggeredCount}{' '}
                matching rule(s) for this submission.
              </p>
            )}
            <div className="pt-2">
              <Button variant="secondary" onClick={resetForm}>
                Submit another synthetic test
              </Button>
            </div>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="max-w-2xl mx-auto">
      <form onSubmit={handleSubmit} noValidate className="p-6 md:p-8 space-y-6">
        <div className="border-b border-[var(--dp-outline-variant)] pb-4 space-y-1.5">
          <h2 className="text-[20px] font-semibold text-[var(--dp-on-surface)]">
            {title}
          </h2>
          {description && (
            <p className="text-[14px] text-[var(--dp-on-surface-variant)] leading-relaxed">
              {description}
            </p>
          )}
          <p className="text-[12px] font-medium text-[var(--dp-warning-text)] pt-1">
            Synthetic test data only — do not enter Aadhaar, PAN, bank account numbers, or financial documents.
          </p>
        </div>

        {submitError && <AlertBanner tone="error" message={submitError} />}

        {fields.length === 0 ? (
          <div className="py-8 text-center text-[13px] text-[var(--dp-on-surface-variant)] border border-dashed border-[var(--dp-outline-variant)] rounded-[var(--dp-radius-sm)]">
            No fields configured yet. Add fields in the Form Builder.
          </div>
        ) : (
          <div className="space-y-5">
            {fields.map((field) => {
              const error = fieldErrors[field.key];
              const inputId = `field-${field.id}`;
              const val = answers[field.key];
              const errorRing = error
                ? 'border-[var(--dp-error)] focus:border-[var(--dp-error)] focus:ring-[var(--dp-error)]/20'
                : '';

              return (
                <div key={field.id} className="space-y-1.5">
                  {field.type !== 'checkbox' && (
                    <label
                      htmlFor={inputId}
                      className="block text-[13px] font-medium text-[var(--dp-on-surface)]"
                    >
                      {field.label}
                      {field.required && (
                        <span
                          className="text-[var(--dp-error)] ml-1"
                          aria-hidden="true"
                        >
                          *
                        </span>
                      )}
                    </label>
                  )}

                  {field.type === 'short_text' && (
                    <input
                      id={inputId}
                      type="text"
                      value={typeof val === 'string' ? val : ''}
                      onChange={(e) => handleFieldChange(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      className={`${INPUT_BASE_CLASS} ${errorRing}`}
                    />
                  )}

                  {field.type === 'long_text' && (
                    <textarea
                      id={inputId}
                      rows={3}
                      value={typeof val === 'string' ? val : ''}
                      onChange={(e) => handleFieldChange(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      className={`${INPUT_BASE_CLASS} ${errorRing}`}
                    />
                  )}

                  {field.type === 'email' && (
                    <input
                      id={inputId}
                      type="email"
                      value={typeof val === 'string' ? val : ''}
                      onChange={(e) => handleFieldChange(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      className={`${INPUT_BASE_CLASS} ${errorRing}`}
                    />
                  )}

                  {field.type === 'phone' && (
                    <input
                      id={inputId}
                      type="tel"
                      value={typeof val === 'string' ? val : ''}
                      onChange={(e) => handleFieldChange(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      className={`${INPUT_BASE_CLASS} ${errorRing}`}
                    />
                  )}

                  {field.type === 'number' && (
                    <input
                      id={inputId}
                      type="number"
                      value={val === undefined || val === null ? '' : String(val)}
                      onChange={(e) => handleFieldChange(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      className={`${INPUT_BASE_CLASS} tabular-nums ${errorRing}`}
                    />
                  )}

                  {field.type === 'date' && (
                    <input
                      id={inputId}
                      type="date"
                      value={typeof val === 'string' ? val : ''}
                      onChange={(e) => handleFieldChange(field.key, e.target.value)}
                      className={`${INPUT_BASE_CLASS} ${errorRing}`}
                    />
                  )}

                  {field.type === 'dropdown' && (
                    <select
                      id={inputId}
                      value={typeof val === 'string' ? val : ''}
                      onChange={(e) => handleFieldChange(field.key, e.target.value)}
                      className={`${SELECT_BASE_CLASS} w-full h-10 text-[14px] ${errorRing}`}
                    >
                      <option value="">Select an option</option>
                      {(field.options ?? []).map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  )}

                  {field.type === 'single_choice' && (
                    <div className="space-y-2 pt-1">
                      {(field.options ?? []).map((opt) => (
                        <label
                          key={opt}
                          className="flex items-center gap-2.5 text-[14px] text-[var(--dp-on-surface)] cursor-pointer"
                        >
                          <input
                            type="radio"
                            name={inputId}
                            value={opt}
                            checked={val === opt}
                            onChange={() => handleFieldChange(field.key, opt)}
                            className="w-4 h-4 accent-[var(--dp-primary)]"
                          />
                          <span>{opt}</span>
                        </label>
                      ))}
                    </div>
                  )}

                  {field.type === 'multiple_choice' && (
                    <div className="space-y-2 pt-1">
                      {(field.options ?? []).map((opt) => {
                        const selected = Array.isArray(val) && val.includes(opt);
                        return (
                          <label
                            key={opt}
                            className="flex items-center gap-2.5 text-[14px] text-[var(--dp-on-surface)] cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleMultiChoice(field.key, opt)}
                              className="w-4 h-4 rounded accent-[var(--dp-primary)]"
                            />
                            <span>{opt}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}

                  {field.type === 'checkbox' && (
                    <label className="flex items-start gap-2.5 text-[14px] text-[var(--dp-on-surface)] cursor-pointer pt-1">
                      <input
                        id={inputId}
                        type="checkbox"
                        checked={Boolean(val)}
                        onChange={(e) =>
                          handleFieldChange(field.key, e.target.checked)
                        }
                        className="w-4 h-4 mt-0.5 rounded accent-[var(--dp-primary)]"
                      />
                      <span>
                        {field.label}
                        {field.required && (
                          <span
                            className="text-[var(--dp-error)] ml-1"
                            aria-hidden="true"
                          >
                            *
                          </span>
                        )}
                      </span>
                    </label>
                  )}

                  {field.helpText && (
                    <p className="text-[12px] text-[var(--dp-on-surface-variant)]">
                      {field.helpText}
                    </p>
                  )}

                  {error && (
                    <p className="text-[12px] font-medium text-[var(--dp-error)]">
                      {error}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="pt-4 border-t border-[var(--dp-outline-variant)] flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-3">
          <span className="text-[12px] text-[var(--dp-on-surface-variant)] whitespace-nowrap">
            {isPreview
              ? 'Preview submissions are persisted to PostgreSQL.'
              : 'DialPulse Workspace'}
          </span>
          <Button
            type="submit"
            variant="primary"
            disabled={submitting || fields.length === 0}
            className="w-full sm:w-auto h-10 px-5"
          >
            {submitting ? 'Submitting...' : submitButtonLabel}
          </Button>
        </div>
      </form>
    </Card>
  );
}
