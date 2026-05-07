import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DB_PATH: z.string().min(1).default('./data/options-trader.sqlite'),
  KITE_API_KEY: z.string().optional().default(''),
  KITE_API_SECRET: z.string().optional().default(''),
  ANTHROPIC_API_KEY: z.string().optional().default(''),
  AI_PROVIDER: z.enum(['anthropic', 'openai']).default('anthropic'),
  AI_MODEL: z.string().default('claude-sonnet-4-6'),
  /** Absolute path to the built web app to serve at /. Empty = API only. */
  WEB_STATIC_DIR: z.string().optional().default(''),
  /** Public origin the browser hits — used to build the OAuth redirect URI. */
  APP_ORIGIN: z.string().optional().default('http://localhost:5173'),
  /** Google OAuth — required to enable login. */
  GOOGLE_CLIENT_ID: z.string().optional().default(''),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(''),
  /** Where Google redirects after login. Must match what's registered in the Google console. */
  GOOGLE_REDIRECT_URI: z.string().optional().default(''),
  /** Daily Zerodha trade sync schedule (IST). Default: 18:00 every day. */
  ZERODHA_SYNC_CRON: z.string().default('0 18 * * *'),
  /** Set to 'false' to disable the scheduled sync (manual /trades/sync still works). */
  ZERODHA_SYNC_ENABLED: z
    .preprocess(
      (v) => (typeof v === 'string' ? v.toLowerCase() !== 'false' : true),
      z.boolean(),
    )
    .default(true),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
