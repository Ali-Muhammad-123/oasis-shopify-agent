import 'server-only';
import { and, eq } from 'drizzle-orm';
import { decrypt, encrypt } from './crypto';
import { db, schema } from './db';
import { env } from './env';
import { parseInsight, type MetaInsightRow } from './meta-parse';

export const META_VERSION = 'v26.0';
const GRAPH = `https://graph.facebook.com/${META_VERSION}`;

export class MetaError extends Error {}

export const metaAppConfigured = () => Boolean(env.META_APP_ID && env.META_APP_SECRET);
export const metaRedirectUri = () => new URL('/api/integrations/meta/callback', env.APP_URL).toString();

export function metaAuthUrl(state: string) {
  const url = new URL(`https://www.facebook.com/${META_VERSION}/dialog/oauth`);
  url.searchParams.set('client_id', env.META_APP_ID!);
  url.searchParams.set('redirect_uri', metaRedirectUri());
  url.searchParams.set('state', state);
  url.searchParams.set('scope', 'ads_read');
  return url.toString();
}

async function graph<T>(pathOrUrl: string, params: Record<string, string> = {}, token?: string): Promise<T> {
  const url = pathOrUrl.startsWith('https://') ? new URL(pathOrUrl) : new URL(`${GRAPH}${pathOrUrl}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (token && !url.searchParams.has('access_token')) url.searchParams.set('access_token', token);
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000), cache: 'no-store' });
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number } };
  if (!res.ok || body.error) {
    const msg = body.error?.message ?? `Meta API ${res.status}`;
    throw new MetaError(body.error?.code === 190 ? `Meta access token is invalid or expired; reconnect Meta Ads in Settings. (${msg})` : msg);
  }
  return body;
}

/** Follows `paging.next` up to `maxPages` and returns all `data` rows. */
async function graphAll<T>(path: string, params: Record<string, string>, token: string, maxPages = 10): Promise<T[]> {
  const rows: T[] = [];
  let page = await graph<{ data: T[]; paging?: { next?: string } }>(path, params, token);
  rows.push(...page.data);
  for (let i = 1; i < maxPages && page.paging?.next; i++) {
    page = await graph<{ data: T[]; paging?: { next?: string } }>(page.paging.next);
    rows.push(...page.data);
  }
  return rows;
}

/** Code -> short-lived token -> long-lived (~60 day) token. */
export async function exchangeCode(code: string) {
  const short = await graph<{ access_token: string }>('/oauth/access_token', {
    client_id: env.META_APP_ID!, client_secret: env.META_APP_SECRET!, redirect_uri: metaRedirectUri(), code,
  });
  return longLived(short.access_token);
}

/** Upgrades a token to long-lived when app credentials exist; otherwise returns it as-is. */
export async function longLived(token: string): Promise<{ accessToken: string; expiresAt: Date | null }> {
  if (!metaAppConfigured()) return { accessToken: token, expiresAt: null };
  const r = await graph<{ access_token: string; expires_in?: number }>('/oauth/access_token', {
    grant_type: 'fb_exchange_token', client_id: env.META_APP_ID!, client_secret: env.META_APP_SECRET!, fb_exchange_token: token,
  });
  return { accessToken: r.access_token, expiresAt: r.expires_in ? new Date(Date.now() + r.expires_in * 1000) : null };
}

export type AdAccount = { id: string; name: string; currency: string; account_status: number };

export function listAdAccounts(token: string) {
  return graphAll<AdAccount>('/me/adaccounts', { fields: 'id,name,currency,account_status', limit: '100' }, token, 3);
}

export async function fetchInsights(
  token: string,
  accountId: string,
  { since, until, level, daily }: { since: string; until: string; level: 'campaign' | 'account'; daily: boolean },
) {
  const rows = await graphAll<MetaInsightRow>(`/${accountId}/insights`, {
    level,
    fields: 'campaign_id,campaign_name,spend,impressions,clicks,actions,action_values,purchase_roas,date_start,date_stop',
    time_range: JSON.stringify({ since, until }),
    ...(daily ? { time_increment: '1' } : {}),
    limit: '500',
  }, token);
  return rows.map(parseInsight);
}

// ---- storage ---------------------------------------------------------------

export async function getMetaIntegration(shop: string) {
  const row = await db.query.integrations.findFirst({ where: and(eq(schema.integrations.shop, shop), eq(schema.integrations.provider, 'meta')) });
  return row ? { ...row, accessToken: decrypt(row.accessToken) } : null;
}

export async function saveMetaToken(shop: string, accessToken: string, expiresAt: Date | null) {
  const values = { accessToken: encrypt(accessToken), expiresAt, accountId: null, accountName: null, currency: null };
  await db.insert(schema.integrations).values({ shop, provider: 'meta', ...values })
    .onConflictDoUpdate({ target: [schema.integrations.shop, schema.integrations.provider], set: values });
}

export async function selectMetaAccount(shop: string, account: AdAccount) {
  await db.update(schema.integrations)
    .set({ accountId: account.id, accountName: account.name, currency: account.currency })
    .where(and(eq(schema.integrations.shop, shop), eq(schema.integrations.provider, 'meta')));
}

export async function removeMetaIntegration(shop: string) {
  await db.delete(schema.integrations).where(and(eq(schema.integrations.shop, shop), eq(schema.integrations.provider, 'meta')));
}

/** Token plus selected account, or a user-facing reason it isn't usable yet. */
export async function requireMetaAccount(shop: string) {
  const meta = await getMetaIntegration(shop);
  if (!meta) throw new MetaError('Meta Ads is not connected. Connect it under Settings → Integrations.');
  if (!meta.accountId) throw new MetaError('Meta Ads is connected but no ad account is selected. Choose one under Settings → Integrations.');
  return { token: meta.accessToken, accountId: meta.accountId, accountName: meta.accountName, currency: meta.currency };
}
