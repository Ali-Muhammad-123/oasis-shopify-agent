// Pins a starter set of live analytics widgets to the dashboard, laid out on the 12-column grid.
// Skips widgets whose title is already pinned. Usage: pnpm seed:dashboard [--shop store.myshopify.com]
import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { addWidget, parseWidget, runShopifyQL, type GridPlacement } from '../src/lib/dashboards';
import { db, schema } from '../src/lib/db';

const i = process.argv.indexOf('--shop');
const shop = i >= 0 ? process.argv[i + 1] : process.env.SHOPIFY_SHOP;
if (!shop) throw new Error('Pass --shop or set SHOPIFY_SHOP');
const row = await db.query.shops.findFirst({ where: eq(schema.shops.domain, shop) });
if (!row) throw new Error(`${shop} is not installed`);
const currency = row.currencyCode ?? 'USD';

type Def = { kind: 'chart' | 'kpis' | 'table'; spec: Record<string, unknown>; query: string; dataKey: 'data' | 'rows' | null; layout: GridPlacement };

const Q = {
  kpis: 'FROM sales SHOW total_sales, orders, average_order_value, net_sales SINCE -30d UNTIL today COMPARE TO previous_period',
  daily: 'FROM sales SHOW total_sales, orders TIMESERIES day SINCE -90d UNTIL today ORDER BY day ASC',
  productType: 'FROM sales SHOW total_sales GROUP BY product_type SINCE -90d UNTIL today ORDER BY total_sales DESC LIMIT 6',
  topProducts: 'FROM sales SHOW total_sales, orders GROUP BY product_title SINCE -90d UNTIL today ORDER BY total_sales DESC LIMIT 8',
  weekly: 'FROM sales SHOW gross_sales, net_sales TIMESERIES week SINCE -12w UNTIL today ORDER BY week ASC',
  region: 'FROM sales SHOW orders, total_sales GROUP BY billing_region SINCE -90d UNTIL today ORDER BY total_sales DESC LIMIT 10',
  customers: 'FROM sales SHOW total_sales, orders GROUP BY new_or_returning_customer SINCE -90d UNTIL today ORDER BY total_sales DESC',
};

const prev = (c: string) => `comparison_${c}__previous_period`;
const hint = 'vs previous 30 days';

const defs: Def[] = [
  {
    kind: 'kpis', query: Q.kpis, dataKey: null, layout: { x: 0, y: 0, w: 12, h: 4 },
    spec: {
      title: 'Last 30 days', currency, source: { shopifyql: Q.kpis },
      items: [
        { label: 'Revenue', value: 0, format: 'currency', column: 'total_sales', compareColumn: prev('total_sales'), hint },
        { label: 'Orders', value: 0, format: 'number', column: 'orders', compareColumn: prev('orders'), hint },
        { label: 'Average order value', value: 0, format: 'currency', column: 'average_order_value', compareColumn: prev('average_order_value'), hint },
        { label: 'Net sales', value: 0, format: 'currency', column: 'net_sales', compareColumn: prev('net_sales'), hint },
      ],
    },
  },
  {
    kind: 'chart', query: Q.daily, dataKey: 'data', layout: { x: 0, y: 4, w: 8, h: 10 },
    spec: { title: 'Daily sales · last 90 days', type: 'area', xKey: 'day', series: [{ key: 'total_sales', label: 'Total sales', format: 'currency' }], currency, source: { shopifyql: Q.daily } },
  },
  {
    kind: 'chart', query: Q.productType, dataKey: 'data', layout: { x: 8, y: 4, w: 4, h: 10 },
    spec: { title: 'Sales by product type · 90 days', type: 'pie', xKey: 'product_type', series: [{ key: 'total_sales', label: 'Total sales', format: 'currency' }], currency, source: { shopifyql: Q.productType } },
  },
  {
    kind: 'chart', query: Q.topProducts, dataKey: 'data', layout: { x: 0, y: 14, w: 6, h: 10 },
    spec: { title: 'Top products by sales · 90 days', type: 'bar', xKey: 'product_title', series: [{ key: 'total_sales', label: 'Total sales', format: 'currency' }], currency, source: { shopifyql: Q.topProducts } },
  },
  {
    kind: 'chart', query: Q.weekly, dataKey: 'data', layout: { x: 6, y: 14, w: 6, h: 10 },
    spec: {
      title: 'Weekly gross vs net sales', type: 'line', xKey: 'week', currency, source: { shopifyql: Q.weekly },
      series: [{ key: 'gross_sales', label: 'Gross sales', format: 'currency' }, { key: 'net_sales', label: 'Net sales', format: 'currency' }],
    },
  },
  {
    kind: 'table', query: Q.region, dataKey: 'rows', layout: { x: 0, y: 24, w: 6, h: 9 },
    spec: {
      title: 'Sales by region · 90 days', currency, source: { shopifyql: Q.region },
      columns: [
        { key: 'billing_region', label: 'Region', format: 'text' },
        { key: 'orders', label: 'Orders', format: 'number' },
        { key: 'total_sales', label: 'Total sales', format: 'currency' },
      ],
    },
  },
  {
    kind: 'chart', query: Q.customers, dataKey: 'data', layout: { x: 6, y: 24, w: 6, h: 9 },
    spec: { title: 'Revenue: new vs returning customers', type: 'bar', xKey: 'new_or_returning_customer', series: [{ key: 'total_sales', label: 'Total sales', format: 'currency' }], currency, source: { shopifyql: Q.customers } },
  },
];

for (const def of defs) {
  const title = String(def.spec.title);
  const exists = await db.query.dashboardWidgets.findFirst({
    where: and(eq(schema.dashboardWidgets.shop, shop), eq(schema.dashboardWidgets.title, title)),
  });
  if (exists) {
    console.log(`skip  ${title} (already pinned)`);
    continue;
  }
  // Store a snapshot so the tile has data even if a later refresh fails.
  const rows = await runShopifyQL(shop, def.query);
  const spec = def.dataKey ? { ...def.spec, [def.dataKey]: rows } : def.spec;
  const widget = parseWidget({ kind: def.kind, spec });
  if (!widget) throw new Error(`Widget "${title}" failed spec validation`);
  await addWidget(shop, widget, def.layout);
  console.log(`ok    ${title} (${rows.length} rows)`);
}
process.exit(0);
