/**
 * Theme tuned for the trading book: cool slate-blue primary, soft
 * neutral background, slightly rounded corners, and component overrides
 * for the components we use most (Card, AppBar, Button, Drawer, Table).
 *
 * `responsiveFontSizes` scales h1–h6 down on small screens automatically
 * so headings don't dominate phones.
 */

import { createTheme, responsiveFontSizes } from '@mui/material/styles';

const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

let theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#2c5cdd', dark: '#1f47b8', light: '#5b82e8' },
    secondary: { main: '#475569' },
    success: { main: '#15803d', light: '#dcfce7' },
    warning: { main: '#c2410c', light: '#ffedd5' },
    error: { main: '#b91c1c', light: '#fee2e2' },
    info: { main: '#0369a1', light: '#e0f2fe' },
    background: { default: '#f6f7fb', paper: '#ffffff' },
    divider: 'rgba(15, 23, 42, 0.08)',
    text: { primary: '#0f172a', secondary: '#475569' },
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: FONT_STACK,
    h1: { fontWeight: 700 },
    h2: { fontWeight: 700 },
    h3: { fontWeight: 700 },
    h4: { fontWeight: 600, letterSpacing: '-0.01em' },
    h5: { fontWeight: 600, letterSpacing: '-0.01em' },
    h6: { fontWeight: 600 },
    subtitle1: { fontWeight: 500 },
    subtitle2: { fontWeight: 500 },
    button: { textTransform: 'none', fontWeight: 500 },
    overline: { fontWeight: 600, letterSpacing: '0.08em' },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { WebkitFontSmoothing: 'antialiased' },
      },
    },
    MuiAppBar: {
      defaultProps: { elevation: 0, color: 'inherit' },
      styleOverrides: {
        root: {
          backgroundColor: '#ffffff',
          color: '#0f172a',
          borderBottom: '1px solid rgba(15,23,42,0.08)',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: { borderRight: '1px solid rgba(15,23,42,0.06)' },
      },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          border: '1px solid rgba(15,23,42,0.06)',
          borderRadius: 12,
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none' },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: 8 },
        sizeLarge: { padding: '10px 20px' },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 500 },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          marginInline: 8,
          marginBlock: 2,
          '&.active': {
            backgroundColor: 'rgba(44,92,221,0.1)',
            color: '#1f47b8',
            '& .MuiListItemIcon-root': { color: '#1f47b8' },
          },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderBottom: '1px solid rgba(15,23,42,0.06)' },
      },
    },
    MuiTextField: {
      defaultProps: { variant: 'outlined' },
    },
    MuiAlert: {
      styleOverrides: { root: { borderRadius: 10 } },
    },
  },
});

theme = responsiveFontSizes(theme);

export { theme };
