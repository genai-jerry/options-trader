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
  type NewTradeInput,
  type Verdict,
} from '@options-trader/shared';
import { HttpError } from '../api/client';
import { useAccount, useCreateTrade, useTrades } from '../api/hooks';
import { AdvisorPanel } from '../components/AdvisorPanel';

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
  const accountQ = useAccount();
  const openTradesQ = useTrades({ status: 'OPEN' });
  const createTrade = useCreateTrade();
  const navigate = useNavigate();

  const { register, handleSubmit, watch, formState } = useForm<TradeFormValues>({
    resolver: zodResolver(TradeSchema),
    mode: 'onChange',
    defaultValues: {
      capitalRupees: 0,
      label: '',
      agentSource: '',
      notes: '',
    },
  });
  const values = watch();

  const input = useMemo<NewTradeInput | null>(() => {
    if (!values.capitalRupees) return null;
    return formToInput(values);
  }, [values]);

  const decision = useMemo(() => {
    if (!accountQ.data || !openTradesQ.data) return null;
    if (accountQ.data.principalX === null) return null;
    if (!input) return null;
    const snapshot = accountToSnapshot(accountQ.data);
    return evaluateDecision(input, snapshot, openTradesQ.data, {
      id: 'preview',
      decidedAt: new Date().toISOString(),
    });
  }, [accountQ.data, openTradesQ.data, input]);

  const computed = useMemo(() => (input ? computeDecisionInputs(input) : null), [input]);

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

  const submit = handleSubmit((data) => {
    createTrade.mutate(formToInput(data), { onSuccess: () => navigate('/trades') });
  });

  const submitBlocked = decision?.verdict === 'BLOCK';
  const submitDisabled = !formState.isValid || createTrade.isPending || submitBlocked;
  const error = createTrade.isError
    ? createTrade.error instanceof HttpError
      ? createTrade.error.message
      : 'Failed to create trade.'
    : null;

  return (
    <Stack spacing={{ xs: 2, sm: 3 }}>
      <Typography variant="h4">New Trade</Typography>

      <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: '2fr 1fr' }} gap={{ xs: 2, md: 3 }}>
        <Card>
          <CardContent component="form" onSubmit={submit}>
            <Typography variant="h6">Trade idea</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Enter the capital you're committing. The deterministic engine
              checks that against your phase, corpus, and position-size cap.
              Everything else is optional.
            </Typography>

            <Stack spacing={2}>
              <TextField
                label="Trade value *"
                type="number"
                fullWidth
                autoFocus
                inputProps={{ step: 1 }}
                error={!!formState.errors.capitalRupees}
                helperText={
                  formState.errors.capitalRupees?.message ??
                  'Total ₹ committed. Debited from your corpus on Accept.'
                }
                slotProps={{
                  input: { startAdornment: <InputAdornment position="start">₹</InputAdornment> },
                }}
                {...register('capitalRupees')}
              />

              <Divider>Optional</Divider>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="Label"
                  fullWidth
                  placeholder="e.g. NIFTY-MAY-CE"
                  helperText="Shown in the Trades list. Auto-generated if blank."
                  {...register('label')}
                />
                <TextField
                  label="Agent source"
                  fullWidth
                  placeholder="e.g. Claude, my analyst"
                  {...register('agentSource')}
                />
              </Stack>

              <TextField label="Notes" fullWidth multiline rows={2} {...register('notes')} />

              {error && <Alert severity="error">{error}</Alert>}

              <Box>
                <Button type="submit" variant="contained" size="large" disabled={submitDisabled}>
                  {createTrade.isPending ? 'Submitting…' : 'Accept & open trade'}
                </Button>
              </Box>
            </Stack>
          </CardContent>
        </Card>

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
                  Enter a trade value to see the deterministic verdict.
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
                  <Row label="Corpus available" value={formatINR(account.investableCorpus)} />
                  <Row
                    label="After this trade"
                    value={formatINR(account.investableCorpus - computed.capitalRequired)}
                  />
                </Stack>
              </CardContent>
            </Card>
          )}

          <AdvisorPanel input={input} enabled={account.aiEnabled} />
        </Stack>
      </Box>
    </Stack>
  );
}

const TradeSchema = z.object({
  capitalRupees: z.coerce.number().positive('Trade value is required'),
  label: z.string().optional(),
  agentSource: z.string().optional(),
  notes: z.string().optional(),
});
type TradeFormValues = z.infer<typeof TradeSchema>;

// The capital amount is recorded as a single FUT-style unit (lotSize 1, qty 1)
// with a 30-day placeholder expiry. The deterministic engine still computes
// capitalRequired = entryPrice × qty × lotSize, which collapses to the user's
// total. Symbol must be unique (C6 fires on duplicates), so we tag with a
// base36 timestamp suffix when no label is given.
function formToInput(data: TradeFormValues): NewTradeInput {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + 30);
  const fallbackId = Date.now().toString(36).toUpperCase();
  const symbol = (data.label?.trim() || `TRADE-${fallbackId}`).toUpperCase().slice(0, 64);
  const capital = rupeesToPaise(data.capitalRupees);

  return {
    symbol,
    instrument: 'FUT',
    expiry: expiry.toISOString().slice(0, 10),
    lotSize: 1,
    qty: 1,
    entryPrice: capital,
    ...(data.notes ? { notes: data.notes } : {}),
    ...(data.agentSource ? { agentSource: data.agentSource } : {}),
  };
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

