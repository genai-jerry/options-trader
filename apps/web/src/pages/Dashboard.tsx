import { Alert, Box, Chip, CircularProgress, Paper, Stack, Typography } from '@mui/material';
import { formatINR } from '@options-trader/shared';
import { useAccount, useTrades, useWithdrawals } from '../api/hooks';

const PHASE_COLOR = {
  BOOTSTRAP: 'warning',
  SELF_SUSTAINING: 'success',
  LOCKED: 'error',
} as const;

export function Dashboard() {
  const accountQ = useAccount();
  const openQ = useTrades({ status: 'OPEN' });
  const pendingQ = useWithdrawals('PENDING');

  if (accountQ.isLoading) return <CircularProgress />;
  if (accountQ.isError) return <Alert severity="error">Failed to load account.</Alert>;
  const account = accountQ.data!;

  const lockFloor = account.principalX !== null ? Math.floor(account.principalX / 2) : null;
  const lockDistance = lockFloor !== null ? account.investableCorpus - lockFloor : null;
  const pendingTotal = (pendingQ.data ?? []).reduce((sum, w) => sum + w.amount, 0);

  return (
    <Stack spacing={3}>
      <Box display="flex" alignItems="center" gap={2}>
        <Typography variant="h4">Dashboard</Typography>
        <Chip label={account.phase} color={PHASE_COLOR[account.phase]} />
      </Box>

      {account.principalX === null && (
        <Alert severity="info">
          Principal X is not configured. Open Settings to set it before placing trades.
        </Alert>
      )}

      <Box
        display="grid"
        gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))"
        gap={2}
      >
        <Tile label="Investable corpus" value={formatINR(account.investableCorpus)} />
        <Tile label="Set aside" value={formatINR(account.setAside)} />
        <Tile label="Cash withdrawn" value={formatINR(account.cashWithdrawn)} />
        <Tile label="Pending withdrawals" value={formatINR(pendingTotal)} />
        <Tile label="Realized P&L" value={formatINR(account.realizedPnL)} />
        <Tile label="Fees paid" value={formatINR(account.feesPaid)} />
        {lockFloor !== null && lockDistance !== null && (
          <Tile
            label="Distance to lock floor"
            value={formatINR(lockDistance)}
            sub={`Floor: ${formatINR(lockFloor)}`}
            tone={lockDistance <= 0 ? 'error' : lockDistance < lockFloor / 2 ? 'warning' : 'default'}
          />
        )}
        <Tile label="Open trades" value={String(openQ.data?.length ?? 0)} />
      </Box>

      <Typography color="text.secondary" variant="caption">
        Step 9 will replace these tiles with the full dashboard (lock-floor gauge, equity curve,
        recent decisions). The data here is live from <code>/api/account</code>.
      </Typography>
    </Stack>
  );
}

function Tile(props: { label: string; value: string; sub?: string; tone?: 'default' | 'warning' | 'error' }) {
  const borderColor =
    props.tone === 'error' ? 'error.main' : props.tone === 'warning' ? 'warning.main' : 'divider';
  return (
    <Paper sx={{ p: 2, borderLeft: 4, borderColor }}>
      <Typography variant="overline" color="text.secondary">
        {props.label}
      </Typography>
      <Typography variant="h5">{props.value}</Typography>
      {props.sub && (
        <Typography variant="caption" color="text.secondary">
          {props.sub}
        </Typography>
      )}
    </Paper>
  );
}
