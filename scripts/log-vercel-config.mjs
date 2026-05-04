#!/usr/bin/env node
// Print vercel.json's /api/* rewrite destination so the Vercel build
// log shows which backend the edge will route to. Read-only.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const config = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8'));
const apiRewrite = (config.rewrites ?? []).find((r) => r.source === '/api/:path*');
if (apiRewrite) {
  console.log(`[vercel] /api/* → ${apiRewrite.destination}`);
} else {
  console.warn('[vercel] no /api/* rewrite found in vercel.json');
}
