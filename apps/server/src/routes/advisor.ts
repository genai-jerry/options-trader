import { Router } from 'express';
import { z } from 'zod';
import type { AdvisorMessage } from '@options-trader/shared';
import { env } from '../env.js';
import { userRepoFor } from '../auth/middleware.js';
import { newId, nowISO, parseBody, wrap } from './_helpers.js';
import { AdvisorService, RateLimiter } from '../ai/AdvisorService.js';
import { createAnthropicProvider } from '../ai/providers/anthropic.js';
import type { AIProvider } from '../ai/types.js';

export const advisorRouter = Router();

// Per-user rate limits (so one tenant can't starve another). Created lazily.
const limiters = new Map<string, RateLimiter>();
function limiterFor(userId: string): RateLimiter {
  let l = limiters.get(userId);
  if (!l) {
    l = new RateLimiter(20, 500);
    limiters.set(userId, l);
  }
  return l;
}

let _provider: AIProvider | null = null;
function getProvider(): AIProvider | null {
  if (_provider) return _provider;
  if (env.AI_PROVIDER !== 'anthropic') return null;
  if (!env.ANTHROPIC_API_KEY) return null;
  _provider = createAnthropicProvider({
    apiKey: env.ANTHROPIC_API_KEY,
    defaultModel: env.AI_MODEL,
  });
  return _provider;
}

interface Guard {
  service: AdvisorService;
}

function ensureEnabled(req: import('express').Request):
  | { ok: true; guard: Guard }
  | { ok: false; reason: string } {
  const repo = userRepoFor(req);
  const account = repo.getAccount();
  if (!account.aiEnabled) {
    return { ok: false, reason: 'AI advisor is disabled in Settings.' };
  }
  const provider = getProvider();
  if (!provider) {
    return {
      ok: false,
      reason: `AI provider not configured. Set ANTHROPIC_API_KEY in apps/server/.env (provider=${env.AI_PROVIDER}).`,
    };
  }
  return {
    ok: true,
    guard: { service: new AdvisorService(repo, provider, limiterFor(req.userId!)) },
  };
}

// ─── Status ───────────────────────────────────────────────────────────

advisorRouter.get(
  '/status',
  wrap((req, res) => {
    const account = userRepoFor(req).getAccount();
    res.json({
      enabled: account.aiEnabled,
      provider: env.AI_PROVIDER,
      model: env.AI_MODEL,
      configured: Boolean(env.ANTHROPIC_API_KEY),
    });
  }),
);

// ─── Conversations ────────────────────────────────────────────────────

advisorRouter.get(
  '/conversations',
  wrap((req, res) => {
    res.json(userRepoFor(req).listConversations(20));
  }),
);

advisorRouter.get(
  '/conversations/:id',
  wrap((req, res) => {
    const id = String(req.params.id);
    res.json(userRepoFor(req).listAdvisorMessages(id));
  }),
);

// ─── Decide ───────────────────────────────────────────────────────────

const NewTradeInputSchema = z.object({
  symbol: z.string().min(1),
  instrument: z.enum(['CE', 'PE', 'FUT']),
  strike: z.number().int().nonnegative().optional(),
  expiry: z.string().min(1),
  lotSize: z.number().int().positive(),
  qty: z.number().int().positive(),
  entryPrice: z.number().int().nonnegative(),
  notes: z.string().optional(),
  agentSource: z.string().optional(),
});

const DecideSchema = z.object({ input: NewTradeInputSchema });

advisorRouter.post(
  '/decide',
  wrap(async (req, res) => {
    const body = parseBody(DecideSchema, req, res);
    if (!body) return;

    const guard = ensureEnabled(req);
    if (!guard.ok) {
      res.status(409).json({ error: guard.reason });
      return;
    }

    try {
      const out = await guard.guard.service.decide(body);
      res.json(out);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Advisor failed.';
      res.status(502).json({ error: message });
    }
  }),
);

// ─── Chat (SSE) ───────────────────────────────────────────────────────

const ChatSchema = z.object({
  conversationId: z.string().optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1),
      }),
    )
    .min(1),
});

advisorRouter.post(
  '/chat',
  wrap(async (req, res) => {
    const body = parseBody(ChatSchema, req, res);
    if (!body) return;

    const guard = ensureEnabled(req);
    if (!guard.ok) {
      res.status(409).json({ error: guard.reason });
      return;
    }

    const conversationId = body.conversationId ?? newId();
    const repo = userRepoFor(req);

    const lastUser = [...body.messages].reverse().find((m) => m.role === 'user');
    if (lastUser) {
      const msg: AdvisorMessage = {
        id: newId(),
        conversationId,
        role: 'user',
        content: lastUser.content,
        createdAt: nowISO(),
      };
      repo.insertAdvisorMessage(msg);
    }

    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();
    res.write(`event: meta\ndata: ${JSON.stringify({ conversationId })}\n\n`);

    const ac = new AbortController();
    req.on('close', () => ac.abort());

    let assistantText = '';
    await guard.guard.service.chat({
      messages: body.messages,
      signal: ac.signal,
      onEvent: (e) => {
        if (e.type === 'text') assistantText += e.data;
        res.write(`event: ${e.type}\ndata: ${JSON.stringify(e.data)}\n\n`);
      },
    });

    if (assistantText) {
      const msg: AdvisorMessage = {
        id: newId(),
        conversationId,
        role: 'assistant',
        content: assistantText,
        createdAt: nowISO(),
      };
      repo.insertAdvisorMessage(msg);
    }
    res.end();
  }),
);

// ─── Portfolio review ─────────────────────────────────────────────────

advisorRouter.post(
  '/portfolio-review',
  wrap(async (req, res) => {
    const guard = ensureEnabled(req);
    if (!guard.ok) {
      res.status(409).json({ error: guard.reason });
      return;
    }
    try {
      const review = await guard.guard.service.portfolioReview();
      res.json(review);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Advisor failed.';
      res.status(502).json({ error: message });
    }
  }),
);
