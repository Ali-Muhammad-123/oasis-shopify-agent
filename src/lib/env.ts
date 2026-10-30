import 'server-only';
import { z } from 'zod';

const hexKey = z.string().regex(/^[0-9a-f]{64}$/i, 'must be 32 bytes of hex (openssl rand -hex 32)');

const schema = z.object({
  SHOPIFY_API_KEY: z.string().min(1),
  SHOPIFY_API_SECRET: z.string().min(1),
  SHOPIFY_SCOPES: z.string().min(1),
  SHOPIFY_API_VERSION: z.string().default('2027-01'),
  SHOPIFY_SHOP: z.string().optional(),
  APP_URL: z.url(),
  DATABASE_URL: z.string().min(1),
  ENCRYPTION_KEY: hexKey,
  SESSION_SECRET: hexKey,
  LLM_MODEL: z.string().default('openai:gpt-5.4-mini'),
  /** Used when LLM_MODEL is overloaded or slow to respond; empty disables fallback. */
  /** Meta app for the "Connect with Facebook" flow (optional; a pasted access token works without it). */
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  LLM_FALLBACK_MODEL: z.string().default('google:gemini-3-flash-preview'),
});

export const env = schema.parse(process.env);
