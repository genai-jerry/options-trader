# Options Trading Tracker — Spec

A personal web app to track options-trading capital, enforce a disciplined
investment philosophy, and (eventually) sync live with Zerodha Kite.

This spec is a standalone planning document. It is **not** part of the
lighthouse-ui application; the eventual implementation will live in its own
codebase (or a clearly separated subtree) so it does not pollute lighthouse.

---

## 1. Goals

1. Track every options trade: entry, exit, fees, net P&L.
2. Enforce a four-stage investment philosophy automatically.
3. Help me decide whether to accept a trade an external "agent" suggests.
4. Show real-time portfolio state via the Zerodha Kite Connect API.
5. Single-user. No auth beyond a local passcode is required for v1.

## 2. Non-goals (v1)

- Multi-user or social features.
- Strategy backtesting.
- Auto-trading or order placement (read-only Zerodha integration).
- Tax reports / Schedule-D output (track raw data; export later).

## 3. Investment philosophy (the rules engine)

Let `X` be the user-configured principal.

### Phases

| Phase             | Meaning                                                        |
| ----------------- | -------------------------------------------------------------- |
| `BOOTSTRAP`       | Original `X` still at risk. Goal: cumulative **net** `realizedPnL ≥ 2X`. Losses subtract from this counter; the 2X target does not move. |
| `SELF_SUSTAINING` | Original `X` has been pulled out and set aside. Only profits remain in play. |
| `LOCKED`          | Investable corpus has fallen to `≤ 0.5 X`. New entries blocked. |

### State on the account

- `principalX` — set on first run. **Locked after the first trade is recorded.** A "Reset everything" action in Settings wipes data and lets a new `X` be set.
- `feePercent` — configurable in Settings; default `5%`.
- `positionSizeCap` — configurable in Settings as a fraction of corpus; default `0.25`. Used by the soft-cap WARN check; can be set to `0` to disable.
- `phase` — `BOOTSTRAP` | `SELF_SUSTAINING` | `LOCKED`.
- `investableCorpus` — usable for new positions.
- `setAside` — original `X` after it has been pulled out.
- `pendingWithdrawals` — queue of profit-split amounts waiting on user confirmation.
- `cashWithdrawn` — running total of confirmed profit withdrawals.
- `realizedPnL`, `feesPaid` — running totals.
- `lockOverrideAt` — timestamp if user manually unlocks (audit trail).

### Rules

| Id | Trigger                                                          | Action                                                                                                                       |
| -- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| R1 | On close: `phase = BOOTSTRAP` and cumulative `realizedPnL ≥ 2 * principalX` | Move `principalX` from `investableCorpus` to `setAside`. Phase → `SELF_SUSTAINING`.                                          |
| R2 | On profitable close while `phase = SELF_SUSTAINING`              | `fees = grossPnL * feePercent`; `net = grossPnL - fees`; **enqueue** a `PendingWithdrawal` of `net/2`; `investableCorpus += net/2`; `feesPaid += fees`. The withdrawn half stays in the corpus until the user confirms it (R5). |
| R3 | On close: `investableCorpus ≤ 0.5 * principalX`                  | Phase → `LOCKED`. New entries blocked.                                                                                       |
| R4 | User unlock action                                               | Phase → previous; record `lockOverrideAt`. Requires explicit confirmation dialog.                                            |
| R5 | User confirms a `PendingWithdrawal`                              | `investableCorpus -= amount`; `cashWithdrawn += amount`; mark the withdrawal `CONFIRMED`. User can also `CANCEL` a pending withdrawal — the amount stays in the corpus and the entry is marked `CANCELLED`. |

Loss closes simply reduce `investableCorpus` by the loss amount. No split, no
fee bookkeeping — fees are modelled on profits only.

`BOOTSTRAP` profitable closes leave the entire net profit in the corpus — no
split is applied until `SELF_SUSTAINING`.

### Worked examples

Assume `X = ₹100,000`, `feePercent = 5%`.

**Bootstrap, profitable trade.** Buy at 50,000 → sell at 70,000.
- `grossPnL = 20,000`. No split. `corpus = 100,000 - 50,000 + 70,000 = 120,000`.
- `realizedPnL = 20,000`. Phase stays `BOOTSTRAP` (not yet at 200k cumulative profit).

**Cumulative profit hits 2X.** After enough wins `realizedPnL = 200,000`,
`corpus = 300,000`. R1 fires: `setAside = 100,000`, `corpus = 200,000`,
phase → `SELF_SUSTAINING`.

**Self-sustaining, profitable trade.** Buy 80,000 → sell 100,000.
- `gross = 20,000`. `fees = 1,000`. `net = 19,000`.
- A `PendingWithdrawal(9,500)` is queued. The other 9,500 is added back.
- Corpus immediately after close = `200,000 - 80,000 + 100,000 - 9,500 = 210,500`. The 9,500 sits inside the corpus until the user confirms the withdrawal in the Withdrawals view; on confirm the corpus becomes `201,000` and `cashWithdrawn += 9,500`.

**Lock trigger.** Series of losses bring `corpus = 49,000`. R3 fires.
Phase → `LOCKED`. New trade form is read-only; only Settings → Unlock works.

## 4. Decision Helper (per-trade go/no-go)

A form fed by the user (manually entering what an external agent suggested):
`symbol`, `instrumentType` (CE/PE/FUT), `strike`, `expiry`, `lotSize`, `qty`,
`entryPrice`, `expectedExit`, `maxAcceptableLoss`, `notes`, `agentSource`.

Computed:
- `capitalRequired = entryPrice * qty * lotSize`
- `expectedReward = (expectedExit - entryPrice) * qty * lotSize`
- `rewardRiskRatio = expectedReward / maxAcceptableLoss`

Checks (each emits OK / WARN / BLOCK with a one-line reason):

| Check | Rule                                                                                              | Severity |
| ----- | ------------------------------------------------------------------------------------------------- | -------- |
| C1    | `phase ≠ LOCKED`                                                                                  | BLOCK    |
| C2    | `capitalRequired ≤ investableCorpus`                                                              | BLOCK    |
| C3    | `investableCorpus − maxAcceptableLoss ≥ 0.5 * principalX`                                          | BLOCK    |
| C4    | `phase = BOOTSTRAP` ⇒ `rewardRiskRatio ≥ 2`                                                       | WARN     |
| C5    | `positionSizeCap > 0 ⇒ capitalRequired ≤ positionSizeCap * investableCorpus` (configurable in Settings; default `0.25`; set to `0` to disable) | WARN     |
| C6    | Same `symbol` not already open                                                                    | WARN     |

Verdict: BLOCK if any BLOCK fires, else WARN if any WARN fires, else GO.
"Accept" promotes the suggestion to an `OPEN` trade and debits the corpus.

## 5. Data model

All amounts stored as **integer paise** to avoid float drift. Format only at the
view layer.

```ts
type Phase = 'BOOTSTRAP' | 'SELF_SUSTAINING' | 'LOCKED';

interface Account {
  principalX: number;          // paise; locked after first trade
  feePercent: number;          // 0..1, configurable
  positionSizeCap: number;     // 0..1, configurable; 0 disables the soft-cap warning
  phase: Phase;
  investableCorpus: number;
  setAside: number;
  cashWithdrawn: number;
  realizedPnL: number;
  feesPaid: number;
  lockOverrideAt?: string;     // ISO
  createdAt: string;
}

type WithdrawalStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED';

interface PendingWithdrawal {
  id: string;
  amount: number;              // paise
  fromTradeId: string;
  createdAt: string;
  decidedAt?: string;
  status: WithdrawalStatus;
}

type Instrument = 'CE' | 'PE' | 'FUT';
type TradeStatus = 'OPEN' | 'CLOSED';

interface Trade {
  id: string;                  // uuid
  symbol: string;              // e.g. NIFTY
  instrument: Instrument;
  strike?: number;             // paise; required for CE/PE
  expiry: string;              // ISO date
  lotSize: number;
  qty: number;                 // number of lots
  entryPrice: number;          // paise per unit
  entryAt: string;             // ISO
  exitPrice?: number;
  exitAt?: string;
  status: TradeStatus;
  fees?: number;               // paise, set on close
  grossPnL?: number;
  netPnL?: number;
  notes?: string;
  agentSource?: string;
}

interface DecisionRecord {
  id: string;
  tradeId?: string;            // set if accepted
  input: NewTradeInput;
  checks: { id: string; status: 'OK'|'WARN'|'BLOCK'; reason: string }[];
  verdict: 'GO' | 'WARN' | 'BLOCK';
  decidedAt: string;
  acceptedByUser: boolean;
}
```

## 6. Screens

1. **Dashboard** — phase badge, tiles for `corpus / setAside / cashWithdrawn /
   pendingWithdrawals / realizedPnL / feesPaid`, lock-floor gauge (`corpus` vs
   `0.5 X`), equity curve (cumulative `realizedPnL` over time), open positions
   table, recent decisions.
2. **Trades** — paginated list, filter by status / instrument / symbol, inline
   close action.
3. **New Trade (Decision Helper)** — form + rules verdict + AI advisor panel
   side-by-side; "Accept" creates an `OPEN` trade. See §10.
4. **Withdrawals** — list of `PendingWithdrawal`s with `Confirm` and `Cancel`
   actions; history of confirmed/cancelled entries.
5. **AI Advisor Chat** — free-form conversation with the philosophy- and
   options-aware AI (see §10). Available standalone and embedded in the
   Decision Helper.
6. **Settings** — configure `feePercent`, `positionSizeCap`, AI provider/model
   and API key. Manual phase override (with confirm). Reset everything (wipes
   all data so a new `principalX` can be set). JSON export/import.
7. **Zerodha Sync** — connect button, last-sync timestamp, live holdings &
   positions table, raw funds. Read-only.

## 7. Tech stack

- **Frontend:** React 19 + TypeScript, Vite, MUI v7, MUI X Charts, MUI X
  DataGrid, react-hook-form + zod, react-router-dom, Zustand with `persist`
  middleware.
- **Backend:** Node + TypeScript + Express (or Fastify). Holds `api_key` /
  `api_secret` for Kite Connect, performs the Kite OAuth `request_token →
  access_token` exchange, proxies REST endpoints, and is the **only** place
  that talks to the LLM provider — the AI API key never ships to the browser.
  SQLite (better-sqlite3) for storage; can be swapped for Postgres later. Same
  schema-versioned migrations the frontend store uses.
- **Tests:** vitest + @testing-library/react on the frontend; vitest on the
  backend. The rules engine is pure functions and gets the lion's share of the
  test coverage.

Repo layout — a separate project root (own repo or `apps/options-tracker/`
workspace), **not** mixed into lighthouse-ui:

```
options-tracker/
  apps/
    web/                          # React + Vite frontend
      src/
        domain/
          rules.ts                # pure: applyRulesOnClose, evaluateDecision
          money.ts                # paise helpers, formatINR
          types.ts
        store/
          accountStore.ts
          tradesStore.ts
          withdrawalsStore.ts
          decisionsStore.ts
        pages/
          Dashboard.tsx
          Trades.tsx
          NewTrade.tsx
          Withdrawals.tsx
          AIAdvisor.tsx
          Settings.tsx
          ZerodhaSync.tsx
        components/
          PhaseBadge.tsx, LockFloorGauge.tsx, MoneyTile.tsx,
          AdvisorPanel.tsx, ChatBubble.tsx, ...
        test/
          rules.spec.ts           # the important suite
    server/                       # Node + Express backend
      src/
        index.ts
        routes/
          zerodha.ts
          advisor.ts
          trades.ts
          account.ts
          withdrawals.ts
        broker/
          KiteClient.ts
        ai/
          AdvisorService.ts       # builds the system prompt + tools
          providers/
            anthropic.ts
            openai.ts
        db/
          schema.sql, migrations/, repo.ts
        test/
          advisor.spec.ts
  packages/
    shared/                       # types shared between web and server
      src/types.ts
```

## 8. Zerodha (Kite Connect) integration

### Constraints

- Kite REST does not allow CORS from browsers; calls must originate from a
  server.
- `api_secret` must never ship to the browser.
- `access_token` is daily; user must re-login each trading day.

### Adapter pattern

```ts
interface BrokerAdapter {
  isConnected(): boolean;
  connect(): Promise<void>;        // launches OAuth in popup/redirect
  disconnect(): Promise<void>;
  getFunds(): Promise<Funds>;
  getHoldings(): Promise<Holding[]>;
  getPositions(): Promise<Position[]>;
  getOrderbook(): Promise<Order[]>;
}
```

v1 ships `KiteBroker` from day one (talks to the backend proxy). A `MockBroker`
fixture is included only for unit tests.

### Backend endpoints

```
GET  /api/zerodha/login-url       → { url }       # Kite login redirect
POST /api/zerodha/exchange-token  body: { request_token } → { user }
GET  /api/zerodha/funds
GET  /api/zerodha/holdings
GET  /api/zerodha/positions
GET  /api/zerodha/orders
POST /api/zerodha/disconnect
```

The frontend stores only the public `user` object; `access_token` lives in a
server-side session keyed by an httpOnly cookie.

## 9. Persistence

The backend owns the source of truth: SQLite (better-sqlite3) with
schema-versioned migrations. Tables: `account`, `trades`, `pending_withdrawals`,
`decisions`, `advisor_messages`, `zerodha_sessions`. The frontend uses
react-query for fetch/cache and Zustand only for transient UI state.

JSON export/import in Settings dumps the full database state for backup.

## 10. AI Advisor

The Decision Helper provides a deterministic, rule-based verdict. The AI
Advisor adds judgement: an LLM that knows your philosophy and the mechanics of
options.

### Goals

1. Critique a specific trade idea you (or another agent) propose — payoff,
   greeks, IV context, expiry/event risks, liquidity.
2. Reconcile the idea with your phase, lock floor, position-size cap, and the
   2X bootstrap goal — same numbers the rules engine sees.
3. Suggest sizing or structural tweaks (different strike, debit/credit spread,
   roll) that fit the philosophy.
4. Be a sparring partner in free-form chat for plans, hedges, and post-mortems.
5. Never auto-place orders. Output is advisory only.

### Architecture

The LLM is called **only from the backend**. The provider key never reaches
the browser. `/api/advisor/*` endpoints accept a structured payload, build the
prompt server-side, and return a structured response. Provider-agnostic
behind an `AIProvider` interface; first impl is Anthropic Claude (the most
recent: Opus 4.7 / Sonnet 4.6), pluggable for OpenAI later.

### Endpoints

```
POST /api/advisor/decide        # one-shot critique of a proposed trade
  body: { input: NewTradeInput, accountSnapshot, openTrades, recentClosed }
  → { verdict: 'GO'|'WARN'|'BLOCK', confidence: 0..1, summary, points: string[],
      suggestedTweaks?: NewTradeInput[], rulesAlignment }

POST /api/advisor/chat          # free-form, server-streamed
  body: { messages, accountSnapshot? }
  → SSE stream of text + tool-call events

POST /api/advisor/portfolio-review   # daily/weekly check on open positions
  body: { accountSnapshot, openTrades, livePositions? }
  → { observations, riskFlags, suggestions }
```

`accountSnapshot` is a derived, minimal view of the account state: phase,
principalX, corpus, setAside, cashWithdrawn, realizedPnL, lock floor distance,
position-size cap, fee percent. The advisor only ever sees what is required.

### Tools available to the model (server-side)

The model uses tool calling so it can ground answers in current state rather
than hallucinate it.

- `get_account_state()` → live snapshot.
- `get_open_trades()` → list of current open positions.
- `get_recent_closed(n)` → last `n` closed trades for context.
- `evaluate_decision(input)` → run the deterministic rules engine and return
  the verdict and check breakdown. The model is **instructed to call this
  before issuing its own verdict** and to never override a deterministic
  BLOCK.
- `get_zerodha_positions()` → live positions from Kite (read-only).

### System prompt (sketch)

The system prompt installs three things:
1. The user's investment philosophy verbatim (phases, R1–R5, lock floor, 2X
   bootstrap goal, profit split, withdrawal-confirmation queue, position-size
   cap).
2. Options-expert framing: be concrete about delta, gamma, theta, vega; flag
   IV percentiles; treat earnings/expiry/event risk explicitly; distinguish
   directional vs theta vs volatility plays; insist on a defined max loss for
   any trade.
3. Output discipline: no order placement, no certainty theater; include a
   one-line "philosophy alignment" at the end of every recommendation; if the
   deterministic engine BLOCKs, return BLOCK regardless of how attractive the
   trade looks.

### Storage

`advisor_messages` table keeps every chat turn for audit; the Decision Helper
also stores the `decide` response on the `decisions` row so accepted trades
carry the AI rationale.

### Cost / safety

- All requests rate-limited (per-minute and per-day) on the backend.
- API key in env / secret manager. Never logged.
- Streaming responses; user can cancel mid-stream.
- A "use AI" toggle in Settings disables advisor calls entirely.

## 11. Build order

1. Scaffold monorepo (`apps/web`, `apps/server`, `packages/shared`), Vite +
   Express, shared TypeScript types, lint/format/test.
2. SQLite schema and migrations; `account`, `trades`, `pending_withdrawals`,
   `decisions`, `advisor_messages`, `zerodha_sessions`.
3. Pure domain layer: `types`, `money`, `rules` (R1–R5, C1–C6) with vitest
   coverage. This is the foundation.
4. Account/trade/withdrawal REST endpoints and the corresponding frontend
   stores + react-query hooks.
5. Settings page (set `principalX`, fees, cap, AI toggle, Zerodha keys).
6. New Trade / Decision Helper with deterministic verdict.
7. Trades list with close action wired to rules.
8. Withdrawals view (confirm / cancel pending).
9. Dashboard tiles, lock gauge, equity curve.
10. AI Advisor: `/api/advisor/decide` + side panel in Decision Helper, then
    `/api/advisor/chat` standalone screen, then `/portfolio-review`.
11. Zerodha integration: backend OAuth + REST proxy, frontend Sync screen.
12. JSON export/import, empty states, polish.

## 12. Locked decisions (from user)

- **Backend in v1.** Real Zerodha integration from day one. Node + Express.
- **Fee model.** Configurable `feePercent` in Settings (default 5%). Applied
  only to profitable closes.
- **Withdrawals.** Profit splits queue as `PendingWithdrawal`; user confirms
  before they leave the corpus.
- **Losses.** No split, no fee bookkeeping — just debit the corpus.
- **2X target.** Cumulative *net* `realizedPnL ≥ 2 * principalX`. Losses
  subtract; the goalpost does not move.
- **`principalX` lock.** Editable until the first trade is recorded; after
  that only "Reset everything" can change it.
- **Position-size cap.** Configurable in Settings; default 25%; `0` disables.
- **Multi-leg.** Out of scope for v1; each leg is a separate `Trade`.
- **AI Advisor.** Required from v1, server-side only, with tool access to the
  rules engine and account state. Defaults to Anthropic Claude (latest model
  family).
