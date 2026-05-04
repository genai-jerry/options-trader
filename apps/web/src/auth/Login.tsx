import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Stack,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

export function Login({ error }: { error?: string }) {
  const status = useQuery({
    queryKey: ['auth', 'status'],
    queryFn: api.authStatus,
    staleTime: 60_000,
  });

  const startGoogle = () => {
    window.location.href = '/api/auth/google/login';
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
        p: 2,
      }}
    >
      <Card sx={{ maxWidth: 420, width: '100%' }}>
        <CardContent sx={{ p: { xs: 2.5, sm: 3 } }}>
          <Stack spacing={3}>
            <Box>
              <Box
                sx={{
                  width: 40,
                  height: 40,
                  borderRadius: 2,
                  bgcolor: 'primary.main',
                  color: 'primary.contrastText',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: 18,
                  mb: 1.5,
                }}
              >
                OT
              </Box>
              <Typography variant="h5">Options Trader</Typography>
              <Typography variant="body2" color="text.secondary">
                Sign in to access your phase-based trading book.
              </Typography>
            </Box>

            {error && <Alert severity="error">{error}</Alert>}

            {status.isLoading && <CircularProgress size={20} />}

            {status.data && !status.data.googleConfigured && (
              <Alert severity="warning">
                Google OAuth is not configured on the server. Set{' '}
                <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code>, and{' '}
                <code>GOOGLE_REDIRECT_URI</code> in <code>apps/server/.env</code>.
              </Alert>
            )}

            <Button
              variant="contained"
              size="large"
              disabled={!status.data?.googleConfigured}
              onClick={startGoogle}
              sx={{ textTransform: 'none' }}
              startIcon={<GoogleIcon />}
            >
              Continue with Google
            </Button>

            <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
              Your trading book is yours alone — every API request is scoped to your
              account.
            </Typography>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}

function GoogleIcon() {
  // Google "G" — official 4-color glyph, simplified. Inline SVG so no
  // additional asset dependency.
  return (
    <Box component="svg" sx={{ width: 18, height: 18 }} viewBox="0 0 48 48">
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C39.012 35.62 44 30 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </Box>
  );
}
