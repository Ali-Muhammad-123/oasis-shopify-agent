import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { sign } from '@/lib/crypto';
import { env } from '@/lib/env';
import { buildAuthorizeUrl, normalizeShop, STATE_COOKIE } from '@/lib/shopify/oauth';

export async function GET(req: NextRequest) {
  const shop = normalizeShop(req.nextUrl.searchParams.get('shop') ?? env.SHOPIFY_SHOP);
  if (!shop) {
    return NextResponse.json({ error: 'Pass ?shop=<store>.myshopify.com' }, { status: 400 });
  }
  const { url, state } = buildAuthorizeUrl(shop);
  (await cookies()).set(STATE_COOKIE, sign(`${state}:${shop}`), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/api/auth',
    maxAge: 600,
  });
  return NextResponse.redirect(url);
}
