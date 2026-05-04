import { useEffect, useMemo, useState } from 'react';
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
  Tab,
  Tabs,
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

type Mode = 'detailed' | 'quick';
// Bumped from `options-trader.newTrade.mode` when Quick became the default.
// The key change resets the per-browser preference; the old key is removed
// once on mount to avoid cruft.
const MODE_STORAGE_KEY = 'options-trader.newTrade.mode.v2';
const LEGACY_MODE_KEYS = ['options-trader.newTrade.mode'];

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

  const [mode, setMode] = useState<Mode>(() => {
    const stored = window.localStorage.getItem(MODE_STORAGE_KEY);
    return stored === 'quick' || stored === 'detailed' ? stored : 'quick';
  });
  useEffect(() => {
    window.localStorage.setItem(MODE_STORAGE_KEY, mode);
    for (const k of LEGACY_MODE_KEYS) window.localStorage.removeItem(k);
  }, [mode]);

  // The currently-being-edited input drives the verdict + computed + advisor
  // panels. Both forms call setInput() whenever their fields change.
  const [input, setInput] = useState<NewTradeInput | null>(null);

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

  const onSubmit = (built: NewTradeInput): void => {
    createTrade.mutate(built, { onSuccess: () => navigate('/trades') });
  };

  const submitBlocked = decision?.verdict === 'BLOCK';

  return (
    <Stack spacing={3}>
      <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
        <Typography variant="h4">New Trade</Typography>
        <Tabs value={mode} onChange={(_, v) => setMode(v as Mode)}>
          <Tab value="detailed" label="Detailed" />
          <Tab value="quick" label="Quick (advisor mode)" />
        </Tabs>
      </Box>

      <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: '2fr 1fr' }} gap={3}>
        {mode === 'detailed' ? (
          <DetailedForm
            onChange={setInput}
            onSubmit={onSubmit}
            submitting={createTrade.isPending}
            submitBlocked={submitBlocked}
            error={
              createTrade.isError
                ? createTrade.error instanceof HttpError
                  ? createTrade.error.message
                  : 'Failed to create trade.'
                : null
            }
          />
        ) : (
          <QuickForm
            onChange={setInput}
            onSubmit={onSubmit}
            submitting={createTrade.isPending}
            submitBlocked={submitBlocked}
            error={
              createTrade.isError
                ? createTrade.error instanceof HttpError
                  ? createTrade.error.message
                  : 'Failed to create trade.'
                : null
            }
          />
        )}

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
                  <Row label="Expected reward" value={formatINR(computed.expectedReward)} />
                  <Row
                    label="Reward/Risk"
                    value={
                      input && input.maxAcceptableLoss > 0
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

          <AdvisorPanel input={input} enabled={account.aiEnabled} />
        </Stack>
      </Box>
    </Stack>
  );
}

// ─── Detailed form ──────────────────────────────────────────────────

const DetailedSchema = z
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
type DetailedValues = z.infer<typeof DetailedSchema>;

function detailedToInput(data: DetailedValues): NewTradeInput {
  return {
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
}

interface FormProps {
  onChange: (input: NewTradeInput | null) => void;
  onSubmit: (input: NewTradeInput) => void;
  submitting: boolean;
  submitBlocked: boolean;
  error: string | null;
}

function DetailedForm({ onChange, onSubmit, submitting, submitBlocked, error }: FormProps) {
  const { register, handleSubmit, watch, formState } = useForm<DetailedValues>({
    resolver: zodResolver(DetailedSchema),
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

  useEffect(() => {
    if (
      !values.symbol ||
      !values.expiry ||
      !values.entryRupees ||
      !values.qty ||
      !values.lotSize
    ) {
      onChange(null);
      return;
    }
    onChange(detailedToInput(values));
  }, [values, onChange]);

  const submit = handleSubmit((data) => onSubmit(detailedToInput(data)));
  const submitDisabled = !formState.isValid || submitting || submitBlocked;

  return (
    <Card>
      <CardContent component="form" onSubmit={submit}>
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
              helperText={formState.errors.strikeRupees?.message ?? 'Required for CE/PE'}
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
            helperText={formState.errors.maxLossRupees?.message ?? 'Total loss you can stomach'}
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

          {error && <Alert severity="error">{error}</Alert>}

          <Box>
            <Button type="submit" variant="contained" size="large" disabled={submitDisabled}>
              {submitting ? 'Submitting…' : 'Accept & open trade'}
            </Button>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}

// ─── Quick form (advisor-trusted: only money matters) ───────────────

// Only Capital Deployed is required. Expected exit value and Max acceptable
// loss are optional — left blank, the form treats max loss as the full
// capital (worst case is losing the whole trade) and expected exit as the
// capital itself (no expected upside, which makes the rules engine WARN on
// reward/risk in BOOTSTRAP — that's intentional and useful feedback).
const QuickSchema = z.object({
  label: z.string().optional(),
  agentSource: z.string().optional(),
  notes: z.string().optional(),
  capitalRupees: z.coerce.number().positive('Capital deployed is required'),
  expectedExitRupees: z.coerce.number().nonnegative().optional(),
  maxLossRupees: z.coerce.number().nonnegative().optional(),
});
type QuickValues = z.infer<typeof QuickSchema>;

/**
 * Map a quick-mode submission to a NewTradeInput.
 *
 * Quick mode treats the trade as a single unit (qty=1, lotSize=1) so that
 * `entryPrice` and `expectedExit` become total rupee amounts directly. The
 * deterministic engine still computes capitalRequired = entryPrice × qty
 * × lotSize, which falls out to the user-entered total. All checks
 * (C1–C6) remain meaningful.
 *
 * Symbol must be unique (C6 fires on duplicate OPEN symbols), so when no
 * label is provided we tag with a base36 timestamp suffix.
 */
function quickToInput(data: QuickValues): NewTradeInput {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + 30);
  const fallbackId = Date.now().toString(36).toUpperCase();
  const symbol = (data.label?.trim() || `ADVISOR-${fallbackId}`)
    .toUpperCase()
    .slice(0, 64);

  // Defaults for the optional fields:
  //   maxLoss = capital  → C3 treats worst case as losing the entire trade
  //   expectedExit = capital → no upside; C4 will WARN in BOOTSTRAP
  const capital = rupeesToPaise(data.capitalRupees);
  const maxLoss =
    data.maxLossRupees !== undefined && data.maxLossRupees > 0
      ? rupeesToPaise(data.maxLossRupees)
      : capital;
  const expectedExit =
    data.expectedExitRupees !== undefined && data.expectedExitRupees > 0
      ? rupeesToPaise(data.expectedExitRupees)
      : capital;

  return {
    symbol,
    instrument: 'FUT',
    expiry: expiry.toISOString().slice(0, 10),
    lotSize: 1,
    qty: 1,
    entryPrice: capital,
    expectedExit,
    maxAcceptableLoss: maxLoss,
    ...(data.notes ? { notes: data.notes } : {}),
    ...(data.agentSource ? { agentSource: data.agentSource } : {}),
  };
}

function QuickForm({ onChange, onSubmit, submitting, submitBlocked, error }: FormProps) {
  const { register, handleSubmit, watch, formState } = useForm<QuickValues>({
    resolver: zodResolver(QuickSchema),
    mode: 'onChange',
    defaultValues: {
      label: '',
      agentSource: '',
      notes: '',
      capitalRupees: 0,
      expectedExitRupees: 0,
      maxLossRupees: 0,
    },
  });
  const values = watch();

  useEffect(() => {
    if (!values.capitalRupees) {
      onChange(null);
      return;
    }
    onChange(quickToInput(values));
  }, [values, onChange]);

  const submit = handleSubmit((data) => onSubmit(quickToInput(data)));
  const submitDisabled = !formState.isValid || submitting || submitBlocked;

  return (
    <Card>
      <CardContent component="form" onSubmit={submit}>
        <Typography variant="h6">Quick trade</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          For advisor-recommended trades where you trust the symbol and contract
          details. Only Capital deployed is required; the rest fall back to
          sensible defaults (max loss = capital, expected exit = capital). The
          trade is recorded as a single FUT-style unit (lot size 1, qty 1) with
          a 30-day expiry; all checks (C1–C6) still run against your live state.
        </Typography>

        <Stack spacing={2}>
          <TextField
            label="Capital deployed *"
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

          <TextField
            label="Expected exit value"
            type="number"
            fullWidth
            inputProps={{ step: 1 }}
            error={!!formState.errors.expectedExitRupees}
            helperText={
              formState.errors.expectedExitRupees?.message ??
              'Total ₹ you expect to walk away with. Leave blank for break-even.'
            }
            slotProps={{
              input: { startAdornment: <InputAdornment position="start">₹</InputAdornment> },
            }}
            {...register('expectedExitRupees')}
          />

          <TextField
            label="Max acceptable loss"
            type="number"
            fullWidth
            inputProps={{ step: 1 }}
            error={!!formState.errors.maxLossRupees}
            helperText={
              formState.errors.maxLossRupees?.message ??
              'Worst case you can stomach. Leave blank to assume the full capital.'
            }
            slotProps={{
              input: { startAdornment: <InputAdornment position="start">₹</InputAdornment> },
            }}
            {...register('maxLossRupees')}
          />

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
              {submitting ? 'Submitting…' : 'Accept & open trade'}
            </Button>
          </Box>
        </Stack>
      </CardContent>
    </Card>
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
