import { Router } from 'express';
import { z } from 'zod';
import { env } from '../env.js';
import { getDb } from '../db/index.js';
import { createRepo } from '../db/repo.js';
import { nowISO, parseBody, wrap } from './_helpers.js';
import { createKiteClient, KiteError, type KiteClient } from '../broker/KiteClient.js';

export const zerodhaRouter = Router();

let _client: KiteClient | null = null;

function getClient(): KiteClient | null {
  if (!env.KITE_API_KEY || !env.KITE_API_SECRET) return null;
  if (_client) return _client;
  _client = createKiteClient({
    apiKey: env.KITE_API_KEY,
    apiSecret: env.KITE_API_SECRET,
  });
  return _client;
}

function notConfigured(res: Parameters<Parameters<typeof wrap>[0]>[1]): void {
  res.status(409).json({
    error:
      'Zerodha not configured. Set KITE_API_KEY and KITE_API_SECRET in apps/server/.env.',
  });
}

function notLoggedIn(res: Parameters<Parameters<typeof wrap>[0]>[1]): void {
  res.status(401).json({
    error: 'No active Zerodha session. Connect via /api/zerodha/login-url.',
  });
}

// ─── Status / login URL ──────────────────────────────────────────────

zerodhaRouter.get(
  '/status',
  wrap((_req, res) => {
    const repo = createRepo(getDb());
    const session = repo.getZerodhaSession();
    res.json({
      configured: Boolean(env.KITE_API_KEY && env.KITE_API_SECRET),
      connected: Boolean(session),
      ...(session
        ? { userId: session.userId, userName: session.userName, loginAt: session.loginAt }
        : {}),
    });
  }),
);

zerodhaRouter.get(
  '/login-url',
  wrap((_req, res) => {
    const client = getClient();
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
    const client = getClient();
    if (!client) return notConfigured(res);

    try {
      const session = await client.exchangeRequestToken(body.request_token);
      const repo = createRepo(getDb());
      repo.putZerodhaSession({
        userId: session.user_id,
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

zerodhaRouter.get(
  '/funds',
  wrap(async (_req, res) => {
    const client = getClient();
    if (!client) return notConfigured(res);
    const session = createRepo(getDb()).getZerodhaSession();
    if (!session) return notLoggedIn(res);
    try {
      res.json(await client.getFunds(session.accessToken));
    } catch (err) {
      handleKiteError(err, res);
    }
  }),
);

zerodhaRouter.get(
  '/holdings',
  wrap(async (_req, res) => {
    const client = getClient();
    if (!client) return notConfigured(res);
    const session = createRepo(getDb()).getZerodhaSession();
    if (!session) return notLoggedIn(res);
    try {
      res.json(await client.getHoldings(session.accessToken));
    } catch (err) {
      handleKiteError(err, res);
    }
  }),
);

zerodhaRouter.get(
  '/positions',
  wrap(async (_req, res) => {
    const client = getClient();
    if (!client) return notConfigured(res);
    const session = createRepo(getDb()).getZerodhaSession();
    if (!session) return notLoggedIn(res);
    try {
      res.json(await client.getPositions(session.accessToken));
    } catch (err) {
      handleKiteError(err, res);
    }
  }),
);

zerodhaRouter.get(
  '/orders',
  wrap(async (_req, res) => {
    const client = getClient();
    if (!client) return notConfigured(res);
    const session = createRepo(getDb()).getZerodhaSession();
    if (!session) return notLoggedIn(res);
    try {
      res.json(await client.getOrders(session.accessToken));
    } catch (err) {
      handleKiteError(err, res);
    }
  }),
);

zerodhaRouter.post(
  '/disconnect',
  wrap(async (_req, res) => {
    const client = getClient();
    const repo = createRepo(getDb());
    const session = repo.getZerodhaSession();
    if (client && session) {
      await client.invalidateAccessToken(session.accessToken);
    }
    repo.clearZerodhaSession();
    res.json({ ok: true });
  }),
);

function handleKiteError(
  err: unknown,
  res: Parameters<Parameters<typeof wrap>[0]>[1],
): void {
  if (err instanceof KiteError) {
    // 403 with error_type=TokenException usually means daily expiry — surface
    // a 401 to the frontend so the user knows to reconnect.
    const status =
      err.errorType === 'TokenException' || err.status === 403
        ? 401
        : err.status >= 400
          ? err.status
          : 502;
    res.status(status).json({ error: err.message, errorType: err.errorType });
    return;
  }
  res.status(502).json({ error: err instanceof Error ? err.message : 'Kite call failed.' });
}
