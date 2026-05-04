/**
 * Auth middleware. `requireAuth` blocks the request if no valid session
 * cookie is present and attaches `req.userId` if it is.
 *
 * The user repo is lazily constructed at the route level via
 * `userRepoFor(req)` so each request gets a freshly bound repo.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { resolveUserId } from './sessions.js';
import { createUserRepo, type UserRepo } from '../db/repo.js';
import { getDb } from '../db/index.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export const requireAuth: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const userId = resolveUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Not authenticated.' });
    return;
  }
  req.userId = userId;
  next();
};

/**
 * Build a UserRepo for the authenticated user. Throws if requireAuth has
 * not run upstream — the caller should rely on Express to never reach
 * the handler in that case.
 */
export function userRepoFor(req: Request): UserRepo {
  if (!req.userId) {
    throw new Error('userRepoFor: req.userId is missing — did you forget requireAuth?');
  }
  return createUserRepo(getDb(), req.userId);
}
