import { Router } from 'express';
import { getDb } from '../db/index.js';
import { createRepo } from '../db/repo.js';
import { wrap } from './_helpers.js';

export const decisionsRouter = Router();

decisionsRouter.get(
  '/',
  wrap((req, res) => {
    const limitRaw = Number.parseInt(String(req.query.limit ?? '50'), 10);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50;
    const repo = createRepo(getDb());
    res.json(repo.listDecisions(limit));
  }),
);
