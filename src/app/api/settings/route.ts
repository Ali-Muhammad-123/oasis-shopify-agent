import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@/lib/db';
import { getSettings } from '@/lib/scheduler';
import { getSessionShop } from '@/lib/session';

export async function GET() {
  const shop = await getSessionShop();
  if (!shop) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return Response.json(await getSettings(shop.domain));
}

const patch = z.object({
  briefEnabled: z.boolean().optional(),
  briefHour: z.number().int().min(0).max(23).optional(),
  weeklyReportEnabled: z.boolean().optional(),
  weeklyReportDay: z.number().int().min(1).max(7).optional(),
});

export async function PATCH(req: Request) {
  const shop = await getSessionShop();
  if (!shop) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = patch.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  await getSettings(shop.domain);
  const [row] = await db.update(schema.shopSettings).set(parsed.data).where(eq(schema.shopSettings.shop, shop.domain)).returning();
  return Response.json(row);
}
