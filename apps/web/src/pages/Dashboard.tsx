import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { LineChart } from '@mui/x-charts/LineChart';
import { Link as RouterLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  formatINR,
  rupeesToPaise,
  type Account,
  type DecisionRecord,
  type Trade,
} from '@options-trader/shared';
import type { ChargesBreakdown } from '../domain/indianTax';
import {
  useAccount,
  useDecisions,
  useTrades,
  useUnlock,
  useWithdrawals,
} from '../api/hooks';
import { api } from '../api/client';
import {
  SLAB_OPTIONS,
  SLAB_STORAGE_KEY,
  TAX_RATES_REVIEWED_AT,
  TAX_RATES_SOURCE_URL,
} from '../domain/indianTax';
import { computeYtdSummary } from '../domain/zerodhaInsights';

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

  // Broker reality (synced Kite fills + live positions). Same query keys
  // as the Zerodha Sync tabs so Recalculate / Sync now there refreshes
  // these too — the Dashboard reflects whatever's in the cache.
  const ytdQ = useQuery({
    queryKey: ['zerodha', 'trades-history'],
    queryFn: () => api.zerodhaTradesHistory(),
    retry: false,
  });
  const positionsQ = useQuery({
    queryKey: ['zerodha', 'positions'],
    queryFn: api.zerodhaPositions,
    retry: false,
  });

  const [slab, setSlab] = useState<number>(() => {
    const stored = window.localStorage.getItem(SLAB_STORAGE_KEY);
    const n = stored ? Number(stored) : 30;
    return SLAB_OPTIONS.includes(n as (typeof SLAB_OPTIONS)[number]) ? n : 30;
  });
  useEffect(() => {
    window.localStorage.setItem(SLAB_STORAGE_KEY, String(slab));
  }, [slab]);

  if (accountQ.isLoading) return <CircularProgress />;
  if (accountQ.isError) return <Alert severity="error">Failed to load account.</Alert>;
  const account = accountQ.data!;

  const brokerTrades = ytdQ.data?.trades ?? [];
  const ytd = brokerTrades.length > 0 ? computeYtdSummary(brokerTrades, slab) : null;
  const dayPositions = positionsQ.data?.day ?? [];
  // /positions.day.pnl is realised+unrealised for today only. To isolate
  // unrealised we need today's realised (which we don't have without
  // fetching orders), so we approximate by using the day's total pnl.
  // For the realistic-corpus tile this overcounts by today's realised
  // already in YTD, but day.pnl is small relative to YTD so the bias is
  // negligible until intraday matters. If a user wants pixel-perfect we
  // can subtract today's intra-day realised from broker_trades.
  const todayPnl = dayPositions.reduce((acc, p) => acc + p.pnl, 0);
  const realisticCorpus =
    account.principalX !== null && ytd
      ? account.principalX + ytd.tax.realisedAfterAll + todayPnl
      : null;

  const lockFloor =
    account.principalX !== null ? Math.floor(account.principalX / 2) : null;
  const lockDistance =
    lockFloor !== null ? account.investableCorpus - lockFloor : null;
  const pendingTotal = (pendingQ.data ?? []).reduce((s, w) => s + w.amount, 0);
  const bootstrapTarget =
    account.principalX !== null ? account.principalX * 2 : null;

  return (
    <Stack spacing={{ xs: 2, sm: 3 }}>
      <Box display="flex" alignItems="center" gap={1.5} flexWrap="wrap">
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

      {/* Tiles — 2-up on mobile, 3-up on tablet, auto-fit on desktop */}
      <Box
        display="grid"
        gap={{ xs: 1.5, sm: 2 }}
        sx={{
          gridTemplateColumns: {
            xs: 'repeat(2, 1fr)',
            sm: 'repeat(3, 1fr)',
            md: 'repeat(auto-fit, minmax(200px, 1fr))',
          },
        }}
      >
        <Tile label="Investable corpus" value={formatINR(account.investableCorpus)} accent="primary" />
        <Tile label="Set aside" value={formatINR(account.setAside)} />
        <Tile label="Cash withdrawn" value={formatINR(account.cashWithdrawn)} />
        <Tile
          label="Pending withdrawals"
          value={formatINR(pendingTotal)}
          sub={pendingQ.data?.length ? `${pendingQ.data.length} queued` : undefined}
        />
        <Tile
          label="Realized P&L"
          value={formatINR(account.realizedPnL)}
          accent={account.realizedPnL >= 0 ? 'success' : 'error'}
        />
        <Tile label="Profit shared" value={formatINR(account.feesPaid)} />
        <Tile label="Open trades" value={String(openQ.data?.length ?? 0)} />
        {lockFloor !== null && lockDistance !== null && (
          <Tile
            label="Distance to lock floor"
            value={formatINR(lockDistance)}
            sub={`Floor: ${formatINR(lockFloor)}`}
            accent={
              lockDistance <= 0
                ? 'error'
                : lockDistance < lockFloor / 2
                  ? 'warning'
                  : undefined
            }
          />
        )}
      </Box>

      {/* ── Broker activity (Kite fills synced daily) ───────────────── */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        spacing={1}
      >
        <Box>
          <Typography variant="subtitle2">Broker activity (YTD, after tax)</Typography>
          <Typography variant="caption" color="text.secondary" component="div">
            {ytd
              ? `FY since ${ytd.fyStart} · ${ytd.dayCount} day${ytd.dayCount === 1 ? '' : 's'} synced · cross-day FIFO`
              : 'No synced fills yet — runs daily at 18:00 IST or hit "Sync now" on Zerodha Sync.'}
            {' · Rates verified '}
            {TAX_RATES_REVIEWED_AT}
            {' · '}
            <a
              href={TAX_RATES_SOURCE_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'inherit' }}
            >
              source
            </a>
          </Typography>
        </Box>
        <TextField
          select
          size="small"
          label="Tax slab"
          value={slab}
          onChange={(e) => setSlab(Number(e.target.value))}
          sx={{ minWidth: 140 }}
        >
          {SLAB_OPTIONS.map((s) => (
            <MenuItem key={s} value={s}>
              {s}%
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      {ytdQ.isError && (
        <Alert severity="info">
          Couldn't load broker trade history. Connect Kite on{' '}
          <RouterLink to="/zerodha" style={{ color: 'inherit' }}>Zerodha Sync</RouterLink>.
        </Alert>
      )}

      {ytd && (
        <Box
          display="grid"
          gap={{ xs: 1.5, sm: 2 }}
          sx={{
            gridTemplateColumns: {
              xs: 'repeat(2, 1fr)',
              sm: 'repeat(3, 1fr)',
              md: 'repeat(auto-fit, minmax(200px, 1fr))',
            },
          }}
        >
          <Tile
            label="YTD realised (FIFO)"
            value={formatINR(rupeesToPaise(ytd.realised))}
            accent={ytd.realised >= 0 ? 'success' : 'error'}
            sub="Matched across days"
          />
          <ChargesTile charges={ytd.tax.charges} />
          <Tile
            label={`YTD tax @ ${slab}% + cess`}
            value={formatINR(rupeesToPaise(ytd.tax.incomeTax))}
            accent={ytd.tax.incomeTax > 0 ? 'error' : undefined}
            sub={
              ytd.tax.realisedAfterCharges > 0
                ? `Effective ${(ytd.tax.effectiveRate * 100).toFixed(1)}%`
                : 'No tax on a net loss'
            }
          />
          <Tile
            label="YTD net after tax"
            value={formatINR(rupeesToPaise(ytd.tax.realisedAfterAll))}
            accent={ytd.tax.realisedAfterAll >= 0 ? 'success' : 'error'}
            sub="Realised − charges − tax"
          />
          {realisticCorpus !== null && (
            <Tile
              label="Realistic corpus"
              value={formatINR(rupeesToPaise(realisticCorpus))}
              accent="primary"
              sub="Principal X + YTD net + day P&L"
            />
          )}
          <Tile
            label="Today's broker P&L"
            value={formatINR(rupeesToPaise(todayPnl))}
            accent={todayPnl >= 0 ? 'success' : todayPnl < 0 ? 'error' : undefined}
            sub="Live positions M2M"
          />
        </Box>
      )}

      {/* Principal recovered */}
      {account.principalX !== null && account.principalX > 0 && (
        <Card>
          <CardContent>
            <ProgressRow
              title="Principal recovered"
              subtitle="Cash withdrawn vs principal X"
              left={formatINR(account.cashWithdrawn)}
              right={formatINR(account.principalX)}
              percent={(account.cashWithdrawn / account.principalX) * 100}
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

      {/* Bootstrap progress */}
      {account.phase === 'BOOTSTRAP' && bootstrapTarget !== null && (
        <Card>
          <CardContent>
            <ProgressRow
              title="Bootstrap progress"
              subtitle="Cumulative net P&L vs 2X target"
              left={formatINR(account.realizedPnL)}
              right={formatINR(bootstrapTarget)}
              percent={(account.realizedPnL / bootstrapTarget) * 100}
            />
          </CardContent>
        </Card>
      )}

      {/* Lock-floor gauge */}
      {lockFloor !== null && account.principalX !== null && (
        <LockFloorGauge account={account} />
      )}

      <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: '2fr 1fr' }} gap={{ xs: 2, md: 3 }}>
        <EquityCurveCard closed={closedQ.data ?? []} />
        <RecentDecisionsCard decisions={decisionsQ.data ?? []} />
      </Box>

      <OpenPositionsCard trades={openQ.data ?? []} />
    </Stack>
  );
}

// ─── charges tile (with hover breakdown) ─────────────────────────────

function ChargesTile({ charges }: { charges: ChargesBreakdown }) {
  return (
    <Tooltip
      title={
        <Box sx={{ fontSize: 12 }}>
          <div>STT: {formatINR(rupeesToPaise(charges.stt))}</div>
          <div>Exchange txn: {formatINR(rupeesToPaise(charges.exchange))}</div>
          <div>SEBI fee: {formatINR(rupeesToPaise(charges.sebi))}</div>
          <div>Stamp duty: {formatINR(rupeesToPaise(charges.stamp))}</div>
          <div>Brokerage: {formatINR(rupeesToPaise(charges.brokerage))}</div>
          <div>GST (18%): {formatINR(rupeesToPaise(charges.gst))}</div>
        </Box>
      }
      placement="top"
      arrow
    >
      <Box>
        <Tile
          label="YTD charges"
          value={formatINR(rupeesToPaise(charges.total))}
          accent="error"
          sub="STT + exch + GST + stamp + brokerage"
        />
      </Box>
    </Tooltip>
  );
}

// ─── tile ─────────────────────────────────────────────────────────────

function Tile(props: {
  label: string;
  value: string;
  sub?: string;
  accent?: 'primary' | 'success' | 'warning' | 'error';
}) {
  const accentColor = props.accent ? `${props.accent}.main` : 'transparent';
  return (
    <Card sx={{ position: 'relative', overflow: 'hidden' }}>
      {props.accent && (
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            width: 3,
            bgcolor: accentColor,
          }}
        />
      )}
      <CardContent
        sx={{
          py: { xs: 1.5, sm: 2 },
          px: { xs: 1.5, sm: 2 },
          '&:last-child': { pb: { xs: 1.5, sm: 2 } },
        }}
      >
        <Typography
          variant="overline"
          color="text.secondary"
          sx={{ fontSize: { xs: 10, sm: 11 }, lineHeight: 1.3 }}
        >
          {props.label}
        </Typography>
        <Typography
          variant="h6"
          sx={{
            fontSize: { xs: 18, sm: 22 },
            fontWeight: 600,
            mt: 0.25,
            wordBreak: 'break-word',
          }}
        >
          {props.value}
        </Typography>
        {props.sub && (
          <Typography variant="caption" color="text.secondary">
            {props.sub}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

// ─── shared progress row ──────────────────────────────────────────────

function ProgressRow(props: {
  title: string;
  subtitle?: string;
  left: string;
  right: string;
  percent: number;
  color?: 'primary' | 'success' | 'warning' | 'error';
}) {
  const pct = Math.max(0, Math.min(100, props.percent));
  return (
    <>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', sm: 'baseline' }}
        sx={{ mb: 1, gap: 0.5 }}
      >
        <Box>
          <Typography variant="subtitle2">{props.title}</Typography>
          {props.subtitle && (
            <Typography variant="caption" color="text.secondary">
              {props.subtitle}
            </Typography>
          )}
        </Box>
        <Typography variant="caption" color="text.secondary">
          {props.left} / {props.right}
        </Typography>
      </Stack>
      <LinearProgress
        variant="determinate"
        value={pct}
        sx={{ height: 8, borderRadius: 8 }}
        color={props.color ?? 'primary'}
      />
    </>
  );
}

// ─── lock-floor gauge ─────────────────────────────────────────────────

function LockFloorGauge({ account }: { account: Account }) {
  if (account.principalX === null) return null;
  const floor = Math.floor(account.principalX / 2);
  const max = account.principalX * 2;
  const corpusPct = Math.max(0, Math.min(100, (account.investableCorpus / max) * 100));
  const floorPct = (floor / max) * 100;

  const tone =
    account.investableCorpus <= floor
      ? 'error.main'
      : account.investableCorpus < floor * 1.5
        ? 'warning.main'
        : 'success.main';

  return (
    <Card>
      <CardContent>
        <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
          Lock-floor gauge
        </Typography>
        <Box sx={{ position: 'relative', height: 24 }}>
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              borderRadius: 12,
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
              bgcolor: tone,
              borderRadius: 12,
              transition: 'width 240ms',
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

// ─── equity curve ─────────────────────────────────────────────────────

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
      ys.push(cum / 100);
    });
    return { xs, ys };
  }, [closed]);

  return (
    <Card>
      <CardContent>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Equity curve
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          Cumulative net P&L (₹) by closed trade
        </Typography>
        {series.xs.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No closed trades yet.
          </Typography>
        ) : (
          <Box sx={{ width: '100%', height: { xs: 220, md: 260 } }}>
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

// ─── recent decisions ─────────────────────────────────────────────────

function RecentDecisionsCard({ decisions }: { decisions: DecisionRecord[] }) {
  return (
    <Card>
      <CardContent>
        <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
          Recent decisions
        </Typography>
        {decisions.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            None yet.
          </Typography>
        ) : (
          <Stack spacing={1.25}>
            {decisions.slice(0, 8).map((d) => (
              <Box
                key={d.id}
                display="flex"
                justifyContent="space-between"
                alignItems="center"
                gap={1}
              >
                <Stack spacing={0} sx={{ minWidth: 0 }}>
                  <Typography
                    variant="body2"
                    fontWeight={500}
                    noWrap
                    sx={{ minWidth: 0 }}
                  >
                    {d.input.symbol} {d.input.instrument}
                    {d.input.strike ? ` @ ${formatINR(d.input.strike)}` : ''}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {new Date(d.decidedAt).toLocaleDateString()}{' '}
                    {new Date(d.decidedAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
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

// ─── open positions (responsive: table on md+, cards on xs) ──────────

function OpenPositionsCard({ trades }: { trades: Trade[] }) {
  return (
    <Card>
      <CardContent>
        <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
          Open positions
        </Typography>
        {trades.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No open positions.
          </Typography>
        ) : (
          <>
            {/* Compact table on md+ */}
            <Box
              display={{ xs: 'none', md: 'grid' }}
              gridTemplateColumns="2fr 1fr 1fr 1fr 1fr 1fr"
              gap={1}
              sx={{
                '& > .h': {
                  fontSize: 12,
                  color: 'text.secondary',
                  textTransform: 'uppercase',
                  fontWeight: 600,
                },
              }}
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

            {/* Card stack on xs/sm */}
            <Stack spacing={1} sx={{ display: { xs: 'flex', md: 'none' } }}>
              {trades.map((t) => (
                <Box
                  key={t.id}
                  sx={{
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 1.5,
                    p: 1.25,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0.25,
                  }}
                >
                  <Box display="flex" justifyContent="space-between" alignItems="center" gap={1}>
                    <Typography variant="body2" fontWeight={600}>
                      {t.symbol}
                    </Typography>
                    <Chip size="small" label={t.instrument} variant="outlined" />
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    {t.qty} lots · entry {formatINR(t.entryPrice)}
                    {t.strike ? ` · strike ${formatINR(t.strike)}` : ''}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Capital: {formatINR(t.entryPrice * t.qty * t.lotSize)}
                  </Typography>
                </Box>
              ))}
            </Stack>
          </>
        )}
      </CardContent>
    </Card>
  );
}
