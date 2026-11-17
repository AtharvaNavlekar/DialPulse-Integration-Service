import type { Request, Response, NextFunction } from 'express';

interface BucketEntry {
  timestamps: number[];
}

export function createRateLimiter(options: {
  windowMs: number;
  maxRequests: number;
}) {
  const buckets = new Map<string, BucketEntry>();
  let calls = 0;

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    calls++;
    if (calls % 200 === 0) {
      for (const [bucketKey, bucket] of buckets.entries()) {
        const fresh = bucket.timestamps.filter((ts) => now - ts < options.windowMs);
        if (fresh.length === 0) {
          buckets.delete(bucketKey);
        } else {
          bucket.timestamps = fresh;
        }
      }
    }

    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const entry = buckets.get(key) ?? { timestamps: [] };
    entry.timestamps = entry.timestamps.filter((ts) => now - ts < options.windowMs);

    if (entry.timestamps.length >= options.maxRequests) {
      res.status(429).json({
        error: 'Too many submissions received. Please wait briefly before retrying.',
      });
      return;
    }

    entry.timestamps.push(now);
    buckets.set(key, entry);
    next();
  };
}
