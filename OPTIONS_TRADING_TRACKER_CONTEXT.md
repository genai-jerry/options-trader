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
- **Step 1 (monorepo scaffold) is done locally.** During the planning
  session a 32-file scaffold was committed as `ef0fe88` on `main` in the
  user's `~/options-trader` directory.
- **GitHub state may be inconsistent.** A previous mishap force-pushed
  `lighthouse-ui`'s history into the `options-trader` GitHub repo. The user
  was given recovery steps (force-push the local scaffold to overwrite). At
  the start of a new session, **verify** `github.com/genai-jerry/options-trader`
  shows commit `ef0fe88` with 32 files including `apps/`, `packages/`,
  `docs/SPEC.md`. If not, see "Recovery" below.
- **Steps 2–12 are pending.** Start at Step 2 (Persistence) per the build
  plan.

## Recovery (if GitHub is still wrong)

The local scaffold lives at `~/options-trader` on the user's Mac.

```bash
cd ~/options-trader
git log --oneline   # confirm ef0fe88 is HEAD
git remote -v       # should be https://github.com/genai-jerry/options-trader.git
git push --force -u origin main
```

If the local copy doesn't exist either, regenerate Step 1 from the build plan
and the spec — it's straightforward, and the scaffold structure is fully
described there.

While you're at it, ensure `~/lighthouse-ui` has the right remote:
```bash
cd ~/lighthouse-ui
git remote set-url origin https://github.com/genai-jerry/lighthouse-ui.git
```

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
- One feature branch per build-plan step:
  `step-2-persistence`, `step-3-rules-engine`, `step-4-rest-api`, etc.
- Commit messages reference the step (e.g. `Step 3: rules engine R1–R3`).
- Don't push directly to `main` once Step 1 is on GitHub — open a PR per
  step so the user can review.

## Harness allowlist note

Earlier sessions had `genai-jerry/options-trader` blocked in this Claude
environment (the local git proxy and signing server were scoped only to
`lighthouse-ui`). Verify at the start of a new session that the new repo is
allowlisted; if not, ask the user to update the harness or to grant explicit
permission for `--no-gpg-sign` commits.

## Where to start in a fresh session

1. Confirm the four `OPTIONS_TRADING_TRACKER_*.md` docs are in your context.
2. Read SPEC, then DECISIONS, then BUILD_PLAN, then this file again.
3. Verify GitHub state per "Current state" above. Do recovery if needed.
4. Pull `~/options-trader` to confirm the local scaffold is intact.
5. Start Step 2 (Persistence: SQLite schema + migrations) on a feature
   branch.
