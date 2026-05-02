# Options Trading Tracker — Session Context

**Read this file first.** It tells a fresh Claude session what the project is,
what's already done, and where to pick up.

Companion docs (read in this order):
1. `OPTIONS_TRADING_TRACKER_SPEC.md` — the design.
2. `OPTIONS_TRADING_TRACKER_DECISIONS.md` — the *why* behind each design choice.
3. `OPTIONS_TRADING_TRACKER_BUILD_PLAN.md` — the ordered build steps.

---

## What this is

A personal web app for tracking options-trading capital, enforcing a phase-based
investment philosophy (BOOTSTRAP → SELF_SUSTAINING → LOCKED), with an AI
advisor and live Zerodha Kite integration.

Single user. Built for the user's own use. Live broker data, advisory AI, no
auto-trading.

## Repo

`https://github.com/genai-jerry/options-trader` — separate from `lighthouse-ui`.
Default branch: `main`.

## Tech stack

- **Monorepo** — npm workspaces.
- **`apps/web`** — React 19 + TS + Vite + MUI v7 + Zustand + react-query +
  react-router + react-hook-form + zod.
- **`apps/server`** — Node + Express + TS (run via `tsx`) + better-sqlite3 +
  zod-parsed env. The only side that talks to Zerodha and the LLM provider.
- **`packages/shared`** — TS types and the pure rules engine, imported by
  both apps via workspace alias.
- **AI** — Anthropic Claude (latest family) by default, behind a pluggable
  `AIProvider` interface.

## Current state

- **Spec is locked.** All design decisions are recorded in DECISIONS.md.
  Don't relitigate them without checking with the user.
- **Repo was deleted and re-created.** The earlier `ef0fe88` scaffold no
  longer exists. The current branch `claude/review-docs-build-plan-4mHxf`
  rebuilds Steps 1 and 2 together in one branch (per user request) and is
  the working branch for the rest of v1.
- **Steps 1 and 2 are being rebuilt in this branch.** Step 1 (monorepo
  scaffold) and Step 2 (persistence) land together; subsequent steps follow
  the build plan in order.
- **Steps 3–12 are pending.** After Step 2 lands, start at Step 3 (Domain
  rules engine).

## Hard constraints to keep in mind

- **Money is paise.** Always integer paise in storage and computation. Format
  at the view layer only. Never let a `number` representing rupees enter
  domain code.
- **Backend owns secrets.** Kite Connect `api_secret` and the LLM API key
  live only in `apps/server/.env`. Never ship them to the browser; never log
  them; never echo them in error messages.
- **Rules engine is pure.** `packages/shared/src/domain/rules.ts` is the
  single source of truth for R1–R5 and C1–C6. Both web and server import it.
  Tests live next to it. No side effects in this file — ever.
- **AI cannot override deterministic BLOCK.** The advisor's system prompt
  enforces this; the backend also re-checks. If `evaluate_decision` returns
  BLOCK, the trade cannot be accepted regardless of how persuasive the AI is.
- **`principalX` is locked once any trade exists.** Only the "Reset
  everything" action can change it.
- **Withdrawals require user confirmation.** Auto-deduction was explicitly
  rejected (D6). Profit splits queue as PENDING; only CONFIRMED withdrawals
  reduce the corpus.
- **No multi-leg in v1.** Each option leg is one independent `Trade`. A
  `Strategy` entity is a post-v1 concern.
- **Read-only Zerodha.** No order placement. Display funds, holdings,
  positions, orderbook only.

## Branch and commit conventions

- Default branch: `main` on `genai-jerry/options-trader`.
- Working branch in this Claude session: `claude/review-docs-build-plan-4mHxf`.
  Per user direction, Steps 1 and 2 land together on this branch instead of
  the per-step branches the build plan describes.
- Commit messages reference the step (e.g. `Step 1+2: scaffold + persistence`).

## Where to start in a fresh session

1. Confirm the four `OPTIONS_TRADING_TRACKER_*.md` docs are in your context.
2. Read SPEC, then DECISIONS, then BUILD_PLAN, then this file again.
3. `git log --oneline` and check the HEAD on
   `claude/review-docs-build-plan-4mHxf` to see how far Steps 1+2 have
   progressed.
4. Resume from the next pending step in BUILD_PLAN.md.
