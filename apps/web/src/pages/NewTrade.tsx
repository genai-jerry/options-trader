import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  InputAdornment,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  accountToSnapshot,
  computeDecisionInputs,
  evaluateDecision,
  formatINR,
  rupeesToPaise,
  type CheckResult,
  type Verdict,
} from '@options-trader/shared';
import { HttpError } from '../api/client';
import { useAccount, useCreateTrade, useTrades } from '../api/hooks';
import { AdvisorPanel } from '../components/AdvisorPanel';

// ─── Form schema (rupees in the UI, converted to paise on submit) ─────

const FormSchema = z
  .object({
    symbol: z.string().min(1, 'Required').toUpperCase(),
    instrument: z.enum(['CE', 'PE', 'FUT']),
    strikeRupees: z.coerce.number().nonnegative().optional(),
    expiry: z.string().min(1, 'Required'),
    lotSize: z.coerce.number().int().positive('> 0'),
    qty: z.coerce.number().int().positive('> 0'),
    entryRupees: z.coerce.number().nonnegative('>= 0'),
    expectedExitRupees: z.coerce.number().nonnegative('>= 0'),
    maxLossRupees: z.coerce.number().nonnegative('>= 0'),
    notes: z.string().optional(),
    agentSource: z.string().optional(),
  })
  .refine(
    (v) => (v.instrument === 'FUT' ? true : v.strikeRupees !== undefined && v.strikeRupees > 0),
    { message: 'Strike is required for CE/PE', path: ['strikeRupees'] },
  );

type FormValues = z.infer<typeof FormSchema>;

const VERDICT_COLOR: Record<Verdict, 'success' | 'warning' | 'error'> = {
  GO: 'success',
  WARN: 'warning',
  BLOCK: 'error',
};

const STATUS_COLOR: Record<CheckResult['status'], 'success' | 'warning' | 'error'> = {
  OK: 'success',
  WARN: 'warning',
  BLOCK: 'error',
};

export function NewTrade() {
  const navigate = useNavigate();
  const accountQ = useAccount();
  const openTradesQ = useTrades({ status: 'OPEN' });
  const createTrade = useCreateTrade();

  const { register, handleSubmit, watch, formState } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    mode: 'onChange',
    defaultValues: {
      symbol: '',
      instrument: 'CE',
      expiry: '',
      lotSize: 50,
      qty: 1,
      entryRupees: 0,
      expectedExitRupees: 0,
      maxLossRupees: 0,
    },
  });

  const values = watch();

  const decision = useMemo(() => {
    if (!accountQ.data || !openTradesQ.data) return null;
    if (accountQ.data.principalX === null) return null;
    if (!values.symbol || !values.expiry) return null;
    if (!values.entryRupees || !values.qty || !values.lotSize) return null;

    const input = {
      symbol: values.symbol.toUpperCase(),
      instrument: values.instrument,
      ...(values.instrument !== 'FUT' && values.strikeRupees
        ? { strike: rupeesToPaise(values.strikeRupees) }
        : {}),
      expiry: values.expiry,
      lotSize: values.lotSize,
      qty: values.qty,
      entryPrice: rupeesToPaise(values.entryRupees),
      expectedExit: rupeesToPaise(values.expectedExitRupees),
      maxAcceptableLoss: rupeesToPaise(values.maxLossRupees),
      ...(values.notes ? { notes: values.notes } : {}),
      ...(values.agentSource ? { agentSource: values.agentSource } : {}),
    };
    const snapshot = accountToSnapshot(accountQ.data);
    return evaluateDecision(input, snapshot, openTradesQ.data, {
      id: 'preview',
      decidedAt: new Date().toISOString(),
    });
  }, [accountQ.data, openTradesQ.data, values]);

  const computed = useMemo(() => {
    if (!values.entryRupees || !values.qty || !values.lotSize) return null;
    return computeDecisionInputs({
      symbol: values.symbol,
      instrument: values.instrument,
      expiry: values.expiry,
      lotSize: values.lotSize,
      qty: values.qty,
      entryPrice: rupeesToPaise(values.entryRupees),
      expectedExit: rupeesToPaise(values.expectedExitRupees),
      maxAcceptableLoss: rupeesToPaise(values.maxLossRupees),
    });
  }, [values]);

  if (accountQ.isLoading || openTradesQ.isLoading) return <CircularProgress />;
  if (!accountQ.data) return <Alert severity="error">Failed to load account.</Alert>;

  const account = accountQ.data;

  if (account.principalX === null) {
    return (
      <Alert severity="warning">
        Set your principal X in Settings before placing trades.
      </Alert>
    );
  }

  const onSubmit = (data: FormValues) => {
    const input = {
      symbol: data.symbol.toUpperCase(),
      instrument: data.instrument,
      ...(data.instrument !== 'FUT' && data.strikeRupees
        ? { strike: rupeesToPaise(data.strikeRupees) }
        : {}),
      expiry: data.expiry,
      lotSize: data.lotSize,
      qty: data.qty,
      entryPrice: rupeesToPaise(data.entryRupees),
      expectedExit: rupeesToPaise(data.expectedExitRupees),
      maxAcceptableLoss: rupeesToPaise(data.maxLossRupees),
      ...(data.notes ? { notes: data.notes } : {}),
      ...(data.agentSource ? { agentSource: data.agentSource } : {}),
    };
    createTrade.mutate(input, {
      onSuccess: () => navigate('/trades'),
    });
  };

  const submitDisabled =
    !decision ||
    decision.verdict === 'BLOCK' ||
    !formState.isValid ||
    createTrade.isPending;

  return (
    <Stack spacing={3}>
      <Typography variant="h4">New Trade</Typography>

      <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: '2fr 1fr' }} gap={3}>
        {/* ── Form ─────────────────────────────────────────────────────── */}
        <Card>
          <CardContent component="form" onSubmit={handleSubmit(onSubmit)}>
            <Typography variant="h6" gutterBottom>
              Trade idea
            </Typography>
            <Stack spacing={2}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="Symbol"
                  fullWidth
                  error={!!formState.errors.symbol}
                  helperText={formState.errors.symbol?.message ?? 'e.g. NIFTY, BANKNIFTY'}
                  {...register('symbol')}
                />
                <TextField
                  label="Instrument"
                  select
                  fullWidth
                  defaultValue="CE"
                  {...register('instrument')}
                >
                  <MenuItem value="CE">Call (CE)</MenuItem>
                  <MenuItem value="PE">Put (PE)</MenuItem>
                  <MenuItem value="FUT">Future (FUT)</MenuItem>
                </TextField>
              </Stack>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="Strike"
                  type="number"
                  fullWidth
                  disabled={values.instrument === 'FUT'}
                  error={!!formState.errors.strikeRupees}
                  helperText={
                    formState.errors.strikeRupees?.message ?? 'Required for CE/PE'
                  }
                  slotProps={{
                    input: { startAdornment: <InputAdornment position="start">₹</InputAdornment> },
                  }}
                  {...register('strikeRupees')}
                />
                <TextField
                  label="Expiry"
                  type="date"
                  fullWidth
                  slotProps={{ inputLabel: { shrink: true } }}
                  error={!!formState.errors.expiry}
                  helperText={formState.errors.expiry?.message}
                  {...register('expiry')}
                />
              </Stack>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="Lot size"
                  type="number"
                  fullWidth
                  error={!!formState.errors.lotSize}
                  helperText={formState.errors.lotSize?.message}
                  {...register('lotSize')}
                />
                <TextField
                  label="Quantity (lots)"
                  type="number"
                  fullWidth
                  error={!!formState.errors.qty}
                  helperText={formState.errors.qty?.message}
                  {...register('qty')}
                />
              </Stack>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="Entry price"
                  type="number"
                  fullWidth
                  inputProps={{ step: 0.05 }}
                  error={!!formState.errors.entryRupees}
                  helperText={formState.errors.entryRupees?.message ?? 'per unit'}
                  slotProps={{
                    input: { startAdornment: <InputAdornment position="start">₹</InputAdornment> },
                  }}
                  {...register('entryRupees')}
                />
                <TextField
                  label="Expected exit"
                  type="number"
                  fullWidth
                  inputProps={{ step: 0.05 }}
                  error={!!formState.errors.expectedExitRupees}
                  helperText={formState.errors.expectedExitRupees?.message ?? 'per unit'}
                  slotProps={{
                    input: { startAdornment: <InputAdornment position="start">₹</InputAdornment> },
                  }}
                  {...register('expectedExitRupees')}
                />
              </Stack>

              <TextField
                label="Max acceptable loss"
                type="number"
                fullWidth
                inputProps={{ step: 1 }}
                error={!!formState.errors.maxLossRupees}
                helperText={
                  formState.errors.maxLossRupees?.message ?? 'Total loss you can stomach'
                }
                slotProps={{
                  input: { startAdornment: <InputAdornment position="start">₹</InputAdornment> },
                }}
                {...register('maxLossRupees')}
              />

              <TextField label="Notes" fullWidth multiline rows={2} {...register('notes')} />
              <TextField
                label="Agent source"
                fullWidth
                helperText="Which agent / source suggested this?"
                {...register('agentSource')}
              />

              {createTrade.isError && (
                <Alert severity="error">
                  {createTrade.error instanceof HttpError
                    ? createTrade.error.message
                    : 'Failed to create trade.'}
                </Alert>
              )}

              <Box>
                <Button
                  type="submit"
                  variant="contained"
                  size="large"
                  disabled={submitDisabled}
                >
                  {createTrade.isPending ? 'Submitting…' : 'Accept & open trade'}
                </Button>
              </Box>
            </Stack>
          </CardContent>
        </Card>

        {/* ── Verdict panel ────────────────────────────────────────────── */}
        <Stack spacing={2}>
          <Card>
            <CardContent>
              <Typography variant="overline" color="text.secondary">
                Verdict
              </Typography>
              {decision ? (
                <Stack spacing={1.5}>
                  <Chip
                    label={decision.verdict}
                    color={VERDICT_COLOR[decision.verdict]}
                    sx={{ alignSelf: 'flex-start', fontSize: 18, py: 2.5, px: 1.5 }}
                  />
                  <Divider />
                  {decision.checks.map((c) => (
                    <Box key={c.id} display="flex" gap={1} alignItems="flex-start">
                      <Chip
                        size="small"
                        label={c.id}
                        color={STATUS_COLOR[c.status]}
                        sx={{ minWidth: 40 }}
                      />
                      <Typography variant="body2">{c.reason}</Typography>
                    </Box>
                  ))}
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Fill the form to see the deterministic verdict.
                </Typography>
              )}
            </CardContent>
          </Card>

          {computed && (
            <Card variant="outlined">
              <CardContent>
                <Typography variant="overline" color="text.secondary">
                  Computed
                </Typography>
                <Stack spacing={0.5} sx={{ mt: 1 }}>
                  <Row label="Capital required" value={formatINR(computed.capitalRequired)} />
                  <Row
                    label="Expected reward"
                    value={formatINR(computed.expectedReward)}
                  />
                  <Row
                    label="Reward/Risk"
                    value={
                      values.maxLossRupees > 0
                        ? computed.rewardRiskRatio.toFixed(2)
                        : '—'
                    }
                  />
                  <Row
                    label="Corpus available"
                    value={formatINR(account.investableCorpus)}
                  />
                  <Row
                    label="After this trade"
                    value={formatINR(account.investableCorpus - computed.capitalRequired)}
                  />
                </Stack>
              </CardContent>
            </Card>
          )}

          <AdvisorPanel
            input={decision ? decision.input : null}
            enabled={account.aiEnabled}
          />
        </Stack>
      </Box>
    </Stack>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Box display="flex" justifyContent="space-between" gap={2}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" fontWeight={500}>
        {value}
      </Typography>
    </Box>
  );
}

