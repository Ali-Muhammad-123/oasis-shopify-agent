import { readReport } from '@/lib/reports';
import { getSessionShop } from '@/lib/session';

export async function GET(req: Request, ctx: RouteContext<'/api/reports/[id]'>) {
  const shop = await getSessionShop();
  if (!shop) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const report = await readReport(shop.domain, id);
  if (!report) return Response.json({ error: 'Not found' }, { status: 404 });
  const inline = new URL(req.url).searchParams.has('view');
  return new Response(new Uint8Array(report.bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="oasis-report-${report.row.periodEnd}.pdf"`,
    },
  });
}
