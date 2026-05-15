import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { env } from '../env.js';
import { userRepoFor } from '../auth/middleware.js';
import { nowISO, parseBody, wrap } from './_helpers.js';
import { createKiteClient, KiteError, type KiteClient } from '../broker/KiteClient.js';
import type { UserRepo } from '../db/repo.js';
import { syncBrokerTradesForUser } from '../jobs/zerodhaTradeSync.js';

export const zerodhaRouter = Router();

interface ResolvedCreds {
  apiKey: string;
  apiSecret: string;
  source: 'db' | 'env';
}

function resolveCredentials(repo: UserRepo): ResolvedCreds | null {
  const fromDb = repo.getZerodhaCredentials();
  if (fromDb) return { apiKey: fromDb.apiKey, apiSecret: fromDb.apiSecret, source: 'db' };
  if (env.KITE_API_KEY && env.KITE_API_SECRET) {
    return { apiKey: env.KITE_API_KEY, apiSecret: env.KITE_API_SECRET, source: 'env' };
  }
  return null;
}

function getClient(repo: UserRepo): KiteClient | null {
  const creds = resolveCredentials(repo);
  if (!creds) return null;
  return createKiteClient({ apiKey: creds.apiKey, apiSecret: creds.apiSecret });
}

function notConfigured(res: Response): void {
  res.status(409).json({
    error:
      'Zerodha not configured. Set the API key and secret in Settings → Zerodha credentials, or via apps/server/.env.',
  });
}

function notLoggedIn(res: Response): void {
  res.status(401).json({
    error: 'No active Zerodha session. Connect via /api/zerodha/login-url.',
  });
}

// ─── Status / login URL ──────────────────────────────────────────────

zerodhaRouter.get(
  '/status',
  wrap((req, res) => {
    const repo = userRepoFor(req);
    const session = repo.getZerodhaSession();
    const creds = resolveCredentials(repo);
    res.json({
      configured: Boolean(creds),
      credentialsSource: creds?.source ?? null,
      connected: Boolean(session),
      ...(session
        ? { userId: session.userIdKite, userName: session.userName, loginAt: session.loginAt }
        : {}),
    });
  }),
);

zerodhaRouter.get(
  '/credentials',
  wrap((req, res) => {
    const repo = userRepoFor(req);
    const creds = resolveCredentials(repo);
    const dbCreds = repo.getZerodhaCredentials();
    res.json({
      configured: Boolean(creds),
      source: creds?.source ?? null,
      hasDbCreds: Boolean(dbCreds),
      hasEnvCreds: Boolean(env.KITE_API_KEY && env.KITE_API_SECRET),
      apiKeyMasked: creds ? maskKey(creds.apiKey) : null,
      updatedAt: dbCreds?.updatedAt ?? null,
    });
  }),
);

const CredentialsSchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  apiSecret: z.string().min(1, 'API secret is required'),
});

zerodhaRouter.put(
  '/credentials',
  wrap((req, res) => {
    const body = parseBody(CredentialsSchema, req, res);
    if (!body) return;
    const repo = userRepoFor(req);
    repo.putZerodhaCredentials(body.apiKey.trim(), body.apiSecret.trim(), nowISO());
    repo.clearZerodhaSession();
    res.status(204).end();
  }),
);

zerodhaRouter.delete(
  '/credentials',
  wrap((req, res) => {
    const repo = userRepoFor(req);
    repo.clearZerodhaCredentials();
    repo.clearZerodhaSession();
    res.status(204).end();
  }),
);

zerodhaRouter.get(
  '/login-url',
  wrap((req, res) => {
    const repo = userRepoFor(req);
    const client = getClient(repo);
    if (!client) return notConfigured(res);
    res.json({ url: client.loginUrl() });
  }),
);

// ─── Token exchange ──────────────────────────────────────────────────

const ExchangeSchema = z.object({
  request_token: z.string().min(1),
});

zerodhaRouter.post(
  '/exchange-token',
  wrap(async (req, res) => {
    const body = parseBody(ExchangeSchema, req, res);
    if (!body) return;
    const repo = userRepoFor(req);
    const client = getClient(repo);
    if (!client) return notConfigured(res);

    try {
      const session = await client.exchangeRequestToken(body.request_token);
      repo.putZerodhaSession({
        userIdKite: session.user_id,
        userName: session.user_name,
        accessToken: session.access_token,
        publicToken: session.public_token,
        loginAt: nowISO(),
      });
      res.json({
        user: { user_id: session.user_id, user_name: session.user_name, email: session.email },
      });
    } catch (err) {
      handleKiteError(err, res);
    }
  }),
);

// ─── Read-only data endpoints ────────────────────────────────────────

function broker(req: Request, res: Response):
  | { client: KiteClient; accessToken: string }
  | null {
  const repo = userRepoFor(req);
  const client = getClient(repo);
  if (!client) {
    notConfigured(res);
    return null;
  }
  const session = repo.getZerodhaSession();
  if (!session) {
    notLoggedIn(res);
    return null;
  }
  return { client, accessToken: session.accessToken };
}

zerodhaRouter.get(
  '/funds',
  wrap(async (req, res) => {
    const b = broker(req, res);
    if (!b) return;
    try {
      res.json(await b.client.getFunds(b.accessToken));
    } catch (err) {
      handleKiteError(err, res);
    }
  }),
);

zerodhaRouter.get(
  '/holdings',
  wrap(async (req, res) => {
    const b = broker(req, res);
    if (!b) return;
    try {
      res.json(await b.client.getHoldings(b.accessToken));
    } catch (err) {
      handleKiteError(err, res);
    }
  }),
);

zerodhaRouter.get(
  '/positions',
  wrap(async (req, res) => {
    const b = broker(req, res);
    if (!b) return;
    try {
      res.json(await b.client.getPositions(b.accessToken));
    } catch (err) {
      handleKiteError(err, res);
    }
  }),
);

zerodhaRouter.get(
  '/orders',
  wrap(async (req, res) => {
    const b = broker(req, res);
    if (!b) return;
    try {
      res.json(await b.client.getOrders(b.accessToken));
    } catch (err) {
      handleKiteError(err, res);
    }
  }),
);

// Kite's /trades endpoint returns fills for the current trading day only.
// Historical trades aren't exposed via REST — those come from Console reports.
zerodhaRouter.get(
  '/trades',
  wrap(async (req, res) => {
    const b = broker(req, res);
    if (!b) return;
    try {
      res.json(await b.client.getTrades(b.accessToken));
    } catch (err) {
      handleKiteError(err, res);
    }
  }),
);

// Day-organized history of synced fills (multi-day). The daily sync job
// snapshots Kite's /trades into broker_trades; this endpoint serves it.
zerodhaRouter.get(
  '/trades/history',
  wrap((req, res) => {
    const repo = userRepoFor(req);
    const filter: { fromDate?: string; toDate?: string } = {};
    if (typeof req.query.from === 'string' && req.query.from.length > 0) {
      filter.fromDate = req.query.from;
    }
    if (typeof req.query.to === 'string' && req.query.to.length > 0) {
      filter.toDate = req.query.to;
    }
    res.json({
      trades: repo.listBrokerTrades(filter),
      sync: repo.getBrokerTradeSync(),
    });
  }),
);

// Manual trigger for the daily sync. Useful when the user reconnects Kite
// after 6PM IST and wants to capture today's fills immediately.
zerodhaRouter.post(
  '/trades/sync',
  wrap(async (req, res) => {
    const repo = userRepoFor(req);
    if (!repo.getZerodhaSession()) return notLoggedIn(res);
    try {
      const result = await syncBrokerTradesForUser(repo);
      res.json({
        ok: true,
        ...result,
        sync: repo.getBrokerTradeSync(),
      });
    } catch (err) {
      const message =
        err instanceof KiteError
          ? describeKiteError(err)
          : err instanceof Error
            ? err.message
            : 'Sync failed.';
      repo.recordBrokerTradeSyncFailure(nowISO(), message);
      handleKiteError(err, res);
    }
  }),
);

zerodhaRouter.post(
  '/disconnect',
  wrap(async (req, res) => {
    const repo = userRepoFor(req);
    const client = getClient(repo);
    const session = repo.getZerodhaSession();
    if (client && session) {
      await client.invalidateAccessToken(session.accessToken);
    }
    repo.clearZerodhaSession();
    res.json({ ok: true });
  }),
);

function maskKey(key: string): string {
  if (key.length <= 4) return '•'.repeat(key.length);
  return `${key.slice(0, 2)}${'•'.repeat(Math.max(0, key.length - 6))}${key.slice(-4)}`;
}

// Kite's error messages are terse and sometimes cryptic. Translate the ones
// users actually hit into actionable guidance.
function describeKiteError(err: KiteError): string {
  if (isUserNotEnabledError(err)) {
    return (
      'Your Zerodha account is not enabled for this Kite Connect app. ' +
      'Sign in at https://developers.kite.trade and check that: (1) the app ' +
      'is active and its subscription has not lapsed, and (2) you are logging ' +
      'in with the same Zerodha account that owns the app — a Kite Connect ' +
      'app only works with its developer account unless it has been published.'
    );
  }
  return err.message;
}

// Kite reports an account that isn't authorised for the app as an
// InputException; reconnecting won't help, so it must not be treated as a
// recoverable session-expiry (TokenException).
function isUserNotEnabledError(err: KiteError): boolean {
  return err.message.toLowerCase().includes('not enabled for the app');
}

function handleKiteError(err: unknown, res: Response): void {
  if (err instanceof KiteError) {
    const status = isUserNotEnabledError(err)
      ? 403
      : err.errorType === 'TokenException' || err.status === 403
        ? 401
        : err.status >= 400
          ? err.status
          : 502;
    res.status(status).json({ error: describeKiteError(err), errorType: err.errorType });
    return;
  }
  res.status(502).json({ error: err instanceof Error ? err.message : 'Kite call failed.' });
}
