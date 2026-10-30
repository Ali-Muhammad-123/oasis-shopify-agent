import { generateWeeklyReport, listReports } from '@/lib/reports';
import { getSessionShop } from '@/lib/session';

export const maxDuration = 300;

export async function GET() {
  const shop = await getSessionShop();
  if (!shop) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return Response.json(await listReports(shop.domain));
}

/** "Generate now": builds this week's PDF report. */
export async function POST() {
  const shop = await getSessionShop();
  if (!shop) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const r = await generateWeeklyReport(shop.domain, 'manual');
    return Response.json({ id: r.id, title: r.title, size: r.size }, { status: 201 });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
