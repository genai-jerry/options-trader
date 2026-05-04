import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  InputAdornment,
  MenuItem,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import { formatINR, rupeesToPaise, type Trade } from '@options-trader/shared';
import { HttpError } from '../api/client';
import { useCloseTrade, useTrades } from '../api/hooks';

type StatusFilter = '' | 'OPEN' | 'CLOSED';
type InstrumentFilter = '' | 'CE' | 'PE' | 'FUT';

export function Trades() {
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const [status, setStatus] = useState<StatusFilter>('');
  const [instrument, setInstrument] = useState<InstrumentFilter>('');
  const [symbol, setSymbol] = useState('');
  const [closing, setClosing] = useState<Trade | null>(null);
  const [closeResult, setCloseResult] = useState<string | null>(null);

  const filter = useMemo(
    () => ({
      ...(status ? { status } : {}),
      ...(instrument ? { instrument } : {}),
      ...(symbol ? { symbol } : {}),
    }),
    [status, instrument, symbol],
  );

  const tradesQ = useTrades(filter);

  return (
    <Stack spacing={{ xs: 2, sm: 3 }}>
      <Typography variant="h4">Trades</Typography>

      {/* Filters — wrap on xs */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1.5}
        sx={{ '& > *': { flex: { sm: 1 } } }}
      >
        <TextField
          label="Status"
          select
          size="small"
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
        >
          <MenuItem value="">All</MenuItem>
          <MenuItem value="OPEN">Open</MenuItem>
          <MenuItem value="CLOSED">Closed</MenuItem>
        </TextField>
        <TextField
          label="Instrument"
          select
          size="small"
          value={instrument}
          onChange={(e) => setInstrument(e.target.value as InstrumentFilter)}
        >
          <MenuItem value="">All</MenuItem>
          <MenuItem value="CE">CE</MenuItem>
          <MenuItem value="PE">PE</MenuItem>
          <MenuItem value="FUT">FUT</MenuItem>
        </TextField>
        <TextField
          label="Symbol"
          size="small"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          placeholder="e.g. NIFTY"
        />
      </Stack>

      {closeResult && (
        <Alert severity="success" onClose={() => setCloseResult(null)}>
          {closeResult}
        </Alert>
      )}

      {tradesQ.isLoading ? (
        <CircularProgress />
      ) : tradesQ.isError ? (
        <Alert severity="error">Failed to load trades.</Alert>
      ) : (tradesQ.data ?? []).length === 0 ? (
        <Card>
          <CardContent>
            <Typography variant="body2" color="text.secondary" textAlign="center" sx={{ py: 4 }}>
              No trades match these filters.
            </Typography>
          </CardContent>
        </Card>
      ) : isDesktop ? (
        <DesktopTradesGrid trades={tradesQ.data ?? []} onClose={setClosing} />
      ) : (
        <MobileTradesList trades={tradesQ.data ?? []} onClose={setClosing} />
      )}

      <CloseTradeDialog
        trade={closing}
        onClose={() => setClosing(null)}
        onSuccess={(message) => {
          setClosing(null);
          setCloseResult(message);
        }}
      />
    </Stack>
  );
}

// ─── desktop: DataGrid ────────────────────────────────────────────────

function DesktopTradesGrid({
  trades,
  onClose,
}: {
  trades: Trade[];
  onClose: (t: Trade) => void;
}) {
  const columns: GridColDef<Trade>[] = [
    { field: 'symbol', headerName: 'Symbol', flex: 1, minWidth: 110 },
    {
      field: 'instrument',
      headerName: 'Inst',
      width: 80,
      renderCell: ({ value }) => <Chip size="small" label={value} variant="outlined" />,
    },
    {
      field: 'strike',
      headerName: 'Strike',
      width: 110,
      valueFormatter: (value) => (value ? formatINR(value as number) : '—'),
    },
    { field: 'expiry', headerName: 'Expiry', width: 120 },
    { field: 'qty', headerName: 'Lots', width: 70 },
    { field: 'lotSize', headerName: 'Lot size', width: 90 },
    {
      field: 'entryPrice',
      headerName: 'Entry',
      width: 110,
      valueFormatter: (value) => formatINR(value as number),
    },
    {
      field: 'exitPrice',
      headerName: 'Exit',
      width: 110,
      valueFormatter: (value) => (value ? formatINR(value as number) : '—'),
    },
    {
      field: 'netPnL',
      headerName: 'Net P&L',
      width: 130,
      renderCell: ({ value, row }) => {
        if (row.status !== 'CLOSED' || value === undefined) return '—';
        const v = value as number;
        return (
          <Typography
            variant="body2"
            color={v >= 0 ? 'success.main' : 'error.main'}
            fontWeight={500}
          >
            {formatINR(v)}
          </Typography>
        );
      },
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 100,
      renderCell: ({ value }) => (
        <Chip
          size="small"
          label={value}
          color={value === 'OPEN' ? 'primary' : 'default'}
        />
      ),
    },
    {
      field: 'actions',
      headerName: '',
      width: 110,
      sortable: false,
      filterable: false,
      renderCell: ({ row }) =>
        row.status === 'OPEN' ? (
          <Button size="small" variant="outlined" onClick={() => onClose(row)}>
            Close
          </Button>
        ) : null,
    },
  ];

  return (
    <Box sx={{ height: 560, width: '100%' }}>
      <DataGrid
        rows={trades}
        columns={columns}
        getRowId={(row) => row.id}
        initialState={{
          pagination: { paginationModel: { pageSize: 25, page: 0 } },
          sorting: { sortModel: [{ field: 'entryPrice', sort: 'desc' }] },
        }}
        pageSizeOptions={[10, 25, 50, 100]}
        disableRowSelectionOnClick
        sx={{
          border: 1,
          borderColor: 'divider',
          borderRadius: 2,
          '& .MuiDataGrid-columnHeaders': { bgcolor: 'background.default' },
        }}
      />
    </Box>
  );
}

// ─── mobile: card stack ───────────────────────────────────────────────

function MobileTradesList({
  trades,
  onClose,
}: {
  trades: Trade[];
  onClose: (t: Trade) => void;
}) {
  return (
    <Stack spacing={1.25}>
      {trades.map((t) => (
        <Card key={t.id}>
          <CardContent
            sx={{ py: 1.5, px: 1.75, '&:last-child': { pb: 1.5 } }}
          >
            <Box display="flex" justifyContent="space-between" alignItems="flex-start" gap={1}>
              <Box sx={{ minWidth: 0 }}>
                <Box display="flex" gap={0.75} alignItems="center" sx={{ mb: 0.25 }}>
                  <Typography variant="body1" fontWeight={600} noWrap>
                    {t.symbol}
                  </Typography>
                  <Chip size="small" label={t.instrument} variant="outlined" />
                  <Chip
                    size="small"
                    label={t.status}
                    color={t.status === 'OPEN' ? 'primary' : 'default'}
                  />
                </Box>
                <Typography variant="caption" color="text.secondary">
                  {t.qty} lots × {t.lotSize}
                  {t.strike ? ` · strike ${formatINR(t.strike)}` : ''} · expiry {t.expiry}
                </Typography>
              </Box>
              {t.status === 'OPEN' && (
                <Button size="small" variant="outlined" onClick={() => onClose(t)}>
                  Close
                </Button>
              )}
            </Box>

            <Box
              display="grid"
              gridTemplateColumns="1fr 1fr 1fr"
              gap={1}
              sx={{ mt: 1.25 }}
            >
              <Cell label="Entry" value={formatINR(t.entryPrice)} />
              <Cell
                label="Exit"
                value={t.exitPrice !== undefined ? formatINR(t.exitPrice) : '—'}
              />
              <Cell
                label="Net P&L"
                value={t.netPnL !== undefined ? formatINR(t.netPnL) : '—'}
                color={
                  t.netPnL === undefined
                    ? 'text.secondary'
                    : t.netPnL >= 0
                      ? 'success.main'
                      : 'error.main'
                }
              />
            </Box>
          </CardContent>
        </Card>
      ))}
    </Stack>
  );
}

function Cell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        {label}
      </Typography>
      <Typography variant="body2" fontWeight={500} sx={{ color: color ?? 'text.primary' }}>
        {value}
      </Typography>
    </Box>
  );
}

// ─── close dialog ─────────────────────────────────────────────────────

function CloseTradeDialog({
  trade,
  onClose,
  onSuccess,
}: {
  trade: Trade | null;
  onClose: () => void;
  onSuccess: (message: string) => void;
}) {
  const closeTrade = useCloseTrade();
  const [exitRupees, setExitRupees] = useState('');

  const handleClose = () => {
    if (!trade) return;
    const value = Number.parseFloat(exitRupees);
    if (Number.isNaN(value) || value < 0) return;
    closeTrade.mutate(
      { id: trade.id, exitPrice: rupeesToPaise(value) },
      {
        onSuccess: (data) => {
          const fired = data.firedRules.length
            ? ` (fired ${data.firedRules.join(', ')})`
            : '';
          const w = data.queuedWithdrawal
            ? ` Queued withdrawal: ${formatINR(data.queuedWithdrawal.amount)}.`
            : '';
          const pnl = data.trade.netPnL ?? 0;
          onSuccess(
            `Closed ${trade.symbol} at ₹${value} — net P&L ${formatINR(pnl)}${fired}.${w}`,
          );
          setExitRupees('');
          closeTrade.reset();
        },
      },
    );
  };

  const reset = () => {
    setExitRupees('');
    closeTrade.reset();
    onClose();
  };

  return (
    <Dialog open={trade !== null} onClose={reset} maxWidth="xs" fullWidth>
      <DialogTitle>Close trade</DialogTitle>
      <DialogContent>
        {trade && (
          <DialogContentText component="div">
            <strong>{trade.symbol}</strong> {trade.instrument}
            {trade.strike ? ` @ ${formatINR(trade.strike)}` : ''} · {trade.qty} lots
            <br />
            Entry: {formatINR(trade.entryPrice)} per unit ·{' '}
            {formatINR(trade.entryPrice * trade.qty * trade.lotSize)} capital
          </DialogContentText>
        )}
        <TextField
          autoFocus
          label="Exit price"
          type="number"
          inputProps={{ step: 0.05 }}
          fullWidth
          sx={{ mt: 2 }}
          value={exitRupees}
          onChange={(e) => setExitRupees(e.target.value)}
          slotProps={{
            input: { startAdornment: <InputAdornment position="start">₹</InputAdornment> },
          }}
        />
        {closeTrade.isError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {closeTrade.error instanceof HttpError
              ? closeTrade.error.message
              : 'Failed to close trade.'}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={reset} disabled={closeTrade.isPending}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleClose}
          disabled={!exitRupees || closeTrade.isPending}
        >
          Close trade
        </Button>
      </DialogActions>
    </Dialog>
  );
}
