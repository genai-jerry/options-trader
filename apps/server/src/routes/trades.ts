import { Router } from 'express';
import { z } from 'zod';
import {
  accountToSnapshot,
  applyRulesOnClose,
  evaluateDecision,
  type Trade,
} from '@options-trader/shared';
import { userRepoFor } from '../auth/middleware.js';
import { newId, nowISO, paramString, parseBody, wrap } from './_helpers.js';

export const tradesRouter = Router();

const InstrumentSchema = z.enum(['CE', 'PE', 'FUT']);
const StatusSchema = z.enum(['OPEN', 'CLOSED']);

// GET /api/trades — filter by status / instrument / symbol.
tradesRouter.get(
  '/',
  wrap((req, res) => {
    const repo = userRepoFor(req);
    const filter: { status?: 'OPEN' | 'CLOSED'; instrument?: 'CE' | 'PE' | 'FUT'; symbol?: string } =
      {};
    const status = StatusSchema.safeParse(req.query.status);
    if (status.success) filter.status = status.data;
    const instrument = InstrumentSchema.safeParse(req.query.instrument);
    if (instrument.success) filter.instrument = instrument.data;
    if (typeof req.query.symbol === 'string' && req.query.symbol.length > 0) {
      filter.symbol = req.query.symbol;
    }
    res.json(repo.listTrades(filter));
  }),
);

// POST /api/trades — open a new trade.
const NewTradeSchema = z.object({
  symbol: z.string().min(1),
  instrument: InstrumentSchema,
  strike: z.number().int().nonnegative().optional(),
  expiry: z.string().min(1),
  lotSize: z.number().int().positive(),
  qty: z.number().int().positive(),
  entryPrice: z.number().int().nonnegative(),
  expectedExit: z.number().int().nonnegative(),
  maxAcceptableLoss: z.number().int().nonnegative(),
  notes: z.string().optional(),
  agentSource: z.string().optional(),
});

tradesRouter.post(
  '/',
  wrap((req, res) => {
    const body = parseBody(NewTradeSchema, req, res);
    if (!body) return;

    const repo = userRepoFor(req);
    const account = repo.getAccount();
    const openTrades = repo.listTrades({ status: 'OPEN' });
    const snapshot = accountToSnapshot(account);

    const decision = evaluateDecision(body, snapshot, openTrades, {
      id: newId(),
      decidedAt: nowISO(),
    });

    if (decision.verdict === 'BLOCK') {
      repo.tx(() => {
        repo.insertDecision(decision);
      });
      res.status(409).json({ error: 'Trade BLOCKED by deterministic engine.', decision });
      return;
    }

    const capitalRequired = body.entryPrice * body.qty * body.lotSize;
    const trade: Trade = {
      id: newId(),
      symbol: body.symbol,
      instrument: body.instrument,
      ...(body.strike !== undefined ? { strike: body.strike } : {}),
      expiry: body.expiry,
      lotSize: body.lotSize,
      qty: body.qty,
      entryPrice: body.entryPrice,
      entryAt: nowISO(),
      status: 'OPEN',
      ...(body.notes ? { notes: body.notes } : {}),
      ...(body.agentSource ? { agentSource: body.agentSource } : {}),
    };

    const accepted = { ...decision, tradeId: trade.id, acceptedByUser: true };

    repo.tx(() => {
      repo.insertTrade(trade);
      repo.insertDecision(accepted);
      repo.putAccount({
        ...account,
        investableCorpus: account.investableCorpus - capitalRequired,
      });
    });

    res.status(201).json({ trade, decision: accepted });
  }),
);

// POST /api/trades/:id/close
const CloseSchema = z.object({
  exitPrice: z.number().int().nonnegative(),
});

tradesRouter.post(
  '/:id/close',
  wrap((req, res) => {
    const id = paramString(req.params.id);
    const body = parseBody(CloseSchema, req, res);
    if (!body) return;

    const repo = userRepoFor(req);
    const trade = repo.getTradeById(id);
    if (!trade) {
      res.status(404).json({ error: 'Trade not found.' });
      return;
    }
    if (trade.status !== 'OPEN') {
      res.status(409).json({ error: 'Trade is not OPEN.' });
      return;
    }

    const account = repo.getAccount();
    const tradeWithExit: Trade = { ...trade, exitPrice: body.exitPrice };

    const result = applyRulesOnClose(account, tradeWithExit, {
      withdrawalId: newId(),
      now: nowISO(),
    });

    repo.tx(() => {
      repo.putTrade(result.trade);
      repo.putAccount(result.account);
      if (result.queuedWithdrawal) repo.insertWithdrawal(result.queuedWithdrawal);
    });

    res.json({
      trade: result.trade,
      account: result.account,
      firedRules: result.firedRules,
      queuedWithdrawal: result.queuedWithdrawal ?? null,
    });
  }),
);
