import { Router } from 'express';
import { z } from 'zod';
import { env } from '../env.js';
import { getDb } from '../db/index.js';
import { createRepo } from '../db/repo.js';
import { nowISO, parseBody, wrap } from './_helpers.js';
import { createKiteClient, KiteError, type KiteClient } from '../broker/KiteClient.js';

export const zerodhaRouter = Router();

interface ResolvedCreds {
  apiKey: string;
  apiSecret: string;
  /** Where the credentials came from. */
  source: 'db' | 'env';
}

function resolveCredentials(): ResolvedCreds | null {
  const repo = createRepo(getDb());
  const fromDb = repo.getZerodhaCredentials();
  if (fromDb) return { apiKey: fromDb.apiKey, apiSecret: fromDb.apiSecret, source: 'db' };
  if (env.KITE_API_KEY && env.KITE_API_SECRET) {
    return { apiKey: env.KITE_API_KEY, apiSecret: env.KITE_API_SECRET, source: 'env' };
  }
  return null;
}

// Build a fresh client per request — credentials may have been rotated in
// the Settings UI between calls. KiteClient is cheap to construct.
function getClient(): KiteClient | null {
  const creds = resolveCredentials();
  if (!creds) return null;
  return createKiteClient({ apiKey: creds.apiKey, apiSecret: creds.apiSecret });
}

function notConfigured(res: Parameters<Parameters<typeof wrap>[0]>[1]): void {
  res.status(409).json({
    error:
      'Zerodha not configured. Set the API key and secret in Settings → Zerodha credentials, or via apps/server/.env.',
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
    const creds = resolveCredentials();
    res.json({
      configured: Boolean(creds),
      credentialsSource: creds?.source ?? null,
      connected: Boolean(session),
      ...(session
        ? { userId: session.userId, userName: session.userName, loginAt: session.loginAt }
        : {}),
    });
  }),
);

// Credentials management — never echoes the secret back.
zerodhaRouter.get(
  '/credentials',
  wrap((_req, res) => {
    const creds = resolveCredentials();
    const repo = createRepo(getDb());
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
    const repo = createRepo(getDb());
    repo.putZerodhaCredentials(body.apiKey.trim(), body.apiSecret.trim(), nowISO());
    // A new key invalidates any active session.
    repo.clearZerodhaSession();
    res.status(204).end();
  }),
);

zerodhaRouter.delete(
  '/credentials',
  wrap((_req, res) => {
    const repo = createRepo(getDb());
    repo.clearZerodhaCredentials();
    repo.clearZerodhaSession();
    res.status(204).end();
  }),
);

function maskKey(key: string): string {
  if (key.length <= 4) return '•'.repeat(key.length);
  return `${key.slice(0, 2)}${'•'.repeat(Math.max(0, key.length - 6))}${key.slice(-4)}`;
}

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
