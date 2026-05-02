import type {
  Account,
  DecisionRecord,
  NewTradeInput,
  PendingWithdrawal,
  Trade,
} from '@options-trader/shared';

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
  };
  if (body !== undefined) init.body = JSON.stringify(body);

  const res = await fetch(url.toString(), init);
  const text = await res.text();
  const parsed = text ? (JSON.parse(text) as unknown) : null;
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

  // ── health ───────────────────────────────────────────────────────────
  healthDb: () => request<{ status: string; schemaVersion: number; tables: string[] }>('GET', '/api/health/db'),
};
