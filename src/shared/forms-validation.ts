import type { FormFieldDefinition } from './types.ts';

const RESTRICTED_KYC_KEYWORDS = [
  'aadhaar',
  'aadhar',
  'pan number',
  'pan card',
  'pan_no',
  'bank statement',
  'account number',
  'ifsc',
  'salary slip',
  'itr',
  'income tax',
  'passport',
  'credit card number',
  'cvv',
];

export function detectRestrictedKycField(field: Pick<FormFieldDefinition, 'label' | 'key'>): string | null {
  const combined = `${field.label} ${field.key}`.toLowerCase();
  for (const keyword of RESTRICTED_KYC_KEYWORDS) {
    if (combined.includes(keyword)) {
      return keyword;
    }
  }
  return null;
}

export function validateFormFieldsSafety(fields: FormFieldDefinition[]): string[] {
  const errors: string[] = [];
  const seenKeys = new Set<string>();

  for (const field of fields) {
    if (!field.label.trim()) {
      errors.push('Every field must have a non-empty label.');
    }
    const normalizedKey = field.key.trim().toLowerCase();
    if (!normalizedKey) {
      errors.push(`Field "${field.label || field.id}" must have a valid key.`);
    } else if (seenKeys.has(normalizedKey)) {
      errors.push(`Duplicate field key "${field.key}". Keys must be unique within a form.`);
    } else {
      seenKeys.add(normalizedKey);
    }

    const restricted = detectRestrictedKycField(field);
    if (restricted) {
      errors.push(
        `Field "${field.label}" matches restricted sensitive/KYC keyword "${restricted}". Real KYC or financial document collection is disabled in this milestone.`
      );
    }

    if (
      (field.type === 'dropdown' ||
        field.type === 'single_choice' ||
        field.type === 'multiple_choice') &&
      (!field.options || field.options.filter((opt) => opt.trim().length > 0).length === 0)
    ) {
      errors.push(`Field "${field.label}" requires at least one non-empty option.`);
    }
  }

  return errors;
}

export interface SubmissionValidationResult {
  valid: boolean;
  fieldErrors: Record<string, string>;
  sanitizedAnswers: Record<string, unknown>;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[+\d][\d\s()-]{6,18}\d$/;

export function validateSubmissionAnswers(
  fields: FormFieldDefinition[],
  rawAnswers: Record<string, unknown>
): SubmissionValidationResult {
  const fieldErrors: Record<string, string> = {};
  const sanitizedAnswers: Record<string, unknown> = {};

  for (const field of fields) {
    const raw = rawAnswers[field.key];

    if (field.type === 'checkbox') {
      const checked = raw === true || raw === 'true' || raw === 'on';
      if (field.required && !checked) {
        fieldErrors[field.key] = `${field.label} must be checked.`;
      } else {
        sanitizedAnswers[field.key] = checked;
      }
      continue;
    }

    if (field.type === 'multiple_choice') {
      const list = Array.isArray(raw)
        ? raw.map((item) => String(item).trim()).filter(Boolean)
        : [];
      if (field.required && list.length === 0) {
        fieldErrors[field.key] = `Please select at least one option for ${field.label}.`;
      } else {
        if (field.options && field.options.length > 0) {
          const invalidOption = list.find((item) => !field.options?.includes(item));
          if (invalidOption) {
            fieldErrors[field.key] = `Invalid selection "${invalidOption}" for ${field.label}.`;
            continue;
          }
        }
        sanitizedAnswers[field.key] = list;
      }
      continue;
    }

    const stringVal =
      raw === undefined || raw === null ? '' : String(raw).trim();

    if (field.required && !stringVal) {
      fieldErrors[field.key] = `${field.label} is required.`;
      continue;
    }

    if (!stringVal) {
      sanitizedAnswers[field.key] = '';
      continue;
    }

    if (field.type === 'email' && !EMAIL_PATTERN.test(stringVal)) {
      fieldErrors[field.key] = `Enter a valid email address for ${field.label}.`;
      continue;
    }

    if (field.type === 'phone' && !PHONE_PATTERN.test(stringVal)) {
      fieldErrors[field.key] = `Enter a valid phone number for ${field.label}.`;
      continue;
    }

    if (field.type === 'number') {
      const num = Number(stringVal);
      if (!Number.isFinite(num)) {
        fieldErrors[field.key] = `${field.label} must be a valid number.`;
        continue;
      }
      if (field.validation?.min !== undefined && num < field.validation.min) {
        fieldErrors[field.key] = `${field.label} must be at least ${field.validation.min}.`;
        continue;
      }
      if (field.validation?.max !== undefined && num > field.validation.max) {
        fieldErrors[field.key] = `${field.label} must be at most ${field.validation.max}.`;
        continue;
      }
      sanitizedAnswers[field.key] = num;
      continue;
    }

    if (
      (field.type === 'dropdown' || field.type === 'single_choice') &&
      field.options &&
      field.options.length > 0 &&
      !field.options.includes(stringVal)
    ) {
      fieldErrors[field.key] = `Select a valid option for ${field.label}.`;
      continue;
    }

    if (field.type === 'date') {
      const parsedTime = Date.parse(stringVal);
      if (Number.isNaN(parsedTime)) {
        fieldErrors[field.key] = `Enter a valid date for ${field.label}.`;
        continue;
      }
    }

    if (
      field.validation?.minLength !== undefined &&
      stringVal.length < field.validation.minLength
    ) {
      fieldErrors[field.key] = `${field.label} must be at least ${field.validation.minLength} characters.`;
      continue;
    }

    if (
      field.validation?.maxLength !== undefined &&
      stringVal.length > field.validation.maxLength
    ) {
      fieldErrors[field.key] = `${field.label} must be at most ${field.validation.maxLength} characters.`;
      continue;
    }

    sanitizedAnswers[field.key] = stringVal;
  }

  return {
    valid: Object.keys(fieldErrors).length === 0,
    fieldErrors,
    sanitizedAnswers,
  };
}

function escapeCsvCell(value: unknown): string {
  const raw = Array.isArray(value)
    ? value.join('; ')
    : value === null || value === undefined
      ? ''
      : String(value);

  // Neutralize CSV spreadsheet formula injection
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function buildSubmissionsCsv(
  fields: FormFieldDefinition[],
  submissions: Array<{
    id: number;
    source: string;
    createdAt: string;
    answers: Record<string, unknown>;
  }>
): string {
  const permittedFields = fields.filter((f) => !detectRestrictedKycField(f));
  const headers = [
    'Submission ID',
    'Source',
    'Created At',
    ...permittedFields.map((f) => f.label),
  ];

  const rows = submissions.map((sub) => [
    sub.id,
    sub.source,
    sub.createdAt,
    ...permittedFields.map((f) => sub.answers[f.key]),
  ]);

  return [headers, ...rows]
    .map((row) => row.map((cell) => escapeCsvCell(cell)).join(','))
    .join('\n');
}
