import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { ZodSchema } from 'zod';

export function nowISO(): string {
  return new Date().toISOString();
}

export function newId(): string {
  // Node 18+ has crypto.randomUUID() globally.
  return globalThis.crypto.randomUUID();
}

/** Wrap a handler so thrown errors bubble to Express's error middleware. */
export function wrap(fn: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const result = fn(req, res, next);
      if (result instanceof Promise) result.catch(next);
    } catch (err) {
      next(err);
    }
  };
}

/** Parse `req.body` against a zod schema; on failure send 400 and return null. */
export function parseBody<T>(schema: ZodSchema<T>, req: Request, res: Response): T | null {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: 'Validation failed', details: result.error.flatten() });
    return null;
  }
  return result.data;
}

/** Pull a string route param; Express 5 types it as `string | string[]` even
 *  for single-segment patterns, so narrow it explicitly. */
export function paramString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
