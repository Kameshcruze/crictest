import type { Request, Response, NextFunction } from 'express';

export interface ActionRateLimitOptions {
  /** Minimum cooldown window in milliseconds between allowed calls for the same bucket */
  windowMs: number;
  /** Optional custom clock for deterministic unit tests */
  now?: () => number;
}

export interface ActionRateLimitResult {
  allowed: boolean;
  retryAfterSec: number;
  remainingMs: number;
}

/**
 * Lightweight in-memory per-bucket cooldown limiter for sensitive admin send/broadcast actions.
 * Prevents accidental double-clicks or rapid-fire Telegram spam.
 */
export function createActionCooldownLimiter(options: ActionRateLimitOptions) {
  const windowMs = Math.max(1000, options.windowMs);
  const nowFn = options.now || (() => Date.now());
  const lastAllowedAtByKey = new Map<string, number>();

  function checkAndConsume(bucketKey: string): ActionRateLimitResult {
    const now = nowFn();
    const prev = lastAllowedAtByKey.get(bucketKey);
    if (prev !== undefined) {
      const elapsed = now - prev;
      if (elapsed < windowMs) {
        const remainingMs = Math.max(1, windowMs - elapsed);
        return {
          allowed: false,
          retryAfterSec: Math.ceil(remainingMs / 1000),
          remainingMs,
        };
      }
    }
    lastAllowedAtByKey.set(bucketKey, now);
    return {
      allowed: true,
      retryAfterSec: 0,
      remainingMs: 0,
    };
  }

  function reset(bucketKey?: string): void {
    if (bucketKey) {
      lastAllowedAtByKey.delete(bucketKey);
    } else {
      lastAllowedAtByKey.clear();
    }
  }

  function middleware(bucketKey: string, actionLabel = 'This action') {
    return (_req: Request, res: Response, next: NextFunction) => {
      const result = checkAndConsume(bucketKey);
      if (!result.allowed) {
        res.setHeader('Retry-After', String(result.retryAfterSec));
        return res.status(429).json({
          ok: false,
          error: `${actionLabel} is rate limited. Please wait ${result.retryAfterSec}s before trying again.`,
          retryAfterSec: result.retryAfterSec,
        });
      }
      return next();
    };
  }

  return {
    windowMs,
    checkAndConsume,
    reset,
    middleware,
  };
}

/**
 * Strictly validates a Crex country code parameter (2-6 uppercase ASCII letters).
 * Guarantees no URLs, paths, or injection strings can ever be passed upstream.
 */
export function sanitizeCountryCode(raw: unknown, fallback = 'IN'): string {
  if (typeof raw !== 'string') return fallback;
  const clean = raw.trim().toUpperCase();
  return /^[A-Z]{2,6}$/.test(clean) ? clean : fallback;
}
