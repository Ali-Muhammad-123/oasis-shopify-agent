import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { eq } from 'drizzle-orm';
import { decrypt } from '../crypto';
import { db, schema } from '../db';
import { env } from '../env';

export type GraphqlError = { message: string; extensions?: { code?: string } & Record<string, unknown> };
export type QueryCost = {
  requestedQueryCost: number;
  actualQueryCost: number | null;
  throttleStatus: { maximumAvailable: number; currentlyAvailable: number; restoreRate: number };
};

export class ShopifyError extends Error {
  constructor(message: string, readonly errors: GraphqlError[] = [], readonly status?: number) {
    super(message);
  }
}

const tokenCache = new Map<string, string>();

/** Per-request tally of Shopify query cost (points), read by the agent run recorder. */
export const queryCost = new AsyncLocalStorage<{ points: number; calls: number }>();

async function getAccessToken(shop: string): Promise<string> {
  const cached = tokenCache.get(shop);
  if (cached) return cached;
  const row = await db.query.shops.findFirst({ where: eq(schema.shops.domain, shop) });
  if (!row) throw new ShopifyError(`Shop ${shop} is not installed`, [], 401);
  const token = decrypt(row.accessToken);
  tokenCache.set(shop, token);
  return token;
}

export function forgetToken(shop: string) {
  tokenCache.delete(shop);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs an Admin GraphQL operation for an installed shop. Retries on throttling,
 * waiting long enough for the bucket to refill to the requested cost.
 */
export async function adminGraphql<T = Record<string, unknown>>(
  shop: string,
  query: string,
  variables?: Record<string, unknown>,
  { accessToken, retries = 3 }: { accessToken?: string; retries?: number } = {},
): Promise<{ data: T; cost?: QueryCost }> {
  const token = accessToken ?? (await getAccessToken(shop));
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://${shop}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query, variables }),
      cache: 'no-store',
    });

    if (res.status === 429 && attempt < retries) {
      await sleep(Number(res.headers.get('Retry-After') ?? 1) * 1000);
      continue;
    }
    if (res.status === 401) forgetToken(shop);
    if (!res.ok) throw new ShopifyError(`Shopify Admin API ${res.status}: ${await res.text()}`, [], res.status);

    const body = (await res.json()) as { data?: T; errors?: GraphqlError[]; extensions?: { cost?: QueryCost } };
    const cost = body.extensions?.cost;
    const tally = queryCost.getStore();
    if (tally) {
      tally.calls += 1;
      tally.points += cost?.actualQueryCost ?? cost?.requestedQueryCost ?? 0;
    }
    const throttled = body.errors?.some((e) => e.extensions?.code === 'THROTTLED');
    if (throttled && attempt < retries && cost) {
      const { currentlyAvailable, restoreRate } = cost.throttleStatus;
      const deficit = Math.max(cost.requestedQueryCost - currentlyAvailable, restoreRate);
      await sleep(Math.ceil((deficit / restoreRate) * 1000));
      continue;
    }
    if (body.errors?.length) {
      throw new ShopifyError(body.errors.map((e) => e.message).join('; '), body.errors);
    }
    return { data: body.data as T, cost };
  }
}

/** Joins a mutation payload's `userErrors` into a message, or null when there are none. */
export function userErrorMessage(payload: { userErrors?: { field?: string[] | null; message: string }[] } | null) {
  const errors = payload?.userErrors ?? [];
  return errors.length ? errors.map((e) => (e.field?.length ? `${e.field.join('.')}: ` : '') + e.message).join('; ') : null;
}

/** The Shopify Admin URL for a resource GID, e.g. gid://shopify/Order/1 -> /store/<handle>/orders/1. */
export function adminUrl(shop: string, gid: string): string {
  const [, type, id] = gid.match(/gid:\/\/shopify\/(\w+)\/(\d+)/) ?? [];
  const path: Record<string, string> = {
    Order: 'orders', Product: 'products', Customer: 'customers', DraftOrder: 'draft_orders',
    DiscountCodeNode: 'discounts', DiscountNode: 'discounts', Page: 'content/pages',
  };
  const handle = shop.replace('.myshopify.com', '');
  return path[type] ? `https://admin.shopify.com/store/${handle}/${path[type]}/${id}` : `https://admin.shopify.com/store/${handle}`;
}
