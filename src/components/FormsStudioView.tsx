import React, { useCallback, useEffect, useState } from 'react';
import { ExternalLink, FilePlus2, Globe, Undo2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { useToast } from '../context/ToastContext.tsx';
import { auth } from '../lib/firebase.ts';
import { STARTER_ENQUIRY_FIELDS } from '../shared/defaults.ts';
import { validateFormFieldsSafety } from '../shared/forms-validation.ts';
import { hasEffectivePermission } from '../shared/rbac.ts';
import type { FormSubTab } from '../shared/routes.ts';
import type {
  FormAnalyticsSummary,
  FormFieldDefinition,
  FormRecord,
  FormSubmissionRecord,
} from '../shared/types.ts';
import { FormAnalyticsView } from './forms/FormAnalyticsView.tsx';
import { FormBuilderView } from './forms/FormBuilderView.tsx';
import { FormPreviewView } from './forms/FormPreviewView.tsx';
import { FormsListView } from './forms/FormsListView.tsx';
import { SubmissionsInboxView } from './forms/SubmissionsInboxView.tsx';
import {
  AlertBanner,
  Button,
  ConfirmModal,
  PageHeader,
  SegmentedControl,
  StatusIndicator,
} from './ui/Primitives.tsx';

export function FormsStudioView({
  routeFormId,
  routeFormTab,
  onNavigateFormRoute,
}: {
  routeFormId: number | null;
  routeFormTab: FormSubTab;
  onNavigateFormRoute: (formId: number | null, formTab: FormSubTab) => void;
}) {
  const { apiFetch, session } = useAuth();
  const { pushToast } = useToast();

  const [formsList, setFormsList] = useState<FormRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [selectedForm, setSelectedForm] = useState<FormRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FormRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Builder draft state
  const [draftTitle, setDraftTitle] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [draftCategory, setDraftCategory] = useState('Lead Intake');
  const [draftSubmitLabel, setDraftSubmitLabel] = useState('Submit Enquiry');
  const [draftSuccessMessage, setDraftSuccessMessage] = useState(
    'Thank you. Your enquiry has been recorded.'
  );
  const [draftFields, setDraftFields] = useState<FormFieldDefinition[]>([]);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Submissions & Analytics state
  const [submissions, setSubmissions] = useState<FormSubmissionRecord[]>([]);
  const [subsLoading, setSubsLoading] = useState(false);
  const [analytics, setAnalytics] = useState<FormAnalyticsSummary | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  const canCreate = hasEffectivePermission(session?.permissions, 'canCreateForms');
  const canEdit = hasEffectivePermission(session?.permissions, 'canEditForms');
  const canPublish = hasEffectivePermission(session?.permissions, 'canPublishForms');
  const canDelete = hasEffectivePermission(session?.permissions, 'canDeleteForms');
  const canViewSubmissions = hasEffectivePermission(
    session?.permissions,
    'canViewSubmissions'
  );
  const canManage = canCreate || canEdit || canPublish || canDelete;
  const canExport = hasEffectivePermission(
    session?.permissions,
    'canExportSubmissions'
  );

  const hydrateDraft = useCallback((form: FormRecord) => {
    setSelectedForm(form);
    setDraftTitle(form.title);
    setDraftDescription(form.description);
    setDraftCategory(form.category);
    setDraftSubmitLabel(form.submitButtonLabel);
    setDraftSuccessMessage(form.successMessage);
    setDraftFields(structuredClone(form.fields));
    setSelectedFieldId(form.fields[0]?.id ?? null);
  }, []);

  const loadForms = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ forms: FormRecord[] }>('/api/forms');
      setFormsList(res.forms);
      return res.forms;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load forms.');
      return [];
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  const loadSubmissionsForForm = useCallback(
    async (formId: number) => {
      setSubsLoading(true);
      setError(null);
      try {
        const res = await apiFetch<{ submissions: FormSubmissionRecord[] }>(
          `/api/forms/${formId}/submissions`
        );
        setSubmissions(res.submissions);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to load submissions.'
        );
      } finally {
        setSubsLoading(false);
      }
    },
    [apiFetch]
  );

  const loadAnalyticsForForm = useCallback(
    async (formId: number) => {
      setAnalyticsLoading(true);
      setError(null);
      try {
        const res = await apiFetch<{ analytics: FormAnalyticsSummary }>(
          `/api/forms/${formId}/analytics`
        );
        setAnalytics(res.analytics);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to load analytics.'
        );
      } finally {
        setAnalyticsLoading(false);
      }
    },
    [apiFetch]
  );

  useEffect(() => {
    void loadForms();
  }, [loadForms, session?.activeTenant.tenantId]);

  useEffect(() => {
    if (!routeFormId || routeFormTab === 'list') {
      setSelectedForm(null);
      return;
    }
    const matched = formsList.find((f) => f.id === routeFormId);
    if (!matched) return;
    if (selectedForm?.id !== matched.id) {
      hydrateDraft(matched);
    }
    if (routeFormTab === 'submissions') {
      void loadSubmissionsForForm(matched.id);
    } else if (routeFormTab === 'analytics') {
      void loadAnalyticsForForm(matched.id);
    }
  }, [
    formsList,
    hydrateDraft,
    loadAnalyticsForForm,
    loadSubmissionsForForm,
    routeFormId,
    routeFormTab,
    selectedForm?.id,
  ]);

  const handleCreateNewForm = async () => {
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch<{ form: FormRecord }>('/api/forms', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Customer Enquiry Form',
          description: 'Synthetic customer enquiry intake form.',
          category: 'Lead Intake',
          submitButtonLabel: 'Submit Enquiry',
          successMessage: 'Thank you. Your synthetic enquiry has been recorded.',
          fields: STARTER_ENQUIRY_FIELDS.slice(0, 4),
        }),
      });
      await loadForms();
      hydrateDraft(res.form);
      onNavigateFormRoute(res.form.id, 'builder');
      setNotice('New draft form created.');
      pushToast('New draft form created.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create form.';
      setError(msg);
      pushToast(msg, 'error');
    }
  };

  const handleSaveBuilder = async () => {
    if (!selectedForm) return;
    setError(null);
    setNotice(null);

    const safetyErrors = validateFormFieldsSafety(draftFields);
    if (safetyErrors.length > 0) {
      setError(safetyErrors[0]!);
      return;
    }

    setSaving(true);
    try {
      const res = await apiFetch<{ form: FormRecord }>(
        `/api/forms/${selectedForm.id}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            title: draftTitle,
            description: draftDescription,
            category: draftCategory,
            submitButtonLabel: draftSubmitLabel,
            successMessage: draftSuccessMessage,
            fields: draftFields,
          }),
        }
      );
      setSelectedForm(res.form);
      await loadForms();
      setNotice('Form saved to PostgreSQL.');
      pushToast('Form changes saved.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save form.';
      setError(msg);
      pushToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDuplicate = async (form: FormRecord) => {
    setError(null);
    try {
      await apiFetch(`/api/forms/${form.id}/duplicate`, { method: 'POST' });
      await loadForms();
      const msg = `Duplicated "${form.title}".`;
      setNotice(msg);
      pushToast(msg);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to duplicate form.';
      setError(msg);
      pushToast(msg, 'error');
    }
  };

  const handlePublishToggle = async (form: FormRecord) => {
    setError(null);
    setNotice(null);
    const endpoint =
      form.status === 'published'
        ? `/api/forms/${form.id}/unpublish`
        : `/api/forms/${form.id}/publish`;
    try {
      const res = await apiFetch<{ form: FormRecord }>(endpoint, {
        method: 'POST',
      });
      await loadForms();
      if (selectedForm?.id === form.id) {
        setSelectedForm(res.form);
      }
      const msg =
        res.form.status === 'published'
          ? `Published "${res.form.title}". Public URL: /f/${res.form.slug}`
          : `Unpublished "${res.form.title}".`;
      setNotice(msg);
      pushToast(msg);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to change publish status.';
      setError(msg);
      pushToast(msg, 'error');
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setError(null);
    try {
      await apiFetch(`/api/forms/${deleteTarget.id}`, { method: 'DELETE' });
      await loadForms();
      if (selectedForm?.id === deleteTarget.id) {
        setSelectedForm(null);
        onNavigateFormRoute(null, 'list');
      }
      const msg = `Deleted "${deleteTarget.title}".`;
      setNotice(msg);
      pushToast(msg, 'info');
      setDeleteTarget(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete form.';
      setError(msg);
      pushToast(msg, 'error');
    } finally {
      setDeleting(false);
    }
  };

  const handleExportCsv = async () => {
    if (!selectedForm || !auth.currentUser || !session) return;
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch(
        `/api/forms/${selectedForm.id}/submissions/export.csv`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'x-tenant-id': String(session.activeTenant.tenantId),
          },
        }
      );
      if (!res.ok) throw new Error('CSV export failed.');
      const csvText = await res.text();
      const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${selectedForm.slug}-submissions.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice('Exported permitted fields to CSV.');
      pushToast('Exported permitted fields to CSV.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'CSV export failed.';
      setError(msg);
      pushToast(msg, 'error');
    }
  };

  const activeTab: FormSubTab =
    routeFormId && selectedForm ? routeFormTab : 'list';

  const studioTabOptions: Array<{ value: FormSubTab; label: string }> = [
    ...(canEdit ? [{ value: 'builder' as const, label: 'Builder & Settings' }] : []),
    { value: 'preview', label: 'Preview & Embed' },
    ...(canViewSubmissions
      ? [{ value: 'submissions' as const, label: 'Submissions' }]
      : []),
    { value: 'analytics', label: 'Analytics' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Forms Studio"
        description="Create, publish, preview, analyze, and collect synthetic enquiry submissions in PostgreSQL."
        actions={
          <>
            {activeTab !== 'list' && (
              <Button
                variant="secondary"
                onClick={() => {
                  onNavigateFormRoute(null, 'list');
                  void loadForms();
                }}
              >
                <Undo2 className="w-3.5 h-3.5" aria-hidden="true" />
                All Forms
              </Button>
            )}
            {canCreate && activeTab === 'list' && (
              <Button variant="primary" onClick={() => void handleCreateNewForm()}>
                <FilePlus2 className="w-4 h-4" aria-hidden="true" />
                Create Form
              </Button>
            )}
          </>
        }
      />

      {selectedForm && activeTab !== 'list' && (
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[var(--dp-outline-variant)]">
          <SegmentedControl
            options={studioTabOptions}
            value={activeTab}
            onChange={(tab) => {
              onNavigateFormRoute(selectedForm.id, tab);
            }}
          />

          <div className="flex flex-wrap items-center gap-2.5 text-[12px]">
            <StatusIndicator
              tone={selectedForm.status === 'published' ? 'success' : 'neutral'}
              label={
                selectedForm.status === 'published' ? 'Published' : 'Draft'
              }
            />
            {canPublish && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handlePublishToggle(selectedForm)}
              >
                <Globe className="w-3.5 h-3.5" aria-hidden="true" />
                {selectedForm.status === 'published' ? 'Unpublish' : 'Publish'}
              </Button>
            )}
            {selectedForm.status === 'published' && (
              <a
                href={`/f/${selectedForm.slug}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 h-8 px-3 text-[12px] font-medium text-[var(--dp-on-primary-container)] bg-[var(--dp-primary-container)] rounded-[var(--dp-radius-sm)] hover:opacity-90 whitespace-nowrap"
              >
                Public Form <ExternalLink className="w-3 h-3" aria-hidden="true" />
              </a>
            )}
          </div>
        </div>
      )}

      {notice && <AlertBanner tone="success" message={notice} />}
      {error && <AlertBanner tone="error" message={error} />}

      {activeTab === 'list' && (
        <FormsListView
          formsList={formsList}
          loading={loading}
          canManage={canManage}
          canCreate={canCreate}
          canEdit={canEdit}
          canPublish={canPublish}
          canDelete={canDelete}
          canViewSubmissions={canViewSubmissions}
          onCreateNew={() => void handleCreateNewForm()}
          onEdit={(form) => {
            hydrateDraft(form);
            onNavigateFormRoute(form.id, 'builder');
          }}
          onPreview={(form) => {
            hydrateDraft(form);
            onNavigateFormRoute(form.id, 'preview');
          }}
          onSubmissions={(form) => {
            hydrateDraft(form);
            onNavigateFormRoute(form.id, 'submissions');
          }}
          onAnalytics={(form) => {
            hydrateDraft(form);
            onNavigateFormRoute(form.id, 'analytics');
          }}
          onPublishToggle={(form) => void handlePublishToggle(form)}
          onDuplicate={(form) => void handleDuplicate(form)}
          onDeleteRequest={setDeleteTarget}
        />
      )}

      {activeTab === 'builder' && selectedForm && (
        <FormBuilderView
          selectedForm={selectedForm}
          draftTitle={draftTitle}
          setDraftTitle={setDraftTitle}
          draftDescription={draftDescription}
          setDraftDescription={setDraftDescription}
          draftCategory={draftCategory}
          setDraftCategory={setDraftCategory}
          draftSubmitLabel={draftSubmitLabel}
          setDraftSubmitLabel={setDraftSubmitLabel}
          draftSuccessMessage={draftSuccessMessage}
          setDraftSuccessMessage={setDraftSuccessMessage}
          draftFields={draftFields}
          setDraftFields={setDraftFields}
          selectedFieldId={selectedFieldId}
          setSelectedFieldId={setSelectedFieldId}
          saving={saving}
          onSave={() => void handleSaveBuilder()}
        />
      )}

      {activeTab === 'preview' && selectedForm && (
        <FormPreviewView
          form={selectedForm}
          title={draftTitle || selectedForm.title}
          description={draftDescription || selectedForm.description}
          fields={draftFields.length > 0 ? draftFields : selectedForm.fields}
          submitButtonLabel={draftSubmitLabel || selectedForm.submitButtonLabel}
          successMessage={draftSuccessMessage || selectedForm.successMessage}
          onSubmitPreview={async (answers, idempotencyKey) => {
            const res = await apiFetch<{
              successMessage: string;
              automationsTriggered?: Array<unknown>;
            }>(`/api/forms/${selectedForm.id}/preview-submit`, {
              method: 'POST',
              body: JSON.stringify({ answers, idempotencyKey }),
            });
            await loadForms();
            pushToast('Preview submission persisted to PostgreSQL.');
            return {
              successMessage: res.successMessage,
              automationsTriggeredCount: res.automationsTriggered?.length ?? 0,
            };
          }}
        />
      )}

      {activeTab === 'submissions' && selectedForm && (
        <SubmissionsInboxView
          form={selectedForm}
          submissions={submissions}
          loading={subsLoading}
          canExport={canExport}
          onExportCsv={() => void handleExportCsv()}
        />
      )}

      {activeTab === 'analytics' && selectedForm && (
        <FormAnalyticsView
          form={selectedForm}
          analytics={analytics}
          loading={analyticsLoading}
        />
      )}

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="Delete Form"
        description={`Are you sure you want to delete "${deleteTarget?.title ?? ''}" and all of its stored submissions? This cannot be undone.`}
        confirmLabel="Delete Form"
        busy={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
