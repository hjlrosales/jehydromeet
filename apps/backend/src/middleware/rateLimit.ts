/**
 * In-Memory Rate Limiter
 *
 * Simple sliding-window rate limiter keyed by IP address.
 * Used for abuse guardrails: max rooms per IP per hour.
 *
 * Falls back gracefully if Redis is not available.
 */

interface BucketEntry {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, BucketEntry>();

// Cleanup stale entries every 5 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of buckets) {
    if (entry.resetAt <= now) {
      buckets.delete(key);
    }
  }
}, CLEANUP_INTERVAL_MS).unref();

/**
 * Check if an action is rate-limited.
 *
 * @param key - Unique key for the action (e.g., `create_room:<ip>`)
 * @param maxActions - Maximum number of actions allowed in the window
 * @param windowMs - Time window in milliseconds
 * @returns Object with `allowed` boolean, `remaining` count, and `resetAt` timestamp
 */
export function checkRateLimit(
  key: string,
  maxActions: number,
  windowMs: number = 3600_000
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    // First action or window expired — start a new window
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxActions - 1, resetAt: now + windowMs };
  }

  if (bucket.count >= maxActions) {
    return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
  }

  bucket.count += 1;
  return { allowed: true, remaining: maxActions - bucket.count, resetAt: bucket.resetAt };
}

/**
 * Express middleware factory for rate limiting by IP.
 *
 * @param getKey - Function to derive the rate limit key from the request
 * @param maxActions - Maximum actions in the time window
 * @param windowMs - Time window in milliseconds
 */
export function rateLimitMiddleware(
  getKey: (req: { ip?: string; headers: Record<string, string | string[] | undefined> }) => string,
  maxActions: number,
  windowMs: number = 3600_000
) {
  return (req: any, res: any, next: any) => {
    const key = getKey(req);
    const result = checkRateLimit(key, maxActions, windowMs);

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', maxActions);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, result.remaining));
    res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000));

    if (!result.allowed) {
      res.status(429).json({
        error: 'RATE_LIMITED',
        message: `Too many requests. Try again after ${new Date(result.resetAt).toISOString()}.`,
      });
      return;
    }

    next();
  };
}
