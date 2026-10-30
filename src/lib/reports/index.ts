import 'server-only';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { renderToBuffer } from '@react-pdf/renderer';
import { and, desc, eq } from 'drizzle-orm';
import { createElement } from 'react';
import { inventoryForecast } from '../analytics';
import { runShopifyQL } from '../dashboards';
import { db, schema } from '../db';
import { generateBrief } from '../insights';
import { ReportDocument, type ReportData } from './document';

const REPORT_ROOT = resolve(process.cwd(), '.data/reports');

const ymd = (d: Date, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, dateStyle: 'short' }).format(d);

/** Builds the weekly PDF (last 7 days vs the 7 before), stores it, and returns the report row. */
export async function generateWeeklyReport(shop: string, trigger: 'schedule' | 'manual' = 'manual') {
  const shopRow = await db.query.shops.findFirst({ where: eq(schema.shops.domain, shop) });
  if (!shopRow) throw new Error(`${shop} is not installed`);
  const tz = shopRow.timezone ?? 'UTC';
  const currency = shopRow.currencyCode ?? 'USD';

  const [brief, daily, forecast] = await Promise.all([
    generateBrief(shop, { kind: 'weekly', trigger }),
    runShopifyQL(shop, 'FROM sales SHOW total_sales TIMESERIES day SINCE -13d UNTIL today ORDER BY day ASC'),
    inventoryForecast(shop, { days: 30 }),
  ]);
  const m = brief.metrics as {
    sales: number; salesPrev: number; orders: number; ordersPrev: number; aov: number; aovPrev: number; returns: number; returnsPrev: number;
    topProducts: { title: string; sales: number; change: number | null }[];
  };
  const end = new Date();
  const start = new Date(end.getTime() - 6 * 86_400_000);
  const data: ReportData = {
    shopName: shopRow.name ?? shop,
    currency,
    periodStart: ymd(start, tz),
    periodEnd: ymd(end, tz),
    summary: brief.summary,
    kpis: [
      { label: 'Total sales', value: m.sales, previous: m.salesPrev, format: 'currency' },
      { label: 'Orders', value: m.orders, previous: m.ordersPrev, format: 'number' },
      { label: 'Average order value', value: m.aov, previous: m.aovPrev, format: 'currency' },
      { label: 'Returns', value: m.returns, previous: m.returnsPrev, format: 'currency' },
    ],
    daily: daily.map((d) => ({ day: String(d.day), sales: Number(d.total_sales ?? 0) })),
    topProducts: m.topProducts,
    stock: forecast.rows.filter((r) => r.status !== 'ok' && r.status !== 'no_sales').slice(0, 8),
    findings: brief.findings,
    generatedAt: new Intl.DateTimeFormat('en-US', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }).format(end),
  };

  const pdf = await renderToBuffer(createElement(ReportDocument, { data }) as Parameters<typeof renderToBuffer>[0]);
  const dir = join(REPORT_ROOT, shop);
  await mkdir(dir, { recursive: true });
  const [row] = await db
    .insert(schema.reports)
    .values({ shop, title: `Weekly report ${data.periodStart} to ${data.periodEnd}`, periodStart: data.periodStart, periodEnd: data.periodEnd, path: '', size: pdf.length, trigger })
    .returning();
  const path = join(dir, `${row.id}.pdf`);
  await writeFile(path, pdf);
  await db.update(schema.reports).set({ path }).where(eq(schema.reports.id, row.id));
  return { ...row, path };
}

export function listReports(shop: string) {
  return db.select().from(schema.reports).where(eq(schema.reports.shop, shop)).orderBy(desc(schema.reports.createdAt)).limit(50);
}

export async function readReport(shop: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const row = await db.query.reports.findFirst({ where: and(eq(schema.reports.id, id), eq(schema.reports.shop, shop)) });
  if (!row || !resolve(row.path).startsWith(REPORT_ROOT)) return null;
  return { row, bytes: await readFile(row.path) };
}
