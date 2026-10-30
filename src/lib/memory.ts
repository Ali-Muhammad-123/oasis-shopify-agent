import 'server-only';
import { and, asc, eq } from 'drizzle-orm';
import { db, schema } from './db';

export const MAX_FACTS = 50;

export function listMemory(shop: string) {
  return db.select().from(schema.storeMemory).where(eq(schema.storeMemory.shop, shop)).orderBy(asc(schema.storeMemory.createdAt));
}

export async function addMemory(shop: string, fact: string) {
  const text = fact.trim().replace(/\s+/g, ' ').slice(0, 500);
  if (!text) throw new Error('Nothing to remember');
  const existing = await listMemory(shop);
  if (existing.length >= MAX_FACTS) throw new Error(`Memory is full (${MAX_FACTS} facts); remove one first`);
  const dupe = existing.find((m) => m.fact.toLowerCase() === text.toLowerCase());
  if (dupe) return dupe;
  const [row] = await db.insert(schema.storeMemory).values({ shop, fact: text }).returning();
  return row;
}

export async function removeMemory(shop: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  const rows = await db
    .delete(schema.storeMemory)
    .where(and(eq(schema.storeMemory.id, id), eq(schema.storeMemory.shop, shop)))
    .returning({ id: schema.storeMemory.id });
  return rows.length > 0;
}

/** Reads a margin target like "margin target 40%" from memory (newest fact wins); defaults to 40%. */
export function marginTargetFrom(facts: { fact: string }[], fallback = 0.4) {
  for (const { fact } of [...facts].reverse()) {
    const m = fact.match(/margin[^0-9%]{0,30}(\d{1,2}(?:\.\d+)?)\s*%/i);
    if (m) return Number(m[1]) / 100;
  }
  return fallback;
}
