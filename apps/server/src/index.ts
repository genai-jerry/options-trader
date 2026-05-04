import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express, { type ErrorRequestHandler, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import { env } from './env.js';
import { getDb, closeDb } from './db/index.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { accountRouter } from './routes/account.js';
import { tradesRouter } from './routes/trades.js';
import { withdrawalsRouter } from './routes/withdrawals.js';
import { decisionsRouter } from './routes/decisions.js';
import { advisorRouter } from './routes/advisor.js';
import { zerodhaRouter } from './routes/zerodha.js';
import { backupRouter } from './routes/backup.js';
import { familyRouter } from './routes/family.js';
import { requireAuth } from './auth/middleware.js';

const app = express();
app.use(cookieParser());
app.use(express.json({ limit: '256kb' }));

// Public.
app.use('/api', healthRouter);
app.use('/api/auth', authRouter);

// Authenticated.
app.use('/api/account', requireAuth, accountRouter);
app.use('/api/trades', requireAuth, tradesRouter);
app.use('/api/withdrawals', requireAuth, withdrawalsRouter);
app.use('/api/decisions', requireAuth, decisionsRouter);
app.use('/api/advisor', requireAuth, advisorRouter);
app.use('/api/zerodha', requireAuth, zerodhaRouter);
app.use('/api/backup', requireAuth, backupRouter);
app.use('/api/family', requireAuth, familyRouter);

// ─── Optional: serve a built web app at / with SPA fallback ─────────
if (env.WEB_STATIC_DIR) {
  const staticDir = resolve(env.WEB_STATIC_DIR);
  if (existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get(/^(?!\/api\/).*/, (_req: Request, res: Response) => {
      res.sendFile(resolve(staticDir, 'index.html'));
    });
    console.log(`[server] serving static web from ${staticDir}`);
  } else {
    console.warn(`[server] WEB_STATIC_DIR=${staticDir} does not exist; skipping`);
  }
}

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error('[server] error', err);
  const message = err instanceof Error ? err.message : 'Internal error';
  res.status(500).json({ error: message });
};
app.use(errorHandler);

// Boot: open DB (runs migrations), then start the server.
const db = getDb();
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
  .all();
console.log(`[server] DB ready. Tables: ${tables.length}`);

const server = app.listen(env.PORT, () => {
  console.log(`[server] listening on http://localhost:${env.PORT}`);
});

function shutdown(signal: string): void {
  console.log(`[server] ${signal} received, shutting down...`);
  server.close(() => {
    closeDb();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
