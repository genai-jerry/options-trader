/**
 * JSON export / import scoped to the authenticated user.
 *
 * Export is "everything in the DB for this user". Import is destructive
 * for this user only: wipes their rows and re-inserts the payload inside
 * a single transaction. Other users' data is never touched.
 *
 * The Zerodha access token is intentionally NOT exported — re-login on
 * import is required.
 */

import { Router } from 'express';
import { z } from 'zod';
import type {
  AdvisorMessage,
  DecisionRecord,
  PendingWithdrawal,
  Trade,
} from '@options-trader/shared';
import { userRepoFor } from '../auth/middleware.js';
import { parseBody, wrap } from './_helpers.js';

export const backupRouter = Router();

backupRouter.get(
  '/export',
  wrap((req, res) => {
    const repo = userRepoFor(req);
    const account = repo.getAccount();
    const trades = repo.listTrades();
    const withdrawals = repo.listWithdrawals();
    const decisions = repo.listDecisions(1000);
    const conversations = repo.listConversations(100);
    const advisorMessages: AdvisorMessage[] = conversations.flatMap((c) =>
      repo.listAdvisorMessages(c.conversationId),
    );

    res.json({
      version: 1,
      exportedAt: new Date().toISOString(),
      account,
      trades,
      withdrawals,
      decisions,
      advisorMessages,
    });
  }),
);

const ImportSchema = z.object({
  version: z.literal(1),
  account: z.unknown(),
  trades: z.array(z.unknown()),
  withdrawals: z.array(z.unknown()),
  decisions: z.array(z.unknown()),
  advisorMessages: z.array(z.unknown()).optional(),
  confirm: z.literal('IMPORT'),
});

backupRouter.post(
  '/import',
  wrap((req, res) => {
    const body = parseBody(ImportSchema, req, res);
    if (!body) return;
    const repo = userRepoFor(req);
    repo.tx(() => {
      repo.resetAll();
      repo.putAccount(body.account as Parameters<typeof repo.putAccount>[0]);
      for (const t of body.trades as Trade[]) repo.insertTrade(t);
      for (const w of body.withdrawals as PendingWithdrawal[]) repo.insertWithdrawal(w);
      for (const d of body.decisions as DecisionRecord[]) repo.insertDecision(d);
      for (const m of (body.advisorMessages ?? []) as AdvisorMessage[]) {
        repo.insertAdvisorMessage(m);
      }
    });
    res.json({ ok: true, account: repo.getAccount(), trades: repo.listTrades().length });
  }),
);
