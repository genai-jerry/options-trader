import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NewTradeInput } from '@options-trader/shared';
import { api } from './client';

const KEYS = {
  account: ['account'] as const,
  trades: (filter?: { status?: string; instrument?: string; symbol?: string }) =>
    ['trades', filter ?? {}] as const,
  withdrawals: (status?: string) => ['withdrawals', status ?? null] as const,
};

// ── account ────────────────────────────────────────────────────────────

export function useAccount() {
  return useQuery({ queryKey: KEYS.account, queryFn: api.getAccount });
}

export function useSetPrincipal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (principalX: number) => api.setPrincipal(principalX),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.account }),
  });
}

export function usePutSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.putSettings,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.account }),
  });
}

export function useResetAll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.resetAll,
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useUnlock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.unlock,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.account }),
  });
}

// ── trades ─────────────────────────────────────────────────────────────

export function useTrades(filter: { status?: 'OPEN' | 'CLOSED'; instrument?: string; symbol?: string } = {}) {
  return useQuery({ queryKey: KEYS.trades(filter), queryFn: () => api.listTrades(filter) });
}

export function useCreateTrade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewTradeInput) => api.createTrade(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.account });
      qc.invalidateQueries({ queryKey: ['trades'] });
    },
  });
}

export function useCloseTrade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, exitPrice }: { id: string; exitPrice: number }) => api.closeTrade(id, exitPrice),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.account });
      qc.invalidateQueries({ queryKey: ['trades'] });
      qc.invalidateQueries({ queryKey: ['withdrawals'] });
    },
  });
}

// ── withdrawals ────────────────────────────────────────────────────────

export function useWithdrawals(status?: 'PENDING' | 'CONFIRMED' | 'CANCELLED') {
  return useQuery({ queryKey: KEYS.withdrawals(status), queryFn: () => api.listWithdrawals(status) });
}

export function useConfirmWithdrawal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.confirmWithdrawal(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.account });
      qc.invalidateQueries({ queryKey: ['withdrawals'] });
    },
  });
}

export function useCancelWithdrawal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.cancelWithdrawal(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['withdrawals'] }),
  });
}
