import { useEffect, useRef, useState } from 'react';
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
  TextField,
  Typography,
} from '@mui/material';
import StopIcon from '@mui/icons-material/Stop';
import SendIcon from '@mui/icons-material/Send';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { streamSSE } from '../api/sse';
import { useAccount } from '../api/hooks';

interface Turn {
  role: 'user' | 'assistant' | 'tool';
  content: string;
}

export function AIAdvisor() {
  const account = useAccount();
  const status = useQuery({ queryKey: ['advisor', 'status'], queryFn: api.advisorStatus });
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight });
  }, [turns]);

  if (account.isLoading || status.isLoading) return <CircularProgress />;

  const aiEnabled = account.data?.aiEnabled ?? false;
  const configured = status.data?.configured ?? false;
  const ready = aiEnabled && configured;

  const send = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    const next: Turn[] = [...turns, { role: 'user', content: text }, { role: 'assistant', content: '' }];
    setTurns(next);
    setInput('');
    setStreaming(true);
    setError(null);

    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const userTurns = next
        .filter((t): t is Turn & { role: 'user' | 'assistant' } => t.role !== 'tool')
        .slice(0, -1); // drop the empty assistant placeholder
      await streamSSE(
        '/api/advisor/chat',
        { messages: userTurns.map((t) => ({ role: t.role, content: t.content })) },
        (e) => {
          if (e.event === 'text') {
            setTurns((curr) => {
              const copy = [...curr];
              const last = copy[copy.length - 1];
              if (last?.role === 'assistant') {
                copy[copy.length - 1] = { role: 'assistant', content: last.content + e.data };
              }
              return copy;
            });
          } else if (e.event === 'tool_use') {
            setTurns((curr) => [...curr, { role: 'tool', content: `→ ${e.data}` }]);
          } else if (e.event === 'tool_result') {
            const preview = e.data.length > 200 ? `${e.data.slice(0, 200)}…` : e.data;
            setTurns((curr) => [...curr, { role: 'tool', content: `← ${preview}` }]);
          } else if (e.event === 'error') {
            setError(e.data);
          }
        },
        ac.signal,
      );
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') setError(err.message);
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    setStreaming(false);
  };

  const newChat = () => {
    if (streaming) stop();
    setTurns([]);
  };

  return (
    <Stack spacing={3} sx={{ height: 'calc(100vh - 160px)' }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" gap={2}>
        <Typography variant="h4">AI Advisor</Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          <Chip
            label={ready ? `${status.data?.provider}/${status.data?.model}` : 'Not configured'}
            color={ready ? 'success' : 'default'}
            size="small"
          />
          <Button size="small" onClick={newChat} disabled={turns.length === 0}>
            New chat
          </Button>
        </Stack>
      </Box>

      {!aiEnabled && (
        <Alert severity="warning">AI advisor is disabled in Settings.</Alert>
      )}
      {aiEnabled && !configured && (
        <Alert severity="warning">
          Set <code>ANTHROPIC_API_KEY</code> in <code>apps/server/.env</code> to enable
          the advisor.
        </Alert>
      )}
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      <Box
        ref={scrollerRef}
        sx={{
          flexGrow: 1,
          overflowY: 'auto',
          bgcolor: 'background.default',
          borderRadius: 1,
          border: 1,
          borderColor: 'divider',
          p: 2,
        }}
      >
        {turns.length === 0 ? (
          <Stack spacing={2} sx={{ color: 'text.secondary' }}>
            <Typography variant="body2">
              Ask Claude about a trade idea, your phase, or how to structure a hedge.
              The advisor calls <code>evaluate_decision</code> against your live state
              before issuing any verdict.
            </Typography>
            <Typography variant="caption">
              Examples: <em>“Should I roll my NIFTY 20000 CE?”</em> ·{' '}
              <em>“What's a safer way to express a vol view this week?”</em>
            </Typography>
          </Stack>
        ) : (
          <Stack spacing={1.5}>
            {turns.map((t, i) => (
              <ChatBubble key={i} turn={t} />
            ))}
            {streaming && (
              <Stack direction="row" spacing={1} alignItems="center">
                <CircularProgress size={14} />
                <Typography variant="caption" color="text.secondary">
                  streaming…
                </Typography>
              </Stack>
            )}
          </Stack>
        )}
      </Box>

      <Box display="flex" gap={1}>
        <TextField
          fullWidth
          multiline
          maxRows={4}
          placeholder={ready ? 'Type a message…' : 'Configure the advisor first.'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (ready) send();
            }
          }}
          disabled={!ready}
        />
        {streaming ? (
          <IconButton color="error" onClick={stop} aria-label="Stop">
            <StopIcon />
          </IconButton>
        ) : (
          <IconButton
            color="primary"
            onClick={send}
            disabled={!ready || !input.trim()}
            aria-label="Send"
          >
            <SendIcon />
          </IconButton>
        )}
      </Box>
    </Stack>
  );
}

function ChatBubble({ turn }: { turn: Turn }) {
  if (turn.role === 'tool') {
    return (
      <Card variant="outlined" sx={{ borderColor: 'grey.300', bgcolor: 'grey.50' }}>
        <CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
          >
            {turn.content}
          </Typography>
        </CardContent>
      </Card>
    );
  }
  const isUser = turn.role === 'user';
  return (
    <Box display="flex" justifyContent={isUser ? 'flex-end' : 'flex-start'}>
      <Card
        sx={{
          maxWidth: '85%',
          bgcolor: isUser ? 'primary.main' : 'background.paper',
          color: isUser ? 'primary.contrastText' : 'text.primary',
        }}
      >
        <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
            {turn.content || (isUser ? '' : '…')}
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}

