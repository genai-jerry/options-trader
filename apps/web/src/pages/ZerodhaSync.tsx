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
  type KiteFundsSegment,
  type KiteHolding,
  type KiteOrder,
  type KitePosition,
  type KiteTrade,
} from '../api/client';

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
          {tab === 'orders' && <OrdersGrid />}
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

function OrdersGrid() {
  const q = useQuery({ queryKey: [...Z_KEY, 'orders'], queryFn: api.zerodhaOrders });
  if (q.isLoading) return <CircularProgress />;
  if (q.isError) return <Alert severity="error">Failed to load orderbook.</Alert>;
  const rows = q.data ?? [];
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
    <Box sx={{ height: { xs: 360, sm: 420 }, width: '100%', overflowX: 'auto' }}>
      <DataGrid rows={rows.map((r) => ({ id: r.order_id, ...r }))} columns={cols} />
    </Box>
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

function tradeDate(t: KiteTrade): string {
  const ts = t.fill_timestamp ?? t.exchange_timestamp ?? t.order_timestamp ?? '';
  // Kite timestamps are "YYYY-MM-DD HH:mm:ss" in IST. The date prefix is enough.
  return ts.slice(0, 10) || 'unknown';
}

function aggregateTrades(trades: KiteTrade[]): DayAggregate[] {
  const byDay = new Map<string, Map<string, DaySymbolAggregate>>();
  for (const t of trades) {
    const date = tradeDate(t);
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
    const value = t.quantity * t.average_price;
    if (t.transaction_type === 'BUY') {
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
  // Most recent day first.
  days.sort((a, b) => b.date.localeCompare(a.date));
  return days;
}

function fmtINR(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}₹${Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function TradesView() {
  const q = useQuery({ queryKey: [...Z_KEY, 'trades'], queryFn: api.zerodhaTrades });
  if (q.isLoading) return <CircularProgress />;
  if (q.isError) return <Alert severity="error">Failed to load trades.</Alert>;
  const trades = q.data ?? [];

  if (trades.length === 0) {
    return (
      <Stack spacing={2}>
        <Alert severity="info">
          No trades reported by Kite for today. Kite's <code>/trades</code> API only
          exposes the current trading day's fills — historical trades come from
          downloadable Console reports.
        </Alert>
      </Stack>
    );
  }

  const days = aggregateTrades(trades);
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

  const tradeCols: GridColDef<KiteTrade>[] = [
    {
      field: 'fill_timestamp',
      headerName: 'Time',
      width: 170,
      valueGetter: (_v, row) =>
        row.fill_timestamp ?? row.exchange_timestamp ?? row.order_timestamp ?? '',
    },
    { field: 'tradingsymbol', headerName: 'Symbol', flex: 1, minWidth: 140 },
    { field: 'exchange', headerName: 'Exch', width: 80 },
    {
      field: 'transaction_type',
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
      field: 'average_price',
      headerName: 'Price',
      width: 110,
      valueFormatter: (v) => Number(v).toFixed(2),
    },
    {
      field: 'value',
      headerName: 'Value',
      width: 130,
      valueGetter: (_v, row) => row.quantity * row.average_price,
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
          rows={trades.map((r) => ({ id: r.trade_id, ...r }))}
          columns={tradeCols}
          density="compact"
          initialState={{ sorting: { sortModel: [{ field: 'fill_timestamp', sort: 'desc' }] } }}
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
