import { deleteConversation } from '@/lib/conversations';
import { getSessionShop } from '@/lib/session';

export async function DELETE(_req: Request, ctx: RouteContext<'/api/conversations/[id]'>) {
  const shop = await getSessionShop();
  if (!shop) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  return (await deleteConversation(shop.domain, id)) ? new Response(null, { status: 204 }) : Response.json({ error: 'Not found' }, { status: 404 });
}
