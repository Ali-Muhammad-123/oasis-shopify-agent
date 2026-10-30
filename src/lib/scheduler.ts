import 'server-only';
import { eq } from 'drizzle-orm';
import { db, schema } from './db';
import { generateBrief } from './insights';
import { generateWeeklyReport } from './reports';

const TICK_MS = 5 * 60 * 1000;

/** Local calendar parts for a timezone: date, hour, ISO weekday (1 = Monday) and ISO week label. */
export function localParts(now: Date, tz: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday) + 1;
  // ISO week: the week's Thursday decides the year.
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return { date, hour: Number(parts.hour), weekday, isoWeek: `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}` };
}

export async function getSettings(shop: string) {
  const existing = await db.query.shopSettings.findFirst({ where: eq(schema.shopSettings.shop, shop) });
  if (existing) return existing;
  const [row] = await db.insert(schema.shopSettings).values({ shop }).onConflictDoNothing().returning();
  return row ?? (await db.query.shopSettings.findFirst({ where: eq(schema.shopSettings.shop, shop) }))!;
}

/** One pass over all shops: run any brief or report that is due in the shop's local time. */
export async function runDueJobs(now = new Date()) {
  const results: { shop: string; job: string; ok: boolean; error?: string }[] = [];
  for (const shop of await db.select().from(schema.shops)) {
    const settings = await getSettings(shop.domain);
    const local = localParts(now, shop.timezone ?? 'UTC');
    if (settings.briefEnabled && local.hour >= settings.briefHour && settings.lastBriefDate !== local.date) {
      // Mark first so a slow run or a crash can't trigger duplicates on the next tick.
      await db.update(schema.shopSettings).set({ lastBriefDate: local.date }).where(eq(schema.shopSettings.shop, shop.domain));
      try {
        await generateBrief(shop.domain, { kind: 'daily', trigger: 'schedule' });
        results.push({ shop: shop.domain, job: 'daily-brief', ok: true });
      } catch (err) {
        results.push({ shop: shop.domain, job: 'daily-brief', ok: false, error: (err as Error).message });
      }
    }
    if (settings.weeklyReportEnabled && local.weekday === settings.weeklyReportDay && local.hour >= settings.briefHour && settings.lastReportWeek !== local.isoWeek) {
      await db.update(schema.shopSettings).set({ lastReportWeek: local.isoWeek }).where(eq(schema.shopSettings.shop, shop.domain));
      try {
        await generateWeeklyReport(shop.domain, 'schedule');
        results.push({ shop: shop.domain, job: 'weekly-report', ok: true });
      } catch (err) {
        results.push({ shop: shop.domain, job: 'weekly-report', ok: false, error: (err as Error).message });
      }
    }
  }
  for (const r of results) console.log(`[scheduler] ${r.shop} ${r.job}: ${r.ok ? 'done' : `failed: ${r.error}`}`);
  return results;
}

/** Starts the in-process scheduler once per server process (survives dev hot reloads). */
export function startScheduler() {
  const g = globalThis as unknown as { __oasisScheduler?: boolean };
  if (g.__oasisScheduler) return;
  g.__oasisScheduler = true;
  const tick = () => runDueJobs().catch((err) => console.error('[scheduler] tick failed', err));
  setTimeout(tick, 30_000);
  setInterval(tick, TICK_MS).unref?.();
  console.log('[scheduler] started: checking for due briefs and reports every 5 minutes');
}
