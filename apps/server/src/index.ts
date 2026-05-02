import express, { type ErrorRequestHandler } from 'express';
import { env } from './env.js';
import { getDb, closeDb } from './db/index.js';
import { healthRouter } from './routes/health.js';
import { accountRouter } from './routes/account.js';
import { tradesRouter } from './routes/trades.js';
import { withdrawalsRouter } from './routes/withdrawals.js';

const app = express();
app.use(express.json({ limit: '256kb' }));

app.use('/api', healthRouter);
app.use('/api/account', accountRouter);
app.use('/api/trades', tradesRouter);
app.use('/api/withdrawals', withdrawalsRouter);

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
