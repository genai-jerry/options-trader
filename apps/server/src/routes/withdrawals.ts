import { Router } from 'express';
import { z } from 'zod';
import { cancelWithdrawal, confirmWithdrawal } from '@options-trader/shared';
import { getDb } from '../db/index.js';
import { createRepo } from '../db/repo.js';
import { nowISO, paramString, wrap } from './_helpers.js';

export const withdrawalsRouter = Router();

const StatusSchema = z.enum(['PENDING', 'CONFIRMED', 'CANCELLED']);

// GET /api/withdrawals — filter by status.
withdrawalsRouter.get(
  '/',
  wrap((req, res) => {
    const repo = createRepo(getDb());
    const filter: { status?: 'PENDING' | 'CONFIRMED' | 'CANCELLED' } = {};
    const parsed = StatusSchema.safeParse(req.query.status);
    if (parsed.success) filter.status = parsed.data;
    res.json(repo.listWithdrawals(filter));
  }),
);

// POST /api/withdrawals/:id/confirm — R5 confirm.
withdrawalsRouter.post(
  '/:id/confirm',
  wrap((req, res) => {
    const id = paramString(req.params.id);
    const repo = createRepo(getDb());
    const w = repo.getWithdrawalById(id);
    if (!w) {
      res.status(404).json({ error: 'Withdrawal not found.' });
      return;
    }
    if (w.status !== 'PENDING') {
      res.status(409).json({ error: `Withdrawal is ${w.status}.` });
      return;
    }
    const account = repo.getAccount();
    const result = confirmWithdrawal(account, w, nowISO());
    repo.tx(() => {
      repo.putAccount(result.account);
      repo.putWithdrawal(result.withdrawal);
    });
    res.json({ withdrawal: result.withdrawal, account: result.account });
  }),
);

// POST /api/withdrawals/:id/cancel — R5 cancel.
withdrawalsRouter.post(
  '/:id/cancel',
  wrap((req, res) => {
    const id = paramString(req.params.id);
    const repo = createRepo(getDb());
    const w = repo.getWithdrawalById(id);
    if (!w) {
      res.status(404).json({ error: 'Withdrawal not found.' });
      return;
    }
    if (w.status !== 'PENDING') {
      res.status(409).json({ error: `Withdrawal is ${w.status}.` });
      return;
    }
    const account = repo.getAccount();
    const result = cancelWithdrawal(account, w, nowISO());
    repo.tx(() => {
      repo.putWithdrawal(result.withdrawal);
    });
    res.json({ withdrawal: result.withdrawal, account: result.account });
  }),
);
