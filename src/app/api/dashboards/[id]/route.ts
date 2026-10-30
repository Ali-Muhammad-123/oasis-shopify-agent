import { removeWidget } from '@/lib/dashboards';
import { getSessionShop } from '@/lib/session';

export async function DELETE(_req: Request, ctx: RouteContext<'/api/dashboards/[id]'>) {
  const shop = await getSessionShop();
  if (!shop) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: 'Not found' }, { status: 404 });
  await removeWidget(shop.domain, id);
  return new Response(null, { status: 204 });
}
