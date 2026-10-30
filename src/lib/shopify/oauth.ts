import 'server-only';
import { createHmac, randomBytes } from 'node:crypto';
import { safeEqual } from '../crypto';
import { env } from '../env';

export const STATE_COOKIE = 'oasis_oauth_state';

const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export function normalizeShop(input: string | null | undefined): string | null {
  if (!input) return null;
  const shop = input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return SHOP_RE.test(shop) ? shop : null;
}

export const redirectUri = () => new URL('/api/auth/callback', env.APP_URL).toString();

/** Authorization-code grant without `grant_options[]=per-user`, so Shopify issues an offline token. */
export function buildAuthorizeUrl(shop: string) {
  const state = randomBytes(16).toString('hex');
  const url = new URL(`https://${shop}/admin/oauth/authorize`);
  url.searchParams.set('client_id', env.SHOPIFY_API_KEY);
  url.searchParams.set('scope', env.SHOPIFY_SCOPES);
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('state', state);
  return { url: url.toString(), state };
}

/** Verifies the `hmac` Shopify appends to OAuth redirects. */
export function verifyCallbackHmac(params: URLSearchParams): boolean {
  const hmac = params.get('hmac');
  if (!hmac) return false;
  const message = [...params.entries()]
    .filter(([k]) => k !== 'hmac' && k !== 'signature')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const digest = createHmac('sha256', env.SHOPIFY_API_SECRET).update(message).digest('hex');
  return safeEqual(digest, hmac);
}

export async function exchangeCodeForToken(shop: string, code: string) {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: env.SHOPIFY_API_KEY, client_secret: env.SHOPIFY_API_SECRET, code }),
  });
  if (!res.ok) throw new Error(`Token exchange failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as { access_token: string; scope: string };
}
