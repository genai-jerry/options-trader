import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import {
  formatINR,
  type PendingWithdrawal,
  type WithdrawalStatus,
} from '@options-trader/shared';
import { HttpError } from '../api/client';
import {
  useCancelWithdrawal,
  useConfirmWithdrawal,
  useWithdrawals,
} from '../api/hooks';

const TABS: { value: WithdrawalStatus; label: string }[] = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'CONFIRMED', label: 'Confirmed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export function Withdrawals() {
  const [tab, setTab] = useState<WithdrawalStatus>('PENDING');
  const q = useWithdrawals(tab);

  return (
    <Stack spacing={3}>
      <Typography variant="h4">Withdrawals</Typography>

      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v as WithdrawalStatus)}
        textColor="primary"
        indicatorColor="primary"
      >
        {TABS.map((t) => (
          <Tab key={t.value} value={t.value} label={t.label} />
        ))}
      </Tabs>

      {q.isLoading && <CircularProgress />}
      {q.isError && <Alert severity="error">Failed to load withdrawals.</Alert>}
      {q.data && q.data.length === 0 && (
        <Alert severity="info">No {tab.toLowerCase()} withdrawals.</Alert>
      )}

      <Stack spacing={2}>
        {q.data?.map((w) => <WithdrawalCard key={w.id} withdrawal={w} />)}
      </Stack>
    </Stack>
  );
}

function WithdrawalCard({ withdrawal }: { withdrawal: PendingWithdrawal }) {
  const confirm = useConfirmWithdrawal();
  const cancel = useCancelWithdrawal();

  const created = new Date(withdrawal.createdAt).toLocaleString();
  const decided = withdrawal.decidedAt
    ? new Date(withdrawal.decidedAt).toLocaleString()
    : null;

  const statusColor: Record<
    WithdrawalStatus,
    'warning' | 'success' | 'default'
  > = {
    PENDING: 'warning',
    CONFIRMED: 'success',
    CANCELLED: 'default',
  };

  const error = confirm.error ?? cancel.error;
  const errorMessage =
    error instanceof HttpError
      ? error.message
      : error
        ? 'Action failed.'
        : null;

  return (
    <Card>
      <CardContent>
        <Box display="flex" justifyContent="space-between" alignItems="center" gap={2}>
          <Stack spacing={0.5}>
            <Typography variant="h5">{formatINR(withdrawal.amount)}</Typography>
            <Typography variant="caption" color="text.secondary">
              From trade <code>{withdrawal.fromTradeId.slice(0, 8)}…</code> · queued {created}
              {decided && ` · decided ${decided}`}
            </Typography>
          </Stack>

          <Stack direction="row" spacing={1} alignItems="center">
            <Chip
              label={withdrawal.status}
              color={statusColor[withdrawal.status]}
              size="small"
            />
            {withdrawal.status === 'PENDING' && (
              <>
                <Button
                  size="small"
                  variant="contained"
                  disabled={confirm.isPending || cancel.isPending}
                  onClick={() => confirm.mutate(withdrawal.id)}
                >
                  Confirm
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  color="inherit"
                  disabled={confirm.isPending || cancel.isPending}
                  onClick={() => cancel.mutate(withdrawal.id)}
                >
                  Cancel
                </Button>
              </>
            )}
          </Stack>
        </Box>

        {errorMessage && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {errorMessage}
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
