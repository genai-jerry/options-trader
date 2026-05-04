import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { env } from '../env.js';
import { getDb } from '../db/index.js';
import { createRepo } from '../db/repo.js';
import { wrap } from './_helpers.js';
import { requireAuth } from '../auth/middleware.js';
import {
  clearStateCookie,
  createSession,
  destroyCurrentSession,
  generateState,
  readStateCookie,
  setSessionCookie,
  setStateCookie,
} from '../auth/sessions.js';
import { buildAuthorizeUrl, exchangeCodeForUserInfo, isGoogleConfigured } from '../auth/google.js';

export const authRouter = Router();

// ─── status / me ─────────────────────────────────────────────────────

authRouter.get(
  '/status',
  wrap((_req, res) => {
    res.json({
      googleConfigured: isGoogleConfigured(),
    });
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  wrap((req, res) => {
    const repo = createRepo(getDb());
    const user = repo.getUserById(req.userId!);
    if (!user) {
      res.status(401).json({ error: 'Session points to a missing user.' });
      return;
    }

    // Family context: 'owner' = sees own data; 'member' = sees ownerUserId's data.
    const family =
      req.familyRole === 'member'
        ? (() => {
            const owner = repo.getUserById(req.dataUserId!);
            return {
              role: 'member' as const,
              ownerUserId: req.dataUserId!,
              ownerEmail: owner?.email ?? null,
              ownerName: owner?.name ?? null,
            };
          })()
        : {
            role: 'owner' as const,
            memberCount: repo.listFamilyMembers(req.userId!).length,
          };

    res.json({ user, family });
  }),
);

// ─── Google OAuth ────────────────────────────────────────────────────

authRouter.get(
  '/google/login',
  wrap((_req, res) => {
    if (!isGoogleConfigured()) {
      res.status(409).json({
        error:
          'Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI in apps/server/.env.',
      });
      return;
    }
    const state = generateState();
    setStateCookie(res, state);
    res.redirect(buildAuthorizeUrl(state));
  }),
);

authRouter.get(
  '/google/callback',
  wrap(async (req, res) => {
    if (!isGoogleConfigured()) {
      res.status(409).send('Google OAuth is not configured.');
      return;
    }
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const expected = readStateCookie(req);
    clearStateCookie(res);

    if (!code || !state || !expected || state !== expected) {
      res.status(400).send('OAuth state check failed. Try logging in again.');
      return;
    }

    let info;
    try {
      info = await exchangeCodeForUserInfo(code);
    } catch (err) {
      res.status(502).send(
        `Google login failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    const repo = createRepo(getDb());
    let user = repo.findUserByGoogleSub(info.sub);
    if (!user) {
      user = repo.insertUser({
        id: randomUUID(),
        googleSub: info.sub,
        email: info.email,
        ...(info.name ? { name: info.name } : {}),
        ...(info.picture ? { picture: info.picture } : {}),
      });
    } else {
      repo.touchUserLogin(user.id, info.name, info.picture);
    }

    const session = createSession(user.id);
    setSessionCookie(res, session.id, session.expiresAt);

    // Land back on the SPA root.
    res.redirect(env.APP_ORIGIN || '/');
  }),
);

// ─── logout ──────────────────────────────────────────────────────────

authRouter.post(
  '/logout',
  wrap((req, res) => {
    destroyCurrentSession(req, res);
    res.status(204).end();
  }),
);
