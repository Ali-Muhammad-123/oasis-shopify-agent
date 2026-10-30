import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { unsign } from '@/lib/crypto';
import { env } from '@/lib/env';
import { exchangeCode, listAdAccounts, saveMetaToken, selectMetaAccount } from '@/lib/meta';
import { getSessionShop } from '@/lib/session';

export async function GET(req: NextRequest) {
  const settings = new URL('/settings', env.APP_URL);
  const shop = await getSessionShop();
  if (!shop) return NextResponse.redirect(new URL('/', env.APP_URL));
  const params = req.nextUrl.searchParams;
  const jar = await cookies();
  const expected = unsign(jar.get('oasis_meta_state')?.value);
  jar.delete({ name: 'oasis_meta_state', path: '/api/integrations/meta' });

  if (params.get('error')) {
    settings.searchParams.set('meta', `error:${params.get('error_description') ?? params.get('error')}`);
    return NextResponse.redirect(settings);
  }
  if (!params.get('code') || expected !== `${params.get('state')}:${shop.domain}`) {
    settings.searchParams.set('meta', 'error:Login could not be verified, try again');
    return NextResponse.redirect(settings);
  }
  try {
    const { accessToken, expiresAt } = await exchangeCode(params.get('code')!);
    await saveMetaToken(shop.domain, accessToken, expiresAt);
    const accounts = await listAdAccounts(accessToken);
    if (accounts.length === 1) await selectMetaAccount(shop.domain, accounts[0]);
    settings.searchParams.set('meta', 'connected');
  } catch (err) {
    settings.searchParams.set('meta', `error:${(err as Error).message}`);
  }
  return NextResponse.redirect(settings);
}
