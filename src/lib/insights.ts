import 'server-only';
import { generateText } from 'ai';
import { desc, eq } from 'drizzle-orm';
import { getModel } from './agent/model';
import { inventoryForecast, marginReport } from './analytics';
import { pctChange, zScore } from './analytics-math';
import { runShopifyQL } from './dashboards';
import { db, schema } from './db';
import type { Finding } from './db/schema';
import { listMemory, marginTargetFrom } from './memory';

const fmtPct = (x: number) => `${x >= 0 ? '+' : ''}${Math.round(x * 100)}%`;

type Metrics = {
  periodDays: number;
  sales: number; salesPrev: number; orders: number; ordersPrev: number;
  aov: number; aovPrev: number; returns: number; returnsPrev: number;
  yesterday: { sales: number; mean: number; z: number } | null;
  topProducts: { title: string; sales: number; change: number | null }[];
  currency: string;
};

/** Computes the numbers and rule-based findings behind a brief (no model involved). */
export async function computeFindings(shop: string, days: number) {
  const row = await db.query.shops.findFirst({ where: eq(schema.shops.domain, shop) });
  const currency = row?.currencyCode ?? 'USD';
  const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
  const target = marginTargetFrom(await listMemory(shop));

  const [kpi, daily, products, forecast, margins] = await Promise.all([
    runShopifyQL(shop, `FROM sales SHOW total_sales, orders, average_order_value, returns SINCE -${days}d UNTIL today COMPARE TO previous_period`),
    runShopifyQL(shop, 'FROM sales SHOW total_sales TIMESERIES day SINCE -29d UNTIL -1d ORDER BY day ASC'),
    runShopifyQL(shop, `FROM sales SHOW total_sales GROUP BY product_title SINCE -${days}d UNTIL today COMPARE TO previous_period ORDER BY total_sales DESC LIMIT 5`),
    inventoryForecast(shop, { days: 30 }),
    marginReport(shop, { target, days: 30 }),
  ]);

  const k = kpi[0] ?? {};
  const n = (key: string) => Number(k[key] ?? 0);
  const prev = (key: string) => Number(k[`comparison_${key}__previous_period`] ?? 0);
  const z = zScore(daily.map((d) => Number(d.total_sales ?? 0)));
  const metrics: Metrics = {
    periodDays: days, currency,
    sales: n('total_sales'), salesPrev: prev('total_sales'),
    orders: n('orders'), ordersPrev: prev('orders'),
    aov: n('average_order_value'), aovPrev: prev('average_order_value'),
    returns: Math.abs(n('returns')), returnsPrev: Math.abs(prev('returns')),
    yesterday: z ? { sales: z.latest, mean: Math.round(z.mean), z: Math.round(z.z * 10) / 10 } : null,
    topProducts: products.map((p) => ({
      title: String(p.product_title),
      sales: Number(p.total_sales ?? 0),
      change: pctChange(Number(p.total_sales ?? 0), Number(p.comparison_total_sales__previous_period ?? 0)),
    })),
  };

  const findings: Finding[] = [];
  const label = days === 7 ? 'week over week' : `vs the previous ${days} days`;
  const salesChange = pctChange(metrics.sales, metrics.salesPrev);
  if (salesChange !== null && Math.abs(salesChange) >= 0.2) {
    findings.push({
      severity: salesChange < 0 ? (salesChange <= -0.4 ? 'critical' : 'warning') : 'good',
      title: `Sales ${salesChange < 0 ? 'down' : 'up'} ${fmtPct(salesChange)} ${label}`,
      detail: `${money(metrics.sales)} from ${metrics.orders} orders, against ${money(metrics.salesPrev)} from ${metrics.ordersPrev} orders.`,
    });
  } else if (salesChange === null && metrics.sales > 0) {
    findings.push({ severity: 'info', title: `${money(metrics.sales)} in sales over the last ${days} days`, detail: 'No comparable sales in the previous period.' });
  }
  const aovChange = pctChange(metrics.aov, metrics.aovPrev);
  if (aovChange !== null && Math.abs(aovChange) >= 0.15) {
    findings.push({ severity: aovChange < 0 ? 'warning' : 'good', title: `Average order value ${fmtPct(aovChange)}`, detail: `${money(metrics.aov)} vs ${money(metrics.aovPrev)}.` });
  }
  const returnRate = metrics.sales > 0 ? metrics.returns / metrics.sales : 0;
  if (returnRate >= 0.03 && metrics.returns > metrics.returnsPrev * 1.5) {
    findings.push({ severity: 'warning', title: `Returns spike: ${money(metrics.returns)} (${(returnRate * 100).toFixed(1)}% of sales)`, detail: `Up from ${money(metrics.returnsPrev)} in the previous period.` });
  }
  if (metrics.yesterday && Math.abs(metrics.yesterday.z) >= 2) {
    const up = metrics.yesterday.z > 0;
    findings.push({
      severity: up ? 'good' : 'warning',
      title: `Unusual day: yesterday's sales were ${up ? 'well above' : 'well below'} normal`,
      detail: `${money(metrics.yesterday.sales)} vs a 4-week daily average of ${money(metrics.yesterday.mean)} (z = ${metrics.yesterday.z}).`,
    });
  }
  const out = forecast.rows.filter((r) => r.status === 'out_of_stock');
  const soon = forecast.rows.filter((r) => r.status === 'reorder_now');
  if (out.length) findings.push({ severity: 'critical', title: `${out.length} selling item${out.length > 1 ? 's are' : ' is'} out of stock`, detail: out.slice(0, 3).map((r) => r.name).join(', ') });
  if (soon.length) {
    findings.push({
      severity: 'warning', title: `${soon.length} item${soon.length > 1 ? 's' : ''} will run out within the supplier lead time`,
      detail: soon.slice(0, 3).map((r) => `${r.name} (${r.daysOfStock} days left, reorder ${r.reorderQty})`).join('; '),
    });
  }
  const lowMargin = margins.rows.filter((r) => r.belowTarget && r.unitsSold > 0).sort((a, b) => b.revenue - a.revenue);
  if (lowMargin.length) {
    findings.push({
      severity: 'warning', title: `${lowMargin.length} selling variant${lowMargin.length > 1 ? 's are' : ' is'} below the ${Math.round(target * 100)}% margin target`,
      detail: lowMargin.slice(0, 3).map((r) => `${r.name} at ${Math.round((r.margin ?? 0) * 100)}% (target price ${money(r.targetPrice ?? 0)})`).join('; '),
    });
  }
  if (margins.summary.missingCost) {
    findings.push({ severity: 'info', title: `${margins.summary.missingCost} variant${margins.summary.missingCost > 1 ? 's have' : ' has'} no unit cost`, detail: 'Margins and profit exclude them until a cost is set.' });
  }
  const order = { critical: 0, warning: 1, good: 2, info: 3 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return { metrics, findings, marginSummary: margins.summary, stock: forecast.summary };
}

function fallbackSummary(findings: Finding[]) {
  if (!findings.length) return 'All quiet: no notable changes, stock risks or margin issues today.';
  return findings.slice(0, 4).map((f) => `${f.title}.`).join(' ');
}

/** Builds a brief (computed findings + a short written summary) and stores it. */
export async function generateBrief(shop: string, { kind = 'daily', trigger = 'manual' }: { kind?: 'daily' | 'weekly'; trigger?: 'schedule' | 'manual' } = {}) {
  const days = 7;
  const computed = await computeFindings(shop, days);
  let summary = fallbackSummary(computed.findings);
  try {
    const { text } = await generateText({
      model: getModel(),
      instructions:
        'You write a short brief for a busy Shopify merchant: 3 to 5 plain sentences, most important first, specific numbers, ' +
        'and one concrete suggested action at the end. No headings, no bullet points, no greetings. Use only the data given.',
      prompt: JSON.stringify({ period: `last ${days} days vs previous ${days}`, findings: computed.findings, metrics: computed.metrics, margins: computed.marginSummary, stock: computed.stock }),
      maxRetries: 1,
    });
    if (text.trim()) summary = text.trim();
  } catch (err) {
    console.warn('[insights] summary model call failed; using rule-based summary', (err as Error).message);
  }
  const period = new Date().toISOString().slice(0, 10);
  const [row] = await db
    .insert(schema.insights)
    .values({ shop, kind, period, summary, findings: computed.findings, metrics: computed.metrics, trigger })
    .returning();
  return row;
}

export async function latestBrief(shop: string) {
  return (await db.query.insights.findFirst({ where: eq(schema.insights.shop, shop), orderBy: [desc(schema.insights.createdAt)] })) ?? null;
}
