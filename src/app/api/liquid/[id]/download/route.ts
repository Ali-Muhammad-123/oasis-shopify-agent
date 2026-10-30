import { getDraft } from '@/lib/liquid/drafts';
import { getSessionShop } from '@/lib/session';

export async function GET(_req: Request, ctx: RouteContext<'/api/liquid/[id]/download'>) {
  const shop = await getSessionShop();
  if (!shop) return new Response('Unauthorized', { status: 401 });
  const { id } = await ctx.params;
  const draft = await getDraft(shop.domain, id);
  if (!draft) return new Response('Not found', { status: 404 });
  return new Response(draft.code, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="oasis-${draft.handle}.liquid"`,
    },
  });
}
