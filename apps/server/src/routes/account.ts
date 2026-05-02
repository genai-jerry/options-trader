import { Router } from 'express';
import { z } from 'zod';
import { unlock } from '@options-trader/shared';
import { getDb } from '../db/index.js';
import { createRepo } from '../db/repo.js';
import { nowISO, parseBody, wrap } from './_helpers.js';

export const accountRouter = Router();

// GET /api/account
accountRouter.get(
  '/',
  wrap((_req, res) => {
    const repo = createRepo(getDb());
    res.json(repo.getAccount());
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
    const repo = createRepo(getDb());
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
    const repo = createRepo(getDb());
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
      // First-time principal: seed the corpus to match. Subsequent edits
      // (still pre-trade) overwrite the corpus too — it's the user's
      // declared starting capital.
      investableCorpus: body.principalX,
      phase: 'BOOTSTRAP' as const,
    };
    repo.putAccount(next);
    res.json(next);
  }),
);

// POST /api/account/reset — wipe everything. Confirmation token required.
const ResetSchema = z.object({
  confirm: z.literal('RESET'),
});

accountRouter.post(
  '/reset',
  wrap((req, res) => {
    const body = parseBody(ResetSchema, req, res);
    if (!body) return;
    const repo = createRepo(getDb());
    repo.resetAll();
    res.json(repo.getAccount());
  }),
);

// POST /api/account/unlock — R4. 409 if not LOCKED.
accountRouter.post(
  '/unlock',
  wrap((_req, res) => {
    const repo = createRepo(getDb());
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
