# Options Trading Tracker — Decision Log

Decisions made during planning, with the *why* and the alternatives that were
considered and rejected. Read together with `OPTIONS_TRADING_TRACKER_SPEC.md`
(the design) and `OPTIONS_TRADING_TRACKER_BUILD_PLAN.md` (the ordered work).

---

## D1 — Build a backend, not just a frontend

**Decision.** Node + Express + TypeScript backend in `apps/server`, alongside
the React frontend in `apps/web`.

**Why.**
- Zerodha Kite Connect REST disallows CORS from browsers, and `api_secret`
  must never ship to the client.
- The AI advisor's API key (Anthropic) similarly stays server-side.
- A backend is the natural owner of these secrets and of the daily Kite OAuth
  `request_token → access_token` exchange.

**Rejected alternative.** Frontend-only with a `MockBroker` adapter, deferring
real Zerodha integration to a "phase 2." Rejected because the user wants live
Zerodha integration from v1.

## D2 — Default AI provider is Anthropic Claude

**Decision.** First impl uses Anthropic Claude (latest model family — Opus
4.x / Sonnet 4.x). Pluggable behind an `AIProvider` interface for OpenAI etc.
later.

**Why.** Strong reasoning + tool use. The advisor must call into the
deterministic rules engine via tool calls, so good function-calling fidelity
is required.

## D3 — Storage: server-owned SQLite (better-sqlite3)

**Decision.** Backend owns the database. SQLite for simplicity, schema-versioned
migrations. Frontend uses react-query for cache, Zustand only for transient UI
state.

**Why.** Single user, local-first, zero ops. Migration path to Postgres exists
if ever needed.

**Rejected alternative.** localStorage via Zustand `persist`. Was the original
plan when v1 was frontend-only; once D1 added the backend, server-side storage
became natural.

## D4 — Money stored as integer paise

**Decision.** All amounts in `Account`, `Trade`, `PendingWithdrawal`, etc. are
integer paise. Format only at the view layer.

**Why.** Avoids floating-point drift that would silently corrupt the corpus
over many trades.

## D5 — Fee model: configurable percent-of-profit

**Decision.** A single `feePercent` (0..1) in Settings, default `0.05`. Applied
only on profitable closes. Loss closes have no fee bookkeeping.

**Rejected alternative.** Modeling per-order brokerage + STT + GST. Too much
accounting overhead for v1; the user can adjust the percent to approximate
real-world net.

## D6 — Profit splits queue as `PendingWithdrawal`s; user confirms before cash leaves the corpus

**Decision.** When a profitable close fires R2 (SELF_SUSTAINING), the 50%
withdrawal half is **queued**, not auto-debited. User confirms or cancels in
the Withdrawals view. Only `CONFIRMED` withdrawals reduce `investableCorpus`.

**Why.** User wanted explicit control over withdrawals. Auto-deduction felt
invisible.

**Implication.** Corpus appears slightly inflated until the user confirms —
the spec's worked example (§3) makes this explicit.

## D7 — Loss closes only debit the corpus

**Decision.** No fee, no profit split, no withdrawal queue entry — just
`investableCorpus -= loss`.

**Why.** Fees apply to profits only by D5. Losses are pure capital reduction.

## D8 — 2X bootstrap target uses cumulative *net* realizedPnL; losses subtract

**Decision.** R1 fires when cumulative `realizedPnL ≥ 2 * principalX` where
`realizedPnL` is the running net (profits add, losses subtract). The 2X
goalpost itself never moves.

**Why.** Honest accounting — losses along the way must be made up before the
bootstrap counts as complete.

## D9 — `principalX` is locked after the first trade

**Decision.** Editable until any trade exists, then frozen. Settings exposes a
"Reset everything" action (with double-confirmation) that wipes all data and
allows a new `principalX`.

**Why.** Once trades reference an `X`-derived corpus and lock floor,
retroactively changing `X` would silently corrupt phase math.

## D10 — Position-size soft cap: configurable, default 25%, set 0 to disable

**Decision.** A `positionSizeCap` fraction in Settings. The Decision Helper
raises a WARN (not BLOCK) if `capitalRequired > positionSizeCap *
investableCorpus`. `0` disables the check entirely.

**Why.** Soft cap stops one bad trade from blowing up the corpus, while
preserving the user's right to override after seeing the warning.

## D11 — Multi-leg strategies are out of scope for v1

**Decision.** Each option leg is one independent `Trade`. Spreads, straddles,
etc. are entered as multiple trades.

**Why.** Multi-leg adds significant complexity (linked closes, combined
greeks, margin offsets) that v1's audience (one user with a clear directional
philosophy) doesn't yet need.

**Forward path.** Post-v1, introduce a `Strategy` entity grouping legs with
shared lifecycle.

## D12 — AI Advisor calls happen only server-side; the model has tools for live state

**Decision.** All LLM calls go through the backend. The model has tool access
to `get_account_state`, `get_open_trades`, `get_recent_closed`,
`evaluate_decision` (the deterministic rules engine), and
`get_zerodha_positions`.

**Why.**
- Hide secrets.
- Ground answers in real state — no hallucinated numbers.
- Enforce that the AI **cannot override** a deterministic BLOCK from the
  rules engine. The system prompt says: if `evaluate_decision` returns BLOCK,
  the advisor's verdict is BLOCK regardless of how attractive the trade looks.

## D13 — Repo location: `genai-jerry/options-trader`, separate from lighthouse-ui

**Decision.** Brand-new repo. Monorepo with `apps/web`, `apps/server`,
`packages/shared`. Default branch `main`.

**Why.** Keep options-trading code completely separate from `lighthouse-ui`,
which is an unrelated project.

## D14 — Withdrawals view distinguishes PENDING / CONFIRMED / CANCELLED

**Decision.** `WithdrawalStatus` is a three-state enum, not a boolean. Users
may cancel a pending withdrawal — the amount stays in the corpus and the entry
is marked `CANCELLED` for audit.

**Why.** Audit trail. The user wanted to keep options open; canceling a
withdrawal isn't the same as it never having been queued.

## D15 — Frontend uses react-query for fetch/cache; Zustand only for UI state

**Decision.** Server data lives in react-query. Zustand only owns ephemeral UI
state (modals, form drafts, etc.).

**Why.** With a backend (D1, D3), the cache invalidation primitives in
react-query are the right tool. Zustand `persist` is no longer needed for
durable state.

---

## Open issues (not decisions, but worth recording)

- **Harness repo allowlist.** This Claude environment is allowlisted only for
  `lighthouse-ui`. Both the local git proxy and the commit-signing server
  reject `options-trader`. Until that's fixed, code changes for the new repo
  can't be pushed directly from a Claude session — workaround was a git
  bundle transported via clipboard. See CONTEXT.md.
- **Zerodha brokerage modeling fidelity.** D5 keeps things simple. If real
  net P&L diverges materially from what the percent-of-profit model predicts,
  revisit and consider a per-order brokerage + STT + GST module post-v1.
