import { undoAction } from '@/lib/agent/tools/write';
import { getSessionShop } from '@/lib/session';

/** Reverses a logged agent change. The click on the confirm button is the user's approval. */
export async function POST(_req: Request, ctx: RouteContext<'/api/actions/[id]/undo'>) {
  const shop = await getSessionShop();
  if (!shop) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const result = await undoAction(shop.domain, id);
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
