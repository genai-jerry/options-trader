/**
 * Thin wrapper around Zerodha Kite Connect REST.
 *
 * READ-ONLY by design — there is no order placement here. The only writes
 * are the OAuth `request_token → access_token` exchange and the
 * `invalidate-token` call on disconnect.
 *
 * Authentication notes:
 * - The user logs in at `https://kite.zerodha.com/connect/login?api_key=…&v=3`.
 * - Kite redirects back to the app's redirect URL with `?request_token=…`.
 * - We POST { api_key, request_token, checksum=sha256(api_key+request_token+api_secret) }
 *   to `/session/token`. Response carries access_token + user.
 * - All subsequent REST calls use header `Authorization: token <api_key>:<access_token>`.
 * - access_token is daily — expires at 6am IST every day.
 */

import { createHash } from 'node:crypto';

const KITE_API_BASE = 'https://api.kite.trade';
const KITE_LOGIN_BASE = 'https://kite.zerodha.com/connect/login';

export interface KiteUser {
  user_id: string;
  user_name: string;
  user_shortname?: string;
  email?: string;
  user_type?: string;
  broker?: string;
  exchanges?: string[];
  products?: string[];
  order_types?: string[];
  avatar_url?: string | null;
}

export interface KiteSession extends KiteUser {
  access_token: string;
  public_token: string;
  refresh_token?: string;
  api_key: string;
  login_time: string;
}

export interface KiteFunds {
  equity: KiteFundsSegment;
  commodity: KiteFundsSegment;
}

export interface KiteFundsSegment {
  enabled: boolean;
  net: number;
  available: { adhoc_margin: number; cash: number; opening_balance: number; live_balance: number; collateral: number; intraday_payin: number };
  utilised: { debits: number; exposure: number; m2m_realised: number; m2m_unrealised: number; option_premium: number; payout: number; span: number; holding_sales: number; turnover: number; liquid_collateral: number; stock_collateral: number };
}

export interface KiteHolding {
  tradingsymbol: string;
  exchange: string;
  isin: string;
  quantity: number;
  t1_quantity: number;
  realised_quantity: number;
  authorised_quantity: number;
  product: string;
  collateral_quantity: number;
  collateral_type: string;
  average_price: number;
  last_price: number;
  close_price: number;
  pnl: number;
  day_change: number;
  day_change_percentage: number;
}

export interface KitePosition {
  tradingsymbol: string;
  exchange: string;
  product: string;
  quantity: number;
  overnight_quantity: number;
  multiplier: number;
  average_price: number;
  close_price: number;
  last_price: number;
  value: number;
  pnl: number;
  m2m: number;
  unrealised: number;
  realised: number;
  buy_quantity: number;
  buy_price: number;
  buy_value: number;
  sell_quantity: number;
  sell_price: number;
  sell_value: number;
}

export interface KitePositions {
  net: KitePosition[];
  day: KitePosition[];
}

export interface KiteOrder {
  order_id: string;
  exchange_order_id?: string;
  parent_order_id?: string | null;
  status: string;
  status_message?: string | null;
  order_timestamp: string;
  exchange_timestamp?: string | null;
  variety: string;
  exchange: string;
  tradingsymbol: string;
  instrument_token: number;
  order_type: string;
  transaction_type: string;
  validity: string;
  product: string;
  quantity: number;
  disclosed_quantity: number;
  price: number;
  trigger_price: number;
  average_price: number;
  filled_quantity: number;
  pending_quantity: number;
  cancelled_quantity: number;
}

export interface KiteCredentials {
  apiKey: string;
  apiSecret: string;
}

interface KiteResponseEnvelope<T> {
  status: 'success' | 'error';
  data?: T;
  message?: string;
  error_type?: string;
}

export class KiteError extends Error {
  status: number;
  errorType: string | undefined;
  constructor(status: number, errorType: string | undefined, message: string) {
    super(message);
    this.status = status;
    this.errorType = errorType;
  }
}

export function createKiteClient(creds: KiteCredentials) {
  function checksum(requestToken: string): string {
    return createHash('sha256')
      .update(`${creds.apiKey}${requestToken}${creds.apiSecret}`)
      .digest('hex');
  }

  async function call<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    accessToken: string | null,
    formBody?: Record<string, string>,
  ): Promise<T> {
    const init: RequestInit = {
      method,
      headers: {
        'X-Kite-Version': '3',
        ...(accessToken
          ? { Authorization: `token ${creds.apiKey}:${accessToken}` }
          : {}),
        ...(formBody ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
    };
    if (formBody) {
      init.body = new URLSearchParams(formBody).toString();
    }
    const res = await fetch(`${KITE_API_BASE}${path}`, init);
    const text = await res.text();
    let parsed: KiteResponseEnvelope<T>;
    try {
      parsed = JSON.parse(text) as KiteResponseEnvelope<T>;
    } catch {
      throw new KiteError(res.status, undefined, `Non-JSON response from Kite (${res.status}): ${text.slice(0, 200)}`);
    }
    if (!res.ok || parsed.status === 'error') {
      throw new KiteError(
        res.status,
        parsed.error_type,
        parsed.message ?? `Kite ${method} ${path} failed (${res.status})`,
      );
    }
    return parsed.data as T;
  }

  return {
    loginUrl(): string {
      const params = new URLSearchParams({ api_key: creds.apiKey, v: '3' });
      return `${KITE_LOGIN_BASE}?${params.toString()}`;
    },

    async exchangeRequestToken(requestToken: string): Promise<KiteSession> {
      return await call<KiteSession>('POST', '/session/token', null, {
        api_key: creds.apiKey,
        request_token: requestToken,
        checksum: checksum(requestToken),
      });
    },

    async invalidateAccessToken(accessToken: string): Promise<void> {
      // Best-effort; ignore failures.
      try {
        await call<unknown>('DELETE', `/session/token?api_key=${encodeURIComponent(creds.apiKey)}&access_token=${encodeURIComponent(accessToken)}`, accessToken);
      } catch {
        /* ignore */
      }
    },

    getProfile: (accessToken: string) => call<KiteUser>('GET', '/user/profile', accessToken),
    getFunds: (accessToken: string) => call<KiteFunds>('GET', '/user/margins', accessToken),
    getHoldings: (accessToken: string) =>
      call<KiteHolding[]>('GET', '/portfolio/holdings', accessToken),
    getPositions: (accessToken: string) =>
      call<KitePositions>('GET', '/portfolio/positions', accessToken),
    getOrders: (accessToken: string) => call<KiteOrder[]>('GET', '/orders', accessToken),
  };
}

export type KiteClient = ReturnType<typeof createKiteClient>;
