/**
 * Cookie-backed sessions.
 *
 * Session IDs are 32 bytes of crypto-random base64url. They live in the
 * `sessions` table keyed by id, with a 30-day expiry. The cookie
 * (`SESSION_COOKIE`) is httpOnly + sameSite=Lax so the OAuth callback
 * redirect can set it without being treated as cross-site.
 */

import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { env } from '../env.js';
import { getDb } from '../db/index.js';
import { createRepo } from '../db/repo.js';

export const SESSION_COOKIE = 'options_trader_sid';
export const STATE_COOKIE = 'options_trader_oauth_state';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function newId(byteLen = 32): string {
  return randomBytes(byteLen).toString('base64url');
}

export interface CreateSessionResult {
  id: string;
  expiresAt: Date;
}

export function createSession(userId: string): CreateSessionResult {
  const id = newId();
  const expiresAt = new Date(Date.now() + THIRTY_DAYS_MS);
  const repo = createRepo(getDb());
  repo.insertSession({ id, userId, expiresAt: expiresAt.toISOString() });
  return { id, expiresAt };
}

export function setSessionCookie(res: Response, id: string, expiresAt: Date): void {
  res.cookie(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    expires: expiresAt,
    path: '/',
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function readSessionCookie(req: Request): string | null {
  const id = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/** Returns the userId for the request, or null if unauthenticated. */
export function resolveUserId(req: Request): string | null {
  const id = readSessionCookie(req);
  if (!id) return null;
  const repo = createRepo(getDb());
  return repo.getSessionUserId(id);
}

export function destroyCurrentSession(req: Request, res: Response): void {
  const id = readSessionCookie(req);
  if (id) {
    const repo = createRepo(getDb());
    repo.deleteSession(id);
  }
  clearSessionCookie(res);
}

// ─── OAuth state cookie (CSRF protection on the redirect leg) ────────

export function setStateCookie(res: Response, state: string): void {
  res.cookie(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    maxAge: 10 * 60 * 1000, // 10 minutes is plenty
    path: '/',
  });
}

export function readStateCookie(req: Request): string | null {
  const v = (req.cookies as Record<string, string> | undefined)?.[STATE_COOKIE];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export function clearStateCookie(res: Response): void {
  res.clearCookie(STATE_COOKIE, { path: '/' });
}

export function generateState(): string {
  return newId(16);
}
