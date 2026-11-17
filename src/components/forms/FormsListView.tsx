import React, { useMemo, useState } from 'react';
import { BarChart3, Copy, Eye, ListChecks, Pencil, Plus, Trash2 } from 'lucide-react';
import type { FormRecord } from '../../shared/types.ts';
import {
  Button,
  Card,
  INPUT_BASE_CLASS,
  SegmentedControl,
  StatusIndicator,
} from '../ui/Primitives.tsx';

const PAGE_SIZE = 10;

export function FormsListView({
  formsList,
  loading,
  canManage,
  canCreate = canManage,
  canEdit = canManage,
  canPublish = canManage,
  canDelete = canManage,
  canViewSubmissions = true,
  onCreateNew,
  onEdit,
  onPreview,
  onSubmissions,
  onAnalytics,
  onPublishToggle,
  onDuplicate,
  onDeleteRequest,
}: {
  formsList: FormRecord[];
  loading: boolean;
  canManage: boolean;
  canCreate?: boolean;
  canEdit?: boolean;
  canPublish?: boolean;
  canDelete?: boolean;
  canViewSubmissions?: boolean;
  onCreateNew: () => void;
  onEdit: (form: FormRecord) => void;
  onPreview: (form: FormRecord) => void;
  onSubmissions: (form: FormRecord) => void;
  onAnalytics: (form: FormRecord) => void;
  onPublishToggle: (form: FormRecord) => void;
  onDuplicate: (form: FormRecord) => void;
  onDeleteRequest: (form: FormRecord) => void;
}) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'published' | 'draft'>('all');
  const [page, setPage] = useState(1);

  const filteredForms = useMemo(() => {
    return formsList.filter((form) => {
      if (statusFilter !== 'all' && form.status !== statusFilter) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        form.title.toLowerCase().includes(q) ||
        form.category.toLowerCase().includes(q) ||
        form.slug.toLowerCase().includes(q)
      );
    });
  }, [formsList, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredForms.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedForms = filteredForms.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <SegmentedControl
          options={[
            { value: 'all', label: 'All' },
            { value: 'published', label: 'Published' },
            { value: 'draft', label: 'Draft' },
          ]}
          value={statusFilter}
          onChange={(val) => {
            setStatusFilter(val);
            setPage(1);
          }}
        />

        <input
          type="search"
          aria-label="Search forms"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search forms by title, category, slug..."
          className={`${INPUT_BASE_CLASS} w-full sm:w-72 py-1.5 text-[13px]`}
        />
      </div>

      <Card className="overflow-hidden">
        {loading ? (
          <div className="p-8 text-[13px] text-[var(--dp-on-surface-variant)]">
            Loading forms...
          </div>
        ) : filteredForms.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <p className="text-[14px] font-medium text-[var(--dp-on-surface)]">
              No forms found
            </p>
            <p className="text-[12px] text-[var(--dp-on-surface-variant)]">
              Create your first synthetic customer enquiry form to get started.
            </p>
            {canCreate && (
              <Button variant="primary" onClick={onCreateNew}>
                <Plus className="w-4 h-4" aria-hidden="true" /> Create Form
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <thead className="bg-[var(--dp-surface-container-low)] border-b border-[var(--dp-outline-variant)] text-[var(--dp-on-surface-variant)]">
                  <tr>
                    <th className="py-3 px-4 font-medium">Form Title</th>
                    <th className="py-3 px-4 font-medium">Status</th>
                    <th className="py-3 px-4 font-medium text-right">Fields</th>
                    <th className="py-3 px-4 font-medium text-right">Submissions</th>
                    <th className="py-3 px-4 font-medium">Updated</th>
                    <th className="py-3 px-4 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--dp-outline-variant)]">
                  {pagedForms.map((form) => (
                    <tr
                      key={form.id}
                      className="hover:bg-[var(--dp-surface-variant)]/50 transition-colors duration-150"
                    >
                      <td className="py-3 px-4">
                        <div className="font-semibold text-[var(--dp-on-surface)] text-[14px]">
                          {form.title}
                        </div>
                        <div className="text-[var(--dp-on-surface-variant)] mt-0.5 text-[12px]">
                          {form.category} ·{' '}
                          <span className="font-mono">/f/{form.slug}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <StatusIndicator
                          tone={form.status === 'published' ? 'success' : 'neutral'}
                          label={form.status === 'published' ? 'Published' : 'Draft'}
                        />
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-[var(--dp-on-surface)]">
                        {form.fields.length}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-[var(--dp-on-surface)] font-semibold">
                        {form.submissionCount ?? 0}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-[var(--dp-on-surface-variant)] whitespace-nowrap">
                        {new Date(form.updatedAt).toLocaleDateString()}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end gap-1.5">
                          {canEdit && (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => onEdit(form)}
                              title="Edit form"
                            >
                              <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                              Edit
                            </Button>
                          )}
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => onPreview(form)}
                          >
                            <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                            Preview
                          </Button>
                          {canViewSubmissions && (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => onSubmissions(form)}
                            >
                              <ListChecks className="w-3.5 h-3.5" aria-hidden="true" />
                              Responses
                            </Button>
                          )}
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => onAnalytics(form)}
                          >
                            <BarChart3 className="w-3.5 h-3.5" aria-hidden="true" />
                            Analytics
                          </Button>
                          {canPublish && (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => onPublishToggle(form)}
                            >
                              {form.status === 'published' ? 'Unpublish' : 'Publish'}
                            </Button>
                          )}
                          {canCreate && (
                            <button
                              type="button"
                              aria-label={`Duplicate ${form.title}`}
                              title={`Duplicate ${form.title}`}
                              onClick={() => onDuplicate(form)}
                              className="h-8 w-8 inline-flex items-center justify-center text-[var(--dp-on-surface-variant)] hover:text-[var(--dp-on-surface)] hover:bg-[var(--dp-surface-variant)] border border-[var(--dp-outline-variant)] rounded-[var(--dp-radius-sm)] transition-colors duration-150 cursor-pointer"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              aria-label={`Delete ${form.title}`}
                              title={`Delete ${form.title}`}
                              onClick={() => onDeleteRequest(form)}
                              className="h-8 w-8 inline-flex items-center justify-center text-[var(--dp-on-surface-variant)] hover:text-[var(--dp-error)] hover:bg-[var(--dp-error-container)]/50 border border-[var(--dp-outline-variant)] rounded-[var(--dp-radius-sm)] transition-colors duration-150 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="px-4 py-3 border-t border-[var(--dp-outline-variant)] flex items-center justify-between text-[12px]">
                <span className="text-[var(--dp-on-surface-variant)] tabular-nums">
                  Page {currentPage} of {totalPages} ({filteredForms.length} forms)
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={currentPage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={currentPage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
