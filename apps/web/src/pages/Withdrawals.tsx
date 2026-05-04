import { useState } from 'react';
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
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import {
  formatINR,
  paiseToRupees,
  rupeesToPaise,
  type PendingWithdrawal,
  type WithdrawalStatus,
} from '@options-trader/shared';
import { HttpError } from '../api/client';
import {
  useAccount,
  useCancelWithdrawal,
  useConfirmWithdrawal,
  useManualWithdraw,
  useWithdrawals,
} from '../api/hooks';

const TABS: { value: WithdrawalStatus; label: string }[] = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'CONFIRMED', label: 'Confirmed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export function Withdrawals() {
  const [tab, setTab] = useState<WithdrawalStatus>('PENDING');
  const [openDialog, setOpenDialog] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const accountQ = useAccount();
  const q = useWithdrawals(tab);

  const account = accountQ.data;
  const lockFloor =
    account?.principalX !== null && account?.principalX !== undefined
      ? Math.floor(account.principalX / 2)
      : 0;
  const withdrawableCeiling = account
    ? Math.max(0, account.investableCorpus - lockFloor)
    : 0;

  return (
    <Stack spacing={3}>
      <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
        <Typography variant="h4">Withdrawals</Typography>
        <Button
          variant="contained"
          onClick={() => setOpenDialog(true)}
          disabled={!account || account.principalX === null || withdrawableCeiling <= 0}
        >
          Withdraw cash
        </Button>
      </Box>

      {account?.principalX !== null && account !== undefined && (
        <Card variant="outlined">
          <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={2}
              divider={<Box sx={{ width: 1, bgcolor: 'divider', display: { xs: 'none', sm: 'block' } }} />}
              justifyContent="space-around"
            >
              <Stat label="Investable corpus" value={formatINR(account.investableCorpus)} />
              <Stat label="Lock floor (0.5X)" value={formatINR(lockFloor)} />
              <Stat label="Withdrawable now" value={formatINR(withdrawableCeiling)} />
              <Stat label="Cash withdrawn" value={formatINR(account.cashWithdrawn)} />
            </Stack>
          </CardContent>
        </Card>
      )}

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

      {success && (
        <Alert severity="success" onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}

      {q.isLoading && <CircularProgress />}
      {q.isError && <Alert severity="error">Failed to load withdrawals.</Alert>}
      {q.data && q.data.length === 0 && (
        <Alert severity="info">No {tab.toLowerCase()} withdrawals.</Alert>
      )}

      <Stack spacing={2}>
        {q.data?.map((w) => <WithdrawalCard key={w.id} withdrawal={w} />)}
      </Stack>

      <ManualWithdrawDialog
        open={openDialog}
        ceiling={withdrawableCeiling}
        onClose={() => setOpenDialog(false)}
        onSuccess={(message) => {
          setOpenDialog(false);
          setSuccess(message);
        }}
      />
    </Stack>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body1" fontWeight={500}>
        {value}
      </Typography>
    </Box>
  );
}

function ManualWithdrawDialog({
  open,
  ceiling,
  onClose,
  onSuccess,
}: {
  open: boolean;
  ceiling: number;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}) {
  const [rupees, setRupees] = useState('');
  const manual = useManualWithdraw();

  const ceilingRupees = paiseToRupees(ceiling);

  const submit = () => {
    const value = Number.parseFloat(rupees);
    if (Number.isNaN(value) || value <= 0) return;
    manual.mutate(rupeesToPaise(value), {
      onSuccess: (data) => {
        onSuccess(
          `Withdrew ${formatINR(data.withdrawal.amount)} — corpus is now ${formatINR(data.account.investableCorpus)}.`,
        );
        setRupees('');
        manual.reset();
      },
    });
  };

  const close = () => {
    setRupees('');
    manual.reset();
    onClose();
  };

  return (
    <Dialog open={open} onClose={close} maxWidth="xs" fullWidth>
      <DialogTitle>Withdraw cash</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          Pulls cash directly from the corpus. Counts toward{' '}
          <strong>cash withdrawn</strong> (your principal-recovered total) and
          will not push the corpus below the 0.5X lock floor.
        </DialogContentText>
        <TextField
          autoFocus
          fullWidth
          type="number"
          label="Amount"
          inputProps={{ step: 1, min: 0 }}
          value={rupees}
          onChange={(e) => setRupees(e.target.value)}
          helperText={`Max ${formatINR(ceiling)} (≈ ₹${ceilingRupees.toLocaleString('en-IN')})`}
          slotProps={{
            input: { startAdornment: <InputAdornment position="start">₹</InputAdornment> },
          }}
        />
        {manual.isError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {manual.error instanceof HttpError
              ? manual.error.message
              : 'Withdrawal failed.'}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={close} disabled={manual.isPending}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={!rupees || manual.isPending}
        >
          Withdraw
        </Button>
      </DialogActions>
    </Dialog>
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
            <Box display="flex" alignItems="center" gap={1}>
              <Typography variant="h5">{formatINR(withdrawal.amount)}</Typography>
              <Chip
                label={withdrawal.source}
                size="small"
                variant="outlined"
                color={withdrawal.source === 'MANUAL' ? 'primary' : 'default'}
              />
            </Box>
            <Typography variant="caption" color="text.secondary">
              {withdrawal.fromTradeId
                ? <>From trade <code>{withdrawal.fromTradeId.slice(0, 8)}…</code> · </>
                : <>Manual withdrawal · </>}
              created {created}
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
