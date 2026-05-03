# Options Trader

A personal options-trading capital tracker with a phase-based investment
philosophy, an AI advisor, and a (planned) live Zerodha Kite integration.

The app forces discipline on a single-user options book by making the rules
engine — not the user — decide whether a trade is allowed, how profits are
split, and when the account locks. Every amount is stored as **integer paise**
to avoid float drift; only the view layer formats to `₹`.

> Status: actively under construction. Steps 1–5 are shipped (scaffold,
> SQLite persistence, domain rules engine, REST + react-query hooks, Settings
> page). Steps 6–12 (full New Trade form, Trades list, Withdrawals view,
> Dashboard polish, AI Advisor, Zerodha integration) are stubbed pages today
> — see `OPTIONS_TRADING_TRACKER_BUILD_PLAN.md` for the full roadmap.

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
15. [Troubleshooting](#troubleshooting)

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
| `KITE_API_KEY`      | Step 11  | empty                              | Zerodha Kite Connect API key. Leave blank until Step 11.                    |
| `KITE_API_SECRET`   | Step 11  | empty                              | Zerodha Kite Connect API secret. Server-side only; never leaves the server. |
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

### 2. Trades (Step 7 — currently a stub)

Planned: MUI X DataGrid with status / instrument / symbol filters and an
inline **Close** action.

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

### 3. New Trade — Decision Helper (Step 6 — currently a stub)

Form on the left, deterministic verdict in the middle, AI advisor on the
right (Step 10).

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

### 4. Withdrawals (Step 8 — currently a stub)

Three tabs: **Pending** / **Confirmed** / **Cancelled**.

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

### 5. AI Advisor (Step 10 — currently a stub)

Standalone chat. The Decision Helper hosts an embedded version with the
proposed trade as context.

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

### 7. Zerodha Sync (Step 11 — currently a stub)

Read-only. Connect button kicks off the Kite OAuth flow, then renders live
tables.

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
POST /api/withdrawals/:id/confirm               → { withdrawal, account }   (R5)
POST /api/withdrawals/:id/cancel                → { withdrawal, account }   (R5)
```

### AI Advisor *(planned, Step 10)*

```
POST /api/advisor/decide                        one-shot critique of a proposed trade
POST /api/advisor/chat                          free-form, server-streamed (SSE)
POST /api/advisor/portfolio-review              periodic check on open positions
```

### Zerodha *(planned, Step 11)*

```
GET  /api/zerodha/login-url
POST /api/zerodha/exchange-token                body: { request_token }
GET  /api/zerodha/funds
GET  /api/zerodha/holdings
GET  /api/zerodha/positions
GET  /api/zerodha/orders
POST /api/zerodha/disconnect
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
- **JSON export / import** in Settings is on the Step 12 list and not yet
  implemented.

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
