import React from 'react';
import { ArrowDown, ArrowUp, Save, Trash2 } from 'lucide-react';
import { detectRestrictedKycField } from '../../shared/forms-validation.ts';
import type {
  FormFieldDefinition,
  FormFieldType,
  FormRecord,
} from '../../shared/types.ts';
import { Button, Card, INPUT_BASE_CLASS } from '../ui/Primitives.tsx';

const FIELD_TYPES: Array<{ type: FormFieldType; label: string }> = [
  { type: 'short_text', label: 'Short text' },
  { type: 'long_text', label: 'Long text' },
  { type: 'email', label: 'Email' },
  { type: 'phone', label: 'Phone number' },
  { type: 'number', label: 'Number' },
  { type: 'dropdown', label: 'Dropdown' },
  { type: 'single_choice', label: 'Single choice' },
  { type: 'multiple_choice', label: 'Multiple choice' },
  { type: 'date', label: 'Date' },
  { type: 'checkbox', label: 'Checkbox' },
];

export function FormBuilderView({
  selectedForm,
  draftTitle,
  setDraftTitle,
  draftDescription,
  setDraftDescription,
  draftCategory,
  setDraftCategory,
  draftSubmitLabel,
  setDraftSubmitLabel,
  draftSuccessMessage,
  setDraftSuccessMessage,
  draftFields,
  setDraftFields,
  selectedFieldId,
  setSelectedFieldId,
  saving,
  onSave,
}: {
  selectedForm: FormRecord;
  draftTitle: string;
  setDraftTitle: (val: string) => void;
  draftDescription: string;
  setDraftDescription: (val: string) => void;
  draftCategory: string;
  setDraftCategory: (val: string) => void;
  draftSubmitLabel: string;
  setDraftSubmitLabel: (val: string) => void;
  draftSuccessMessage: string;
  setDraftSuccessMessage: (val: string) => void;
  draftFields: FormFieldDefinition[];
  setDraftFields: React.Dispatch<React.SetStateAction<FormFieldDefinition[]>>;
  selectedFieldId: string | null;
  setSelectedFieldId: (id: string | null) => void;
  saving: boolean;
  onSave: () => void;
}) {
  const selectedField =
    draftFields.find((f) => f.id === selectedFieldId) ?? null;

  const addField = (type: FormFieldType) => {
    const id = `fld-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const count = draftFields.length + 1;
    const baseLabel = FIELD_TYPES.find((t) => t.type === type)?.label || 'Field';
    const needsOptions =
      type === 'dropdown' ||
      type === 'single_choice' ||
      type === 'multiple_choice';

    const newField: FormFieldDefinition = {
      id,
      key: `${type}_${count}`,
      type,
      label: `${baseLabel} ${count}`,
      helpText: '',
      placeholder: '',
      required: false,
      ...(needsOptions ? { options: ['Option 1', 'Option 2'] } : {}),
    };
    setDraftFields((prev) => [...prev, newField]);
    setSelectedFieldId(id);
  };

  const moveField = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= draftFields.length) return;
    setDraftFields((prev) => {
      const copy = [...prev];
      const [moved] = copy.splice(index, 1);
      copy.splice(target, 0, moved!);
      return copy;
    });
  };

  const updateSelectedField = (patch: Partial<FormFieldDefinition>) => {
    if (!selectedFieldId) return;
    setDraftFields((prev) =>
      prev.map((fld) => (fld.id === selectedFieldId ? { ...fld, ...patch } : fld))
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      <Card className="lg:col-span-4 space-y-5 p-5">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[16px] font-semibold text-[var(--dp-on-surface)]">
              Form Settings & Details
            </h2>
            <span className="font-mono text-[11px] text-[var(--dp-on-surface-variant)]">
              /f/{selectedForm.slug}
            </span>
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[var(--dp-on-surface-variant)] mb-1">
              Form Title
            </label>
            <input
              type="text"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              className={`${INPUT_BASE_CLASS} py-1.5 text-[13px]`}
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[var(--dp-on-surface-variant)] mb-1">
              Description
            </label>
            <textarea
              rows={2}
              value={draftDescription}
              onChange={(e) => setDraftDescription(e.target.value)}
              className={`${INPUT_BASE_CLASS} py-1.5 text-[13px]`}
            />
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[12px] font-medium text-[var(--dp-on-surface-variant)] mb-1">
                Category
              </label>
              <input
                type="text"
                value={draftCategory}
                onChange={(e) => setDraftCategory(e.target.value)}
                className={`${INPUT_BASE_CLASS} py-1.5 text-[13px]`}
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[var(--dp-on-surface-variant)] mb-1">
                Submit Button
              </label>
              <input
                type="text"
                value={draftSubmitLabel}
                onChange={(e) => setDraftSubmitLabel(e.target.value)}
                className={`${INPUT_BASE_CLASS} py-1.5 text-[13px]`}
              />
            </div>
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[var(--dp-on-surface-variant)] mb-1">
              Success Message
            </label>
            <input
              type="text"
              value={draftSuccessMessage}
              onChange={(e) => setDraftSuccessMessage(e.target.value)}
              className={`${INPUT_BASE_CLASS} py-1.5 text-[13px]`}
            />
          </div>
        </div>

        <div className="pt-4 border-t border-[var(--dp-outline-variant)] space-y-2.5">
          <h3 className="text-[12px] font-semibold text-[var(--dp-on-surface-variant)] uppercase tracking-wider">
            Add Field (10 Types)
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {FIELD_TYPES.map((ft) => (
              <button
                key={ft.type}
                type="button"
                onClick={() => addField(ft.type)}
                className="px-2.5 py-2 text-[12px] font-medium text-left text-[var(--dp-on-surface)] bg-[var(--dp-surface-container-low)] hover:bg-[var(--dp-primary-container)] hover:text-[var(--dp-on-primary-container)] border border-[var(--dp-outline-variant)] rounded-[var(--dp-radius-sm)] transition-colors duration-150 cursor-pointer"
              >
                + {ft.label}
              </button>
            ))}
          </div>
        </div>

        <div className="pt-2">
          <Button
            variant="primary"
            onClick={onSave}
            disabled={saving}
            className="w-full h-10"
          >
            <Save className="w-4 h-4" aria-hidden="true" />
            {saving ? 'Saving...' : 'Save Form Changes'}
          </Button>
        </div>
      </Card>

      <Card className="lg:col-span-4 p-5 space-y-3">
        <h2 className="text-[16px] font-semibold text-[var(--dp-on-surface)]">
          Fields ({draftFields.length})
        </h2>
        {draftFields.length === 0 ? (
          <p className="text-[13px] text-[var(--dp-on-surface-variant)] py-8 text-center">
            Use the Add Field buttons on the left to add fields.
          </p>
        ) : (
          <div className="space-y-2">
            {draftFields.map((fld, idx) => {
              const isSelected = fld.id === selectedFieldId;
              const restricted = detectRestrictedKycField(fld);
              return (
                <div
                  key={fld.id}
                  className={`p-3 rounded-[var(--dp-radius-sm)] border transition-colors duration-150 ${
                    isSelected
                      ? 'border-[var(--dp-primary)] bg-[var(--dp-primary-container)]/35'
                      : 'border-[var(--dp-outline-variant)] hover:border-[var(--dp-outline)]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedFieldId(fld.id)}
                      className="text-left min-w-0 flex-1 cursor-pointer"
                    >
                      <div className="text-[13px] font-semibold text-[var(--dp-on-surface)] truncate">
                        {fld.label || '(Untitled field)'}
                        {fld.required && (
                          <span className="text-[var(--dp-error)] ml-1">*</span>
                        )}
                      </div>
                      <div className="text-[11px] text-[var(--dp-on-surface-variant)] font-mono truncate">
                        {fld.type} · {fld.key}
                      </div>
                    </button>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        aria-label={`Move ${fld.label} up`}
                        disabled={idx === 0}
                        onClick={() => moveField(idx, -1)}
                        className="p-1 text-[var(--dp-on-surface-variant)] hover:text-[var(--dp-on-surface)] disabled:opacity-30 cursor-pointer"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${fld.label} down`}
                        disabled={idx === draftFields.length - 1}
                        onClick={() => moveField(idx, 1)}
                        className="p-1 text-[var(--dp-on-surface-variant)] hover:text-[var(--dp-on-surface)] disabled:opacity-30 cursor-pointer"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${fld.label}`}
                        onClick={() => {
                          const next = draftFields.filter(
                            (item) => item.id !== fld.id
                          );
                          setDraftFields(next);
                          if (selectedFieldId === fld.id) {
                            setSelectedFieldId(next[0]?.id ?? null);
                          }
                        }}
                        className="p-1 text-[var(--dp-on-surface-variant)] hover:text-[var(--dp-error)] cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  {restricted && (
                    <p className="text-[11px] font-medium text-[var(--dp-error)] mt-1.5">
                      Blocked KYC keyword: {restricted}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card className="lg:col-span-4 p-5 space-y-4">
        <h2 className="text-[16px] font-semibold text-[var(--dp-on-surface)]">
          Field Properties
        </h2>
        {!selectedField ? (
          <p className="text-[13px] text-[var(--dp-on-surface-variant)] py-8 text-center">
            Select a field to configure label, validation, or options.
          </p>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="block text-[12px] font-medium text-[var(--dp-on-surface-variant)] mb-1">
                Label
              </label>
              <input
                type="text"
                value={selectedField.label}
                onChange={(e) =>
                  updateSelectedField({ label: e.target.value })
                }
                className={`${INPUT_BASE_CLASS} py-1.5 text-[13px]`}
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[var(--dp-on-surface-variant)] mb-1">
                Field Key (used in Automations)
              </label>
              <input
                type="text"
                value={selectedField.key}
                onChange={(e) =>
                  updateSelectedField({
                    key: e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9_]/g, '_'),
                  })
                }
                className={`${INPUT_BASE_CLASS} py-1.5 text-[12px] font-mono`}
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[var(--dp-on-surface-variant)] mb-1">
                Help Text
              </label>
              <input
                type="text"
                value={selectedField.helpText ?? ''}
                onChange={(e) =>
                  updateSelectedField({ helpText: e.target.value })
                }
                className={`${INPUT_BASE_CLASS} py-1.5 text-[13px]`}
              />
            </div>
            {selectedField.type !== 'checkbox' &&
              selectedField.type !== 'single_choice' &&
              selectedField.type !== 'multiple_choice' && (
                <div>
                  <label className="block text-[12px] font-medium text-[var(--dp-on-surface-variant)] mb-1">
                    Placeholder
                  </label>
                  <input
                    type="text"
                    value={selectedField.placeholder ?? ''}
                    onChange={(e) =>
                      updateSelectedField({ placeholder: e.target.value })
                    }
                    className={`${INPUT_BASE_CLASS} py-1.5 text-[13px]`}
                  />
                </div>
              )}

            <label className="flex items-center gap-2 text-[13px] font-medium text-[var(--dp-on-surface)] pt-1 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedField.required}
                onChange={(e) =>
                  updateSelectedField({ required: e.target.checked })
                }
                className="w-4 h-4 rounded accent-[var(--dp-primary)]"
              />
              Required field
            </label>

            {(selectedField.type === 'dropdown' ||
              selectedField.type === 'single_choice' ||
              selectedField.type === 'multiple_choice') && (
              <div>
                <label className="block text-[12px] font-medium text-[var(--dp-on-surface-variant)] mb-1">
                  Options (one per line)
                </label>
                <textarea
                  rows={4}
                  value={(selectedField.options ?? []).join('\n')}
                  onChange={(e) =>
                    updateSelectedField({
                      options: e.target.value
                        .split('\n')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                  className={`${INPUT_BASE_CLASS} py-1.5 text-[13px]`}
                />
              </div>
            )}

            {selectedField.type === 'number' && (
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[12px] font-medium text-[var(--dp-on-surface-variant)] mb-1">
                    Min Value
                  </label>
                  <input
                    type="number"
                    value={selectedField.validation?.min ?? ''}
                    onChange={(e) =>
                      updateSelectedField({
                        validation: {
                          ...selectedField.validation,
                          min:
                            e.target.value === ''
                              ? undefined
                              : Number(e.target.value),
                        },
                      })
                    }
                    className={`${INPUT_BASE_CLASS} py-1.5 text-[13px] tabular-nums`}
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-[var(--dp-on-surface-variant)] mb-1">
                    Max Value
                  </label>
                  <input
                    type="number"
                    value={selectedField.validation?.max ?? ''}
                    onChange={(e) =>
                      updateSelectedField({
                        validation: {
                          ...selectedField.validation,
                          max:
                            e.target.value === ''
                              ? undefined
                              : Number(e.target.value),
                        },
                      })
                    }
                    className={`${INPUT_BASE_CLASS} py-1.5 text-[13px] tabular-nums`}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
