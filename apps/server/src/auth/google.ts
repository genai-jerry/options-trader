/**
 * Google OAuth 2.0 — code flow.
 *
 * 1. /api/auth/google/login → 302 to accounts.google.com with a state cookie.
 * 2. Google redirects back to GOOGLE_REDIRECT_URI with `code` and `state`.
 *    The callback verifies state, exchanges the code at /token, fetches the
 *    profile from /userinfo, finds-or-creates the user, creates a session
 *    cookie, and 302s back to APP_ORIGIN.
 *
 * No third-party OAuth library — direct fetch is straightforward and one
 * less thing to keep up to date. The id_token is cryptographically signed,
 * but since we receive it over HTTPS in response to an authenticated POST,
 * the TLS guarantee is sufficient and we skip JWT verification.
 */

import { env } from '../env.js';

const GOOGLE_AUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO = 'https://www.googleapis.com/oauth2/v3/userinfo';

const SCOPES = ['openid', 'email', 'profile'];

export function isGoogleConfigured(): boolean {
  return Boolean(
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI,
  );
}

export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES.join(' '),
    state,
    access_type: 'online',
    include_granted_scopes: 'true',
    prompt: 'select_account',
  });
  return `${GOOGLE_AUTH_BASE}?${params.toString()}`;
}

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  id_token?: string;
  scope?: string;
}

interface GoogleUserInfo {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
  given_name?: string;
  family_name?: string;
}

export async function exchangeCodeForUserInfo(code: string): Promise<GoogleUserInfo> {
  const tokenRes = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    }).toString(),
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text().catch(() => '');
    throw new Error(`Google token exchange failed (${tokenRes.status}): ${text.slice(0, 300)}`);
  }
  const tokens = (await tokenRes.json()) as GoogleTokenResponse;

  const userRes = await fetch(GOOGLE_USERINFO, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!userRes.ok) {
    const text = await userRes.text().catch(() => '');
    throw new Error(`Google userinfo failed (${userRes.status}): ${text.slice(0, 300)}`);
  }
  const info = (await userRes.json()) as GoogleUserInfo;

  if (!info.sub || !info.email) {
    throw new Error('Google userinfo missing sub/email.');
  }
  if (info.email_verified === false) {
    throw new Error('Google account email is not verified.');
  }
  return info;
}
