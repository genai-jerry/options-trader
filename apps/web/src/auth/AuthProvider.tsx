/**
 * Auth gate. While `/api/auth/me` is loading, render a spinner. If it
 * 401s, render the Login page. Otherwise the children get a populated
 * AuthContext and the SPA mounts.
 */

import { createContext, useContext, type ReactNode } from 'react';
import { Box, CircularProgress } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import type { User } from '@options-trader/shared';
import { api, HttpError } from '../api/client';
import { Login } from './Login';

interface AuthContextValue {
  user: User;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const meQ = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: api.me,
    retry: (count, err) => {
      if (err instanceof HttpError && err.status === 401) return false;
      return count < 1;
    },
    staleTime: 60_000,
  });

  if (meQ.isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (meQ.isError) {
    const err = meQ.error;
    if (err instanceof HttpError && err.status === 401) {
      return <Login />;
    }
    return <Login error={err instanceof Error ? err.message : 'Auth check failed.'} />;
  }

  const user = meQ.data!.user;
  return <AuthContext.Provider value={{ user }}>{children}</AuthContext.Provider>;
}
