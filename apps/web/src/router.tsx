import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { Dashboard } from './pages/Dashboard';
import { Trades } from './pages/Trades';
import { NewTrade } from './pages/NewTrade';
import { Withdrawals } from './pages/Withdrawals';
import { AIAdvisor } from './pages/AIAdvisor';
import { Settings } from './pages/Settings';
import { ZerodhaSync } from './pages/ZerodhaSync';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: 'dashboard', element: <Dashboard /> },
      { path: 'trades', element: <Trades /> },
      { path: 'trades/new', element: <NewTrade /> },
      { path: 'withdrawals', element: <Withdrawals /> },
      { path: 'advisor', element: <AIAdvisor /> },
      { path: 'settings', element: <Settings /> },
      { path: 'zerodha', element: <ZerodhaSync /> },
    ],
  },
]);
