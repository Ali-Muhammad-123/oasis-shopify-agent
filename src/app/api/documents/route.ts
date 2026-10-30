import { listDocuments, saveUpload, UploadError } from '@/lib/documents/store';
import { getSessionShop } from '@/lib/session';

export async function GET() {
  const shop = await getSessionShop();
  if (!shop) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return Response.json(await listDocuments(shop.domain));
}

export async function POST(req: Request) {
  const shop = await getSessionShop();
  if (!shop) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const file = (await req.formData()).get('file');
  if (!(file instanceof File)) return Response.json({ error: 'Attach a file in the "file" field' }, { status: 400 });
  try {
    const doc = await saveUpload(shop.domain, file);
    return Response.json({ id: doc.id, filename: doc.filename }, { status: 201 });
  } catch (err) {
    if (err instanceof UploadError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
