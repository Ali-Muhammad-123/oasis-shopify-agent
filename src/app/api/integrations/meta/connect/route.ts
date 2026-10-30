import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { sign } from '@/lib/crypto';
import { metaAppConfigured, metaAuthUrl } from '@/lib/meta';
import { getSessionShop } from '@/lib/session';

export async function GET() {
  const shop = await getSessionShop();
  if (!shop) return NextResponse.redirect(new URL('/', process.env.APP_URL));
  if (!metaAppConfigured()) return Response.json({ error: 'Set META_APP_ID and META_APP_SECRET to use Connect with Facebook' }, { status: 400 });
  const state = randomBytes(16).toString('hex');
  (await cookies()).set('oasis_meta_state', sign(`${state}:${shop.domain}`), {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/api/integrations/meta', maxAge: 600,
  });
  return NextResponse.redirect(metaAuthUrl(state));
}
