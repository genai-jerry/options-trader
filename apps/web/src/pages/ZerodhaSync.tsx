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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  type KiteFundsSegment,
  type KiteHolding,
  type KiteOrder,
  type KitePosition,
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
        <Alert severity="warning">
          Set <code>KITE_API_KEY</code> and <code>KITE_API_SECRET</code> in{' '}
          <code>apps/server/.env</code> and restart the server.
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
  const [tab, setTab] = useState<'positions' | 'holdings' | 'orders'>('positions');
  return (
    <Card>
      <CardContent>
        <Tabs value={tab} onChange={(_, v) => setTab(v)}>
          <Tab value="positions" label="Positions" />
          <Tab value="holdings" label="Holdings" />
          <Tab value="orders" label="Orderbook" />
        </Tabs>
        <Box sx={{ mt: 2 }}>
          {tab === 'positions' && <PositionsGrid />}
          {tab === 'holdings' && <HoldingsGrid />}
          {tab === 'orders' && <OrdersGrid />}
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
