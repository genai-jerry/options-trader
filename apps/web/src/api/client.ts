import type {
  Account,
  AdvisorMessage,
  DecisionRecord,
  NewTradeInput,
  PendingWithdrawal,
  Trade,
  User,
} from '@options-trader/shared';

export interface AuthStatus {
  googleConfigured: boolean;
}

export interface FamilyMember {
  memberEmail: string;
  ownerUserId: string;
  memberUserId: string | null;
  invitedAt: string;
  acceptedAt: string | null;
}

export type FamilyContext =
  | { role: 'owner'; memberCount: number }
  | { role: 'member'; ownerUserId: string; ownerEmail: string | null; ownerName: string | null };

export interface MeResponse {
  user: User;
  family: FamilyContext;
}

export interface FamilyListResponse {
  role: 'owner' | 'member';
  ownerUserId: string;
  members: FamilyMember[];
}

export interface AdvisorStatus {
  enabled: boolean;
  provider: string;
  model: string;
  configured: boolean;
}

export interface AdvisorDecideResponse {
  verdict: 'GO' | 'WARN' | 'BLOCK';
  summary: string;
  points: string[];
  rulesAlignment: string;
  rules: DecisionRecord;
  toolTrace: { name: string; output: string }[];
}

export interface AdvisorReview {
  observations: string[];
  riskFlags: string[];
  suggestions: string[];
}

export interface ZerodhaStatus {
  configured: boolean;
  credentialsSource: 'db' | 'env' | null;
  connected: boolean;
  userId?: string;
  userName?: string;
  loginAt?: string;
}

export interface ZerodhaCredentialsStatus {
  configured: boolean;
  source: 'db' | 'env' | null;
  hasDbCreds: boolean;
  hasEnvCreds: boolean;
  apiKeyMasked: string | null;
  updatedAt: string | null;
}

export interface KiteFundsSegment {
  enabled: boolean;
  net: number;
  available: { cash: number; opening_balance: number; live_balance: number; collateral: number };
  utilised: { debits: number; m2m_realised: number; m2m_unrealised: number; option_premium: number; span: number };
}

export interface KiteHolding {
  tradingsymbol: string;
  exchange: string;
  quantity: number;
  average_price: number;
  last_price: number;
  pnl: number;
  day_change: number;
  day_change_percentage: number;
}

export interface KitePosition {
  tradingsymbol: string;
  exchange: string;
  product: string;
  quantity: number;
  average_price: number;
  last_price: number;
  pnl: number;
  m2m: number;
}

export interface KiteOrder {
  order_id: string;
  status: string;
  tradingsymbol: string;
  exchange: string;
  transaction_type: string;
  order_type: string;
  product: string;
  quantity: number;
  filled_quantity: number;
  pending_quantity: number;
  price: number;
  average_price: number;
  order_timestamp: string;
}

export interface KiteTrade {
  trade_id: string;
  order_id: string;
  tradingsymbol: string;
  exchange: string;
  transaction_type: 'BUY' | 'SELL';
  product: string;
  average_price: number;
  quantity: number;
  fill_timestamp?: string;
  exchange_timestamp?: string;
  order_timestamp?: string;
}

/** A single Kite fill, persisted in broker_trades. averagePricePaise is integer paise. */
export interface BrokerTrade {
  tradeId: string;
  orderId: string;
  exchangeOrderId: string | null;
  tradingsymbol: string;
  exchange: string;
  instrumentToken: number | null;
  transactionType: 'BUY' | 'SELL';
  product: string | null;
  quantity: number;
  averagePricePaise: number;
  fillTimestamp: string | null;
  exchangeTimestamp: string | null;
  orderTimestamp: string | null;
  tradeDate: string;
  syncedAt: string;
}

export interface BrokerTradeSync {
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  fillsTotal: number;
}

export interface BrokerTradeHistory {
  trades: BrokerTrade[];
  sync: BrokerTradeSync | null;
}

class HttpError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  query?: Record<string, string | undefined>,
): Promise<T> {
  const url = new URL(path, window.location.origin);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, v);
    }
  }
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
  };
  if (body !== undefined) init.body = JSON.stringify(body);

  const res = await fetch(url.toString(), init);
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // Non-JSON body — typically an HTML/text error page from the
      // edge proxy (e.g. Vercel's "DNS_HOSTNAME_NOT_FOUND" when the
      // backend is unreachable). Surface a clean status-based error
      // instead of letting the SyntaxError bubble up.
      throw new HttpError(
        res.status,
        text,
        res.ok
          ? `${method} ${path} returned a non-JSON response`
          : `${method} ${path} failed (${res.status})`,
      );
    }
  }
  if (!res.ok) {
    const detail =
      parsed && typeof parsed === 'object' && 'error' in parsed
        ? String((parsed as { error: unknown }).error)
        : `${method} ${path} failed (${res.status})`;
    throw new HttpError(res.status, parsed, detail);
  }
  return parsed as T;
}

export { HttpError };

export const api = {
  // ── auth ─────────────────────────────────────────────────────────────
  authStatus: () => request<AuthStatus>('GET', '/api/auth/status'),
  me: () => request<MeResponse>('GET', '/api/auth/me'),
  logout: () => request<null>('POST', '/api/auth/logout'),

  // ── family ───────────────────────────────────────────────────────────
  familyList: () => request<FamilyListResponse>('GET', '/api/family/members'),
  familyAdd: (email: string) =>
    request<{ members: FamilyMember[] }>('POST', '/api/family/members', { email }),
  familyRemove: (email: string) =>
    request<{ members: FamilyMember[] }>(
      'DELETE',
      `/api/family/members/${encodeURIComponent(email)}`,
    ),
  familyLeave: () => request<{ ok: boolean }>('DELETE', '/api/family/membership'),

  // ── account ──────────────────────────────────────────────────────────
  getAccount: () => request<Account>('GET', '/api/account'),
  putSettings: (body: Partial<Pick<Account, 'feePercent' | 'positionSizeCap' | 'aiEnabled'>>) =>
    request<Account>('PUT', '/api/account/settings', body),
  setPrincipal: (principalX: number) =>
    request<Account>('POST', '/api/account/principal', { principalX }),
  resetAll: () => request<Account>('POST', '/api/account/reset', { confirm: 'RESET' }),
  unlock: () => request<Account>('POST', '/api/account/unlock'),

  // ── trades ───────────────────────────────────────────────────────────
  listTrades: (filter: { status?: 'OPEN' | 'CLOSED'; instrument?: string; symbol?: string } = {}) =>
    request<Trade[]>('GET', '/api/trades', undefined, filter),
  createTrade: (input: NewTradeInput) =>
    request<{ trade: Trade; decision: DecisionRecord }>('POST', '/api/trades', input),
  closeTrade: (id: string, exitPrice: number) =>
    request<{
      trade: Trade;
      account: Account;
      firedRules: ('R1' | 'R2' | 'R3')[];
      queuedWithdrawal: PendingWithdrawal | null;
    }>('POST', `/api/trades/${encodeURIComponent(id)}/close`, { exitPrice }),

  // ── withdrawals ──────────────────────────────────────────────────────
  listWithdrawals: (status?: 'PENDING' | 'CONFIRMED' | 'CANCELLED') =>
    request<PendingWithdrawal[]>('GET', '/api/withdrawals', undefined, { status }),
  manualWithdrawal: (amount: number) =>
    request<{ withdrawal: PendingWithdrawal; account: Account }>(
      'POST',
      '/api/withdrawals',
      { amount },
    ),
  confirmWithdrawal: (id: string) =>
    request<{ withdrawal: PendingWithdrawal; account: Account }>(
      'POST',
      `/api/withdrawals/${encodeURIComponent(id)}/confirm`,
    ),
  cancelWithdrawal: (id: string) =>
    request<{ withdrawal: PendingWithdrawal; account: Account }>(
      'POST',
      `/api/withdrawals/${encodeURIComponent(id)}/cancel`,
    ),

  // ── decisions ────────────────────────────────────────────────────────
  listDecisions: (limit = 25) =>
    request<DecisionRecord[]>('GET', '/api/decisions', undefined, { limit: String(limit) }),

  // ── advisor ──────────────────────────────────────────────────────────
  advisorStatus: () => request<AdvisorStatus>('GET', '/api/advisor/status'),
  advisorDecide: (input: NewTradeInput) =>
    request<AdvisorDecideResponse>('POST', '/api/advisor/decide', { input }),
  advisorReview: () =>
    request<AdvisorReview>('POST', '/api/advisor/portfolio-review'),
  advisorConversations: () =>
    request<{ conversationId: string; lastAt: string; turns: number }[]>(
      'GET',
      '/api/advisor/conversations',
    ),
  advisorConversation: (id: string) =>
    request<AdvisorMessage[]>('GET', `/api/advisor/conversations/${encodeURIComponent(id)}`),

  // ── zerodha ──────────────────────────────────────────────────────────
  zerodhaStatus: () => request<ZerodhaStatus>('GET', '/api/zerodha/status'),
  zerodhaCredentials: () =>
    request<ZerodhaCredentialsStatus>('GET', '/api/zerodha/credentials'),
  zerodhaSetCredentials: (apiKey: string, apiSecret: string) =>
    request<null>('PUT', '/api/zerodha/credentials', { apiKey, apiSecret }),
  zerodhaDeleteCredentials: () =>
    request<null>('DELETE', '/api/zerodha/credentials'),
  zerodhaLoginUrl: () => request<{ url: string }>('GET', '/api/zerodha/login-url'),
  zerodhaExchangeToken: (request_token: string) =>
    request<{ user: { user_id: string; user_name: string; email?: string } }>(
      'POST',
      '/api/zerodha/exchange-token',
      { request_token },
    ),
  zerodhaFunds: () =>
    request<{ equity: KiteFundsSegment; commodity: KiteFundsSegment }>(
      'GET',
      '/api/zerodha/funds',
    ),
  zerodhaHoldings: () => request<KiteHolding[]>('GET', '/api/zerodha/holdings'),
  zerodhaPositions: () =>
    request<{ net: KitePosition[]; day: KitePosition[] }>('GET', '/api/zerodha/positions'),
  zerodhaOrders: () => request<KiteOrder[]>('GET', '/api/zerodha/orders'),
  zerodhaTrades: () => request<KiteTrade[]>('GET', '/api/zerodha/trades'),
  zerodhaTradesHistory: (range?: { from?: string; to?: string }) =>
    request<BrokerTradeHistory>('GET', '/api/zerodha/trades/history', undefined, range),
  zerodhaTradesSync: () =>
    request<{ ok: true; fetched: number; upserted: number; sync: BrokerTradeSync }>(
      'POST',
      '/api/zerodha/trades/sync',
    ),
  zerodhaDisconnect: () => request<{ ok: boolean }>('POST', '/api/zerodha/disconnect'),

  // ── health ───────────────────────────────────────────────────────────
  healthDb: () => request<{ status: string; schemaVersion: number; tables: string[] }>('GET', '/api/health/db'),
};
