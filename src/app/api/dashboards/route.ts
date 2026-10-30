import { z } from 'zod';
import { addWidget, loadDashboard, parseWidget, saveLayout } from '@/lib/dashboards';
import { getSessionShop } from '@/lib/session';

export async function GET() {
  const shop = await getSessionShop();
  if (!shop) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return Response.json(await loadDashboard(shop.domain));
}

export async function POST(req: Request) {
  const shop = await getSessionShop();
  if (!shop) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const widget = parseWidget(await req.json());
  if (!widget) return Response.json({ error: 'Invalid widget' }, { status: 400 });
  return Response.json(await addWidget(shop.domain, widget), { status: 201 });
}

const cell = z.number().int().min(0).max(1000);
const layoutBody = z.object({
  layout: z.array(z.object({ i: z.string().uuid(), x: cell, y: cell, w: cell.min(1).max(12), h: cell.min(1) })).max(200),
});

/** Saves the grid after the user drags or resizes tiles. */
export async function PATCH(req: Request) {
  const shop = await getSessionShop();
  if (!shop) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = layoutBody.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  await saveLayout(shop.domain, parsed.data.layout);
  return new Response(null, { status: 204 });
}
