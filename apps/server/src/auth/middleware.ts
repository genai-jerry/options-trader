/**
 * Auth middleware. `requireAuth` blocks the request without a valid
 * session cookie; on success it attaches:
 *
 *   req.userId       — the actual signed-in user's id (used for /me, logout).
 *   req.dataUserId   — the effective user id for data scoping. Equals
 *                      req.userId for owners; equals the family owner's id
 *                      for members (so members see the owner's data).
 *   req.familyRole   — 'owner' | 'member', for UI gating.
 *
 * Family auto-linking: the first time a member logs in (their email matches
 * an outstanding family_members.member_email but member_user_id is NULL),
 * the middleware writes the link and sets accepted_at. Idempotent on
 * subsequent requests.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { resolveUserId } from './sessions.js';
import { createRepo, createUserRepo, type UserRepo } from '../db/repo.js';
import { getDb } from '../db/index.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      dataUserId?: string;
      familyRole?: 'owner' | 'member';
    }
  }
}

export const requireAuth: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const userId = resolveUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Not authenticated.' });
    return;
  }

  const repo = createRepo(getDb());
  const user = repo.getUserById(userId);
  if (!user) {
    res.status(401).json({ error: 'Session points to a missing user.' });
    return;
  }

  req.userId = userId;

  // Already linked as a family member? Use the owner's id.
  let family = repo.findFamilyByMemberUserId(userId);

  // Not linked yet — but maybe their email matches an outstanding invite.
  if (!family) {
    const byEmail = repo.findFamilyByMemberEmail(user.email);
    if (byEmail && !byEmail.memberUserId) {
      repo.linkFamilyMember({
        memberEmail: byEmail.memberEmail,
        memberUserId: userId,
        now: new Date().toISOString(),
      });
      family = { ...byEmail, memberUserId: userId, acceptedAt: new Date().toISOString() };
    }
  }

  if (family) {
    req.dataUserId = family.ownerUserId;
    req.familyRole = 'member';
  } else {
    req.dataUserId = userId;
    req.familyRole = 'owner';
  }

  next();
};

/** Build a UserRepo bound to req.dataUserId (the effective owner). */
export function userRepoFor(req: Request): UserRepo {
  if (!req.dataUserId) {
    throw new Error('userRepoFor: req.dataUserId is missing — did you forget requireAuth?');
  }
  return createUserRepo(getDb(), req.dataUserId);
}
