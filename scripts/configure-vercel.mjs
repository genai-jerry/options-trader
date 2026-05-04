#!/usr/bin/env node
/**
 * Substitute the BACKEND_ORIGIN env var into vercel.json's rewrite
 * destination at build time.
 *
 * Why a script:
 *   `vercel.json` rewrites take a literal URL — they do not interpolate
 *   env vars. To keep the Fly URL out of git, we ship vercel.json with a
 *   placeholder (https://YOUR-FLY-APP.fly.dev) and rewrite it on each
 *   build using the BACKEND_ORIGIN env var configured in the Vercel
 *   project's Settings → Environment Variables.
 *
 * Running locally:
 *   This script is invoked only by Vercel's buildCommand. Plain
 *   `npm run build:web` skips it, so your local vercel.json is never
 *   modified. Idempotent — re-running with the same value is a no-op.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PLACEHOLDER = 'https://YOUR-FLY-APP.fly.dev';
const VERCEL_JSON = resolve(process.cwd(), 'vercel.json');

const backend = (process.env.BACKEND_ORIGIN ?? '').trim().replace(/\/$/, '');
if (!backend) {
  console.error(
    '\n[configure-vercel] BACKEND_ORIGIN is not set.\n' +
      '   Add it under Vercel → Project Settings → Environment Variables.\n' +
      '   Example: BACKEND_ORIGIN=https://your-fly-app.fly.dev\n',
  );
  process.exit(1);
}
if (!/^https?:\/\//.test(backend)) {
  console.error(`[configure-vercel] BACKEND_ORIGIN must start with http(s)://. Got: ${backend}`);
  process.exit(1);
}

const config = JSON.parse(readFileSync(VERCEL_JSON, 'utf8'));
let touched = 0;
for (const rewrite of config.rewrites ?? []) {
  if (typeof rewrite.destination === 'string' && rewrite.destination.startsWith(PLACEHOLDER)) {
    rewrite.destination = rewrite.destination.replace(PLACEHOLDER, backend);
    touched += 1;
  }
}

writeFileSync(VERCEL_JSON, `${JSON.stringify(config, null, 2)}\n`);
console.log(
  touched
    ? `[configure-vercel] rewrites destination → ${backend} (${touched} rule${touched === 1 ? '' : 's'})`
    : '[configure-vercel] no placeholder found (already configured?)',
);
