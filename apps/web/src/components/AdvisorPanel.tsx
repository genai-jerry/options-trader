import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  Typography,
} from '@mui/material';
import type { NewTradeInput } from '@options-trader/shared';
import { api, type AdvisorDecideResponse } from '../api/client';

const VERDICT_COLOR = {
  GO: 'success',
  WARN: 'warning',
  BLOCK: 'error',
} as const;

export function AdvisorPanel({ input, enabled }: { input: NewTradeInput | null; enabled: boolean }) {
  const status = useQuery({ queryKey: ['advisor', 'status'], queryFn: api.advisorStatus });
  const [response, setResponse] = useState<AdvisorDecideResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = enabled && (status.data?.configured ?? false);

  const ask = async () => {
    if (!input) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api.advisorDecide(input);
      setResponse(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Advisor failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="overline" color="text.secondary">
            AI advisor
          </Typography>
          {ready && (
            <Chip
              size="small"
              label={`${status.data?.provider}/${status.data?.model}`}
              variant="outlined"
            />
          )}
        </Stack>

        {!enabled && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Disabled in Settings.
          </Typography>
        )}
        {enabled && !status.data?.configured && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Set <code>ANTHROPIC_API_KEY</code> to enable.
          </Typography>
        )}
        {ready && (
          <>
            <Box sx={{ mt: 1 }}>
              <Button
                size="small"
                variant="outlined"
                disabled={!input || loading}
                onClick={ask}
              >
                {loading ? 'Asking Claude…' : 'Ask Claude about this trade'}
              </Button>
            </Box>

            {error && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {error}
              </Alert>
            )}

            {response && (
              <Stack spacing={1.5} sx={{ mt: 2 }}>
                <Chip
                  label={`AI: ${response.verdict}`}
                  color={VERDICT_COLOR[response.verdict]}
                  sx={{ alignSelf: 'flex-start' }}
                />
                <Typography variant="body2">{response.summary}</Typography>
                {response.points.length > 0 && (
                  <Box component="ul" sx={{ pl: 2, m: 0 }}>
                    {response.points.map((p, i) => (
                      <Typography key={i} component="li" variant="body2">
                        {p}
                      </Typography>
                    ))}
                  </Box>
                )}
                <Divider />
                <Typography variant="caption" color="text.secondary">
                  Philosophy alignment: {response.rulesAlignment}
                </Typography>
              </Stack>
            )}

            {loading && (
              <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                <CircularProgress size={14} />
                <Typography variant="caption" color="text.secondary">
                  Calling tools and forming a verdict…
                </Typography>
              </Box>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
