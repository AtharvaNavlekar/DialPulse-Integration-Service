import React, { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { usePreferences } from '../../context/PreferencesContext.tsx';
import type { FormRecord, FormSubmissionRecord } from '../../shared/types.ts';
import {
  Button,
  Card,
  INPUT_BASE_CLASS,
  SegmentedControl,
  StatusIndicator,
} from '../ui/Primitives.tsx';

const PAGE_SIZE = 15;

export function SubmissionsInboxView({
  form,
  submissions,
  loading,
  canExport,
  onExportCsv,
}: {
  form: FormRecord;
  submissions: FormSubmissionRecord[];
  loading: boolean;
  canExport: boolean;
  onExportCsv: () => void;
}) {
  const { formatTimestamp } = usePreferences();
  const [subSearch, setSubSearch] = useState('');
  const [subSourceFilter, setSubSourceFilter] = useState<
    'all' | 'public_form' | 'preview_test'
  >('all');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [page, setPage] = useState(1);

  const filteredSubmissions = useMemo(() => {
    return submissions.filter((sub) => {
      if (subSourceFilter !== 'all' && sub.source !== subSourceFilter) return false;
      if (!subSearch.trim()) return true;
      const q = subSearch.toLowerCase();
      return (
        sub.submitterSummary.toLowerCase().includes(q) ||
        JSON.stringify(sub.answers).toLowerCase().includes(q)
      );
    });
  }, [submissions, subSearch, subSourceFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredSubmissions.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedSubmissions = filteredSubmissions.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  const selectedSubmission =
    filteredSubmissions.find((s) => s.id === selectedId) ??
    pagedSubmissions[0] ??
    null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <SegmentedControl
          options={[
            { value: 'all', label: 'All Sources' },
            { value: 'public_form', label: 'Public Form' },
            { value: 'preview_test', label: 'Preview Test' },
          ]}
          value={subSourceFilter}
          onChange={(val) => {
            setSubSourceFilter(val);
            setPage(1);
          }}
        />

        <div className="flex items-center gap-2">
          <input
            type="search"
            aria-label="Search submissions"
            value={subSearch}
            onChange={(e) => {
              setSubSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search submissions..."
            className={`${INPUT_BASE_CLASS} w-56 py-1.5 text-[13px]`}
          />
          {canExport && (
            <Button
              variant="primary"
              size="sm"
              onClick={onExportCsv}
              disabled={submissions.length === 0}
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              Export CSV
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <Card className="lg:col-span-7 overflow-hidden">
          {loading ? (
            <div className="p-8 text-[13px] text-[var(--dp-on-surface-variant)]">
              Loading submissions...
            </div>
          ) : filteredSubmissions.length === 0 ? (
            <div className="p-8 text-center text-[13px] text-[var(--dp-on-surface-variant)]">
              No submissions found for &ldquo;{form.title}&rdquo;.
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12px]">
                  <thead className="bg-[var(--dp-surface-container-low)] border-b border-[var(--dp-outline-variant)] text-[var(--dp-on-surface-variant)]">
                    <tr>
                      <th className="py-2.5 px-4 font-medium">ID</th>
                      <th className="py-2.5 px-4 font-medium">Submitter</th>
                      <th className="py-2.5 px-4 font-medium">Source</th>
                      <th className="py-2.5 px-4 font-medium">Submitted</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--dp-outline-variant)]">
                    {pagedSubmissions.map((sub) => {
                      const active = selectedSubmission?.id === sub.id;
                      return (
                        <tr
                          key={sub.id}
                          onClick={() => setSelectedId(sub.id)}
                          className={`cursor-pointer transition-colors duration-150 ${
                            active
                              ? 'bg-[var(--dp-primary-container)]/35'
                              : 'hover:bg-[var(--dp-surface-variant)]/50'
                          }`}
                        >
                          <td className="py-2.5 px-4 font-mono tabular-nums text-[var(--dp-on-surface-variant)]">
                            #{sub.id}
                          </td>
                          <td className="py-2.5 px-4 font-medium text-[var(--dp-on-surface)]">
                            {sub.submitterSummary || 'Submission'}
                          </td>
                          <td className="py-2.5 px-4">
                            <StatusIndicator
                              tone={
                                sub.source === 'public_form' ? 'success' : 'neutral'
                              }
                              label={sub.source}
                            />
                          </td>
                          <td className="py-2.5 px-4 font-mono tabular-nums text-[var(--dp-on-surface-variant)] whitespace-nowrap">
                            {formatTimestamp(sub.createdAt)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="px-4 py-3 border-t border-[var(--dp-outline-variant)] flex items-center justify-between text-[12px]">
                  <span className="text-[var(--dp-on-surface-variant)] tabular-nums">
                    Page {currentPage} of {totalPages}
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

        <Card className="lg:col-span-5 p-5 space-y-4">
          <h2 className="text-[16px] font-semibold text-[var(--dp-on-surface)]">
            Submission Details
          </h2>
          {!selectedSubmission ? (
            <p className="text-[13px] text-[var(--dp-on-surface-variant)] py-6 text-center">
              Select a submission row to inspect submitted answers.
            </p>
          ) : (
            <div className="space-y-3 text-[13px]">
              <div className="flex items-center justify-between text-[12px] text-[var(--dp-on-surface-variant)] border-b border-[var(--dp-outline-variant)] pb-2 font-mono tabular-nums">
                <span>ID #{selectedSubmission.id}</span>
                <span>{formatTimestamp(selectedSubmission.createdAt)}</span>
              </div>
              <dl className="space-y-2.5">
                {Object.entries(selectedSubmission.answers).map(([key, val]) => {
                  const fieldLabel =
                    form.fields.find((f) => f.key === key)?.label || key;
                  return (
                    <div
                      key={key}
                      className="border-b border-[var(--dp-outline-variant)] pb-2"
                    >
                      <dt className="text-[12px] font-medium text-[var(--dp-on-surface-variant)]">
                        {fieldLabel}
                      </dt>
                      <dd className="text-[var(--dp-on-surface)] mt-0.5 break-words">
                        {Array.isArray(val)
                          ? val.join(', ')
                          : typeof val === 'boolean'
                            ? val
                              ? 'Yes'
                              : 'No'
                            : String(val ?? '—') || '—'}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
