import { z } from 'zod';
import { getMetaIntegration, listAdAccounts, longLived, MetaError, metaAppConfigured, removeMetaIntegration, saveMetaToken, selectMetaAccount } from '@/lib/meta';
import { getSessionShop } from '@/lib/session';

/** Connection status plus the ad accounts the token can see. */
export async function GET() {
  const shop = await getSessionShop();
  if (!shop) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const meta = await getMetaIntegration(shop.domain);
  if (!meta) return Response.json({ connected: false, appConfigured: metaAppConfigured() });
  try {
    const accounts = await listAdAccounts(meta.accessToken);
    return Response.json({
      connected: true, appConfigured: metaAppConfigured(), accountId: meta.accountId, accountName: meta.accountName, currency: meta.currency,
      expiresAt: meta.expiresAt, accounts: accounts.map(({ id, name, currency, account_status }) => ({ id, name, currency, active: account_status === 1 })),
    });
  } catch (err) {
    return Response.json({ connected: true, appConfigured: metaAppConfigured(), accountId: meta.accountId, accountName: meta.accountName, error: (err as Error).message });
  }
}

/** Connect by pasting a user access token with ads_read (upgraded to long-lived when app credentials exist). */
export async function POST(req: Request) {
  const shop = await getSessionShop();
  if (!shop) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = z.object({ accessToken: z.string().min(20).max(1000) }).safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: 'Paste a valid access token' }, { status: 400 });
  try {
    const { accessToken, expiresAt } = await longLived(parsed.data.accessToken.trim());
    const accounts = await listAdAccounts(accessToken);
    await saveMetaToken(shop.domain, accessToken, expiresAt);
    if (accounts.length === 1) await selectMetaAccount(shop.domain, accounts[0]);
    return Response.json({ connected: true, accounts: accounts.length });
  } catch (err) {
    return Response.json({ error: err instanceof MetaError ? err.message : 'Could not verify the token' }, { status: 400 });
  }
}

/** Choose which ad account to analyse. */
export async function PATCH(req: Request) {
  const shop = await getSessionShop();
  if (!shop) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = z.object({ accountId: z.string().regex(/^act_\d+$/) }).safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: 'Invalid ad account id' }, { status: 400 });
  const meta = await getMetaIntegration(shop.domain);
  if (!meta) return Response.json({ error: 'Meta Ads is not connected' }, { status: 400 });
  const account = (await listAdAccounts(meta.accessToken)).find((a) => a.id === parsed.data.accountId);
  if (!account) return Response.json({ error: 'That ad account is not available to this token' }, { status: 404 });
  await selectMetaAccount(shop.domain, account);
  return Response.json({ accountId: account.id, accountName: account.name });
}

export async function DELETE() {
  const shop = await getSessionShop();
  if (!shop) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await removeMetaIntegration(shop.domain);
  return new Response(null, { status: 204 });
}
