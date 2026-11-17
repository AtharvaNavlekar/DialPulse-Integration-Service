import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.ts';
import { activityLogs, formSubmissions, forms } from '../../db/schema.ts';
import { buildAutomationEventId } from '../../shared/automation-engine.ts';
import { validateSubmissionAnswers } from '../../shared/forms-validation.ts';
import { logPipelineEvent } from '../events/logger.ts';
import { enqueueOutboxEvent } from '../events/outbox-repository.ts';
import { createRateLimiter } from '../middleware/rate-limit.ts';

const router = Router();
const publicSubmitLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 25,
});

router.get('/:slug', async (req, res) => {
  const slug = String(req.params.slug || '').trim();
  if (!slug) {
    res.status(404).json({ error: 'Published form not found.' });
    return;
  }

  try {
    const rows = await db
      .select({
        id: forms.id,
        slug: forms.slug,
        title: forms.title,
        description: forms.description,
        category: forms.category,
        fields: forms.fields,
        submitButtonLabel: forms.submitButtonLabel,
        successMessage: forms.successMessage,
      })
      .from(forms)
      .where(and(eq(forms.slug, slug), eq(forms.status, 'published')))
      .limit(1);

    if (!rows[0]) {
      res.status(404).json({ error: 'Published form not found.' });
      return;
    }

    res.json({ form: rows[0] });
  } catch (error) {
    console.error('Public form fetch failed:', error);
    res.status(500).json({ error: 'Unable to load form.' });
  }
});

const PublicSubmissionSchema = z.object({
  answers: z.record(z.string(), z.unknown()),
  idempotencyKey: z.string().min(4).max(128).optional(),
});

router.post('/:slug/submissions', publicSubmitLimiter, async (req, res) => {
  const slug = String(req.params.slug || '').trim();
  const parsed = PublicSubmissionSchema.safeParse(req.body);
  if (!slug || !parsed.success) {
    res.status(400).json({ error: 'Invalid submission request.' });
    return;
  }

  try {
    const rows = await db
      .select()
      .from(forms)
      .where(and(eq(forms.slug, slug), eq(forms.status, 'published')))
      .limit(1);

    const form = rows[0];
    if (!form) {
      res.status(404).json({ error: 'Published form not found.' });
      return;
    }

    const validation = validateSubmissionAnswers(
      form.fields,
      parsed.data.answers
    );
    if (!validation.valid) {
      res.status(400).json({
        error: 'Please review the highlighted form errors.',
        fieldErrors: validation.fieldErrors,
      });
      return;
    }

    const idempotencyKey = parsed.data.idempotencyKey || randomUUID();
    const correlationId = randomUUID();
    const summaryName = String(
      validation.sanitizedAnswers.full_name ||
        validation.sanitizedAnswers.email ||
        'Customer Submission'
    ).slice(0, 120);

    const txResult = await db.transaction(async (tx) => {
      const [submission] = await tx
        .insert(formSubmissions)
        .values({
          tenantId: form.tenantId,
          formId: form.id,
          idempotencyKey,
          source: 'public_form',
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
        tenantId: form.tenantId,
        idempotencyKey: `submission:${submission.id}:received`,
        actorUid: 'public:customer',
        actorLabel: summaryName,
        module: 'forms',
        action: 'submission.received',
        entityType: 'form_submission',
        entityId: String(submission.id),
        summary: `Public submission #${submission.id} received on "${form.title}".`,
        metadata: { formId: form.id, source: 'public_form', eventId },
      });

      await enqueueOutboxEvent(
        {
          tenantId: form.tenantId,
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
            actorUid: 'public:customer',
            actorLabel: summaryName,
            eventPayload: {
              formId: form.id,
              formTitle: form.title,
              submissionId: submission.id,
              source: 'public_form',
              answers: validation.sanitizedAnswers,
            },
          },
        },
        tx
      );

      return {
        duplicate: false as const,
        submissionId: submission.id,
        eventId,
      };
    });

    if (txResult.duplicate) {
      res.status(200).json({
        duplicate: true,
        successMessage: form.successMessage,
      });
      return;
    }

    logPipelineEvent({
      event: 'event_accepted',
      tenantId: form.tenantId,
      eventId: txResult.eventId,
      eventType: 'form_submitted',
      submissionId: txResult.submissionId,
      formId: form.id,
    });

    res.status(201).json({
      submissionId: txResult.submissionId,
      accepted: true,
      eventId: txResult.eventId,
      successMessage: form.successMessage,
    });
  } catch (error) {
    console.error('Public form submission failed:', error);
    res.status(500).json({ error: 'Unable to submit form right now.' });
  }
});

export default router;
