import { Router, type RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.ts';
import { activityLogs, formSubmissions, forms } from '../../db/schema.ts';
import {
  buildSubmissionsCsv,
  validateFormFieldsSafety,
  validateSubmissionAnswers,
} from '../../shared/forms-validation.ts';
import { computeFormAnalytics } from '../../shared/form-analytics.ts';
import type { FormFieldDefinition } from '../../shared/types.ts';
import { buildAutomationEventId } from '../../shared/automation-engine.ts';
import {
  requireAuth,
  requirePermission,
  type AuthRequest,
} from '../middleware/auth.ts';
import { requireAppEnabled } from '../services/app-management-service.ts';
import { enqueueOutboxEvent } from '../events/outbox-repository.ts';

export function createFormsRouter(
  authMiddleware: RequestHandler = requireAuth
) {
  const router = Router();
  router.use(authMiddleware);
  router.use(requireAppEnabled('forms-studio'));

const FormFieldSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  type: z.enum([
    'short_text',
    'long_text',
    'email',
    'phone',
    'number',
    'dropdown',
    'single_choice',
    'multiple_choice',
    'date',
    'checkbox',
  ]),
  label: z.string().min(1),
  helpText: z.string().optional(),
  placeholder: z.string().optional(),
  required: z.boolean(),
  options: z.array(z.string()).optional(),
  validation: z
    .object({
      minLength: z.number().int().min(0).optional(),
      maxLength: z.number().int().min(1).optional(),
      min: z.number().optional(),
      max: z.number().optional(),
      pattern: z.string().optional(),
    })
    .optional(),
});

const FormUpsertSchema = z.object({
  title: z.string().min(2).max(120),
  description: z.string().max(500).default(''),
  category: z.string().min(1).max(80).default('Lead Intake'),
  submitButtonLabel: z.string().min(1).max(60).default('Submit Enquiry'),
  successMessage: z
    .string()
    .min(1)
    .max(300)
    .default('Thank you. Your enquiry has been recorded.'),
  fields: z.array(FormFieldSchema).default([]),
});

function slugifyTitle(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const suffix = randomUUID().slice(0, 6);
  return `${base || 'form'}-${suffix}`;
}

router.get('/', requirePermission('canViewForms'), async (req: AuthRequest, res) => {
  try {
    const tenantId = req.authContext!.activeMembership.tenantId;
    const rows = await db
      .select({
        form: forms,
        submissionCount: sql<number>`cast(count(${formSubmissions.id}) as int)`,
      })
      .from(forms)
      .leftJoin(formSubmissions, eq(formSubmissions.formId, forms.id))
      .where(eq(forms.tenantId, tenantId))
      .groupBy(forms.id)
      .orderBy(desc(forms.updatedAt));

    res.json({
      forms: rows.map((r) => ({
        ...r.form,
        submissionCount: Number(r.submissionCount ?? 0),
      })),
    });
  } catch (error) {
    console.error('Forms list failed:', error);
    res.status(500).json({ error: 'Failed to load forms.' });
  }
});

router.post('/', requirePermission('canCreateForms'), async (req: AuthRequest, res) => {
  const parsed = FormUpsertSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid form definition.' });
    return;
  }

  const safetyErrors = validateFormFieldsSafety(
    parsed.data.fields as FormFieldDefinition[]
  );
  if (safetyErrors.length > 0) {
    res.status(400).json({ error: safetyErrors[0], details: safetyErrors });
    return;
  }

  try {
    const ctx = req.authContext!;
    const tenantId = ctx.activeMembership.tenantId;
    const [created] = await db
      .insert(forms)
      .values({
        tenantId,
        slug: slugifyTitle(parsed.data.title),
        title: parsed.data.title.trim(),
        description: parsed.data.description.trim(),
        category: parsed.data.category.trim(),
        status: 'draft',
        fields: parsed.data.fields as FormFieldDefinition[],
        submitButtonLabel: parsed.data.submitButtonLabel.trim(),
        successMessage: parsed.data.successMessage.trim(),
        createdByUid: ctx.user.uid,
      })
      .returning();

    await db.insert(activityLogs).values({
      tenantId,
      actorUid: ctx.user.uid,
      actorLabel: ctx.user.displayName,
      module: 'forms',
      action: 'form.created',
      entityType: 'form',
      entityId: String(created!.id),
      summary: `Created form "${created!.title}".`,
      metadata: { fieldCount: created!.fields.length },
    });

    res.status(201).json({ form: { ...created!, submissionCount: 0 } });
  } catch (error) {
    console.error('Form creation failed:', error);
    res.status(500).json({ error: 'Failed to create form.' });
  }
});

router.put('/:id', requirePermission('canEditForms'), async (req: AuthRequest, res) => {
  const formId = Number(req.params.id);
  const parsed = FormUpsertSchema.safeParse(req.body);
  if (!Number.isInteger(formId) || !parsed.success) {
    res.status(400).json({ error: 'Invalid form update payload.' });
    return;
  }

  const safetyErrors = validateFormFieldsSafety(
    parsed.data.fields as FormFieldDefinition[]
  );
  if (safetyErrors.length > 0) {
    res.status(400).json({ error: safetyErrors[0], details: safetyErrors });
    return;
  }

  try {
    const ctx = req.authContext!;
    const tenantId = ctx.activeMembership.tenantId;
    const [updated] = await db
      .update(forms)
      .set({
        title: parsed.data.title.trim(),
        description: parsed.data.description.trim(),
        category: parsed.data.category.trim(),
        submitButtonLabel: parsed.data.submitButtonLabel.trim(),
        successMessage: parsed.data.successMessage.trim(),
        fields: parsed.data.fields as FormFieldDefinition[],
        updatedAt: new Date(),
      })
      .where(and(eq(forms.id, formId), eq(forms.tenantId, tenantId)))
      .returning();

    if (!updated) {
      res.status(404).json({ error: 'Form not found.' });
      return;
    }

    await db.insert(activityLogs).values({
      tenantId,
      actorUid: ctx.user.uid,
      actorLabel: ctx.user.displayName,
      module: 'forms',
      action: 'form.updated',
      entityType: 'form',
      entityId: String(updated.id),
      summary: `Updated form "${updated.title}" (${updated.fields.length} fields).`,
      metadata: { fieldCount: updated.fields.length },
    });

    res.json({ form: updated });
  } catch (error) {
    console.error('Form update failed:', error);
    res.status(500).json({ error: 'Failed to update form.' });
  }
});

router.post('/:id/duplicate', requirePermission('canCreateForms'), async (req: AuthRequest, res) => {
  const formId = Number(req.params.id);
  if (!Number.isInteger(formId)) {
    res.status(400).json({ error: 'Invalid form ID.' });
    return;
  }

  try {
    const ctx = req.authContext!;
    const tenantId = ctx.activeMembership.tenantId;
    const existingRows = await db
      .select()
      .from(forms)
      .where(and(eq(forms.id, formId), eq(forms.tenantId, tenantId)))
      .limit(1);

    const existing = existingRows[0];
    if (!existing) {
      res.status(404).json({ error: 'Form not found.' });
      return;
    }

    const copyTitle = `${existing.title} (Copy)`;
    const [duplicated] = await db
      .insert(forms)
      .values({
        tenantId,
        slug: slugifyTitle(copyTitle),
        title: copyTitle,
        description: existing.description,
        category: existing.category,
        status: 'draft',
        fields: existing.fields,
        submitButtonLabel: existing.submitButtonLabel,
        successMessage: existing.successMessage,
        createdByUid: ctx.user.uid,
      })
      .returning();

    await db.insert(activityLogs).values({
      tenantId,
      actorUid: ctx.user.uid,
      actorLabel: ctx.user.displayName,
      module: 'forms',
      action: 'form.duplicated',
      entityType: 'form',
      entityId: String(duplicated!.id),
      summary: `Duplicated "${existing.title}" as "${duplicated!.title}".`,
      metadata: { sourceFormId: existing.id },
    });

    res.status(201).json({ form: { ...duplicated!, submissionCount: 0 } });
  } catch (error) {
    console.error('Form duplication failed:', error);
    res.status(500).json({ error: 'Failed to duplicate form.' });
  }
});

router.post('/:id/publish', requirePermission('canPublishForms'), async (req: AuthRequest, res) => {
  const formId = Number(req.params.id);
  if (!Number.isInteger(formId)) {
    res.status(400).json({ error: 'Invalid form ID.' });
    return;
  }

  try {
    const ctx = req.authContext!;
    const tenantId = ctx.activeMembership.tenantId;
    const existingRows = await db
      .select()
      .from(forms)
      .where(and(eq(forms.id, formId), eq(forms.tenantId, tenantId)))
      .limit(1);

    const existing = existingRows[0];
    if (!existing) {
      res.status(404).json({ error: 'Form not found.' });
      return;
    }
    if (existing.fields.length === 0) {
      res.status(400).json({ error: 'Add at least one field before publishing.' });
      return;
    }

    const safetyErrors = validateFormFieldsSafety(existing.fields);
    if (safetyErrors.length > 0) {
      res.status(400).json({ error: safetyErrors[0] });
      return;
    }

    const [updated] = await db
      .update(forms)
      .set({
        status: 'published',
        publishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(forms.id, formId), eq(forms.tenantId, tenantId)))
      .returning();

    await db.insert(activityLogs).values({
      tenantId,
      actorUid: ctx.user.uid,
      actorLabel: ctx.user.displayName,
      module: 'forms',
      action: 'form.published',
      entityType: 'form',
      entityId: String(updated!.id),
      summary: `Published form "${updated!.title}".`,
      metadata: { slug: updated!.slug },
    });

    res.json({ form: updated });
  } catch (error) {
    console.error('Form publish failed:', error);
    res.status(500).json({ error: 'Failed to publish form.' });
  }
});

router.post('/:id/unpublish', requirePermission('canPublishForms'), async (req: AuthRequest, res) => {
  const formId = Number(req.params.id);
  if (!Number.isInteger(formId)) {
    res.status(400).json({ error: 'Invalid form ID.' });
    return;
  }

  try {
    const ctx = req.authContext!;
    const tenantId = ctx.activeMembership.tenantId;
    const [updated] = await db
      .update(forms)
      .set({
        status: 'draft',
        updatedAt: new Date(),
      })
      .where(and(eq(forms.id, formId), eq(forms.tenantId, tenantId)))
      .returning();

    if (!updated) {
      res.status(404).json({ error: 'Form not found.' });
      return;
    }

    await db.insert(activityLogs).values({
      tenantId,
      actorUid: ctx.user.uid,
      actorLabel: ctx.user.displayName,
      module: 'forms',
      action: 'form.unpublished',
      entityType: 'form',
      entityId: String(updated.id),
      summary: `Unpublished form "${updated.title}".`,
      metadata: {},
    });

    res.json({ form: updated });
  } catch (error) {
    console.error('Form unpublish failed:', error);
    res.status(500).json({ error: 'Failed to unpublish form.' });
  }
});

router.delete('/:id', requirePermission('canDeleteForms'), async (req: AuthRequest, res) => {
  const formId = Number(req.params.id);
  if (!Number.isInteger(formId)) {
    res.status(400).json({ error: 'Invalid form ID.' });
    return;
  }

  try {
    const ctx = req.authContext!;
    const tenantId = ctx.activeMembership.tenantId;
    const [deleted] = await db
      .delete(forms)
      .where(and(eq(forms.id, formId), eq(forms.tenantId, tenantId)))
      .returning();

    if (!deleted) {
      res.status(404).json({ error: 'Form not found.' });
      return;
    }

    await db.insert(activityLogs).values({
      tenantId,
      actorUid: ctx.user.uid,
      actorLabel: ctx.user.displayName,
      module: 'forms',
      action: 'form.deleted',
      entityType: 'form',
      entityId: String(deleted.id),
      summary: `Deleted form "${deleted.title}".`,
      metadata: {},
    });

    res.json({ deletedId: deleted.id });
  } catch (error) {
    console.error('Form deletion failed:', error);
    res.status(500).json({ error: 'Failed to delete form.' });
  }
});

router.get('/:id/submissions', requirePermission('canViewSubmissions'), async (req: AuthRequest, res) => {
  const formId = Number(req.params.id);
  if (!Number.isInteger(formId)) {
    res.status(400).json({ error: 'Invalid form ID.' });
    return;
  }

  try {
    const tenantId = req.authContext!.activeMembership.tenantId;
    const formRows = await db
      .select()
      .from(forms)
      .where(and(eq(forms.id, formId), eq(forms.tenantId, tenantId)))
      .limit(1);

    if (formRows.length === 0) {
      res.status(404).json({ error: 'Form not found.' });
      return;
    }

    const submissions = await db
      .select()
      .from(formSubmissions)
      .where(
        and(
          eq(formSubmissions.formId, formId),
          eq(formSubmissions.tenantId, tenantId)
        )
      )
      .orderBy(desc(formSubmissions.createdAt))
      .limit(200);

    res.json({ form: formRows[0], submissions });
  } catch (error) {
    console.error('Submissions list failed:', error);
    res.status(500).json({ error: 'Failed to load submissions.' });
  }
});

router.get('/:id/analytics', requirePermission('canViewForms'), async (req: AuthRequest, res) => {
  const formId = Number(req.params.id);
  if (!Number.isInteger(formId)) {
    res.status(400).json({ error: 'Invalid form ID.' });
    return;
  }

  try {
    const tenantId = req.authContext!.activeMembership.tenantId;
    const formRows = await db
      .select()
      .from(forms)
      .where(and(eq(forms.id, formId), eq(forms.tenantId, tenantId)))
      .limit(1);

    const form = formRows[0];
    if (!form) {
      res.status(404).json({ error: 'Form not found.' });
      return;
    }

    const submissions = await db
      .select({
        source: formSubmissions.source,
        answers: formSubmissions.answers,
        createdAt: formSubmissions.createdAt,
      })
      .from(formSubmissions)
      .where(
        and(
          eq(formSubmissions.formId, formId),
          eq(formSubmissions.tenantId, tenantId)
        )
      );

    const analytics = computeFormAnalytics(form.id, form.fields, submissions);
    res.json({ form, analytics });
  } catch (error) {
    console.error('Form analytics failed:', error);
    res.status(500).json({ error: 'Failed to compute form analytics.' });
  }
});

router.get(
  '/:id/submissions/export.csv',
  requirePermission('canExportSubmissions'),
  async (req: AuthRequest, res) => {
    const formId = Number(req.params.id);
    if (!Number.isInteger(formId)) {
      res.status(400).json({ error: 'Invalid form ID.' });
      return;
    }

    try {
      const ctx = req.authContext!;
      const tenantId = ctx.activeMembership.tenantId;
      const formRows = await db
        .select()
        .from(forms)
        .where(and(eq(forms.id, formId), eq(forms.tenantId, tenantId)))
        .limit(1);

      const form = formRows[0];
      if (!form) {
        res.status(404).json({ error: 'Form not found.' });
        return;
      }

      const submissions = await db
        .select()
        .from(formSubmissions)
        .where(
          and(
            eq(formSubmissions.formId, formId),
            eq(formSubmissions.tenantId, tenantId)
          )
        )
        .orderBy(desc(formSubmissions.createdAt));

      const csv = buildSubmissionsCsv(
        form.fields,
        submissions.map((s) => ({
          id: s.id,
          source: s.source,
          createdAt: s.createdAt.toISOString(),
          answers: s.answers,
        }))
      );

      await db.insert(activityLogs).values({
        tenantId,
        actorUid: ctx.user.uid,
        actorLabel: ctx.user.displayName,
        module: 'forms',
        action: 'submissions.exported_csv',
        entityType: 'form',
        entityId: String(form.id),
        summary: `Exported ${submissions.length} submissions for "${form.title}" to CSV.`,
        metadata: { count: submissions.length },
      });

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${form.slug}-submissions.csv"`
      );
      res.send(csv);
    } catch (error) {
      console.error('CSV export failed:', error);
      res.status(500).json({ error: 'Failed to export CSV.' });
    }
  }
);

const PreviewSubmitSchema = z.object({
  answers: z.record(z.string(), z.unknown()),
  idempotencyKey: z.string().min(4).max(128).optional(),
});

router.post('/:id/preview-submit', requirePermission('canViewForms'), async (req: AuthRequest, res) => {
  const formId = Number(req.params.id);
  const parsed = PreviewSubmitSchema.safeParse(req.body);
  if (!Number.isInteger(formId) || !parsed.success) {
    res.status(400).json({ error: 'Invalid preview submission payload.' });
    return;
  }

  try {
    const ctx = req.authContext!;
    const tenantId = ctx.activeMembership.tenantId;
    const formRows = await db
      .select()
      .from(forms)
      .where(and(eq(forms.id, formId), eq(forms.tenantId, tenantId)))
      .limit(1);

    const form = formRows[0];
    if (!form) {
      res.status(404).json({ error: 'Form not found.' });
      return;
    }

    const validation = validateSubmissionAnswers(
      form.fields,
      parsed.data.answers
    );
    if (!validation.valid) {
      res.status(400).json({
        error: 'Please review the highlighted fields.',
        fieldErrors: validation.fieldErrors,
      });
      return;
    }

    const idempotencyKey = parsed.data.idempotencyKey || randomUUID();
    const correlationId = randomUUID();
    const summaryName = String(
      validation.sanitizedAnswers.full_name ||
        validation.sanitizedAnswers.email ||
        'Preview Submission'
    ).slice(0, 120);

    const txResult = await db.transaction(async (tx) => {
      const [submission] = await tx
        .insert(formSubmissions)
        .values({
          tenantId,
          formId: form.id,
          idempotencyKey,
          source: 'preview_test',
          answers: validation.sanitizedAnswers,
          submitterSummary: summaryName,
        })
        .onConflictDoNothing({
          target: [formSubmissions.formId, formSubmissions.idempotencyKey],
        })
        .returning();

      if (!submission) {
        return { duplicate: true as const };
      }

      const eventId = buildAutomationEventId(
        'form_submitted',
        'form_submission',
        submission.id
      );

      await tx.insert(activityLogs).values({
        tenantId,
        idempotencyKey: `submission:${submission.id}:received`,
        actorUid: ctx.user.uid,
        actorLabel: ctx.user.displayName,
        module: 'forms',
        action: 'submission.received',
        entityType: 'form_submission',
        entityId: String(submission.id),
        summary: `Preview submission #${submission.id} stored for "${form.title}".`,
        metadata: { formId: form.id, source: 'preview_test', eventId },
      });

      await enqueueOutboxEvent(
        {
          tenantId,
          eventId,
          schemaVersion: '1.0',
          eventType: 'form_submitted',
          aggregateType: 'form_submission',
          aggregateId: String(submission.id),
          correlationId,
          payload: {
            sourceEntityType: 'form_submission',
            sourceEntityId: submission.id,
            formId: form.id,
            actorUid: ctx.user.uid,
            actorLabel: ctx.user.displayName,
            eventPayload: {
              formId: form.id,
              formTitle: form.title,
              submissionId: submission.id,
              source: 'preview_test',
              answers: validation.sanitizedAnswers,
            },
          },
        },
        tx
      );

      return { duplicate: false as const, submission, eventId };
    });

    if (txResult.duplicate) {
      res.status(200).json({
        duplicate: true,
        message: 'Duplicate submission ignored safely.',
      });
      return;
    }

    res.status(201).json({
      submission: txResult.submission,
      accepted: true,
      eventId: txResult.eventId,
      successMessage: form.successMessage,
      automationsTriggered: [],
    });
  } catch (error) {
    console.error('Preview submit failed:', error);
    res.status(500).json({ error: 'Failed to submit form preview.' });
  }
});

  return router;
}

export default createFormsRouter();
