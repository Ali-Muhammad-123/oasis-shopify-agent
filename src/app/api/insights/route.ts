import { generateBrief, latestBrief } from '@/lib/insights';
import { getSessionShop } from '@/lib/session';

export const maxDuration = 120;

export async function GET() {
  const shop = await getSessionShop();
  if (!shop) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return Response.json(await latestBrief(shop.domain));
}

/** "Run now": builds a fresh brief. */
export async function POST() {
  const shop = await getSessionShop();
  if (!shop) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return Response.json(await generateBrief(shop.domain, { kind: 'daily', trigger: 'manual' }), { status: 201 });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
