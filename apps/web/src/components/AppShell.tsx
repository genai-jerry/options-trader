import { useEffect, useState } from 'react';
import { AppBar, Box, Drawer, List, ListItemButton, ListItemText, Toolbar, Tooltip, Typography } from '@mui/material';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', shortcut: 'd' },
  { to: '/trades', label: 'Trades', shortcut: 't' },
  { to: '/trades/new', label: 'New Trade', shortcut: 'n' },
  { to: '/withdrawals', label: 'Withdrawals', shortcut: 'w' },
  { to: '/advisor', label: 'AI Advisor', shortcut: 'a' },
  { to: '/zerodha', label: 'Zerodha Sync', shortcut: 'z' },
  { to: '/settings', label: 'Settings', shortcut: 's' },
];

const DRAWER_WIDTH = 220;

export function AppShell() {
  const navigate = useNavigate();
  const [pending, setPending] = useState<'g' | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore if typing in an input/textarea/contenteditable.
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.isContentEditable ||
          t.tagName === 'SELECT')
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === '?') {
        e.preventDefault();
        alert(
          'Shortcuts:\n' +
            'n — New Trade\n' +
            'g d / g t / g w / g a / g z / g s — go to page\n' +
            '? — this help',
        );
        return;
      }

      if (pending === 'g') {
        const nav = NAV.find((n) => n.shortcut === e.key);
        if (nav) {
          e.preventDefault();
          navigate(nav.to);
        }
        setPending(null);
        return;
      }
      if (e.key === 'g') {
        setPending('g');
        // Auto-clear if no follow-up key in 1.5s
        window.setTimeout(() => setPending(null), 1500);
        return;
      }
      if (e.key === 'n') {
        e.preventDefault();
        navigate('/trades/new');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate, pending]);

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar position="fixed" sx={{ zIndex: (t) => t.zIndex.drawer + 1 }}>
        <Toolbar>
          <Typography variant="h6" noWrap component="div">
            Options Trader
          </Typography>
        </Toolbar>
      </AppBar>
      <Drawer
        variant="permanent"
        sx={{
          width: DRAWER_WIDTH,
          flexShrink: 0,
          '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' },
        }}
      >
        <Toolbar />
        <List>
          {NAV.map((item) => (
            <Tooltip
              key={item.to}
              title={`Shortcut: ${item.shortcut === 'n' ? 'n' : `g ${item.shortcut}`}`}
              placement="right"
            >
              <ListItemButton
                component={NavLink}
                to={item.to}
                sx={{ '&.active': { backgroundColor: 'action.selected' } }}
              >
                <ListItemText primary={item.label} />
              </ListItemButton>
            </Tooltip>
          ))}
        </List>
      </Drawer>
      <Box component="main" sx={{ flexGrow: 1, p: 3 }}>
        <Toolbar />
        <Outlet />
      </Box>
    </Box>
  );
}
