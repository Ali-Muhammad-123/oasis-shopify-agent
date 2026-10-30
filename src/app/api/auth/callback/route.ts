import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { encrypt, unsign } from '@/lib/crypto';
import { db, schema } from '@/lib/db';
import { env } from '@/lib/env';
import { setSessionShop } from '@/lib/session';
import { adminGraphql, forgetToken } from '@/lib/shopify/admin';
import { exchangeCodeForToken, normalizeShop, STATE_COOKIE, verifyCallbackHmac } from '@/lib/shopify/oauth';

const SHOP_INFO = `query ShopInfo { shop { name currencyCode ianaTimezone } }`;

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const shop = normalizeShop(params.get('shop'));
  const code = params.get('code');
  const jar = await cookies();
  const expected = unsign(jar.get(STATE_COOKIE)?.value);
  jar.delete({ name: STATE_COOKIE, path: '/api/auth' });

  if (!shop || !code || !verifyCallbackHmac(params)) {
    return NextResponse.json({ error: 'Invalid OAuth callback' }, { status: 400 });
  }
  if (expected !== `${params.get('state')}:${shop}`) {
    return NextResponse.json({ error: 'OAuth state mismatch; restart the install' }, { status: 403 });
  }

  const { access_token, scope } = await exchangeCodeForToken(shop, code);
  const { data } = await adminGraphql<{ shop: { name: string; currencyCode: string; ianaTimezone: string } }>(
    shop, SHOP_INFO, undefined, { accessToken: access_token },
  );

  const values = {
    accessToken: encrypt(access_token),
    scopes: scope,
    name: data.shop.name,
    currencyCode: data.shop.currencyCode,
    timezone: data.shop.ianaTimezone,
  };
  await db.insert(schema.shops).values({ domain: shop, ...values })
    .onConflictDoUpdate({ target: schema.shops.domain, set: values });
  forgetToken(shop);
  await setSessionShop(shop);

  return NextResponse.redirect(new URL('/chat', env.APP_URL));
}
