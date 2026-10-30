import { z } from 'zod';
import { addMemory, listMemory } from '@/lib/memory';
import { getSessionShop } from '@/lib/session';

export async function GET() {
  const shop = await getSessionShop();
  if (!shop) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return Response.json(await listMemory(shop.domain));
}

export async function POST(req: Request) {
  const shop = await getSessionShop();
  if (!shop) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = z.object({ fact: z.string().min(3).max(500) }).safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: 'Write a short preference (3-500 characters)' }, { status: 400 });
  try {
    return Response.json(await addMemory(shop.domain, parsed.data.fact), { status: 201 });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
