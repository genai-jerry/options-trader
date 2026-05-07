/**
 * AdvisorService — bridges the rules engine, the SQLite repo, and the
 * provider-neutral AIProvider. Builds the system prompt, exposes the tools
 * the model needs, and runs single-shot critiques and streaming chat.
 */

import {
  accountToSnapshot,
  evaluateDecision,
  formatINR,
  type DecisionRecord,
  type NewTradeInput,
} from '@options-trader/shared';
import type { UserRepo } from '../db/repo.js';
import { newId, nowISO } from '../routes/_helpers.js';
import type {
  AIProvider,
  ChatTextMessage,
  StreamEvent,
  ToolDefinition,
} from './types.js';

// ─── System prompt ────────────────────────────────────────────────────

const PHILOSOPHY = `\
INVESTMENT PHILOSOPHY (verbatim from the spec — do not soften):

Phases:
- BOOTSTRAP: original principal X is at risk. Goal: cumulative net realizedPnL ≥ 2X. Losses subtract; the 2X target does not move.
- SELF_SUSTAINING: original X has been pulled out into setAside. Only profits remain in play.
- LOCKED: corpus has fallen to ≤ 0.5X. New entries are blocked.

Rules:
- R1: BOOTSTRAP close that brings cumulative net realizedPnL ≥ 2X moves principal X into setAside; phase → SELF_SUSTAINING.
- R2: SELF_SUSTAINING profitable close: fees = gross × feePercent; net = gross − fees; queue a PendingWithdrawal of net/2.
- R3: corpus ≤ 0.5X → phase = LOCKED, new entries blocked.
- R4: User unlock action; recorded with audit timestamp.
- R5: User confirms a PendingWithdrawal: corpus -= amount, cashWithdrawn += amount.
- Losses simply debit the corpus. No fees on losses. No split.

Decision checks (deterministic engine the user trusts as ground truth):
- C1 (BLOCK) phase ≠ LOCKED.
- C2 (BLOCK) capitalRequired ≤ investableCorpus.
- C5 (WARN)  capitalRequired ≤ positionSizeCap × corpus (if cap > 0).
- C6 (WARN)  no other OPEN trade on the same symbol.
`;

const FRAMING = `\
You are an options-trading advisor. Be concrete and brief.

OUTPUT DISCIPLINE:
1. Never instruct the user to place orders or claim you can. Your output is advisory only.
2. Always call the evaluate_decision tool BEFORE issuing a verdict for a specific trade idea. Never override a deterministic BLOCK — return BLOCK regardless of how attractive the trade looks.
3. Talk about delta, gamma, theta, vega when they matter. Flag IV percentiles. Treat earnings/expiry/event risk explicitly. Distinguish directional vs theta vs volatility plays. Insist on a defined max loss for any trade.
4. End every recommendation with a one-line "Philosophy alignment: …" tying it back to the user's current phase, lock floor, position-size cap, and (in BOOTSTRAP) the 2X goal.
5. No certainty theater. If you don't know IV percentile or live greeks, say so and recommend the user pull them.
`;

export function buildSystemPrompt(): string {
  return `${PHILOSOPHY}\n${FRAMING}`;
}

// ─── Tool definitions ─────────────────────────────────────────────────

export const TOOLS: ToolDefinition[] = [
  {
    name: 'get_account_state',
    description:
      'Return the live AccountSnapshot: phase, principalX, corpus, setAside, cashWithdrawn, realizedPnL, feesPaid, feePercent, positionSizeCap, lockFloorDistance.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_open_trades',
    description: 'Return all currently OPEN trades.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_recent_closed',
    description: 'Return up to N most recently CLOSED trades.',
    input_schema: {
      type: 'object',
      properties: {
        n: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
      },
    },
  },
  {
    name: 'evaluate_decision',
    description:
      'Run the deterministic rules engine (C1, C2, C5, C6) against a proposed NewTradeInput. ' +
      'Returns the full DecisionRecord including the verdict and per-check breakdown. ' +
      'You MUST call this before issuing your own verdict and you MUST NOT override a BLOCK.',
    input_schema: {
      type: 'object',
      required: ['symbol', 'instrument', 'expiry', 'lotSize', 'qty', 'entryPrice'],
      properties: {
        symbol: { type: 'string' },
        instrument: { type: 'string', enum: ['CE', 'PE', 'FUT'] },
        strike: { type: 'integer', description: 'paise; required for CE/PE' },
        expiry: { type: 'string', description: 'YYYY-MM-DD' },
        lotSize: { type: 'integer', minimum: 1 },
        qty: { type: 'integer', minimum: 1 },
        entryPrice: { type: 'integer', description: 'paise per unit' },
        notes: { type: 'string' },
        agentSource: { type: 'string' },
      },
    },
  },
];

// ─── Tool handler factory ─────────────────────────────────────────────

export function createToolHandler(repo: UserRepo) {
  return async function handler(
    name: string,
    input: Record<string, unknown>,
  ): Promise<string> {
    switch (name) {
      case 'get_account_state': {
        const snap = accountToSnapshot(repo.getAccount());
        return JSON.stringify(snap);
      }
      case 'get_open_trades': {
        return JSON.stringify(repo.listTrades({ status: 'OPEN' }));
      }
      case 'get_recent_closed': {
        const n = typeof input.n === 'number' ? Math.min(50, Math.max(1, input.n)) : 10;
        const closed = repo.listTrades({ status: 'CLOSED' }).slice(0, n);
        return JSON.stringify(closed);
      }
      case 'evaluate_decision': {
        const tradeInput = input as unknown as NewTradeInput;
        const account = repo.getAccount();
        const snapshot = accountToSnapshot(account);
        const open = repo.listTrades({ status: 'OPEN' });
        const decision = evaluateDecision(tradeInput, snapshot, open, {
          id: newId(),
          decidedAt: nowISO(),
        });
        return JSON.stringify(decision);
      }
      default:
        return `Unknown tool: ${name}`;
    }
  };
}

// ─── Rate limiter ─────────────────────────────────────────────────────

interface RateLimitState {
  minuteWindow: number;
  minuteCount: number;
  dayWindow: number;
  dayCount: number;
}

export class RateLimiter {
  private state: RateLimitState = {
    minuteWindow: 0,
    minuteCount: 0,
    dayWindow: 0,
    dayCount: 0,
  };
  constructor(
    private perMinute: number,
    private perDay: number,
  ) {}

  /** Returns null if allowed, else a human-readable error string. */
  check(): string | null {
    const now = Date.now();
    const minute = Math.floor(now / 60_000);
    const day = Math.floor(now / 86_400_000);

    if (this.state.minuteWindow !== minute) {
      this.state.minuteWindow = minute;
      this.state.minuteCount = 0;
    }
    if (this.state.dayWindow !== day) {
      this.state.dayWindow = day;
      this.state.dayCount = 0;
    }
    if (this.state.minuteCount >= this.perMinute) {
      return `Rate limit: ${this.perMinute}/minute reached. Wait a moment.`;
    }
    if (this.state.dayCount >= this.perDay) {
      return `Rate limit: ${this.perDay}/day reached.`;
    }
    this.state.minuteCount += 1;
    this.state.dayCount += 1;
    return null;
  }
}

// ─── Service entry points ─────────────────────────────────────────────

export interface DecideRequest {
  input: NewTradeInput;
}

export interface DecideResponse {
  verdict: 'GO' | 'WARN' | 'BLOCK';
  summary: string;
  points: string[];
  rulesAlignment: string;
  /** The deterministic decision (always honoured). */
  rules: DecisionRecord;
  /** Tool calls the model made, for audit. */
  toolTrace: { name: string; output: string }[];
}

export class AdvisorService {
  constructor(
    private repo: UserRepo,
    private provider: AIProvider,
    private limiter: RateLimiter,
  ) {}

  async decide(req: DecideRequest): Promise<DecideResponse> {
    const limit = this.limiter.check();
    if (limit) throw new Error(limit);

    const account = this.repo.getAccount();
    const snapshot = accountToSnapshot(account);
    const open = this.repo.listTrades({ status: 'OPEN' });
    const rules = evaluateDecision(req.input, snapshot, open, {
      id: newId(),
      decidedAt: nowISO(),
    });

    const userMsg = `\
Critique the following trade idea. Call evaluate_decision first.

Input (paise; entryPrice is per unit):
${JSON.stringify(req.input, null, 2)}

Account snapshot for context:
${JSON.stringify(snapshot, null, 2)}

Open positions count: ${open.length}.

Return: a one-paragraph summary, a bulleted list of points (3–6 short bullets), and a final "Philosophy alignment: …" line.
`;

    const result = await this.provider.run({
      system: buildSystemPrompt(),
      messages: [{ role: 'user', content: userMsg }],
      tools: TOOLS,
      toolHandler: createToolHandler(this.repo),
    });

    // Parse the model text into summary + bullets + alignment heuristically.
    const lines = result.text.split('\n').map((l) => l.trim()).filter(Boolean);
    const points: string[] = [];
    const summaryLines: string[] = [];
    let alignment = '';
    for (const l of lines) {
      if (/^philosophy alignment[: ]/i.test(l)) {
        alignment = l.replace(/^philosophy alignment[: ]\s*/i, '');
      } else if (/^[-*•]\s+/.test(l)) {
        points.push(l.replace(/^[-*•]\s+/, ''));
      } else {
        summaryLines.push(l);
      }
    }

    return {
      verdict: rules.verdict, // deterministic engine wins
      summary: summaryLines.join(' ') || result.text.slice(0, 400),
      points,
      rulesAlignment:
        alignment ||
        `Phase ${snapshot.phase}; corpus ${formatINR(snapshot.investableCorpus)}.`,
      rules,
      toolTrace: result.toolCalls.map((t) => ({ name: t.name, output: t.output })),
    };
  }

  async chat(opts: {
    messages: ChatTextMessage[];
    onEvent: (e: StreamEvent) => void;
    signal?: AbortSignal;
  }): Promise<void> {
    const limit = this.limiter.check();
    if (limit) {
      opts.onEvent({ type: 'error', data: limit });
      opts.onEvent({ type: 'done', data: '' });
      return;
    }
    await this.provider.stream({
      system: buildSystemPrompt(),
      messages: opts.messages,
      tools: TOOLS,
      toolHandler: createToolHandler(this.repo),
      onEvent: opts.onEvent,
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    });
  }

  async portfolioReview(): Promise<{
    observations: string[];
    riskFlags: string[];
    suggestions: string[];
  }> {
    const limit = this.limiter.check();
    if (limit) throw new Error(limit);

    const account = this.repo.getAccount();
    const snapshot = accountToSnapshot(account);
    const open = this.repo.listTrades({ status: 'OPEN' });
    const closed = this.repo.listTrades({ status: 'CLOSED' }).slice(0, 10);

    const userMsg = `\
Daily portfolio review. Current snapshot:

${JSON.stringify(snapshot, null, 2)}

Open positions:
${JSON.stringify(open, null, 2)}

Recent closed:
${JSON.stringify(closed.slice(0, 10), null, 2)}

Output three short sections, plain text, one bullet per line:
OBSERVATIONS:
- …
RISK_FLAGS:
- …
SUGGESTIONS:
- …
`;

    const result = await this.provider.run({
      system: buildSystemPrompt(),
      messages: [{ role: 'user', content: userMsg }],
      tools: TOOLS,
      toolHandler: createToolHandler(this.repo),
    });

    return parseReview(result.text);
  }
}

function parseReview(text: string): {
  observations: string[];
  riskFlags: string[];
  suggestions: string[];
} {
  const sections: Record<'observations' | 'riskFlags' | 'suggestions', string[]> = {
    observations: [],
    riskFlags: [],
    suggestions: [],
  };
  let current: keyof typeof sections | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (/^OBSERVATIONS[: ]/i.test(line)) current = 'observations';
    else if (/^RISK_FLAGS[: ]/i.test(line)) current = 'riskFlags';
    else if (/^SUGGESTIONS[: ]/i.test(line)) current = 'suggestions';
    else if (current && /^[-*•]\s+/.test(line)) {
      sections[current].push(line.replace(/^[-*•]\s+/, ''));
    }
  }
  return sections;
}
