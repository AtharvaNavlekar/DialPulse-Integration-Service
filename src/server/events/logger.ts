const SENSITIVE_KEY_PATTERN =
  /secret|token|password|authorization|api_?key|aadhaar|aadhar|pan_?number|bank_?account|ifsc|salary|cvv|itr|kyc/i;

export function redactLogValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[TRUNCATED]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
      .replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, '[REDACTED_DSN]')
      .slice(0, 500);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => redactLogValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redactLogValue(v, depth + 1);
      }
    }
    return out;
  }
  return String(value);
}

export interface PipelineLogFields {
  event: string;
  level?: 'info' | 'warn' | 'error';
  workerId?: string;
  tenantId?: number;
  eventId?: string;
  correlationId?: string;
  eventType?: string;
  consumerName?: string;
  outboxId?: number;
  inboxId?: number;
  automationId?: number;
  automationExecutionId?: number;
  actionKey?: string;
  actionType?: string;
  attempt?: number;
  maxAttempts?: number;
  nextAvailableAt?: string;
  status?: string;
  reason?: string;
  [key: string]: unknown;
}

export function logPipelineEvent(fields: PipelineLogFields): void {
  const { level = 'info', event, ...rest } = fields;
  const payload = {
    timestamp: new Date().toISOString(),
    component: 'dialpulse-event-pipeline',
    level,
    event,
    ...(redactLogValue(rest) as Record<string, unknown>),
  };
  const serialized = JSON.stringify(payload);
  if (level === 'error') {
    console.error(serialized);
  } else if (level === 'warn') {
    console.warn(serialized);
  } else {
    console.info(serialized);
  }
}
