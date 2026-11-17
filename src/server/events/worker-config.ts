import { z } from 'zod';

export interface EventWorkerConfig {
  enabled: boolean;
  pollIntervalMs: number;
  batchSize: number;
  maxConcurrency: number;
  leaseDurationMs: number;
}

const WorkerEnvSchema = z.object({
  EVENT_WORKER_ENABLED: z.enum(['true', 'false']).optional(),
  EVENT_WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(200).max(300_000).optional(),
  EVENT_WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(100).optional(),
  EVENT_WORKER_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(20).optional(),
  EVENT_WORKER_LEASE_MS: z.coerce.number().int().min(5_000).max(3_600_000).optional(),
});

export function loadEventWorkerConfig(
  env: Record<string, string | undefined> = process.env
): EventWorkerConfig {
  const parsed = WorkerEnvSchema.safeParse({
    EVENT_WORKER_ENABLED: env.EVENT_WORKER_ENABLED,
    EVENT_WORKER_POLL_INTERVAL_MS: env.EVENT_WORKER_POLL_INTERVAL_MS,
    EVENT_WORKER_BATCH_SIZE: env.EVENT_WORKER_BATCH_SIZE,
    EVENT_WORKER_MAX_CONCURRENCY: env.EVENT_WORKER_MAX_CONCURRENCY,
    EVENT_WORKER_LEASE_MS: env.EVENT_WORKER_LEASE_MS,
  });

  if (!parsed.success) {
    throw new Error(
      `Invalid event worker configuration: ${parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`
    );
  }

  const isTestEnv = env.NODE_ENV === 'test';
  const defaultEnabled = !isTestEnv;

  return {
    enabled:
      parsed.data.EVENT_WORKER_ENABLED !== undefined
        ? parsed.data.EVENT_WORKER_ENABLED === 'true'
        : defaultEnabled,
    pollIntervalMs: parsed.data.EVENT_WORKER_POLL_INTERVAL_MS ?? 2_000,
    batchSize: parsed.data.EVENT_WORKER_BATCH_SIZE ?? 10,
    maxConcurrency: parsed.data.EVENT_WORKER_MAX_CONCURRENCY ?? 3,
    leaseDurationMs: parsed.data.EVENT_WORKER_LEASE_MS ?? 60_000,
  };
}
