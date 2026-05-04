import { useMemo } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { LineChart } from '@mui/x-charts/LineChart';
import { Link as RouterLink } from 'react-router-dom';
import {
  formatINR,
  type Account,
  type DecisionRecord,
  type Trade,
} from '@options-trader/shared';
import {
  useAccount,
  useDecisions,
  useTrades,
  useUnlock,
  useWithdrawals,
} from '../api/hooks';

const PHASE_COLOR = {
  BOOTSTRAP: 'warning',
  SELF_SUSTAINING: 'success',
  LOCKED: 'error',
} as const;

const VERDICT_COLOR = {
  GO: 'success',
  WARN: 'warning',
  BLOCK: 'error',
} as const;

export function Dashboard() {
  const accountQ = useAccount();
  const openQ = useTrades({ status: 'OPEN' });
  const closedQ = useTrades({ status: 'CLOSED' });
  const pendingQ = useWithdrawals('PENDING');
  const decisionsQ = useDecisions(10);
  const unlock = useUnlock();

  if (accountQ.isLoading) return <CircularProgress />;
  if (accountQ.isError) return <Alert severity="error">Failed to load account.</Alert>;
  const account = accountQ.data!;

  const lockFloor =
    account.principalX !== null ? Math.floor(account.principalX / 2) : null;
  const lockDistance =
    lockFloor !== null ? account.investableCorpus - lockFloor : null;
  const pendingTotal = (pendingQ.data ?? []).reduce((s, w) => s + w.amount, 0);
  const bootstrapTarget =
    account.principalX !== null ? account.principalX * 2 : null;

  return (
    <Stack spacing={3}>
      <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
        <Typography variant="h4">Dashboard</Typography>
        <Chip label={account.phase} color={PHASE_COLOR[account.phase]} />
        {account.lockOverrideAt && (
          <Chip label="Unlocked manually" variant="outlined" size="small" />
        )}
        {account.phase === 'LOCKED' && (
          <Button
            variant="outlined"
            color="error"
            size="small"
            disabled={unlock.isPending}
            onClick={() => {
              if (window.confirm('Unlock the account? This bypasses the 0.5X floor.')) {
                unlock.mutate();
              }
            }}
          >
            Unlock
          </Button>
        )}
      </Box>

      {account.principalX === null && (
        <Alert
          severity="info"
          action={
            <Button component={RouterLink} to="/settings" size="small">
              Open Settings
            </Button>
          }
        >
          Principal X is not configured.
        </Alert>
      )}

      {/* Tiles */}
      <Box
        display="grid"
        gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))"
        gap={2}
      >
        <Tile label="Investable corpus" value={formatINR(account.investableCorpus)} />
        <Tile label="Set aside" value={formatINR(account.setAside)} />
        <Tile label="Cash withdrawn" value={formatINR(account.cashWithdrawn)} />
        <Tile
          label="Pending withdrawals"
          value={formatINR(pendingTotal)}
          sub={pendingQ.data?.length ? `${pendingQ.data.length} queued` : undefined}
        />
        <Tile label="Realized P&L" value={formatINR(account.realizedPnL)} />
        <Tile label="Fees paid" value={formatINR(account.feesPaid)} />
        <Tile label="Open trades" value={String(openQ.data?.length ?? 0)} />
        {lockFloor !== null && lockDistance !== null && (
          <Tile
            label="Distance to lock floor"
            value={formatINR(lockDistance)}
            sub={`Floor: ${formatINR(lockFloor)}`}
            tone={
              lockDistance <= 0
                ? 'error'
                : lockDistance < lockFloor / 2
                  ? 'warning'
                  : 'default'
            }
          />
        )}
      </Box>

      {/* Principal recovered (cumulative cashWithdrawn vs principalX) */}
      {account.principalX !== null && account.principalX > 0 && (
        <Card>
          <CardContent>
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              sx={{ mb: 1 }}
            >
              <Typography variant="subtitle2" color="text.secondary">
                Principal recovered (cash withdrawn vs principal X)
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {formatINR(account.cashWithdrawn)} / {formatINR(account.principalX)}
              </Typography>
            </Stack>
            <LinearProgress
              variant="determinate"
              value={Math.max(
                0,
                Math.min(100, (account.cashWithdrawn / account.principalX) * 100),
              )}
              sx={{ height: 10, borderRadius: 1 }}
              color={account.cashWithdrawn >= account.principalX ? 'success' : 'primary'}
            />
            {account.cashWithdrawn >= account.principalX && (
              <Typography variant="caption" color="success.main" sx={{ display: 'block', mt: 1 }}>
                You've taken out at least your starting capital — everything still in the corpus is house money.
              </Typography>
            )}
          </CardContent>
        </Card>
      )}

      {/* Bootstrap gauge */}
      {account.phase === 'BOOTSTRAP' && bootstrapTarget !== null && (
        <Card>
          <CardContent>
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              sx={{ mb: 1 }}
            >
              <Typography variant="subtitle2" color="text.secondary">
                Bootstrap progress (cumulative net P&L vs 2X)
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {formatINR(account.realizedPnL)} / {formatINR(bootstrapTarget)}
              </Typography>
            </Stack>
            <LinearProgress
              variant="determinate"
              value={Math.max(
                0,
                Math.min(100, (account.realizedPnL / bootstrapTarget) * 100),
              )}
              sx={{ height: 10, borderRadius: 1 }}
            />
          </CardContent>
        </Card>
      )}

      {/* Lock-floor gauge */}
      {lockFloor !== null && account.principalX !== null && (
        <LockFloorGauge account={account} />
      )}

      <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: '2fr 1fr' }} gap={3}>
        <EquityCurveCard closed={closedQ.data ?? []} />
        <RecentDecisionsCard decisions={decisionsQ.data ?? []} />
      </Box>

      <OpenPositionsCard trades={openQ.data ?? []} />
    </Stack>
  );
}

function Tile(props: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'warning' | 'error';
}) {
  const borderColor =
    props.tone === 'error'
      ? 'error.main'
      : props.tone === 'warning'
        ? 'warning.main'
        : 'divider';
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

function LockFloorGauge({ account }: { account: Account }) {
  if (account.principalX === null) return null;
  const floor = Math.floor(account.principalX / 2);
  // Visual range: 0 .. 2X. Floor sits at 25% of the bar.
  const max = account.principalX * 2;
  const corpusPct = Math.max(0, Math.min(100, (account.investableCorpus / max) * 100));
  const floorPct = (floor / max) * 100;

  return (
    <Card>
      <CardContent>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
          Lock-floor gauge
        </Typography>
        <Box sx={{ position: 'relative', height: 28 }}>
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              borderRadius: 1,
              bgcolor: 'grey.200',
            }}
          />
          <Box
            sx={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              width: `${corpusPct}%`,
              bgcolor:
                account.investableCorpus <= floor
                  ? 'error.main'
                  : account.investableCorpus < floor * 1.5
                    ? 'warning.main'
                    : 'success.main',
              borderRadius: 1,
              transition: 'width 200ms',
            }}
          />
          <Box
            sx={{
              position: 'absolute',
              top: -4,
              bottom: -4,
              left: `${floorPct}%`,
              width: 2,
              bgcolor: 'error.dark',
            }}
            title={`Floor: ${formatINR(floor)}`}
          />
        </Box>
        <Stack direction="row" justifyContent="space-between" sx={{ mt: 1 }}>
          <Typography variant="caption" color="text.secondary">
            ₹0
          </Typography>
          <Typography variant="caption" color="error.dark">
            Floor {formatINR(floor)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            2X {formatINR(account.principalX * 2)}
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}

function EquityCurveCard({ closed }: { closed: Trade[] }) {
  const series = useMemo(() => {
    const sorted = [...closed]
      .filter((t) => t.exitAt && t.netPnL !== undefined)
      .sort((a, b) => (a.exitAt! < b.exitAt! ? -1 : 1));
    let cum = 0;
    const xs: number[] = [];
    const ys: number[] = [];
    sorted.forEach((t, i) => {
      cum += t.netPnL ?? 0;
      xs.push(i + 1);
      ys.push(cum / 100); // rupees for the chart
    });
    return { xs, ys };
  }, [closed]);

  return (
    <Card>
      <CardContent>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
          Equity curve (cumulative net P&L, ₹)
        </Typography>
        {series.xs.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No closed trades yet.
          </Typography>
        ) : (
          <Box sx={{ width: '100%', height: 260 }}>
            <LineChart
              xAxis={[{ data: series.xs, label: 'Closed trade #' }]}
              series={[{ data: series.ys, label: 'Net P&L (₹)', area: true, showMark: false }]}
              height={260}
              margin={{ left: 60, right: 12, top: 12, bottom: 40 }}
            />
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

function RecentDecisionsCard({ decisions }: { decisions: DecisionRecord[] }) {
  return (
    <Card>
      <CardContent>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
          Recent decisions
        </Typography>
        {decisions.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            None yet.
          </Typography>
        ) : (
          <Stack spacing={1.5}>
            {decisions.slice(0, 8).map((d) => (
              <Box
                key={d.id}
                display="flex"
                justifyContent="space-between"
                alignItems="center"
                gap={1}
              >
                <Stack spacing={0}>
                  <Typography variant="body2" fontWeight={500}>
                    {d.input.symbol} {d.input.instrument}
                    {d.input.strike ? ` @ ${formatINR(d.input.strike)}` : ''}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {new Date(d.decidedAt).toLocaleString()}
                    {d.acceptedByUser ? ' · accepted' : ''}
                  </Typography>
                </Stack>
                <Chip
                  size="small"
                  label={d.verdict}
                  color={VERDICT_COLOR[d.verdict]}
                />
              </Box>
            ))}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}

function OpenPositionsCard({ trades }: { trades: Trade[] }) {
  return (
    <Card>
      <CardContent>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
          Open positions
        </Typography>
        {trades.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No open positions.
          </Typography>
        ) : (
          <Box
            display="grid"
            gridTemplateColumns="2fr 1fr 1fr 1fr 1fr 1fr"
            gap={1}
            sx={{ '& > .h': { fontSize: 12, color: 'text.secondary', textTransform: 'uppercase' } }}
          >
            <Typography className="h">Symbol</Typography>
            <Typography className="h">Inst</Typography>
            <Typography className="h">Strike</Typography>
            <Typography className="h">Lots</Typography>
            <Typography className="h">Entry</Typography>
            <Typography className="h">Capital</Typography>
            {trades.map((t) => (
              <Box key={t.id} display="contents">
                <Typography variant="body2">{t.symbol}</Typography>
                <Typography variant="body2">{t.instrument}</Typography>
                <Typography variant="body2">
                  {t.strike ? formatINR(t.strike) : '—'}
                </Typography>
                <Typography variant="body2">{t.qty}</Typography>
                <Typography variant="body2">{formatINR(t.entryPrice)}</Typography>
                <Typography variant="body2">
                  {formatINR(t.entryPrice * t.qty * t.lotSize)}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
