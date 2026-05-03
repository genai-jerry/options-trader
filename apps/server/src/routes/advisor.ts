import { Router } from 'express';
import { z } from 'zod';
import type { AdvisorMessage } from '@options-trader/shared';
import { env } from '../env.js';
import { getDb } from '../db/index.js';
import { createRepo } from '../db/repo.js';
import { newId, nowISO, parseBody, wrap } from './_helpers.js';
import {
  AdvisorService,
  RateLimiter,
} from '../ai/AdvisorService.js';
import { createAnthropicProvider } from '../ai/providers/anthropic.js';
import type { AIProvider } from '../ai/types.js';

export const advisorRouter = Router();

let _service: AdvisorService | null = null;

function getService(): AdvisorService | null {
  if (_service) return _service;
  if (env.AI_PROVIDER !== 'anthropic') return null;
  if (!env.ANTHROPIC_API_KEY) return null;

  const repo = createRepo(getDb());
  const provider: AIProvider = createAnthropicProvider({
    apiKey: env.ANTHROPIC_API_KEY,
    defaultModel: env.AI_MODEL,
  });
  _service = new AdvisorService(repo, provider, new RateLimiter(20, 500));
  return _service;
}

function ensureEnabled(): { ok: true; service: AdvisorService } | { ok: false; reason: string } {
  const repo = createRepo(getDb());
  const account = repo.getAccount();
  if (!account.aiEnabled) {
    return { ok: false, reason: 'AI advisor is disabled in Settings.' };
  }
  const service = getService();
  if (!service) {
    return {
      ok: false,
      reason: `AI provider not configured. Set ANTHROPIC_API_KEY in apps/server/.env (provider=${env.AI_PROVIDER}).`,
    };
  }
  return { ok: true, service };
}

// ─── Status ───────────────────────────────────────────────────────────

advisorRouter.get(
  '/status',
  wrap((_req, res) => {
    const repo = createRepo(getDb());
    const account = repo.getAccount();
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
  wrap((_req, res) => {
    const repo = createRepo(getDb());
    res.json(repo.listConversations(20));
  }),
);

advisorRouter.get(
  '/conversations/:id',
  wrap((req, res) => {
    const id = String(req.params.id);
    const repo = createRepo(getDb());
    res.json(repo.listAdvisorMessages(id));
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
  expectedExit: z.number().int().nonnegative(),
  maxAcceptableLoss: z.number().int().nonnegative(),
  notes: z.string().optional(),
  agentSource: z.string().optional(),
});

const DecideSchema = z.object({ input: NewTradeInputSchema });

advisorRouter.post(
  '/decide',
  wrap(async (req, res) => {
    const body = parseBody(DecideSchema, req, res);
    if (!body) return;

    const guard = ensureEnabled();
    if (!guard.ok) {
      res.status(409).json({ error: guard.reason });
      return;
    }

    try {
      const out = await guard.service.decide(body);
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

    const guard = ensureEnabled();
    if (!guard.ok) {
      res.status(409).json({ error: guard.reason });
      return;
    }

    const conversationId = body.conversationId ?? newId();
    const repo = createRepo(getDb());

    // Persist the latest user message.
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

    // SSE setup.
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
    await guard.service.chat({
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
  wrap(async (_req, res) => {
    const guard = ensureEnabled();
    if (!guard.ok) {
      res.status(409).json({ error: guard.reason });
      return;
    }
    try {
      const review = await guard.service.portfolioReview();
      res.json(review);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Advisor failed.';
      res.status(502).json({ error: message });
    }
  }),
);
