import 'server-only';
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from './db';

export function listConversations(shop: string, limit = 100) {
  return db
    .select({ id: schema.conversations.id, title: schema.conversations.title, updatedAt: schema.conversations.updatedAt })
    .from(schema.conversations)
    .where(eq(schema.conversations.shop, shop))
    .orderBy(desc(schema.conversations.updatedAt))
    .limit(limit);
}

export async function getConversation(shop: string, id: string) {
  return (
    (await db.query.conversations.findFirst({
      where: and(eq(schema.conversations.id, id), eq(schema.conversations.shop, shop)),
    })) ?? null
  );
}

/** Deletes a conversation if it belongs to the shop; returns whether anything was deleted. */
export async function deleteConversation(shop: string, id: string) {
  const rows = await db
    .delete(schema.conversations)
    .where(and(eq(schema.conversations.id, id), eq(schema.conversations.shop, shop)))
    .returning({ id: schema.conversations.id });
  return rows.length > 0;
}
