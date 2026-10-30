import { z } from 'zod';
import { previewWrite } from '@/lib/agent/tools/write';
import { getSessionShop } from '@/lib/session';

const body = z.object({ tool: z.string(), input: z.unknown() });

/** Live before/after preview for a write the agent proposed; shown on the approval card. */
export async function POST(req: Request) {
  const shop = await getSessionShop();
  if (!shop) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = body.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: 'Bad request' }, { status: 400 });
  try {
    return Response.json(await previewWrite(shop.domain, parsed.data.tool, parsed.data.input));
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
