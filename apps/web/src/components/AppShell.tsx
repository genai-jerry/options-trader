import { useEffect, useState } from 'react';
import {
  AppBar,
  Avatar,
  Box,
  Chip,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import LogoutIcon from '@mui/icons-material/Logout';
import DashboardIcon from '@mui/icons-material/SpaceDashboardOutlined';
import TableViewIcon from '@mui/icons-material/TableViewOutlined';
import AddCircleIcon from '@mui/icons-material/AddCircleOutline';
import WalletIcon from '@mui/icons-material/AccountBalanceWalletOutlined';
import PsychologyIcon from '@mui/icons-material/PsychologyOutlined';
import SyncAltIcon from '@mui/icons-material/SyncAltOutlined';
import SettingsIcon from '@mui/icons-material/SettingsOutlined';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthProvider';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', shortcut: 'd', Icon: DashboardIcon },
  { to: '/trades', label: 'Trades', shortcut: 't', Icon: TableViewIcon },
  { to: '/trades/new', label: 'New Trade', shortcut: 'n', Icon: AddCircleIcon },
  { to: '/withdrawals', label: 'Withdrawals', shortcut: 'w', Icon: WalletIcon },
  { to: '/advisor', label: 'AI Advisor', shortcut: 'a', Icon: PsychologyIcon },
  { to: '/zerodha', label: 'Zerodha Sync', shortcut: 'z', Icon: SyncAltIcon },
  { to: '/settings', label: 'Settings', shortcut: 's', Icon: SettingsIcon },
];

const DRAWER_WIDTH = 240;

export function AppShell() {
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const navigate = useNavigate();
  const location = useLocation();
  const { user, family } = useAuth();
  const qc = useQueryClient();
  const [pending, setPending] = useState<'g' | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close the temporary drawer on route change.
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const logout = async () => {
    await api.logout();
    qc.clear();
    window.location.assign('/');
  };

  // ── keyboard shortcuts ─────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
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

  const drawerContent = (
    <>
      <Toolbar sx={{ px: 2.5 }}>
        <Box display="flex" alignItems="center" gap={1.25}>
          <Box
            sx={{
              width: 28,
              height: 28,
              borderRadius: 1.5,
              bgcolor: 'primary.main',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'primary.contrastText',
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            OT
          </Box>
          <Typography variant="subtitle1" fontWeight={700}>
            Options Trader
          </Typography>
        </Box>
      </Toolbar>
      <Divider />
      <List sx={{ px: 0.5, py: 1 }}>
        {NAV.map(({ to, label, shortcut, Icon }) => (
          <Tooltip
            key={to}
            title={`Shortcut: ${shortcut === 'n' ? 'n' : `g ${shortcut}`}`}
            placement="right"
            disableHoverListener={!isDesktop}
          >
            <ListItemButton component={NavLink} to={to}>
              <ListItemIcon sx={{ minWidth: 36, color: 'text.secondary' }}>
                <Icon fontSize="small" />
              </ListItemIcon>
              <ListItemText
                primary={label}
                slotProps={{ primary: { fontSize: 14, fontWeight: 500 } }}
              />
            </ListItemButton>
          </Tooltip>
        ))}
      </List>
      <Box flexGrow={1} />
      <Box sx={{ px: 2, py: 1.5, color: 'text.secondary' }}>
        <Typography variant="caption" sx={{ display: 'block' }}>
          Press <code>?</code> for shortcuts
        </Typography>
      </Box>
    </>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="fixed" sx={{ zIndex: (t) => t.zIndex.drawer + 1 }}>
        <Toolbar sx={{ gap: 1 }}>
          {!isDesktop && (
            <IconButton
              edge="start"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
              sx={{ mr: 0.5 }}
            >
              <MenuIcon />
            </IconButton>
          )}

          <Typography
            variant="h6"
            noWrap
            component="div"
            sx={{ fontSize: { xs: 16, sm: 18 }, fontWeight: 600 }}
          >
            Options Trader
          </Typography>

          {family.role === 'member' && isDesktop && (
            <Chip
              size="small"
              variant="outlined"
              label={`Viewing ${family.ownerName ?? family.ownerEmail ?? 'family'}'s account`}
              color="primary"
              sx={{ ml: 2 }}
            />
          )}

          <Box sx={{ flexGrow: 1 }} />

          {family.role === 'member' && !isDesktop && (
            <Chip
              size="small"
              variant="outlined"
              color="primary"
              label="member"
              sx={{ height: 22 }}
            />
          )}

          <Tooltip title={user.email}>
            <IconButton onClick={(e) => setAnchor(e.currentTarget)} size="small" sx={{ p: 0 }}>
              <Avatar
                src={user.picture}
                alt={user.name ?? user.email}
                sx={{ width: 32, height: 32, bgcolor: 'primary.dark', fontSize: 14 }}
              >
                {(user.name ?? user.email).slice(0, 1).toUpperCase()}
              </Avatar>
            </IconButton>
          </Tooltip>

          <Menu
            anchorEl={anchor}
            open={Boolean(anchor)}
            onClose={() => setAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          >
            <Box sx={{ px: 2, py: 1, minWidth: 200 }}>
              <Typography variant="body2" fontWeight={600}>
                {user.name ?? '—'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {user.email}
              </Typography>
              {family.role === 'member' && (
                <Typography
                  variant="caption"
                  color="primary.main"
                  sx={{ display: 'block', mt: 0.5 }}
                >
                  Family member
                </Typography>
              )}
            </Box>
            <Divider />
            <MenuItem
              onClick={() => {
                setAnchor(null);
                logout();
              }}
            >
              <LogoutIcon fontSize="small" sx={{ mr: 1 }} />
              Sign out
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      {/* Permanent drawer for desktop. */}
      {isDesktop && (
        <Drawer
          variant="permanent"
          sx={{
            width: DRAWER_WIDTH,
            flexShrink: 0,
            '& .MuiDrawer-paper': {
              width: DRAWER_WIDTH,
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
            },
          }}
        >
          {drawerContent}
        </Drawer>
      )}

      {/* Temporary drawer for mobile/tablet. */}
      {!isDesktop && (
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{
            '& .MuiDrawer-paper': {
              width: DRAWER_WIDTH,
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
            },
          }}
        >
          {drawerContent}
        </Drawer>
      )}

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          minWidth: 0,
          px: { xs: 2, sm: 3 },
          py: { xs: 2, sm: 3 },
        }}
      >
        <Toolbar />
        <Outlet />
      </Box>
    </Box>
  );
}
