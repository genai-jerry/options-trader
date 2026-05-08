import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  IconButton,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import RefreshIcon from '@mui/icons-material/Refresh';
import { Link as RouterLink } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  type BrokerTrade,
  type KiteFundsSegment,
  type KiteHolding,
  type KiteOrder,
  type KitePosition,
} from '../api/client';
import {
  SLAB_OPTIONS,
  SLAB_STORAGE_KEY,
  TAX_RATES_REVIEWED_AT,
  TAX_RATES_SOURCE_URL,
  aggregateCharges,
  classifyByMeta,
  computeRealisedFifo,
  computeTaxLiability,
  startOfCurrentFY,
  type FifoFill,
  type FillForCharges,
  type OrderForBrokerage,
  type TaxLiability,
} from '../domain/indianTax';

const Z_KEY = ['zerodha'] as const;

export function ZerodhaSync() {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: [...Z_KEY, 'status'],
    queryFn: api.zerodhaStatus,
    refetchInterval: 60_000,
  });

  // Kite redirects back with ?request_token=…&status=success after login.
  // If we see that in the URL, exchange it automatically.
  const exchange = useMutation({
    mutationFn: api.zerodhaExchangeToken,
    onSuccess: () => qc.invalidateQueries({ queryKey: Z_KEY }),
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('request_token');
    const ok = params.get('status') === 'success';
    if (token && ok && !exchange.isPending) {
      exchange.mutate(token, {
        onSuccess: () => {
          // Strip the token from the URL so a refresh doesn't replay.
          window.history.replaceState({}, '', window.location.pathname);
        },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const disconnect = useMutation({
    mutationFn: api.zerodhaDisconnect,
    onSuccess: () => qc.invalidateQueries({ queryKey: Z_KEY }),
  });

  if (status.isLoading) return <CircularProgress />;
  const s = status.data;

  return (
    <Stack spacing={{ xs: 2, sm: 3 }}>
      <Box
        display="flex"
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        flexDirection={{ xs: 'column', sm: 'row' }}
        gap={1.5}
      >
        <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
          <Typography variant="h4">Zerodha Sync</Typography>
          {s?.connected && (
            <Chip
              size="small"
              color="success"
              label={`${s.userName} (${s.userId})`}
              variant="outlined"
            />
          )}
        </Box>
        <Stack direction="row" spacing={1}>
          <IconButton
            size="small"
            onClick={() => qc.invalidateQueries({ queryKey: Z_KEY })}
            aria-label="Refresh"
          >
            <RefreshIcon />
          </IconButton>
          {s?.connected && (
            <Button
              size="small"
              color="inherit"
              variant="outlined"
              onClick={() => disconnect.mutate()}
              disabled={disconnect.isPending}
            >
              Disconnect
            </Button>
          )}
        </Stack>
      </Box>

      {!s?.configured && (
        <Alert
          severity="warning"
          action={
            <Button
              component={RouterLink}
              to="/settings"
              size="small"
              color="inherit"
            >
              Open Settings
            </Button>
          }
        >
          Add your Kite Connect API key + secret in Settings → Zerodha credentials
          to enable this screen. (Or set <code>KITE_API_KEY</code> /{' '}
          <code>KITE_API_SECRET</code> in <code>apps/server/.env</code> and restart.)
        </Alert>
      )}

      {s?.configured && !s.connected && <ConnectFlow />}

      {exchange.isError && (
        <Alert severity="error">
          {exchange.error instanceof Error ? exchange.error.message : 'Token exchange failed.'}
        </Alert>
      )}

      {s?.connected && (
        <>
          <Typography variant="caption" color="text.secondary">
            Connected at {s.loginAt && new Date(s.loginAt).toLocaleString()}. The Kite
            access token expires daily at ~6am IST — reconnect each trading day.
          </Typography>
          <FundsCard />
          <PortfolioTabs />
        </>
      )}
    </Stack>
  );
}

function ConnectFlow() {
  const [token, setToken] = useState('');
  const exchange = useMutation({
    mutationFn: api.zerodhaExchangeToken,
  });
  const qc = useQueryClient();

  const launch = async () => {
    const { url } = await api.zerodhaLoginUrl();
    window.location.href = url;
  };

  const exchangeManual = () => {
    const t = token.trim();
    if (!t) return;
    exchange.mutate(t, {
      onSuccess: () => {
        setToken('');
        qc.invalidateQueries({ queryKey: Z_KEY });
      },
    });
  };

  return (
    <Card>
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h6">Connect to Kite</Typography>
          <Typography variant="body2" color="text.secondary">
            Click <strong>Connect</strong> to authenticate with Zerodha. After login Kite
            redirects to your registered redirect URL with a <code>request_token</code> in
            the query string. If you're redirected back here, the token is exchanged
            automatically. Otherwise paste the token below.
          </Typography>
          <Box>
            <Button variant="contained" onClick={launch}>
              Connect with Kite
            </Button>
          </Box>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <TextField
              label="request_token"
              size="small"
              fullWidth
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <Button
              variant="outlined"
              onClick={exchangeManual}
              disabled={!token.trim() || exchange.isPending}
            >
              Exchange
            </Button>
          </Stack>
          {exchange.isError && (
            <Alert severity="error">
              {exchange.error instanceof Error ? exchange.error.message : 'Exchange failed.'}
            </Alert>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

function FundsCard() {
  const q = useQuery({ queryKey: [...Z_KEY, 'funds'], queryFn: api.zerodhaFunds });
  if (q.isLoading) return <CircularProgress />;
  if (q.isError) return <Alert severity="error">Failed to load funds. Re-connect?</Alert>;

  return (
    <Card>
      <CardContent>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
          Funds
        </Typography>
        <Box display="grid" gridTemplateColumns="1fr 1fr" gap={2}>
          <SegmentTile label="Equity" segment={q.data?.equity} />
          <SegmentTile label="Commodity" segment={q.data?.commodity} />
        </Box>
      </CardContent>
    </Card>
  );
}

function SegmentTile({ label, segment }: { label: string; segment: KiteFundsSegment | undefined }) {
  if (!segment || !segment.enabled) {
    return (
      <Box>
        <Typography variant="overline" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Disabled
        </Typography>
      </Box>
    );
  }
  return (
    <Box>
      <Typography variant="overline" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h6">₹{segment.net.toLocaleString('en-IN')}</Typography>
      <Tooltip
        title={`Cash ₹${segment.available.cash.toLocaleString('en-IN')}, Live ₹${segment.available.live_balance.toLocaleString('en-IN')}, Used ₹${segment.utilised.debits.toLocaleString('en-IN')}`}
      >
        <Typography variant="caption" color="text.secondary">
          Cash ₹{segment.available.cash.toLocaleString('en-IN')} · Used ₹
          {segment.utilised.debits.toLocaleString('en-IN')}
        </Typography>
      </Tooltip>
    </Box>
  );
}

function PortfolioTabs() {
  const [tab, setTab] = useState<'positions' | 'holdings' | 'orders' | 'trades'>(
    'positions',
  );
  return (
    <Card>
      <CardContent>
        <Tabs value={tab} onChange={(_, v) => setTab(v)}>
          <Tab value="positions" label="Positions" />
          <Tab value="holdings" label="Holdings" />
          <Tab value="orders" label="Orderbook" />
          <Tab value="trades" label="Trades" />
        </Tabs>
        <Box sx={{ mt: 2 }}>
          {tab === 'positions' && <PositionsGrid />}
          {tab === 'holdings' && <HoldingsGrid />}
          {tab === 'orders' && <OrderbookView />}
          {tab === 'trades' && <TradesView />}
        </Box>
      </CardContent>
    </Card>
  );
}

function PositionsGrid() {
  const q = useQuery({ queryKey: [...Z_KEY, 'positions'], queryFn: api.zerodhaPositions });
  if (q.isLoading) return <CircularProgress />;
  if (q.isError) return <Alert severity="error">Failed to load positions.</Alert>;
  const rows = q.data?.net ?? [];
  const cols: GridColDef<KitePosition>[] = [
    { field: 'tradingsymbol', headerName: 'Symbol', flex: 1 },
    { field: 'exchange', headerName: 'Exch', width: 80 },
    { field: 'product', headerName: 'Product', width: 110 },
    { field: 'quantity', headerName: 'Qty', width: 80 },
    {
      field: 'average_price',
      headerName: 'Avg',
      width: 110,
      valueFormatter: (v) => Number(v).toFixed(2),
    },
    {
      field: 'last_price',
      headerName: 'LTP',
      width: 110,
      valueFormatter: (v) => Number(v).toFixed(2),
    },
    {
      field: 'pnl',
      headerName: 'P&L',
      width: 130,
      renderCell: ({ value }) => (
        <Typography
          variant="body2"
          color={(value as number) >= 0 ? 'success.main' : 'error.main'}
        >
          ₹{(value as number).toFixed(2)}
        </Typography>
      ),
    },
  ];
  return (
    <Box sx={{ height: { xs: 360, sm: 420 }, width: '100%', overflowX: 'auto' }}>
      <DataGrid
        rows={rows.map((r, i) => ({ id: `${r.tradingsymbol}-${i}`, ...r }))}
        columns={cols}
      />
    </Box>
  );
}

function HoldingsGrid() {
  const q = useQuery({ queryKey: [...Z_KEY, 'holdings'], queryFn: api.zerodhaHoldings });
  if (q.isLoading) return <CircularProgress />;
  if (q.isError) return <Alert severity="error">Failed to load holdings.</Alert>;
  const rows = q.data ?? [];
  const cols: GridColDef<KiteHolding>[] = [
    { field: 'tradingsymbol', headerName: 'Symbol', flex: 1 },
    { field: 'exchange', headerName: 'Exch', width: 80 },
    { field: 'quantity', headerName: 'Qty', width: 80 },
    {
      field: 'average_price',
      headerName: 'Avg cost',
      width: 110,
      valueFormatter: (v) => Number(v).toFixed(2),
    },
    {
      field: 'last_price',
      headerName: 'LTP',
      width: 110,
      valueFormatter: (v) => Number(v).toFixed(2),
    },
    {
      field: 'pnl',
      headerName: 'P&L',
      width: 130,
      renderCell: ({ value }) => (
        <Typography
          variant="body2"
          color={(value as number) >= 0 ? 'success.main' : 'error.main'}
        >
          ₹{(value as number).toFixed(2)}
        </Typography>
      ),
    },
    {
      field: 'day_change_percentage',
      headerName: 'Day %',
      width: 100,
      valueFormatter: (v) => `${Number(v).toFixed(2)}%`,
    },
  ];
  return (
    <Box sx={{ height: { xs: 360, sm: 420 }, width: '100%', overflowX: 'auto' }}>
      <DataGrid
        rows={rows.map((r, i) => ({ id: `${r.tradingsymbol}-${i}`, ...r }))}
        columns={cols}
      />
    </Box>
  );
}

// Per-symbol aggregate of today's COMPLETE orders. Open quantity (one-sided)
// doesn't contribute to realised P&L — it's an unrealised position handled by
// the /positions endpoint.
interface OrderbookSymbolAggregate {
  symbol: string;
  exchange: string;
  buyQty: number;
  buyValue: number;
  sellQty: number;
  sellValue: number;
}

interface OrderbookSummary {
  bought: number;
  sold: number;
  realisedPnL: number;
  unrealisedPnL: number;
  bySymbol: OrderbookSymbolAggregate[];
  /** Capital-flow rollup — see computeCapitalFlow for semantics. */
  flow: CapitalFlow;
}

// Convert a Kite order into (fill, brokerage-order) inputs for the
// generic charge aggregator. Skips non-COMPLETE orders.
function ordersToTaxInputs(orders: KiteOrder[]): {
  fills: FillForCharges[];
  brokerageOrders: OrderForBrokerage[];
} {
  const fills: FillForCharges[] = [];
  const brokerageOrders: OrderForBrokerage[] = [];
  for (const o of orders) {
    if (o.status !== 'COMPLETE' || o.filled_quantity <= 0) continue;
    const segment = classifyByMeta({
      tradingsymbol: o.tradingsymbol,
      exchange: o.exchange,
      product: o.product,
    });
    fills.push({
      segment,
      side: o.transaction_type === 'BUY' ? 'BUY' : 'SELL',
      turnover: o.filled_quantity * o.average_price,
    });
    brokerageOrders.push({ segment });
  }
  return { fills, brokerageOrders };
}

// Convert synced Kite fills (broker_trades) into tax inputs. Brokerage is
// per-order, not per-fill — group by order_id and bill ₹20 per unique
// order so partial fills don't inflate it.
function brokerTradesToTaxInputs(trades: BrokerTrade[]): {
  fills: FillForCharges[];
  brokerageOrders: OrderForBrokerage[];
} {
  const fills: FillForCharges[] = [];
  const orderSegments = new Map<string, OrderForBrokerage['segment']>();
  for (const t of trades) {
    const segment = classifyByMeta({
      tradingsymbol: t.tradingsymbol,
      exchange: t.exchange,
      product: t.product,
    });
    fills.push({
      segment,
      side: t.transactionType,
      turnover: (t.quantity * t.averagePricePaise) / 100,
    });
    if (!orderSegments.has(t.orderId)) orderSegments.set(t.orderId, segment);
  }
  const brokerageOrders: OrderForBrokerage[] = [...orderSegments.values()].map(
    (segment) => ({ segment }),
  );
  return { fills, brokerageOrders };
}

function computeOrderbookTax(orders: KiteOrder[], grossRealised: number, slab: number): TaxLiability {
  const { fills, brokerageOrders } = ordersToTaxInputs(orders);
  return computeTaxLiability(fills, brokerageOrders, grossRealised, slab);
}

function useTaxSlab(): [number, (n: number) => void] {
  const [slab, setSlab] = useState<number>(() => {
    const stored = window.localStorage.getItem(SLAB_STORAGE_KEY);
    const n = stored ? Number(stored) : 30;
    return SLAB_OPTIONS.includes(n as (typeof SLAB_OPTIONS)[number]) ? n : 30;
  });
  useEffect(() => {
    window.localStorage.setItem(SLAB_STORAGE_KEY, String(slab));
  }, [slab]);
  return [slab, setSlab];
}

function TaxSlabSelect({
  slab,
  onChange,
}: {
  slab: number;
  onChange: (n: number) => void;
}) {
  return (
    <TextField
      select
      size="small"
      label="Income-tax slab"
      value={slab}
      onChange={(e) => onChange(Number(e.target.value))}
      sx={{ minWidth: 160 }}
      helperText="F&O is non-spec. business income"
    >
      {SLAB_OPTIONS.map((s) => (
        <MenuItem key={s} value={s}>
          {s}%{s === 30 ? ' (default)' : ''}
        </MenuItem>
      ))}
    </TextField>
  );
}

/**
 * Capital-flow view: how much outside money was actually put in vs. how
 * much of every buy was just recycling prior sell proceeds.
 *
 * `originalCapital` is the peak running deficit when COMPLETE fills are
 * walked in chronological order. That's the most cash this strategy ever
 * needed at one moment — buying again after a sell doesn't grow it.
 *
 * Buys above that peak (`recycledBuys = grossBuys − originalCapital`) are
 * funded entirely by sale proceeds. Each rupee of sale proceeds is part
 * cost-basis (principal) and part realised profit. We split the recycled
 * total into:
 *   - principalReturned = grossSells − realisedPnL  (cost basis recovered)
 *   - recycledPrincipal = min(recycledBuys, principalReturned)
 *   - profitRedeployed  = max(0, recycledBuys − principalReturned)
 *
 * `finalCapital` = originalCapital + realisedPnL + unrealisedPnL — what
 * the position is worth if every open leg is closed at LTP right now.
 */
interface CapitalFlow {
  originalCapital: number;
  recycledPrincipal: number;
  profitRedeployed: number;
  netInMarket: number;
  finalCapital: number;
}

function computeCapitalFlow(
  orders: KiteOrder[],
  realisedPnL: number,
  unrealisedPnL: number,
): CapitalFlow {
  const sorted = orders
    .filter((o) => o.status === 'COMPLETE' && o.filled_quantity > 0)
    .slice()
    .sort((a, b) => (a.order_timestamp ?? '').localeCompare(b.order_timestamp ?? ''));

  let cash = 0;
  let peakDeficit = 0;
  let grossBuys = 0;
  let grossSells = 0;
  for (const o of sorted) {
    const value = o.filled_quantity * o.average_price;
    if (o.transaction_type === 'BUY') {
      cash -= value;
      grossBuys += value;
      if (-cash > peakDeficit) peakDeficit = -cash;
    } else if (o.transaction_type === 'SELL') {
      cash += value;
      grossSells += value;
    }
  }

  const originalCapital = peakDeficit;
  const recycledBuys = Math.max(0, grossBuys - originalCapital);
  const principalReturned = Math.max(0, grossSells - realisedPnL);
  const recycledPrincipal = Math.min(recycledBuys, principalReturned);
  const profitRedeployed = Math.max(0, recycledBuys - principalReturned);
  const netInMarket = grossBuys - grossSells;
  const finalCapital = originalCapital + realisedPnL + unrealisedPnL;

  return {
    originalCapital,
    recycledPrincipal,
    profitRedeployed,
    netInMarket,
    finalCapital,
  };
}

function computeOrderbookSummary(
  orders: KiteOrder[],
  positions: KitePosition[],
): OrderbookSummary {
  const bySym = new Map<string, OrderbookSymbolAggregate>();
  for (const o of orders) {
    if (o.status !== 'COMPLETE' || o.filled_quantity <= 0) continue;
    const key = `${o.exchange}:${o.tradingsymbol}`;
    let agg = bySym.get(key);
    if (!agg) {
      agg = {
        symbol: o.tradingsymbol,
        exchange: o.exchange,
        buyQty: 0,
        buyValue: 0,
        sellQty: 0,
        sellValue: 0,
      };
      bySym.set(key, agg);
    }
    const value = o.filled_quantity * o.average_price;
    if (o.transaction_type === 'BUY') {
      agg.buyQty += o.filled_quantity;
      agg.buyValue += value;
    } else if (o.transaction_type === 'SELL') {
      agg.sellQty += o.filled_quantity;
      agg.sellValue += value;
    }
  }

  let bought = 0;
  let sold = 0;
  let realised = 0;
  for (const s of bySym.values()) {
    bought += s.buyValue;
    sold += s.sellValue;
    const matched = Math.min(s.buyQty, s.sellQty);
    if (matched > 0 && s.buyQty > 0 && s.sellQty > 0) {
      const avgBuy = s.buyValue / s.buyQty;
      const avgSell = s.sellValue / s.sellQty;
      realised += matched * (avgSell - avgBuy);
    }
  }

  // Kite's `pnl` field on a day-position already reflects M2M for the day
  // (including realised + unrealised). To isolate unrealised we'd need
  // last_price × open_qty − cost_basis. With only what /positions exposes,
  // the cleanest unrealised proxy is `pnl − realised_from_orders`.
  const dayPnl = positions.reduce((acc, p) => acc + p.pnl, 0);
  const unrealised = dayPnl - realised;

  const bySymbol = [...bySym.values()].sort((a, b) =>
    a.symbol.localeCompare(b.symbol),
  );

  const flow = computeCapitalFlow(orders, realised, unrealised);

  return {
    bought,
    sold,
    realisedPnL: realised,
    unrealisedPnL: unrealised,
    bySymbol,
    flow,
  };
}

function OrderbookView() {
  const qc = useQueryClient();
  const ordersQ = useQuery({
    queryKey: [...Z_KEY, 'orders'],
    queryFn: api.zerodhaOrders,
  });
  const positionsQ = useQuery({
    queryKey: [...Z_KEY, 'positions'],
    queryFn: api.zerodhaPositions,
  });

  const [slab, setSlab] = useTaxSlab();

  const recompute = (): void => {
    void qc.invalidateQueries({ queryKey: [...Z_KEY, 'orders'] });
    void qc.invalidateQueries({ queryKey: [...Z_KEY, 'positions'] });
  };

  if (ordersQ.isLoading) return <CircularProgress />;
  if (ordersQ.isError) return <Alert severity="error">Failed to load orderbook.</Alert>;

  const orders = ordersQ.data ?? [];
  const positions = positionsQ.data?.day ?? [];
  const summary = computeOrderbookSummary(orders, positions);
  const tax = computeOrderbookTax(orders, summary.realisedPnL, slab);
  const recomputing = ordersQ.isFetching || positionsQ.isFetching;

  const cols: GridColDef<KiteOrder>[] = [
    { field: 'order_timestamp', headerName: 'Time', width: 170 },
    { field: 'tradingsymbol', headerName: 'Symbol', flex: 1 },
    { field: 'transaction_type', headerName: 'Side', width: 80 },
    { field: 'order_type', headerName: 'Type', width: 100 },
    { field: 'product', headerName: 'Product', width: 100 },
    { field: 'quantity', headerName: 'Qty', width: 80 },
    { field: 'filled_quantity', headerName: 'Filled', width: 80 },
    { field: 'status', headerName: 'Status', width: 120 },
    {
      field: 'average_price',
      headerName: 'Avg',
      width: 110,
      valueFormatter: (v) => Number(v).toFixed(2),
    },
  ];

  return (
    <Stack spacing={2}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        spacing={1}
      >
        <Typography variant="subtitle1">Day summary</Typography>
        <Button
          size="small"
          variant="outlined"
          onClick={recompute}
          disabled={recomputing}
          startIcon={<RefreshIcon />}
        >
          {recomputing ? 'Recalculating…' : 'Recalculate'}
        </Button>
      </Stack>

      {positionsQ.isError && (
        <Alert severity="warning">
          Couldn't load positions — unrealised P&L is shown as ₹0.
        </Alert>
      )}

      <Box
        display="grid"
        gridTemplateColumns={{ xs: '1fr 1fr', sm: 'repeat(4, 1fr)' }}
        gap={2}
      >
        <SummaryTile label="Bought" primary={fmtINR(summary.bought)} secondary="Filled BUY orders" />
        <SummaryTile label="Sold" primary={fmtINR(summary.sold)} secondary="Filled SELL orders" />
        <SummaryTile
          label="Realised P&L"
          primary={fmtINR(summary.realisedPnL)}
          primaryColor={summary.realisedPnL >= 0 ? 'success.main' : 'error.main'}
          secondary="Matched intraday legs"
        />
        <SummaryTile
          label="Unrealised P&L"
          primary={fmtINR(summary.unrealisedPnL)}
          primaryColor={summary.unrealisedPnL >= 0 ? 'success.main' : 'error.main'}
          secondary="Open positions × LTP"
        />
      </Box>

      <Typography variant="overline" color="text.secondary" sx={{ mt: 1 }}>
        Capital flow
      </Typography>
      <Box
        display="grid"
        gridTemplateColumns={{ xs: '1fr 1fr', sm: 'repeat(4, 1fr)' }}
        gap={2}
      >
        <SummaryTile
          label="Original capital"
          primary={fmtINR(summary.flow.originalCapital)}
          secondary="Peak deficit — outside money put in"
        />
        <SummaryTile
          label="Recycled principal"
          primary={fmtINR(summary.flow.recycledPrincipal)}
          secondary="Buys funded by prior sells' cost basis"
        />
        <SummaryTile
          label="Profit redeployed"
          primary={fmtINR(summary.flow.profitRedeployed)}
          primaryColor={summary.flow.profitRedeployed > 0 ? 'success.main' : undefined}
          secondary="Realised gains put back into buys"
        />
        <SummaryTile
          label="Final capital"
          primary={fmtINR(summary.flow.finalCapital)}
          primaryColor={
            summary.flow.finalCapital >= summary.flow.originalCapital
              ? 'success.main'
              : 'error.main'
          }
          secondary="Original + realised + unrealised"
        />
      </Box>

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        spacing={1}
        sx={{ mt: 1 }}
      >
        <Box>
          <Typography variant="overline" color="text.secondary">
            Tax & charges (estimated)
          </Typography>
          <Typography variant="caption" color="text.secondary" component="div">
            Rates verified {TAX_RATES_REVIEWED_AT} ·{' '}
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
        <TaxSlabSelect slab={slab} onChange={setSlab} />
      </Stack>

      <Box
        display="grid"
        gridTemplateColumns={{ xs: '1fr 1fr', sm: 'repeat(4, 1fr)' }}
        gap={2}
      >
        <Tooltip
          title={
            <Box sx={{ fontSize: 12 }}>
              <div>STT: {fmtINR(tax.charges.stt)}</div>
              <div>Exchange txn: {fmtINR(tax.charges.exchange)}</div>
              <div>SEBI fee: {fmtINR(tax.charges.sebi)}</div>
              <div>Stamp duty: {fmtINR(tax.charges.stamp)}</div>
              <div>Brokerage: {fmtINR(tax.charges.brokerage)}</div>
              <div>GST (18%): {fmtINR(tax.charges.gst)}</div>
            </Box>
          }
          placement="top"
          arrow
        >
          <Box>
            <SummaryTile
              label="Transaction charges"
              primary={fmtINR(tax.charges.total)}
              primaryColor="error.main"
              secondary="STT + exch + GST + stamp + brokerage"
            />
          </Box>
        </Tooltip>
        <SummaryTile
          label="Realised after charges"
          primary={fmtINR(tax.realisedAfterCharges)}
          primaryColor={tax.realisedAfterCharges >= 0 ? 'success.main' : 'error.main'}
          secondary="Gross realised − charges"
        />
        <SummaryTile
          label={`Income tax @ ${slab}% + cess`}
          primary={fmtINR(tax.incomeTax)}
          primaryColor={tax.incomeTax > 0 ? 'error.main' : undefined}
          secondary={
            tax.realisedAfterCharges > 0
              ? `Effective ${(tax.effectiveRate * 100).toFixed(1)}%`
              : 'No tax on a loss day'
          }
        />
        <SummaryTile
          label="Net realised after tax"
          primary={fmtINR(tax.realisedAfterAll)}
          primaryColor={tax.realisedAfterAll >= 0 ? 'success.main' : 'error.main'}
          secondary="What actually stays with you"
        />
      </Box>

      {summary.bySymbol.length > 0 && (
        <Box sx={{ overflowX: 'auto' }}>
          <Box
            component="table"
            sx={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 14,
              '& th, & td': {
                textAlign: 'right',
                padding: '6px 10px',
                borderBottom: '1px solid',
                borderColor: 'divider',
              },
              '& th:first-of-type, & td:first-of-type': { textAlign: 'left' },
              '& th': { fontWeight: 600, color: 'text.secondary' },
            }}
          >
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Buy qty</th>
                <th>Avg buy</th>
                <th>Sell qty</th>
                <th>Avg sell</th>
                <th>Realised P&L</th>
              </tr>
            </thead>
            <tbody>
              {summary.bySymbol.map((s) => {
                const matched = Math.min(s.buyQty, s.sellQty);
                const avgBuy = s.buyQty > 0 ? s.buyValue / s.buyQty : 0;
                const avgSell = s.sellQty > 0 ? s.sellValue / s.sellQty : 0;
                const pnl =
                  matched > 0 && s.buyQty > 0 && s.sellQty > 0
                    ? matched * (avgSell - avgBuy)
                    : 0;
                return (
                  <tr key={`${s.exchange}:${s.symbol}`}>
                    <td>
                      {s.symbol}{' '}
                      <Typography component="span" variant="caption" color="text.secondary">
                        {s.exchange}
                      </Typography>
                    </td>
                    <td>{s.buyQty || '—'}</td>
                    <td>{s.buyQty > 0 ? avgBuy.toFixed(2) : '—'}</td>
                    <td>{s.sellQty || '—'}</td>
                    <td>{s.sellQty > 0 ? avgSell.toFixed(2) : '—'}</td>
                    <td>
                      <Box
                        component="span"
                        sx={{
                          color:
                            pnl === 0
                              ? 'text.secondary'
                              : pnl > 0
                                ? 'success.main'
                                : 'error.main',
                        }}
                      >
                        {matched > 0 ? fmtINR(pnl) : '—'}
                      </Box>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Box>
        </Box>
      )}

      <Box sx={{ height: { xs: 360, sm: 420 }, width: '100%', overflowX: 'auto' }}>
        <DataGrid rows={orders.map((r) => ({ id: r.order_id, ...r }))} columns={cols} />
      </Box>
    </Stack>
  );
}

interface DaySymbolAggregate {
  date: string;
  symbol: string;
  exchange: string;
  buyQty: number;
  buyValue: number;
  sellQty: number;
  sellValue: number;
}

interface DayAggregate {
  date: string;
  buyQty: number;
  buyValue: number;
  sellQty: number;
  sellValue: number;
  realisedPnL: number;
  symbols: DaySymbolAggregate[];
}

function aggregateBrokerTrades(trades: BrokerTrade[]): DayAggregate[] {
  const byDay = new Map<string, Map<string, DaySymbolAggregate>>();
  for (const t of trades) {
    const date = t.tradeDate || 'unknown';
    const symKey = `${t.exchange}:${t.tradingsymbol}`;
    let dayMap = byDay.get(date);
    if (!dayMap) {
      dayMap = new Map();
      byDay.set(date, dayMap);
    }
    let agg = dayMap.get(symKey);
    if (!agg) {
      agg = {
        date,
        symbol: t.tradingsymbol,
        exchange: t.exchange,
        buyQty: 0,
        buyValue: 0,
        sellQty: 0,
        sellValue: 0,
      };
      dayMap.set(symKey, agg);
    }
    // Stored prices are paise; UI works in rupees for human-readable formatting.
    const priceRupees = t.averagePricePaise / 100;
    const value = t.quantity * priceRupees;
    if (t.transactionType === 'BUY') {
      agg.buyQty += t.quantity;
      agg.buyValue += value;
    } else {
      agg.sellQty += t.quantity;
      agg.sellValue += value;
    }
  }

  const days: DayAggregate[] = [];
  for (const [date, dayMap] of byDay) {
    const symbols = [...dayMap.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
    const day: DayAggregate = {
      date,
      buyQty: 0,
      buyValue: 0,
      sellQty: 0,
      sellValue: 0,
      realisedPnL: 0,
      symbols,
    };
    for (const s of symbols) {
      day.buyQty += s.buyQty;
      day.buyValue += s.buyValue;
      day.sellQty += s.sellQty;
      day.sellValue += s.sellValue;
      // Intraday realised P&L per symbol: matched leg × (avg sell − avg buy).
      // Open quantity (one-sided) doesn't contribute — that's an unrealised position.
      const matched = Math.min(s.buyQty, s.sellQty);
      if (matched > 0 && s.buyQty > 0 && s.sellQty > 0) {
        const avgBuy = s.buyValue / s.buyQty;
        const avgSell = s.sellValue / s.sellQty;
        day.realisedPnL += matched * (avgSell - avgBuy);
      }
    }
    days.push(day);
  }
  days.sort((a, b) => b.date.localeCompare(a.date));
  return days;
}

function fmtINR(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}₹${Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function TradesView() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: [...Z_KEY, 'trades-history'],
    queryFn: () => api.zerodhaTradesHistory(),
  });
  const sync = useMutation({
    mutationFn: api.zerodhaTradesSync,
    onSuccess: () => qc.invalidateQueries({ queryKey: [...Z_KEY, 'trades-history'] }),
  });

  if (q.isLoading) return <CircularProgress />;
  if (q.isError) return <Alert severity="error">Failed to load trades.</Alert>;

  const data = q.data ?? { trades: [], sync: null };
  const trades = data.trades;
  const syncState = data.sync;

  const sessionExpired = syncState?.lastError?.toLowerCase().includes('token') ?? false;

  return (
    <Stack spacing={2}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        spacing={1}
      >
        <Typography variant="caption" color="text.secondary">
          {syncState?.lastSuccessAt
            ? `Last synced: ${new Date(syncState.lastSuccessAt).toLocaleString('en-IN')}`
            : 'Not synced yet — runs daily at 18:00 IST.'}
        </Typography>
        <Button
          size="small"
          variant="outlined"
          onClick={() => sync.mutate()}
          disabled={sync.isPending}
          startIcon={<RefreshIcon />}
        >
          {sync.isPending ? 'Syncing…' : 'Sync now'}
        </Button>
      </Stack>

      {sync.isError && (
        <Alert severity="error">
          {sync.error instanceof Error ? sync.error.message : 'Sync failed.'}
        </Alert>
      )}

      {syncState?.lastError && !sync.isPending && (
        <Alert severity={sessionExpired ? 'warning' : 'error'}>
          Last sync failed: {syncState.lastError}.
          {sessionExpired
            ? ' Reconnect Kite (top of this page) to resume daily syncs.'
            : ''}
        </Alert>
      )}

      {trades.length === 0 ? (
        <Alert severity="info">
          No trades synced yet. Kite's <code>/trades</code> API only exposes
          today's fills, so history accumulates one day at a time. Click{' '}
          <strong>Sync now</strong> to capture today after market hours, or wait
          for the 18:00 IST scheduled run.
        </Alert>
      ) : (
        <TradesViewContent trades={trades} />
      )}
    </Stack>
  );
}

function TradesViewContent({ trades }: { trades: BrokerTrade[] }) {
  const [slab, setSlab] = useTaxSlab();
  const days = aggregateBrokerTrades(trades);
  const totals = days.reduce(
    (acc, d) => ({
      buyQty: acc.buyQty + d.buyQty,
      buyValue: acc.buyValue + d.buyValue,
      sellQty: acc.sellQty + d.sellQty,
      sellValue: acc.sellValue + d.sellValue,
      realisedPnL: acc.realisedPnL + d.realisedPnL,
    }),
    { buyQty: 0, buyValue: 0, sellQty: 0, sellValue: 0, realisedPnL: 0 },
  );

  // YTD = current Indian financial year (Apr 1 → Mar 31). Cross-day FIFO
  // matching catches positions opened one day and closed another (any
  // overnight/swing F&O leg, weekly-expiry options held past midnight).
  // Per-day matching alone would silently miss that P&L.
  const fyStart = startOfCurrentFY();
  const ytdTrades = trades.filter((t) => t.tradeDate >= fyStart);
  const ytdFifoFills: FifoFill[] = ytdTrades.map((t) => ({
    tradingsymbol: t.tradingsymbol,
    exchange: t.exchange,
    transactionType: t.transactionType,
    quantity: t.quantity,
    pricePerUnitRupees: t.averagePricePaise / 100,
    sortKey:
      t.fillTimestamp ?? t.exchangeTimestamp ?? t.orderTimestamp ?? t.tradeDate,
  }));
  const ytdRealised = computeRealisedFifo(ytdFifoFills);
  const ytdTaxInputs = brokerTradesToTaxInputs(ytdTrades);
  const ytdTax = computeTaxLiability(
    ytdTaxInputs.fills,
    ytdTaxInputs.brokerageOrders,
    ytdRealised,
    slab,
  );
  const ytdDayCount = new Set(ytdTrades.map((t) => t.tradeDate)).size;

  const tradeCols: GridColDef<BrokerTrade>[] = [
    {
      field: 'fillTimestamp',
      headerName: 'Time',
      width: 170,
      valueGetter: (_v, row) =>
        row.fillTimestamp ?? row.exchangeTimestamp ?? row.orderTimestamp ?? '',
    },
    { field: 'tradeDate', headerName: 'Date', width: 110 },
    { field: 'tradingsymbol', headerName: 'Symbol', flex: 1, minWidth: 140 },
    { field: 'exchange', headerName: 'Exch', width: 80 },
    {
      field: 'transactionType',
      headerName: 'Side',
      width: 80,
      renderCell: ({ value }) => (
        <Chip
          size="small"
          label={value as string}
          color={value === 'BUY' ? 'success' : 'error'}
          variant="outlined"
        />
      ),
    },
    { field: 'product', headerName: 'Product', width: 100 },
    { field: 'quantity', headerName: 'Qty', width: 80 },
    {
      field: 'averagePricePaise',
      headerName: 'Price',
      width: 110,
      valueFormatter: (v) => (Number(v) / 100).toFixed(2),
    },
    {
      field: 'value',
      headerName: 'Value',
      width: 130,
      valueGetter: (_v, row) => (row.quantity * row.averagePricePaise) / 100,
      valueFormatter: (v) => fmtINR(Number(v)),
    },
  ];

  return (
    <Stack spacing={2}>
      <Box
        display="grid"
        gridTemplateColumns={{ xs: '1fr 1fr', sm: 'repeat(4, 1fr)' }}
        gap={2}
      >
        <SummaryTile
          label="Buys"
          primary={`${totals.buyQty.toLocaleString('en-IN')} qty`}
          secondary={fmtINR(totals.buyValue)}
        />
        <SummaryTile
          label="Sells"
          primary={`${totals.sellQty.toLocaleString('en-IN')} qty`}
          secondary={fmtINR(totals.sellValue)}
        />
        <SummaryTile
          label="Net flow"
          primary={fmtINR(totals.sellValue - totals.buyValue)}
          secondary="Sells − Buys"
        />
        <SummaryTile
          label="Realised P&L"
          primary={fmtINR(totals.realisedPnL)}
          primaryColor={totals.realisedPnL >= 0 ? 'success.main' : 'error.main'}
          secondary="Matched intraday legs"
        />
      </Box>

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        spacing={1}
        sx={{ mt: 1 }}
      >
        <Box>
          <Typography variant="overline" color="text.secondary">
            Year-to-date tax (FY since {fyStart}, {ytdDayCount} day{ytdDayCount === 1 ? '' : 's'})
          </Typography>
          <Typography variant="caption" color="text.secondary" component="div">
            Cross-day FIFO matching · Rates verified {TAX_RATES_REVIEWED_AT} ·{' '}
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
        <TaxSlabSelect slab={slab} onChange={setSlab} />
      </Stack>

      <Box
        display="grid"
        gridTemplateColumns={{ xs: '1fr 1fr', sm: 'repeat(4, 1fr)' }}
        gap={2}
      >
        <SummaryTile
          label="YTD realised (FIFO)"
          primary={fmtINR(ytdRealised)}
          primaryColor={ytdRealised >= 0 ? 'success.main' : 'error.main'}
          secondary="Matched across days"
        />
        <Tooltip
          title={
            <Box sx={{ fontSize: 12 }}>
              <div>STT: {fmtINR(ytdTax.charges.stt)}</div>
              <div>Exchange txn: {fmtINR(ytdTax.charges.exchange)}</div>
              <div>SEBI fee: {fmtINR(ytdTax.charges.sebi)}</div>
              <div>Stamp duty: {fmtINR(ytdTax.charges.stamp)}</div>
              <div>Brokerage: {fmtINR(ytdTax.charges.brokerage)}</div>
              <div>GST (18%): {fmtINR(ytdTax.charges.gst)}</div>
            </Box>
          }
          placement="top"
          arrow
        >
          <Box>
            <SummaryTile
              label="YTD charges"
              primary={fmtINR(ytdTax.charges.total)}
              primaryColor="error.main"
              secondary="STT + exch + GST + stamp + brokerage"
            />
          </Box>
        </Tooltip>
        <SummaryTile
          label={`YTD income tax @ ${slab}% + cess`}
          primary={fmtINR(ytdTax.incomeTax)}
          primaryColor={ytdTax.incomeTax > 0 ? 'error.main' : undefined}
          secondary={
            ytdTax.realisedAfterCharges > 0
              ? `Effective ${(ytdTax.effectiveRate * 100).toFixed(1)}% on ₹${ytdTax.realisedAfterCharges.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
              : 'No tax on a net loss'
          }
        />
        <SummaryTile
          label="YTD net after tax"
          primary={fmtINR(ytdTax.realisedAfterAll)}
          primaryColor={ytdTax.realisedAfterAll >= 0 ? 'success.main' : 'error.main'}
          secondary="Realised − charges − income tax"
        />
      </Box>

      {days.map((day) => (
        <Card variant="outlined" key={day.date}>
          <CardContent>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              justifyContent="space-between"
              alignItems={{ xs: 'flex-start', sm: 'center' }}
              spacing={1}
              sx={{ mb: 1.5 }}
            >
              <Typography variant="subtitle1">{day.date}</Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap">
                <Chip
                  size="small"
                  variant="outlined"
                  color="success"
                  label={`Buy ${day.buyQty} · ${fmtINR(day.buyValue)}`}
                />
                <Chip
                  size="small"
                  variant="outlined"
                  color="error"
                  label={`Sell ${day.sellQty} · ${fmtINR(day.sellValue)}`}
                />
                <Chip
                  size="small"
                  color={day.realisedPnL >= 0 ? 'success' : 'error'}
                  label={`Realised ${fmtINR(day.realisedPnL)}`}
                />
              </Stack>
            </Stack>

            <Box sx={{ overflowX: 'auto', mb: 2 }}>
              <Box
                component="table"
                sx={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 14,
                  '& th, & td': {
                    textAlign: 'right',
                    padding: '6px 10px',
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                  },
                  '& th:first-of-type, & td:first-of-type': { textAlign: 'left' },
                  '& th': { fontWeight: 600, color: 'text.secondary' },
                }}
              >
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Buy qty</th>
                    <th>Avg buy</th>
                    <th>Sell qty</th>
                    <th>Avg sell</th>
                    <th>Realised P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {day.symbols.map((s) => {
                    const matched = Math.min(s.buyQty, s.sellQty);
                    const avgBuy = s.buyQty > 0 ? s.buyValue / s.buyQty : 0;
                    const avgSell = s.sellQty > 0 ? s.sellValue / s.sellQty : 0;
                    const pnl =
                      matched > 0 && s.buyQty > 0 && s.sellQty > 0
                        ? matched * (avgSell - avgBuy)
                        : 0;
                    return (
                      <tr key={`${s.exchange}:${s.symbol}`}>
                        <td>
                          {s.symbol}{' '}
                          <Typography
                            component="span"
                            variant="caption"
                            color="text.secondary"
                          >
                            {s.exchange}
                          </Typography>
                        </td>
                        <td>{s.buyQty || '—'}</td>
                        <td>{s.buyQty > 0 ? avgBuy.toFixed(2) : '—'}</td>
                        <td>{s.sellQty || '—'}</td>
                        <td>{s.sellQty > 0 ? avgSell.toFixed(2) : '—'}</td>
                        <td>
                          <Box
                            component="span"
                            sx={{
                              color:
                                pnl === 0
                                  ? 'text.secondary'
                                  : pnl > 0
                                    ? 'success.main'
                                    : 'error.main',
                            }}
                          >
                            {matched > 0 ? fmtINR(pnl) : '—'}
                          </Box>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Box>
            </Box>
          </CardContent>
        </Card>
      ))}

      <Box sx={{ height: { xs: 360, sm: 480 }, width: '100%', overflowX: 'auto' }}>
        <DataGrid
          rows={trades.map((r) => ({ id: r.tradeId, ...r }))}
          columns={tradeCols}
          density="compact"
          initialState={{ sorting: { sortModel: [{ field: 'fillTimestamp', sort: 'desc' }] } }}
        />
      </Box>

      <Typography variant="caption" color="text.secondary">
        Realised P&L is computed from matched intraday buy/sell legs only — open
        quantity is excluded. For positions opened earlier and closed today (BTST,
        swing exits), the Positions tab's day P&L is the more accurate figure.
      </Typography>
    </Stack>
  );
}

function SummaryTile({
  label,
  primary,
  secondary,
  primaryColor,
}: {
  label: string;
  primary: string;
  secondary?: string;
  primaryColor?: string;
}) {
  return (
    <Box
      sx={{
        p: 1.5,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
      }}
    >
      <Typography variant="overline" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h6" sx={{ color: primaryColor ?? 'text.primary' }}>
        {primary}
      </Typography>
      {secondary && (
        <Typography variant="caption" color="text.secondary">
          {secondary}
        </Typography>
      )}
    </Box>
  );
}
