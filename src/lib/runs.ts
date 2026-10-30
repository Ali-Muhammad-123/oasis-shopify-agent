import 'server-only';
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from './db';

export type RunRecord = typeof schema.agentRuns.$inferInsert;

export async function recordRun(run: RunRecord) {
  try {
    await db.insert(schema.agentRuns).values(run);
  } catch (err) {
    console.error('[runs] failed to record run', err);
  }
}

export function listRuns(shop: string, { conversationId, limit = 100 }: { conversationId?: string; limit?: number } = {}) {
  return db
    .select()
    .from(schema.agentRuns)
    .where(conversationId ? and(eq(schema.agentRuns.shop, shop), eq(schema.agentRuns.conversationId, conversationId)) : eq(schema.agentRuns.shop, shop))
    .orderBy(desc(schema.agentRuns.createdAt))
    .limit(limit);
}
