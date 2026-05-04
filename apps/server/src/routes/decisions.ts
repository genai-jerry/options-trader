import { Router } from 'express';
import { userRepoFor } from '../auth/middleware.js';
import { wrap } from './_helpers.js';

export const decisionsRouter = Router();

decisionsRouter.get(
  '/',
  wrap((req, res) => {
    const limitRaw = Number.parseInt(String(req.query.limit ?? '50'), 10);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50;
    res.json(userRepoFor(req).listDecisions(limit));
  }),
);
