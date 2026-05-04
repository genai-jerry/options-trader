# Options Trader

A personal options-trading capital tracker with a phase-based investment
philosophy, an AI advisor, and a (planned) live Zerodha Kite integration.

The app forces discipline on a single-user options book by making the rules
engine — not the user — decide whether a trade is allowed, how profits are
split, and when the account locks. Every amount is stored as **integer paise**
to avoid float drift; only the view layer formats to `₹`.

> Status: feature-complete for v1. All twelve build-plan steps are
> implemented — Decision Helper, Trades list with close action, Withdrawals
> tabs, Dashboard with lock-floor gauge / equity curve / recent decisions,
> AI Advisor (decide + streaming chat + portfolio review), Zerodha read-only
> integration, JSON backup/restore, error boundary, and keyboard shortcuts.
> The app is dockerised and ships with a GitHub Actions workflow that
> builds, pushes to GHCR, and deploys to an Amazon Lightsail VM.

---

## Table of contents

1. [What this system does](#what-this-system-does)
2. [Tech stack](#tech-stack)
3. [Repository layout](#repository-layout)
4. [Prerequisites](#prerequisites)
5. [Setup](#setup)
6. [Configuration](#configuration)
7. [Running the app](#running-the-app)
8. [First-time use](#first-time-use)
9. [Screens](#screens)
10. [Investment philosophy (rules engine)](#investment-philosophy-rules-engine)
11. [REST API reference](#rest-api-reference)
12. [Database & migrations](#database--migrations)
13. [Testing, type-checking, formatting](#testing-type-checking-formatting)
14. [Resetting / backups](#resetting--backups)
15. [Docker](#docker)
16. [Deploying to Amazon Lightsail](#deploying-to-amazon-lightsail)
17. [Keyboard shortcuts](#keyboard-shortcuts)
18. [Troubleshooting](#troubleshooting)

---

## What this system does

- **Tracks every options trade** — entry, exit, fees, gross / net P&L.
- **Enforces a four-stage philosophy** automatically: `BOOTSTRAP` →
  `SELF_SUSTAINING` → `LOCKED`, with a profit-split queue and a hard lock
  floor at `0.5 × principal`.
- **Decision Helper** runs deterministic checks (C1–C6) against a proposed
  trade and returns `GO` / `WARN` / `BLOCK`. The server refuses BLOCKed
  trades.
- **AI Advisor** (planned, Step 10) calls Anthropic Claude server-side with
  tool access to the rules engine and account state. Never auto-places
  orders; can never override a deterministic BLOCK.
- **Zerodha sync** (planned, Step 11) pulls live funds / holdings /
  positions / orders read-only via Kite Connect.

## Tech stack

| Layer        | Choice                                                                             |
| ------------ | ---------------------------------------------------------------------------------- |
| Frontend     | React 19 + TypeScript, Vite, MUI v7, MUI X Charts/DataGrid, react-router-dom       |
| State / data | react-query (server state), Zustand (transient UI), react-hook-form + zod (forms)  |
| Backend      | Node 20+, Express, TypeScript via `tsx`, dotenv + zod env parsing                  |
| Database     | SQLite via `better-sqlite3`, schema-versioned migrations                           |
| Tests        | vitest (shared domain + server)                                                    |
| AI provider  | Anthropic Claude (default `claude-sonnet-4-6`); pluggable for OpenAI later        |
| Broker       | Zerodha Kite Connect (server-side OAuth + REST proxy)                              |

## Repository layout

```
options-trader/
├── apps/
│   ├── server/                         # Express + SQLite backend
│   │   ├── .env.example
│   │   └── src/
│   │       ├── index.ts                # boot, route mounting, shutdown
│   │       ├── env.ts                  # zod-parsed env
│   │       ├── db/
│   │       │   ├── index.ts            # opens DB, runs migrations
│   │       │   ├── migrate.ts          # versioned migration runner
│   │       │   ├── repo.ts             # typed CRUD helpers
│   │       │   ├── schema.sql
│   │       │   └── migrations/001_initial.sql
│   │       └── routes/
│   │           ├── account.ts          # GET/PUT/POST account, settings, principal, reset, unlock
│   │           ├── trades.ts           # list, open, close
│   │           ├── withdrawals.ts      # list, confirm, cancel
│   │           ├── health.ts           # /api/health, /api/health/db
│   │           └── _helpers.ts
│   └── web/                            # Vite + React frontend
│       ├── vite.config.ts              # proxies /api → http://localhost:4000
│       └── src/
│           ├── main.tsx
│           ├── router.tsx
│           ├── components/AppShell.tsx
│           ├── pages/                  # Dashboard, Trades, NewTrade, Withdrawals,
│           │                           # AIAdvisor, Settings, ZerodhaSync
│           └── api/{client,hooks}.ts   # fetch + react-query wrappers
├── packages/
│   └── shared/                         # types + pure domain code shared by both apps
│       ├── src/
│       │   ├── types.ts                # Account, Trade, PendingWithdrawal, …
│       │   └── domain/
│       │       ├── money.ts            # paise helpers, formatINR
│       │       └── rules.ts            # applyRulesOnClose, evaluateDecision, …
│       └── test/rules.spec.ts          # 29 tests covering R1–R5, C1–C6
├── docs/SPEC.md
├── OPTIONS_TRADING_TRACKER_SPEC.md
├── OPTIONS_TRADING_TRACKER_BUILD_PLAN.md
├── OPTIONS_TRADING_TRACKER_DECISIONS.md
├── OPTIONS_TRADING_TRACKER_CONTEXT.md
├── package.json                        # npm workspaces root
└── tsconfig.base.json
```

## Prerequisites

- **Node.js ≥ 20** (set in `package.json#engines.node`)
- **npm ≥ 10** (any npm shipped with Node 20 works)
- **A C toolchain** for `better-sqlite3` to compile its native module on
  install: `build-essential` on Debian/Ubuntu, Xcode CLT on macOS,
  windows-build-tools on Windows.
- **(Optional)** An Anthropic API key for the AI advisor (Step 10).
- **(Optional)** Zerodha Kite Connect API key + secret for the broker
  integration (Step 11).

## Setup

```bash
# 1. Clone and install — the workspace root installs every workspace at once.
git clone <this-repo-url> options-trader
cd options-trader
npm install

# 2. Create the server env file from the template.
cp apps/server/.env.example apps/server/.env

# 3. Create the SQLite data directory (the file is created on first boot).
mkdir -p apps/server/data
```

`apps/server/data/` and `apps/server/.env` are both gitignored.

## Configuration

### Server environment (`apps/server/.env`)

Parsed by `apps/server/src/env.ts` with zod — invalid values fail fast at
boot.

| Variable            | Required | Default                            | Notes                                                                       |
| ------------------- | -------- | ---------------------------------- | --------------------------------------------------------------------------- |
| `PORT`              | no       | `4000`                             | Backend HTTP port. The Vite dev server proxies `/api` here.                 |
| `NODE_ENV`          | no       | `development`                      | One of `development` / `production` / `test`.                               |
| `DB_PATH`           | no       | `./data/options-trader.sqlite`     | Path to the SQLite file. Relative paths resolve from `apps/server/`.        |
| `KITE_API_KEY`      | optional | empty                              | Zerodha Kite Connect API key. *Optional* — can also be set in Settings → Zerodha credentials (DB takes precedence). |
| `KITE_API_SECRET`   | optional | empty                              | Zerodha Kite Connect API secret. Server-side only; never leaves the server. |
| `ANTHROPIC_API_KEY` | Step 10  | empty                              | Anthropic API key for the AI Advisor.                                       |
| `AI_PROVIDER`       | no       | `anthropic`                        | `anthropic` or `openai`.                                                    |
| `AI_MODEL`          | no       | `claude-sonnet-4-6`                | Model id passed to the provider.                                            |

> The Vite dev server reads `SERVER_PORT` (defaults to `4000`) to wire up
> the `/api` proxy. If you change `PORT` in the server env, run the web
> dev script with the matching value: `SERVER_PORT=4100 npm run dev:web`.

### In-app preferences (set from the Settings page)

These live in the SQLite `account` row, **not** in `.env`:

| Field             | Default | Meaning                                                                |
| ----------------- | ------- | ---------------------------------------------------------------------- |
| `principalX`      | unset   | Starting capital (paise). Locked once any trade exists.                |
| `feePercent`      | `0.05`  | Fraction of profit charged as fees on `SELF_SUSTAINING` profitable closes. |
| `positionSizeCap` | `0.25`  | Soft cap for check C5. Set to `0` to disable the cap WARN.             |
| `aiEnabled`       | `true`  | Master switch for all server-side advisor calls (Step 10).             |

## Running the app

### Dev (both apps in parallel)

```bash
npm run dev
```

This runs `dev:server` (`tsx watch` on the Express app, port 4000) and
`dev:web` (`vite`, port 5173) together via `npm-run-all`.

- Web app: http://localhost:5173
- API:     http://localhost:4000/api/health

### Run one at a time

```bash
npm run dev:server      # backend only
npm run dev:web         # frontend only (calls /api → proxied to 4000)
```

### Background start / stop scripts

For longer-running sessions where you don't want a terminal window open
holding the foreground process, the repo ships start/stop scripts. They
spawn each side under `setsid` so the entire process tree (npm → tsx →
node, etc.) is killed cleanly on stop. PIDs and logs land in `.run/`
(gitignored).

```bash
npm run start            # both apps in the background; tails:
                         #   .run/server.log + .run/web.log
npm run stop             # SIGTERMs the whole tree, falls back to SIGKILL
                         # after 5s if anything's still alive

# Single-process prod-style run: builds the SPA and serves it from Express.
npm run start:prod
npm run stop:prod

# Docker compose (uses docker-compose.yml).
npm run start:docker     # docker compose up -d --build
npm run stop:docker      # docker compose down
```

Equivalent direct invocations: `scripts/start.sh [--dev|--prod|--docker]`
and `scripts/stop.sh [--dev|--prod|--docker]`. Defaults to `--dev`.

### Production-style build (no deploy yet)

```bash
npm run build           # build:shared → build:server → build:web
```

`build:server` and `build:shared` currently only run `tsc --noEmit`
(type-check); production deployment is out of scope for v1. `build:web`
produces a static `dist/` you can serve from any web server, with `/api`
reverse-proxied to the Node process.

## First-time use

```
   ┌────────────────────────────────┐
1. │ Start dev servers              │   npm run dev
   └──────────────┬─────────────────┘
                  ▼
   ┌────────────────────────────────┐
2. │ Open http://localhost:5173     │   you land on Dashboard
   └──────────────┬─────────────────┘
                  ▼
   ┌────────────────────────────────┐
3. │ Settings → set Principal X     │   one-time; locks after 1st trade
   └──────────────┬─────────────────┘
                  ▼
   ┌────────────────────────────────┐
4. │ Settings → tune fee% / cap%    │   defaults: 5% / 25%
   └──────────────┬─────────────────┘
                  ▼
   ┌────────────────────────────────┐
5. │ New Trade → fill form          │   verdict shown live
   │ Accept                         │   creates OPEN trade, debits corpus
   └──────────────┬─────────────────┘
                  ▼
   ┌────────────────────────────────┐
6. │ Trades → Close with exit price │   runs R1/R2/R3, may queue R2 split
   └──────────────┬─────────────────┘
                  ▼
   ┌────────────────────────────────┐
7. │ Withdrawals → Confirm / Cancel │   R5 moves cash out (or keeps it)
   └────────────────────────────────┘
```

## Screens

The left rail (always visible) holds: **Dashboard · Trades · New Trade ·
Withdrawals · AI Advisor · Zerodha Sync · Settings**.

### App shell

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ▓▓ Options Trader                                                  AppBar│
├────────────┬─────────────────────────────────────────────────────────────┤
│ Dashboard  │                                                             │
│ Trades     │                                                             │
│ New Trade  │                                                             │
│ Withdraw…  │                  ROUTE OUTLET (page content)                │
│ AI Advisor │                                                             │
│ Zerodha    │                                                             │
│ Settings   │                                                             │
└────────────┴─────────────────────────────────────────────────────────────┘
```

### 1. Dashboard

Live tiles from `/api/account`. Phase chip is colour-coded
(BOOTSTRAP=warning, SELF_SUSTAINING=success, LOCKED=error). The
distance-to-lock-floor tile turns warning when corpus drops below `0.75 × X`
and error when it crosses the floor.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Dashboard                                                [BOOTSTRAP]     │
├──────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐    │
│  │ INVESTABLE   │ │ SET ASIDE    │ │ CASH         │ │ PENDING      │    │
│  │ CORPUS       │ │              │ │ WITHDRAWN    │ │ WITHDRAWALS  │    │
│  │ ₹1,20,000    │ │ ₹0           │ │ ₹0           │ │ ₹0           │    │
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘    │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐    │
│  │ REALIZED P&L │ │ FEES PAID    │ │ DIST TO LOCK │ │ OPEN TRADES  │    │
│  │ ₹20,000      │ │ ₹0           │ │ ₹70,000      │ │ 0            │    │
│  │              │ │              │ │ Floor:50,000 │ │              │    │
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘    │
│                                                                          │
│  (Step 9 will add: equity curve, lock-floor gauge, recent decisions)     │
└──────────────────────────────────────────────────────────────────────────┘
```

### 2. Trades

MUI X DataGrid with status / instrument / symbol filters and an inline
**Close** action. The close dialog runs the rules engine on the server
side; the resulting `firedRules` (R1/R2/R3) and queued withdrawal show in
a toast.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Trades                                       [status ▾] [instrument ▾]  │
├──────────────────────────────────────────────────────────────────────────┤
│ Symbol  Inst  Strike   Expiry      Qty  Entry    Exit    P&L    Status  │
│ NIFTY   CE    20000    2026-05-29   2   180.00      —      —    OPEN  ▶ │
│ BANKNFY PE    45000    2026-05-22   1    95.50  120.00 +24,500  CLOSED  │
│ ...                                                                      │
└──────────────────────────────────────────────────────────────────────────┘

  Click ▶ to open the close dialog:
  ┌─────────────────────────┐
  │ Close NIFTY 20000 CE    │
  │ Exit price (₹): [____]  │
  │  [Cancel]      [Close]  │
  └─────────────────────────┘
```

### 3. New Trade — Decision Helper

A tab toggle at the top picks the input style. **Quick** is the default
on first load (the choice is then sticky in `localStorage`).

- **Quick (advisor mode)** *(default)* — only three money fields plus
  optional label, agent source, and notes. Use this when an advisor
  recommended the trade and you only care about the risk numbers. The
  form records the trade as a single FUT-style unit (`qty=1, lotSize=1,
  expiry=today+30d`) so the entered amounts are totals; every check
  (C1–C6) still runs against your live account.
- **Detailed** — full form (symbol, instrument, strike, expiry, lot
  size, qty, entry/expected/max-loss per unit). Use this when you're
  driving the trade yourself.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ New Trade                          [ Quick (advisor mode) | Detailed ]   │
├──────────────────────────────────┬──────────────────┬────────────────────┤
│  QUICK FORM                      │  VERDICT         │  AI ADVISOR        │
│  Capital deployed   [ ₹ 50000 ]  │  ┌────────────┐  │  ┌──────────────┐  │
│  Expected exit val. [ ₹ 70000 ]  │  │    GO      │  │  │ Streaming…   │  │
│  Max acceptable loss[ ₹ 15000 ]  │  └────────────┘  │  │              │  │
│  ──── Optional ────              │  C1 phase OK     │  │              │  │
│  Label              [_________]  │  C2 cap   OK     │  │              │  │
│  Agent source       [_________]  │  C3 floor OK     │  │              │  │
│  Notes              [_________]  │  C4 R/R 1.33 ⚠   │  └──────────────┘  │
│                                  │  C5 size 50% ⚠   │                    │
│  [   Accept & open trade   ]     │  C6 dup OK       │                    │
└──────────────────────────────────┴──────────────────┴────────────────────┘
```

The toggle is sticky (saved in `localStorage` as
`options-trader.newTrade.mode`); first-time users land on Quick.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ New Trade                                                                │
├──────────────────────────────────┬──────────────────┬────────────────────┤
│  FORM (react-hook-form + zod)    │  VERDICT         │  AI ADVISOR        │
│  Symbol      [NIFTY        ]     │  ┌────────────┐  │  ┌──────────────┐  │
│  Instrument  [CE ▾]              │  │   WARN     │  │  │ Streaming…   │  │
│  Strike      [20000        ]     │  └────────────┘  │  │              │  │
│  Expiry      [2026-05-29   ]     │  C1 phase OK     │  │              │  │
│  Lot size    [50           ]     │  C2 cap  OK      │  │              │  │
│  Qty (lots)  [2            ]     │  C3 floor OK     │  │              │  │
│  Entry ₹     [180.00       ]     │  C4 R/R 1.5 ⚠    │  └──────────────┘  │
│  Exp. exit ₹ [220.00       ]     │  C5 size 30% ⚠   │                    │
│  Max loss ₹  [4000         ]     │  C6 dup OK       │                    │
│  Notes       [_____________]     │                  │                    │
│  Source      [external bot ]     │  [   Accept   ]  │                    │
└──────────────────────────────────┴──────────────────┴────────────────────┘
```

Verdict states:
- **GO** (green) — all checks OK. Accept enabled.
- **WARN** (amber) — one or more soft warnings (C4/C5/C6). Accept still enabled.
- **BLOCK** (red) — at least one hard fail (C1/C2/C3). Accept disabled; the
  server also returns 409 if you try.

### 4. Withdrawals

Top action: **Withdraw cash** — manual withdrawal of any amount up to
`corpus − 0.5 × principalX` (the lock floor). Goes straight to
`CONFIRMED`, reduces the corpus, and adds to `cashWithdrawn` so it
counts toward "principal recovered" on the Dashboard.

Three tabs: **Pending** / **Confirmed** / **Cancelled**. Each row shows
a `MANUAL` or `AUTO` chip so you can tell user-initiated withdrawals
from R2-driven splits.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Withdrawals     [Pending ▎ Confirmed ▎ Cancelled]                        │
├──────────────────────────────────────────────────────────────────────────┤
│ Amount     Created       From trade               Action                 │
│ ₹9,500     2026-05-03    NIFTY 20000 CE 2026-05  [Confirm] [Cancel]      │
│ ₹4,200     2026-05-02    BANKNFY 45000 PE …      [Confirm] [Cancel]      │
└──────────────────────────────────────────────────────────────────────────┘
```

`Confirm` debits the corpus and increments `cashWithdrawn`. `Cancel` keeps
the cash in the corpus and just marks the row CANCELLED.

### 5. AI Advisor

Standalone streaming chat. The Decision Helper hosts an embedded version
that calls `/api/advisor/decide` for one-shot critiques. All advisor
traffic goes server-side — the Anthropic API key never reaches the
browser. The model is required to call `evaluate_decision` before
issuing a verdict and never overrides a deterministic BLOCK.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ AI Advisor                                                       [Stop]  │
├──────────────────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────────┐          │
│ │ You: Should I roll the NIFTY 20000 CE up a strike?          │          │
│ └─────────────────────────────────────────────────────────────┘          │
│ ┌─────────────────────────────────────────────────────────────┐          │
│ │ Claude: Calling evaluate_decision… Calling get_account_state│          │
│ │ The current position is at delta 0.62 with theta of …       │          │
│ │ Philosophy alignment: WARN — rolls forward only inside size │          │
│ │ cap; you're at 23%, so headroom is fine.                    │          │
│ └─────────────────────────────────────────────────────────────┘          │
│ ──────────────────────────────────────────────────────────────────       │
│ [ Type a message…                                  ] [Send ▶ ]           │
└──────────────────────────────────────────────────────────────────────────┘
```

### 6. Settings *(implemented)*

Four sections, top to bottom: **Principal X**, **Preferences**, **AI
advisor** (placeholder), **Zerodha** (placeholder), **Reset everything**.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Settings                                                                 │
├──────────────────────────────────────────────────────────────────────────┤
│  Principal X                                                             │
│  ─────────────────────────────────────────────────────────────────────   │
│   Current X: ₹1,00,000                                                   │
│   [ ₹  100000      ]                                       [ Update X ]  │
│   (input disabled once any trade exists; use Reset below)                │
│                                                                          │
│  Preferences                                                             │
│  ─────────────────────────────────────────────────────────────────────   │
│   Fee percent     [ 5  % ]    Position-size cap [ 25 % ]                 │
│   [✓] AI advisor enabled                                                 │
│                                                       [ Save preferences]│
│                                                                          │
│  AI advisor   (placeholder — Step 10)                                    │
│  Zerodha      (placeholder — Step 11)                                    │
│                                                                          │
│  ┌── Reset everything ─────────────────────────────────────────────┐    │
│  │ Wipes all trades, decisions, withdrawals, advisor messages, and │    │
│  │ Zerodha sessions, and clears principal X.                       │    │
│  │                              [ Reset everything… ]              │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────┘
```

The reset dialog requires you to type **`RESET`** in a confirm field.

### 7. Zerodha Sync

Read-only. **Connect with Kite** opens the Kite login flow. Kite
redirects back with `?request_token=…&status=success` in the query
string; the page detects it and POSTs to `/api/zerodha/exchange-token`
automatically. Once connected, **Funds**, **Positions**, **Holdings**,
and **Orderbook** tabs render live data. The access token expires daily
at ~6 am IST — re-connect each trading day.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Zerodha Sync                                       Last sync: 13:42 IST  │
│                                                       [ Connect ]        │
├──────────────────────────────────────────────────────────────────────────┤
│  Funds        ₹X,XX,XXX available · ₹X,XXX used                          │
│                                                                          │
│  Holdings     Symbol   Qty  Avg cost    LTP    P&L                       │
│  Positions    Symbol   Net qty  Avg     LTP    Day P&L                   │
│  Orderbook    Order id, status, etc.                                     │
└──────────────────────────────────────────────────────────────────────────┘
```

## Investment philosophy (rules engine)

Pure functions in `packages/shared/src/domain/rules.ts`. The same code runs
in the browser (for the live verdict) and on the server (as the source of
truth on every write).

### Phases

| Phase             | Meaning                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------- |
| `BOOTSTRAP`       | Original `X` still at risk. Goal: cumulative net `realizedPnL ≥ 2X`. The 2X target does not move. |
| `SELF_SUSTAINING` | Original `X` has been pulled out into `setAside`. Only profits remain in play.           |
| `LOCKED`          | Investable corpus has fallen to `≤ 0.5 X`. New entries are blocked.                      |

### Rules

| Id  | Trigger                                                                              | Action                                                                                       |
| --- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| R1  | On close, `phase=BOOTSTRAP` and cumulative `realizedPnL ≥ 2X`                       | Move `X` from corpus to `setAside`; phase → `SELF_SUSTAINING`.                              |
| R2  | On profitable close, `phase=SELF_SUSTAINING`                                         | `fees = gross × feePercent`; `net = gross - fees`; enqueue a `PendingWithdrawal(net/2)`.    |
| R3  | On close, `corpus ≤ 0.5 X`                                                           | Phase → `LOCKED`. New entries blocked.                                                      |
| R4  | User unlock                                                                          | Phase → previous; `lockOverrideAt` recorded.                                                |
| R5  | User confirms a `PendingWithdrawal`                                                  | `corpus -= amount`; `cashWithdrawn += amount`. Cancel keeps the cash and marks CANCELLED.   |

### Decision Helper checks

| Id  | Rule                                                                                                                  | Severity |
| --- | --------------------------------------------------------------------------------------------------------------------- | -------- |
| C1  | `phase ≠ LOCKED`                                                                                                      | BLOCK    |
| C2  | `capitalRequired ≤ investableCorpus`                                                                                  | BLOCK    |
| C3  | `investableCorpus − maxAcceptableLoss ≥ 0.5 × principalX`                                                             | BLOCK    |
| C4  | `phase = BOOTSTRAP ⇒ rewardRiskRatio ≥ 2`                                                                             | WARN     |
| C5  | `positionSizeCap > 0 ⇒ capitalRequired ≤ positionSizeCap × investableCorpus` (set the cap to `0` to disable the warn) | WARN     |
| C6  | Same `symbol` not already open                                                                                        | WARN     |

Verdict: **BLOCK** if any BLOCK fires, else **WARN** if any WARN fires, else
**GO**. Accepting promotes the suggestion to an `OPEN` trade and debits the
corpus.

## REST API reference

All endpoints return JSON. Errors come back as `{ "error": string }` (and,
for `POST /api/trades` BLOCKs, the full `DecisionRecord` for audit).

### Health

```
GET  /api/health           → { status: "ok" }
GET  /api/health/db        → { status, schemaVersion, tables: string[] }
```

### Account

```
GET  /api/account                           → Account
PUT  /api/account/settings                  body: { feePercent?, positionSizeCap?, aiEnabled? }
POST /api/account/principal                 body: { principalX: paise }   (409 once any trade exists)
POST /api/account/reset                     body: { confirm: "RESET" }    (wipes everything)
POST /api/account/unlock                    (409 unless phase=LOCKED)
```

### Trades

```
GET  /api/trades?status=&instrument=&symbol=    → Trade[]
POST /api/trades                                body: NewTradeInput
                                                201 → { trade, decision }
                                                409 → { error, decision }   (BLOCK)
POST /api/trades/:id/close                      body: { exitPrice }
                                                → { trade, account, firedRules, queuedWithdrawal }
```

### Withdrawals

```
GET  /api/withdrawals?status=                   → PendingWithdrawal[]
POST /api/withdrawals                           body: { amount }
                                                → { withdrawal, account }   (manual; auto-CONFIRMED)
POST /api/withdrawals/:id/confirm               → { withdrawal, account }   (R5)
POST /api/withdrawals/:id/cancel                → { withdrawal, account }   (R5)
```

`POST /api/withdrawals` is the manual cash-out path. It refuses with
HTTP 409 if the requested amount exceeds the corpus or would push the
corpus below the 0.5 × principalX lock floor. Auto-withdrawals (R2 from
SELF_SUSTAINING profitable closes) keep using the existing
confirm/cancel queue.

### Decisions

```
GET  /api/decisions?limit=N                     → DecisionRecord[]
```

### AI Advisor

```
GET  /api/advisor/status                        → { enabled, provider, model, configured }
POST /api/advisor/decide                        one-shot critique of a proposed trade
                                                body: { input: NewTradeInput }
                                                → { verdict, summary, points, rulesAlignment, rules, toolTrace }
POST /api/advisor/chat                          free-form, server-streamed (SSE)
                                                body: { conversationId?, messages: {role, content}[] }
                                                streams: meta, text, tool_use, tool_result, done, error
POST /api/advisor/portfolio-review              periodic check on open positions
                                                → { observations, riskFlags, suggestions }
GET  /api/advisor/conversations                 → [{ conversationId, lastAt, turns }]
GET  /api/advisor/conversations/:id             → AdvisorMessage[]
```

The deterministic engine wins: even if the LLM disagrees, the response
verdict reflects the rules-engine output. Tool traces are returned in
`toolTrace` so you can audit what the model checked.

### Zerodha (Kite Connect)

```
GET    /api/zerodha/status                      → { configured, credentialsSource, connected, … }
GET    /api/zerodha/credentials                 → { configured, source, hasDbCreds, hasEnvCreds, apiKeyMasked, updatedAt }
PUT    /api/zerodha/credentials                 body: { apiKey, apiSecret } → 204 (clears any active session)
DELETE /api/zerodha/credentials                 → 204
GET    /api/zerodha/login-url                   → { url }
POST   /api/zerodha/exchange-token              body: { request_token } → { user }
GET    /api/zerodha/funds                       → KiteFunds
GET    /api/zerodha/holdings                    → KiteHolding[]
GET    /api/zerodha/positions                   → { net, day }
GET    /api/zerodha/orders                      → KiteOrder[]
POST   /api/zerodha/disconnect                  → { ok: true }
```

API credentials can live in the SQLite DB (set via Settings → **Zerodha
credentials**) *or* in `apps/server/.env`. DB takes precedence. The
secret is never returned to the browser; only a masked key like
`ab••••••••••wxyz` is shown.

### Backup / restore

```
GET  /api/backup/export                         → { version, exportedAt, account, trades, withdrawals, decisions, advisorMessages }
POST /api/backup/import                         body: { ...export-payload, confirm: "IMPORT" }
                                                wipes everything and reloads
```

### Quick smoke test with curl

```bash
# Boot the server, then:
curl -s localhost:4000/api/health
# {"status":"ok"}

curl -s localhost:4000/api/health/db | jq
# { "status": "ok", "schemaVersion": 1, "tables": [...] }

# Set principal X to ₹1,00,000 (in paise: 10000000)
curl -s -X POST localhost:4000/api/account/principal \
  -H 'content-type: application/json' \
  -d '{"principalX":10000000}' | jq

curl -s localhost:4000/api/account | jq
```

## Database & migrations

- File: `apps/server/data/options-trader.sqlite` (path comes from `DB_PATH`).
- Driver: `better-sqlite3` (synchronous, in-process).
- Migrations: `apps/server/src/db/migrations/NNN_name.sql` — applied in
  numeric order at server boot. Each migration runs in a transaction; the
  `schema_versions` table records what's been applied so reboots are
  idempotent.
- Tables (after `001_initial`): `account`, `trades`, `pending_withdrawals`,
  `decisions`, `advisor_messages`, `zerodha_sessions`, plus `schema_versions`.
- To add a migration: drop a new file `00N_<short_name>.sql` next to the
  existing one and restart the server. The runner refuses files that don't
  match `^(\d+)_(.+)\.sql$`.

## Testing, type-checking, formatting

```bash
npm run test            # vitest (shared rules suite, then server)
npm run typecheck       # tsc --noEmit on shared / server / web in parallel
npm run format          # prettier --write .
```

The rules engine is pure — `packages/shared/test/rules.spec.ts` carries the
heaviest coverage (29 tests covering R1–R5, C1–C6, and the spec's worked
examples). Any new behaviour in `rules.ts` should land with tests in the
same change.

## Resetting / backups

- **Reset everything** lives in Settings; type `RESET` in the confirm
  dialog. It wipes every table and lets you set a fresh `principalX`. There
  is no "undo".
- **Backup** the SQLite file directly: `cp apps/server/data/options-trader.sqlite
  ~/options-trader-backup-$(date +%F).sqlite`. The server holds an open
  handle while running but better-sqlite3 + WAL allow safe online copies.
- **JSON export / import** lives in Settings → **Backup & restore**.
  Import is destructive: it wipes the database first, then loads the
  payload inside a single transaction. The Zerodha access token is *not*
  exported — reconnect after restoring.

## Docker

The repo ships a multi-stage Dockerfile and a `docker-compose.yml` that
runs the backend (Express + SQLite) and serves the prebuilt React app
from a single port (4000 by default).

```bash
# Build and run locally — opens http://localhost:4000
docker compose up --build

# Pass through advisor / broker secrets (or use a .env next to compose)
ANTHROPIC_API_KEY=sk-ant-… \
KITE_API_KEY=…  KITE_API_SECRET=… \
docker compose up --build
```

Image structure:
- **Builder stage** — `node:20-bookworm-slim`, installs python3/make/g++
  for `better-sqlite3`'s native module, runs `npm ci --workspaces` and
  `npm run build:web`.
- **Runtime stage** — same base image (so the better-sqlite3 prebuilt
  matches the libc), runs as a non-root `app` user, serves `/api` plus
  the static `apps/web/dist` from one Express process via `tsx`.

Persistent state:
- SQLite lives at `/data/options-trader.sqlite` inside the container,
  backed by the named volume `options-trader-data` (or whatever you
  mount). Don't lose this volume.

Container env (override via `docker compose` env vars or an `.env` file):

| Variable            | Default                            | Notes                                                                          |
| ------------------- | ---------------------------------- | ------------------------------------------------------------------------------ |
| `PORT`              | `4000`                             | Container-internal port. Map with `HOST_PORT`.                                 |
| `HOST_PORT`         | `4000`                             | Host port for the published binding.                                           |
| `DB_PATH`           | `/data/options-trader.sqlite`      | Inside the container; sits on the persistent volume.                           |
| `WEB_STATIC_DIR`    | `/app/apps/web/dist`               | Where Express serves the bundled SPA from. Empty disables static hosting.      |
| `ANTHROPIC_API_KEY` | empty                              | Enables `/api/advisor/*`. Without it the advisor returns 409.                  |
| `AI_PROVIDER`       | `anthropic`                        | Currently only `anthropic` is implemented.                                     |
| `AI_MODEL`          | `claude-sonnet-4-6`                | Anthropic model id.                                                            |
| `KITE_API_KEY`      | empty                              | Required for `/api/zerodha/*`.                                                 |
| `KITE_API_SECRET`   | empty                              | Required for `/api/zerodha/*` (server-side OAuth checksum).                    |

Health check: `GET /api/health` — used by the container's
`HEALTHCHECK` directive. The compose service marks itself `unhealthy`
after three consecutive failures.

## Deploying to Amazon Lightsail

The repo ships two GitHub Actions workflows in `.github/workflows/`:

- **`ci.yml`** — runs on every push and PR: install, type-check, tests,
  Vite build.
- **`deploy-lightsail.yml`** — runs on push to `main`: builds the Docker
  image, pushes it to **GHCR** (`ghcr.io/<owner>/<repo>:<sha>` plus
  `:latest`), then SSHes into a Lightsail VM and runs `docker compose
  up -d` with the new image.

### One-time setup

1. **Provision a Lightsail Ubuntu instance** (22.04 or 24.04).
   Recommended: 1 vCPU / 2 GB RAM is enough for a single user. Attach a
   static IP. In the Lightsail networking panel open TCP port `4000`
   (or 80/443 if you put nginx in front).

2. **Bootstrap the instance** — SSH in, then:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/main/scripts/lightsail-bootstrap.sh | bash
   exit  # log out and back in so the docker group takes effect
   ```
   The script installs Docker Engine + the compose plugin and creates
   `~/options-trader/`.

3. **Add GitHub secrets** under *Settings → Secrets and variables → Actions*:

   | Secret               | Value                                                                                           |
   | -------------------- | ----------------------------------------------------------------------------------------------- |
   | `LIGHTSAIL_HOST`     | The instance's public IP or static-IP DNS                                                       |
   | `LIGHTSAIL_USER`     | Usually `ubuntu`                                                                                |
   | `LIGHTSAIL_SSH_KEY`  | Private key matching the instance's key pair (paste the entire `-----BEGIN…` block)             |
   | `LIGHTSAIL_SSH_PORT` | Optional, defaults to `22`                                                                      |
   | `ANTHROPIC_API_KEY`  | Optional — passed into the container at deploy time                                             |
   | `KITE_API_KEY`       | Optional                                                                                        |
   | `KITE_API_SECRET`    | Optional                                                                                        |

   And these *Variables* (optional, with defaults):

   | Variable      | Default               | Notes                                                                |
   | ------------- | --------------------- | -------------------------------------------------------------------- |
   | `AI_MODEL`    | `claude-sonnet-4-6`   | Anthropic model id                                                   |
   | `AI_PROVIDER` | `anthropic`           |                                                                      |
   | `HOST_PORT`   | `4000`                | Host port the container publishes                                    |

4. **Allow the Lightsail VM to read GHCR.** The deploy step performs
   `docker login ghcr.io` with the repo's `GITHUB_TOKEN` automatically,
   so no extra secret is needed as long as the workflow runs in the
   same repo that hosts the image.

### Deploy flow on every push to `main`

```
GitHub Actions
  ├─ build-and-push
  │   ├─ docker buildx build .
  │   └─ docker push ghcr.io/<owner>/<repo>:<sha>  (and :latest)
  └─ deploy
      ├─ scp docker-compose.prod.yml → ~/options-trader/
      └─ ssh ubuntu@LIGHTSAIL_HOST 'cd ~/options-trader &&
            docker login ghcr.io <token>
            write .env (IMAGE, secrets, vars)
            mv docker-compose.prod.yml docker-compose.yml
            docker compose pull
            docker compose up -d --remove-orphans
            docker image prune -f'
```

The compose file on the VM (`docker-compose.prod.yml`) only declares
the service shape — the actual image tag comes from the `IMAGE` env
var the workflow writes.

### Backups

Snapshot the SQLite volume periodically:

```bash
ssh ubuntu@LIGHTSAIL_HOST '
  docker run --rm \
    -v options-trader-data:/data \
    -v $HOME:/backup busybox \
    tar czf /backup/options-trader-$(date +%F).tgz /data'
```

Or use Settings → **Backup & restore** in the UI to download a JSON
snapshot.

## Keyboard shortcuts

The AppShell installs a small set of shortcuts (active when no input is
focused; press `?` for the in-app reminder):

| Keys     | Action                |
| -------- | --------------------- |
| `n`      | Open New Trade        |
| `g d`    | Go to Dashboard       |
| `g t`    | Go to Trades          |
| `g w`    | Go to Withdrawals     |
| `g a`    | Go to AI Advisor      |
| `g z`    | Go to Zerodha Sync    |
| `g s`    | Go to Settings        |
| `Esc`    | Close any open dialog |
| `?`      | Show this list        |

## Troubleshooting

- **`better-sqlite3` install fails.** Make sure a C toolchain and Python 3
  are on the PATH (`build-essential` on Debian/Ubuntu; `xcode-select
  --install` on macOS). Then `npm rebuild better-sqlite3`.
- **Server exits with `Invalid environment configuration`.** `apps/server/.env`
  has a value that doesn't match `EnvSchema` in `apps/server/src/env.ts` —
  e.g. a non-numeric `PORT` or a typo in `AI_PROVIDER`. The error message
  lists the offending fields.
- **Web app shows blank tiles / `Failed to load account`.** The server isn't
  running, or it's on a port other than 4000 and you didn't start the web
  with `SERVER_PORT=…`. Confirm with `curl localhost:4000/api/health`.
- **`POST /api/trades` returns `409`.** A deterministic check failed (BLOCK).
  The response body includes the full `DecisionRecord` — look at
  `decision.checks` to see which of C1/C2/C3 fired and why.
- **Principal won't update.** Once any trade exists, `POST /api/account/principal`
  returns 409. Use **Reset everything** to start over.

---

For deeper background see:
- `OPTIONS_TRADING_TRACKER_SPEC.md` — full design doc.
- `OPTIONS_TRADING_TRACKER_BUILD_PLAN.md` — step-by-step roadmap and status.
- `OPTIONS_TRADING_TRACKER_DECISIONS.md` — locked design decisions.
- `OPTIONS_TRADING_TRACKER_CONTEXT.md` — running context for collaborators.
