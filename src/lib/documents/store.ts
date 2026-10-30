import 'server-only';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '../db';

const UPLOAD_ROOT = resolve(process.cwd(), '.data/uploads');
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const TYPES: Record<string, string> = {
  '.csv': 'text/csv',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  // Saved web pages (browser "Save Page As… HTML only") for sites that block automated fetching.
  '.html': 'text/html',
  '.htm': 'text/html',
};
export const ACCEPTED_EXTENSIONS = Object.keys(TYPES);

export class UploadError extends Error {}

export async function saveUpload(shop: string, file: File) {
  const ext = extname(file.name).toLowerCase();
  const mimeType = TYPES[ext];
  if (!mimeType) throw new UploadError(`Unsupported file type ${ext || '(none)'}; use ${ACCEPTED_EXTENSIONS.join(', ')}`);
  if (file.size > MAX_UPLOAD_BYTES) throw new UploadError('File is larger than 10 MB');
  if (file.size === 0) throw new UploadError('File is empty');

  // Files are stored under a generated name; the original name is metadata only.
  const dir = join(UPLOAD_ROOT, shop);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${randomUUID()}${ext}`);
  await writeFile(path, Buffer.from(await file.arrayBuffer()));

  const [row] = await db
    .insert(schema.documents)
    .values({ shop, filename: file.name.slice(0, 200), mimeType, size: file.size, path })
    .returning();
  return row;
}

export function listDocuments(shop: string) {
  return db
    .select({
      id: schema.documents.id, filename: schema.documents.filename, mimeType: schema.documents.mimeType,
      size: schema.documents.size, extracted: schema.documents.extracted, createdAt: schema.documents.createdAt,
    })
    .from(schema.documents)
    .where(eq(schema.documents.shop, shop))
    .orderBy(desc(schema.documents.createdAt));
}

export async function getDocument(shop: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return (await db.query.documents.findFirst({ where: and(eq(schema.documents.id, id), eq(schema.documents.shop, shop)) })) ?? null;
}

export async function readDocumentBytes(doc: { path: string }) {
  if (!resolve(doc.path).startsWith(UPLOAD_ROOT)) throw new Error('Invalid document path');
  return readFile(doc.path);
}

export async function saveExtraction(shop: string, id: string, extracted: unknown) {
  await db.update(schema.documents).set({ extracted }).where(and(eq(schema.documents.id, id), eq(schema.documents.shop, shop)));
}

export async function deleteDocument(shop: string, id: string) {
  const doc = await getDocument(shop, id);
  if (!doc) return false;
  await db.delete(schema.documents).where(eq(schema.documents.id, id));
  await unlink(doc.path).catch(() => undefined);
  return true;
}

/** Saves a file the app generated (e.g. a purchase order CSV) so it appears in Documents and can be downloaded. */
export async function saveGeneratedDocument(shop: string, filename: string, mimeType: string, content: string) {
  const ext = extname(filename).toLowerCase() || '.txt';
  const dir = join(UPLOAD_ROOT, shop);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${randomUUID()}${ext}`);
  const bytes = Buffer.from(content, 'utf8');
  await writeFile(path, bytes);
  const [row] = await db.insert(schema.documents).values({ shop, filename: filename.slice(0, 200), mimeType, size: bytes.length, path }).returning();
  return row;
}
