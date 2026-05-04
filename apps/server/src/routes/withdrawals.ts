import { Router } from 'express';
import { z } from 'zod';
import {
  cancelWithdrawal,
  confirmWithdrawal,
  type PendingWithdrawal,
} from '@options-trader/shared';
import { getDb } from '../db/index.js';
import { createRepo } from '../db/repo.js';
import { newId, nowISO, paramString, parseBody, wrap } from './_helpers.js';

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

// POST /api/withdrawals — manual cash withdrawal.
//
// Reduces investableCorpus by `amount` and increments cashWithdrawn in a
// single transaction. Refuses to breach the 0.5X lock floor; the trade
// engine's R3 still applies on the next close so this guard is just a
// preflight.
const ManualWithdrawSchema = z.object({
  amount: z.number().int().positive(),
  notes: z.string().optional(),
});

withdrawalsRouter.post(
  '/',
  wrap((req, res) => {
    const body = parseBody(ManualWithdrawSchema, req, res);
    if (!body) return;

    const repo = createRepo(getDb());
    const account = repo.getAccount();

    if (account.principalX === null) {
      res.status(409).json({ error: 'Principal X is not configured.' });
      return;
    }
    if (body.amount > account.investableCorpus) {
      res.status(409).json({
        error: `Amount exceeds investable corpus (${account.investableCorpus} paise).`,
      });
      return;
    }
    const floor = Math.floor(account.principalX / 2);
    if (account.investableCorpus - body.amount < floor) {
      res.status(409).json({
        error: `Withdrawing this would push the corpus below the 0.5X lock floor (${floor} paise).`,
      });
      return;
    }

    const now = nowISO();
    const withdrawal: PendingWithdrawal = {
      id: newId(),
      amount: body.amount,
      source: 'MANUAL',
      status: 'CONFIRMED',
      createdAt: now,
      decidedAt: now,
    };

    const next = {
      ...account,
      investableCorpus: account.investableCorpus - body.amount,
      cashWithdrawn: account.cashWithdrawn + body.amount,
    };

    repo.tx(() => {
      repo.insertWithdrawal(withdrawal);
      repo.putAccount(next);
    });

    res.status(201).json({ withdrawal, account: next });
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
