import express from 'express';
import { env } from './env.js';
import { getDb, closeDb } from './db/index.js';
import { healthRouter } from './routes/health.js';

const app = express();
app.use(express.json({ limit: '256kb' }));

app.use('/api', healthRouter);

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
