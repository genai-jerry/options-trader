# Options Trading Tracker — Build Plan

The ordered work to ship v1. Each step's outputs are listed; the next step
depends only on what came before. The pure domain layer (rules engine) is
foundational — UI and integrations sit on top.

Status legend: `[ ]` pending, `[~]` in progress, `[x]` done.

Read alongside `OPTIONS_TRADING_TRACKER_SPEC.md` (design) and
`OPTIONS_TRADING_TRACKER_DECISIONS.md` (rationale).

---

## Step 1 — Monorepo scaffold `[x]` *(rebuilt)*

- npm workspaces: `apps/web`, `apps/server`, `packages/shared`.
- Root: shared `tsconfig.base.json`, `.prettierrc.json`, `.editorconfig`,
  `.gitignore`, `package.json` with workspace scripts.
- `apps/web`: Vite + React 19 + TS + MUI v7 + Zustand + react-query +
  react-router + react-hook-form + zod. Router shell with placeholder pages
  for Dashboard, Trades, NewTrade, Withdrawals, AIAdvisor, Settings,
  ZerodhaSync. Dev server proxies `/api` to the backend.
- `apps/server`: Express via tsx, dotenv + zod env parsing, better-sqlite3
  in deps, `/api/health` endpoint.
- `packages/shared`: TS types from spec §5 (Account, Trade,
  PendingWithdrawal, NewTradeInput, DecisionRecord, AccountSnapshot, etc.).
- `docs/SPEC.md` — canonical design doc copied into the repo.

**Status.** Repo was deleted and re-created. Step 1 has been rebuilt on
`claude/review-docs-build-plan-4mHxf` together with Step 2 (per user
direction to land both in one branch).

## Step 2 — Persistence: SQLite schema + migrations `[x]`

- `apps/server/src/db/schema.sql` — tables: `account`, `trades`,
  `pending_withdrawals`, `decisions`, `advisor_messages`,
  `zerodha_sessions`. Plus a `schema_versions` table.
- Migration runner — versioned, idempotent, runs at boot.
- `apps/server/src/db/repo.ts` — typed CRUD helpers.
- Seed: insert default `account` row (no `principalX` yet — Settings sets
  it).

**Acceptance.** Backend boots, applies migrations, exposes
`/api/health/db` showing schema version and table list.

**Status.** Done. `apps/server/src/db/schema.sql`, the migration runner,
`repo.ts`, and `/api/health/db` ship in this branch. Verified locally:
`schemaVersion: 1` and all six tables present.

## Step 3 — Domain rules engine `[ ]` *(foundation; do this carefully)*

- `packages/shared/src/domain/money.ts` — paise helpers, `formatINR`.
- `packages/shared/src/domain/rules.ts`:
  - `applyRulesOnClose(account, trade) → { account', queuedWithdrawal? }` —
    pure; fires R1, R2, R3.
  - `evaluateDecision(input, snapshot, openTrades) → DecisionRecord` —
    pure; runs C1–C6.
  - `confirmWithdrawal(account, withdrawal) → account'` — fires R5.
  - `cancelWithdrawal(account, withdrawal) → account'`.
  - `unlock(account) → account'` — fires R4.
- `packages/shared/test/rules.spec.ts` — vitest. Cover every rule, every
  check, plus the worked examples in spec §3 (bootstrap profit, 2X trigger,
  self-sustaining split, lock trigger, withdrawal confirm/cancel).

**Acceptance.** Test suite passes with full branch coverage on `rules.ts`.

## Step 4 — REST endpoints + frontend stores `[ ]`

Server endpoints:
- `GET    /api/account`
- `PUT    /api/account/settings` (feePercent, positionSizeCap, AI toggle)
- `POST   /api/account/principal` (rejected if any trade exists)
- `POST   /api/account/reset` (wipes all data; require confirmation token)
- `POST   /api/account/unlock`
- `GET    /api/trades` (filter: status, instrument, symbol)
- `POST   /api/trades` (creates OPEN trade — debits corpus, runs C1–C3 as
  server-side guard)
- `POST   /api/trades/:id/close`
- `GET    /api/withdrawals` (filter: status)
- `POST   /api/withdrawals/:id/confirm`
- `POST   /api/withdrawals/:id/cancel`

Frontend: react-query hooks per endpoint. Zustand for transient UI only.

**Acceptance.** Curl-able backend; web app shows live data; closing a trade
in the API updates account state correctly per the rules engine.

## Step 5 — Settings page `[ ]`

- Set `principalX` (one-time gate; if any trade exists, hide and show
  "Reset everything" instead).
- Configure `feePercent`, `positionSizeCap`, AI toggle, AI provider/model
  selection, Zerodha API credentials.
- "Reset everything" with double-confirmation dialog.

**Acceptance.** A user can complete first-time setup end-to-end starting
from an empty database.

## Step 6 — New Trade / Decision Helper `[ ]`

- Form (react-hook-form + zod) for `NewTradeInput`.
- Live verdict panel running `evaluateDecision` against current state.
- "Accept" creates an OPEN trade; persists the `DecisionRecord`.

**Acceptance.** Verdict updates as form values change. BLOCK disables
Accept. WARN shows reasons but allows Accept.

## Step 7 — Trades list with close action `[ ]`

- MUI X DataGrid: filter by status, instrument, symbol. Sortable.
- Inline "Close" with exit price; runs `applyRulesOnClose`; surfaces phase
  changes and queued withdrawals via toast.

**Acceptance.** Closing a trade visibly updates corpus, phase badge, and
withdrawals queue without a page reload.

## Step 8 — Withdrawals view `[ ]`

- Tab "Pending": each PENDING withdrawal with amount, source trade,
  Confirm / Cancel buttons.
- Tabs "Confirmed" and "Cancelled" for history.
- Confirming reduces `investableCorpus` and increments `cashWithdrawn`.
- Cancelling marks the row CANCELLED — the amount stays in the corpus.

**Acceptance.** Confirm and Cancel both behave per D14 / R5.

## Step 9 — Dashboard `[ ]`

- Phase badge (color-coded).
- Tiles: corpus, setAside, cashWithdrawn, total pending withdrawals,
  realizedPnL, feesPaid.
- Lock-floor gauge (current corpus vs `0.5 * principalX`).
- Equity curve (cumulative `realizedPnL` over time, MUI X Charts).
- Open positions table.

**Acceptance.** Dashboard renders correctly in all four states: empty,
mid-bootstrap, self-sustaining, locked.

## Step 10 — AI Advisor `[ ]`

- Backend endpoints:
  - `POST /api/advisor/decide` (one-shot critique of a trade idea)
  - `POST /api/advisor/chat` (free-form, server-streamed via SSE)
  - `POST /api/advisor/portfolio-review`
- `AIProvider` interface; first impl: Anthropic Claude (latest model
  family).
- System prompt installs the philosophy verbatim, options-expert framing,
  and output discipline (never override deterministic BLOCK).
- Tools: `get_account_state`, `get_open_trades`, `get_recent_closed`,
  `evaluate_decision`, `get_zerodha_positions`.
- Frontend: side panel embedded in NewTrade; standalone Chat page.
- Persist messages in `advisor_messages` for audit.
- Per-minute and per-day rate limits; "AI toggle" in Settings disables all
  calls.

**Acceptance.** A trade idea returns a structured verdict with rationale.
Chat streams tokens. The deterministic engine's BLOCK is always honoured.

## Step 11 — Zerodha Kite integration `[ ]`

- Backend: `KiteClient` wrapping Kite Connect REST. Daily OAuth
  `request_token → access_token` flow. Session in httpOnly cookie.
- Endpoints: `/api/zerodha/login-url`, `/api/zerodha/exchange-token`,
  `/api/zerodha/funds`, `/api/zerodha/holdings`, `/api/zerodha/positions`,
  `/api/zerodha/orders`, `/api/zerodha/disconnect`.
- Frontend: connect/disconnect, last-sync timestamp, live
  positions/holdings/funds tables. **Read-only** — no order placement.

**Acceptance.** User authenticates via Kite, sees live portfolio data.

## Step 12 — Polish `[ ]`

- Empty states everywhere.
- JSON export/import in Settings.
- Error boundaries, loading skeletons.
- Keyboard shortcuts (esc closes dialogs, `n` opens New Trade).
- README with setup instructions for `apps/server/.env`.
