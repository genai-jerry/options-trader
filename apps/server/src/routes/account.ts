import { Router } from 'express';
import { z } from 'zod';
import { unlock } from '@options-trader/shared';
import { userRepoFor } from '../auth/middleware.js';
import { nowISO, parseBody, wrap } from './_helpers.js';

export const accountRouter = Router();

// GET /api/account
accountRouter.get(
  '/',
  wrap((req, res) => {
    res.json(userRepoFor(req).getAccount());
  }),
);

// PUT /api/account/settings — partial update of feePercent, positionSizeCap, aiEnabled.
const SettingsSchema = z
  .object({
    feePercent: z.number().min(0).max(1).optional(),
    positionSizeCap: z.number().min(0).max(1).optional(),
    aiEnabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update.' });

accountRouter.put(
  '/settings',
  wrap((req, res) => {
    const body = parseBody(SettingsSchema, req, res);
    if (!body) return;
    const repo = userRepoFor(req);
    const account = repo.getAccount();
    const next = {
      ...account,
      ...(body.feePercent !== undefined ? { feePercent: body.feePercent } : {}),
      ...(body.positionSizeCap !== undefined ? { positionSizeCap: body.positionSizeCap } : {}),
      ...(body.aiEnabled !== undefined ? { aiEnabled: body.aiEnabled } : {}),
    };
    repo.putAccount(next);
    res.json(next);
  }),
);

// POST /api/account/principal — set principalX (rejected once any trade exists).
const PrincipalSchema = z.object({
  principalX: z.number().int().positive(),
});

accountRouter.post(
  '/principal',
  wrap((req, res) => {
    const body = parseBody(PrincipalSchema, req, res);
    if (!body) return;
    const repo = userRepoFor(req);
    if (repo.countTrades() > 0) {
      res.status(409).json({
        error: 'Principal is locked once any trade exists. Use /api/account/reset.',
      });
      return;
    }
    const account = repo.getAccount();
    const next = {
      ...account,
      principalX: body.principalX,
      investableCorpus: body.principalX,
      phase: 'BOOTSTRAP' as const,
    };
    repo.putAccount(next);
    res.json(next);
  }),
);

// POST /api/account/reset — wipe this user's data. Confirmation token required.
const ResetSchema = z.object({
  confirm: z.literal('RESET'),
});

accountRouter.post(
  '/reset',
  wrap((req, res) => {
    const body = parseBody(ResetSchema, req, res);
    if (!body) return;
    const repo = userRepoFor(req);
    repo.resetAll();
    res.json(repo.getAccount());
  }),
);

// POST /api/account/unlock — R4. 409 if not LOCKED.
accountRouter.post(
  '/unlock',
  wrap((req, res) => {
    const repo = userRepoFor(req);
    const account = repo.getAccount();
    if (account.phase !== 'LOCKED') {
      res.status(409).json({ error: 'Account is not LOCKED.' });
      return;
    }
    const next = unlock(account, nowISO());
    repo.putAccount(next);
    res.json(next);
  }),
);
