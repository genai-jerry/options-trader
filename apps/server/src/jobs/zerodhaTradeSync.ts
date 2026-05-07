/**
 * Daily Zerodha trade sync.
 *
 * Kite Connect's `/trades` endpoint returns only fills for the current
 * trading day. We invoke it once per day at 18:00 IST (after market close)
 * and persist the result into `broker_trades`. Days where the user's Kite
 * session has expired are recorded as a failure on `broker_trade_syncs`
 * with `last_error = "Kite session expired"`, which the UI surfaces as a
 * banner prompting the user to reconnect.
 *
 * The job is multi-tenant: it iterates every user with an access token
 * stored in `zerodha_sessions`. Per-user failures are isolated — one
 * user's expired token never blocks another user's sync.
 */

import { createKiteClient, KiteError, type KiteTrade } from '../broker/KiteClient.js';
import type {
  BrokerTradeUpsertRow,
  Repo,
  UserRepo,
} from '../db/repo.js';
import { createUserRepo } from '../db/repo.js';
import type { Database } from 'better-sqlite3';
import { env } from '../env.js';
import { rupeesToPaise } from '@options-trader/shared';

export interface SyncResult {
  fetched: number;
  upserted: number;
}

/**
 * Convert a Kite timestamp ("YYYY-MM-DD HH:mm:ss" in IST) to a YYYY-MM-DD
 * trading-day string. Kite returns local IST strings without a zone
 * marker; we treat them as IST and slice the date prefix. If a fill has
 * no timestamps at all we fall back to the date the sync ran (IST).
 */
function tradeDateFor(t: KiteTrade, fallbackIstDate: string): string {
  const ts = t.fill_timestamp ?? t.exchange_timestamp ?? t.order_timestamp;
  if (ts && ts.length >= 10) return ts.slice(0, 10);
  return fallbackIstDate;
}

/** Today's date in IST as YYYY-MM-DD. */
export function istDateString(now: Date = new Date()): string {
  // IST = UTC+5:30. Compute the IST wall-clock time and slice.
  const istMs = now.getTime() + 5.5 * 60 * 60 * 1000;
  return new Date(istMs).toISOString().slice(0, 10);
}

function tradeToRow(t: KiteTrade, todayIst: string): BrokerTradeUpsertRow {
  const row: BrokerTradeUpsertRow = {
    tradeId: t.trade_id,
    orderId: t.order_id,
    tradingsymbol: t.tradingsymbol,
    exchange: t.exchange,
    transactionType: t.transaction_type,
    quantity: t.quantity,
    // Kite returns rupees with up to 2 decimals.
    averagePricePaise: rupeesToPaise(t.average_price),
    tradeDate: tradeDateFor(t, todayIst),
  };
  if (t.exchange_order_id) row.exchangeOrderId = t.exchange_order_id;
  if (typeof t.instrument_token === 'number') row.instrumentToken = t.instrument_token;
  if (t.product) row.product = t.product;
  if (t.fill_timestamp) row.fillTimestamp = t.fill_timestamp;
  if (t.exchange_timestamp) row.exchangeTimestamp = t.exchange_timestamp;
  if (t.order_timestamp) row.orderTimestamp = t.order_timestamp;
  return row;
}

function resolveCreds(
  userRepo: UserRepo,
): { apiKey: string; apiSecret: string } | null {
  const fromDb = userRepo.getZerodhaCredentials();
  if (fromDb) return { apiKey: fromDb.apiKey, apiSecret: fromDb.apiSecret };
  if (env.KITE_API_KEY && env.KITE_API_SECRET) {
    return { apiKey: env.KITE_API_KEY, apiSecret: env.KITE_API_SECRET };
  }
  return null;
}

/**
 * Sync today's Kite fills for a single user. Throws on session expiry,
 * missing credentials, or Kite API failure — callers should catch and
 * record the error via `recordBrokerTradeSyncFailure`.
 */
export async function syncBrokerTradesForUser(
  userRepo: UserRepo,
): Promise<SyncResult> {
  const session = userRepo.getZerodhaSession();
  if (!session) throw new Error('No active Kite session');

  const creds = resolveCreds(userRepo);
  if (!creds) throw new Error('Kite credentials not configured');

  const client = createKiteClient(creds);
  const trades = await client.getTrades(session.accessToken);

  const todayIst = istDateString();
  const rows = trades.map((t) => tradeToRow(t, todayIst));
  const now = new Date().toISOString();
  const upserted = userRepo.upsertBrokerTrades(rows, now);
  userRepo.recordBrokerTradeSyncSuccess(now, trades.length);

  return { fetched: trades.length, upserted };
}

/**
 * Run the daily sync for every user with a stored Kite access token.
 * Per-user failures are caught and recorded; one bad token never blocks
 * the rest of the fan-out.
 */
export async function syncAllUsers(
  db: Database,
  repo: Repo,
  log: (msg: string) => void = console.log,
): Promise<void> {
  const userIds = repo.listUserIdsWithKiteSession();
  log(`[zerodha-sync] starting daily sync for ${userIds.length} user(s)`);

  for (const userId of userIds) {
    const userRepo = createUserRepo(db, userId);
    try {
      const result = await syncBrokerTradesForUser(userRepo);
      log(
        `[zerodha-sync] user=${userId} fetched=${result.fetched} upserted=${result.upserted}`,
      );
    } catch (err) {
      const message =
        err instanceof KiteError
          ? `${err.errorType ?? 'KiteError'}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'Unknown error';
      userRepo.recordBrokerTradeSyncFailure(new Date().toISOString(), message);
      log(`[zerodha-sync] user=${userId} skipped — ${message}`);
    }
  }
}
