import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  FormControlLabel,
  InputAdornment,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { formatINR, paiseToRupees, rupeesToPaise, type Account } from '@options-trader/shared';
import {
  useAccount,
  usePutSettings,
  useResetAll,
  useSetPrincipal,
  useTrades,
} from '../api/hooks';
import { HttpError } from '../api/client';

export function Settings() {
  const accountQ = useAccount();
  const tradesQ = useTrades();

  if (accountQ.isLoading || tradesQ.isLoading) return <CircularProgress />;
  if (accountQ.isError || !accountQ.data) {
    return <Alert severity="error">Failed to load account.</Alert>;
  }

  const account = accountQ.data;
  const hasTrades = (tradesQ.data?.length ?? 0) > 0;

  return (
    <Stack spacing={3} maxWidth={720}>
      <Typography variant="h4">Settings</Typography>

      <PrincipalSection account={account} hasTrades={hasTrades} />
      <PreferencesSection account={account} />
      <BackupSection />
      <ResetSection hasTrades={hasTrades} />
    </Stack>
  );
}

// ─── Principal X ──────────────────────────────────────────────────────

const PrincipalSchema = z.object({
  rupees: z.coerce
    .number({ invalid_type_error: 'Enter a number.' })
    .positive('Principal must be positive.'),
});
type PrincipalForm = z.infer<typeof PrincipalSchema>;

function PrincipalSection({ account, hasTrades }: { account: Account; hasTrades: boolean }) {
  const setPrincipal = useSetPrincipal();
  const initial = account.principalX !== null ? paiseToRupees(account.principalX) : 0;
  const { register, handleSubmit, formState } = useForm<PrincipalForm>({
    resolver: zodResolver(PrincipalSchema),
    defaultValues: { rupees: initial },
  });

  const locked = hasTrades;
  const onSubmit = (data: PrincipalForm) => {
    setPrincipal.mutate(rupeesToPaise(data.rupees));
  };

  return (
    <Card>
      <CardContent>
        <Typography variant="h6">Principal X</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          The starting capital that defines the bootstrap target (2X) and the lock floor (0.5X).
          {locked
            ? ' Locked because trades exist — use “Reset everything” below to change.'
            : ' Editable until the first trade is recorded (D9).'}
        </Typography>

        {account.principalX !== null && (
          <Alert severity="info" sx={{ mb: 2 }}>
            Current X: <strong>{formatINR(account.principalX)}</strong>
          </Alert>
        )}

        <Box component="form" onSubmit={handleSubmit(onSubmit)} sx={{ display: 'flex', gap: 2 }}>
          <TextField
            label="Principal X (rupees)"
            type="number"
            disabled={locked}
            error={!!formState.errors.rupees}
            helperText={formState.errors.rupees?.message}
            slotProps={{
              input: { startAdornment: <InputAdornment position="start">₹</InputAdornment> },
            }}
            sx={{ flexGrow: 1 }}
            {...register('rupees')}
          />
          <Button type="submit" variant="contained" disabled={locked || setPrincipal.isPending}>
            {account.principalX === null ? 'Set X' : 'Update X'}
          </Button>
        </Box>

        {setPrincipal.isError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {setPrincipal.error instanceof HttpError
              ? setPrincipal.error.message
              : 'Failed to set principal.'}
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Preferences ──────────────────────────────────────────────────────

const PreferencesSchema = z.object({
  feePercentNumber: z.coerce.number().min(0).max(100),
  positionSizeCapNumber: z.coerce.number().min(0).max(100),
  aiEnabled: z.boolean(),
});
type PreferencesForm = z.infer<typeof PreferencesSchema>;

function PreferencesSection({ account }: { account: Account }) {
  const putSettings = usePutSettings();
  const { register, handleSubmit, watch, setValue, formState } = useForm<PreferencesForm>({
    resolver: zodResolver(PreferencesSchema),
    defaultValues: {
      feePercentNumber: account.feePercent * 100,
      positionSizeCapNumber: account.positionSizeCap * 100,
      aiEnabled: account.aiEnabled,
    },
  });
  const aiEnabled = watch('aiEnabled');

  const onSubmit = (data: PreferencesForm) => {
    putSettings.mutate({
      feePercent: data.feePercentNumber / 100,
      positionSizeCap: data.positionSizeCapNumber / 100,
      aiEnabled: data.aiEnabled,
    });
  };

  return (
    <Card>
      <CardContent component="form" onSubmit={handleSubmit(onSubmit)}>
        <Typography variant="h6">Preferences</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Fee model is a percent of profit (D5); position-size cap is a soft WARN; set to 0 to
          disable the cap warning (D10).
        </Typography>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            label="Fee percent"
            type="number"
            inputProps={{ step: 0.1, min: 0, max: 100 }}
            error={!!formState.errors.feePercentNumber}
            helperText={formState.errors.feePercentNumber?.message ?? 'Default 5%'}
            slotProps={{
              input: { endAdornment: <InputAdornment position="end">%</InputAdornment> },
            }}
            {...register('feePercentNumber')}
          />
          <TextField
            label="Position-size cap"
            type="number"
            inputProps={{ step: 1, min: 0, max: 100 }}
            error={!!formState.errors.positionSizeCapNumber}
            helperText={formState.errors.positionSizeCapNumber?.message ?? '0 to disable'}
            slotProps={{
              input: { endAdornment: <InputAdornment position="end">%</InputAdornment> },
            }}
            {...register('positionSizeCapNumber')}
          />
        </Stack>

        <FormControlLabel
          sx={{ mt: 2 }}
          control={
            <Switch
              checked={aiEnabled}
              onChange={(e) => setValue('aiEnabled', e.target.checked, { shouldDirty: true })}
            />
          }
          label="AI advisor enabled"
        />

        <Box sx={{ mt: 2 }}>
          <Button type="submit" variant="contained" disabled={putSettings.isPending}>
            Save preferences
          </Button>
        </Box>

        {putSettings.isError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {putSettings.error instanceof HttpError
              ? putSettings.error.message
              : 'Failed to save preferences.'}
          </Alert>
        )}
        {putSettings.isSuccess && (
          <Alert severity="success" sx={{ mt: 2 }}>
            Preferences saved.
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Backup / restore ─────────────────────────────────────────────────

function BackupSection() {
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const exportNow = async () => {
    setError(null);
    try {
      const res = await fetch('/api/backup/export');
      if (!res.ok) throw new Error(`Export failed: ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `options-trader-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed.');
    }
  };

  const importFile = async (file: File) => {
    if (
      !window.confirm(
        'Importing will WIPE all current data and replace it with the file contents. Continue?',
      )
    ) {
      return;
    }
    setImporting(true);
    setError(null);
    setSuccess(null);
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const res = await fetch('/api/backup/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, confirm: 'IMPORT' }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Import failed: ${res.status}`);
      }
      const out = (await res.json()) as { trades: number };
      setSuccess(`Imported ${out.trades} trade(s). Reload the page to see the new state.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <Card>
      <CardContent>
        <Typography variant="h6">Backup & restore</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Export the full state as JSON, or import a previous export. Import is
          destructive — it wipes the database first. The Zerodha access token is not
          included; reconnect after restoring.
        </Typography>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <Button variant="outlined" onClick={exportNow}>
            Export JSON
          </Button>
          <Button variant="outlined" component="label" disabled={importing}>
            {importing ? 'Importing…' : 'Import JSON…'}
            <input
              hidden
              type="file"
              accept="application/json"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importFile(f);
                e.target.value = '';
              }}
            />
          </Button>
        </Stack>

        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
        {success && (
          <Alert severity="success" sx={{ mt: 2 }}>
            {success}
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Reset everything ─────────────────────────────────────────────────

function ResetSection({ hasTrades }: { hasTrades: boolean }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const resetAll = useResetAll();

  const close = () => {
    setOpen(false);
    setTyped('');
    resetAll.reset();
  };

  const onConfirm = () => {
    resetAll.mutate(undefined, {
      onSuccess: () => {
        setOpen(false);
        setTyped('');
      },
    });
  };

  return (
    <>
      <Card sx={{ borderColor: 'error.main' }} variant="outlined">
        <CardContent>
          <Typography variant="h6" color="error">
            Reset everything
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Wipes all trades, decisions, withdrawals, advisor messages, and Zerodha sessions, and
            clears principal X. Use this if you want to start over.
            {!hasTrades && ' (No trades exist yet — this is a no-op data-wise.)'}
          </Typography>
          <Button color="error" variant="contained" onClick={() => setOpen(true)}>
            Reset everything…
          </Button>
        </CardContent>
      </Card>

      <Dialog open={open} onClose={close}>
        <DialogTitle>Reset everything?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This is irreversible. Type <strong>RESET</strong> in the box below to confirm.
          </DialogContentText>
          <Divider sx={{ my: 2 }} />
          <TextField
            autoFocus
            fullWidth
            label="Type RESET to confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
          {resetAll.isError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {resetAll.error instanceof HttpError ? resetAll.error.message : 'Reset failed.'}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={close} disabled={resetAll.isPending}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={typed !== 'RESET' || resetAll.isPending}
            onClick={onConfirm}
          >
            Reset
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
