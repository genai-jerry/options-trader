import { Router } from 'express';
import { getDb } from '../db/index.js';
import { createRepo } from '../db/repo.js';

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

healthRouter.get('/health/db', (_req, res) => {
  const db = getDb();
  const repo = createRepo(db);
  res.json({
    status: 'ok',
    schemaVersion: repo.schemaVersion(),
    tables: repo.listTables(),
  });
});
