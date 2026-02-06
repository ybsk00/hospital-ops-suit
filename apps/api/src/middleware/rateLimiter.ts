import { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export function createRateLimiter(windowMs: number, maxRequests: number) {
  const store = new Map<string, RateLimitEntry>();

  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now >= entry.resetAt) {
        store.delete(key);
      }
    }
  }, windowMs);

  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  return (req: Request, _res: Response, next: NextFunction) => {
    const key =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
      req.socket.remoteAddress ??
      'unknown';

    const now = Date.now();
    const entry = store.get(key);

    if (!entry || now >= entry.resetAt) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (entry.count >= maxRequests) {
      const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
      return next(
        new AppError(429, 'RATE_LIMIT_EXCEEDED', `요청이 너무 많습니다. ${retryAfterSec}초 후 다시 시도해주세요.`),
      );
    }

    entry.count += 1;
    next();
  };
}

export const loginLimiter = createRateLimiter(10 * 60 * 1000, 5);
