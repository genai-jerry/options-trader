import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[error-boundary]', error, info);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <Box sx={{ p: 3 }}>
          <Stack spacing={2}>
            <Typography variant="h5">Something went wrong.</Typography>
            <Alert severity="error">{this.state.error.message}</Alert>
            <Box>
              <Button
                variant="outlined"
                onClick={() => {
                  this.setState({ error: null });
                  window.location.reload();
                }}
              >
                Reload
              </Button>
            </Box>
          </Stack>
        </Box>
      );
    }
    return this.props.children;
  }
}
