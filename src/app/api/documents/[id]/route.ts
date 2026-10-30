import { deleteDocument, getDocument, readDocumentBytes } from '@/lib/documents/store';
import { getSessionShop } from '@/lib/session';

export async function GET(_req: Request, ctx: RouteContext<'/api/documents/[id]'>) {
  const shop = await getSessionShop();
  if (!shop) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const doc = await getDocument(shop.domain, id);
  if (!doc) return Response.json({ error: 'Not found' }, { status: 404 });
  const bytes = await readDocumentBytes(doc);
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': doc.mimeType,
      'Content-Disposition': `attachment; filename="${doc.filename.replace(/[^\w.\- ]/g, '_')}"`,
    },
  });
}

export async function DELETE(_req: Request, ctx: RouteContext<'/api/documents/[id]'>) {
  const shop = await getSessionShop();
  if (!shop) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  return (await deleteDocument(shop.domain, id)) ? new Response(null, { status: 204 }) : Response.json({ error: 'Not found' }, { status: 404 });
}
