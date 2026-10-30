import 'server-only';
import { runShopifyQL } from './dashboards';
import type { CatalogVariant } from './documents/reconcile';
import { adminGraphql } from './shopify/admin';
import { CATALOG_VARIANTS } from './shopify/queries';
import { forecastRow, marginRow } from './analytics-math';

export type CatalogEntry = CatalogVariant & { productId: string; productStatus: string };

/** Every variant with price, stock, tracking and unit cost (paged, up to 2,500). */
export async function loadCatalog(shop: string): Promise<CatalogEntry[]> {
  type V = {
    id: string; title: string; sku: string | null; price: string; inventoryQuantity: number;
    inventoryItem: { tracked: boolean; unitCost: { amount: string } | null }; product: { id: string; title: string; status: string };
  };
  const out: CatalogEntry[] = [];
  let after: string | null = null;
  for (let page = 0; page < 10; page++) {
    const { data }: { data: { productVariants: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: V[] } } } =
      await adminGraphql(shop, CATALOG_VARIANTS, { first: 250, after });
    for (const v of data.productVariants.nodes) {
      out.push({
        id: v.id, sku: v.sku, title: v.title, productTitle: v.product.title, productId: v.product.id, productStatus: v.product.status,
        price: Number(v.price), inventoryQuantity: v.inventoryQuantity, tracked: v.inventoryItem.tracked,
        unitCost: v.inventoryItem.unitCost ? Number(v.inventoryItem.unitCost.amount) : null,
      });
    }
    if (!data.productVariants.pageInfo.hasNextPage) break;
    after = data.productVariants.pageInfo.endCursor;
  }
  return out;
}

const key = (product: string, variant: string | null) => `${product}||${!variant || variant === 'Default Title' ? '' : variant}`;

/** Net units sold per variant over the last `days`, keyed by product + variant title (ShopifyQL has no variant id). */
export async function unitsSold(shop: string, days: number) {
  const rows = await runShopifyQL(
    shop,
    `FROM sales SHOW net_items_sold, total_sales GROUP BY product_title, product_variant_title SINCE -${days}d UNTIL today LIMIT 1000`,
  );
  const map = new Map<string, { units: number; sales: number }>();
  for (const r of rows) {
    const k = key(String(r.product_title ?? ''), r.product_variant_title as string | null);
    const prev = map.get(k) ?? { units: 0, sales: 0 };
    map.set(k, { units: prev.units + Number(r.net_items_sold ?? 0), sales: prev.sales + Number(r.total_sales ?? 0) });
  }
  return { get: (v: CatalogEntry) => map.get(key(v.productTitle, v.title)) ?? { units: 0, sales: 0 } };
}

export async function marginReport(shop: string, { target, days = 90 }: { target: number; days?: number }) {
  const [catalog, sold] = await Promise.all([loadCatalog(shop), unitsSold(shop, days)]);
  const rows = catalog
    .filter((v) => v.productStatus === 'ACTIVE' && v.price > 0)
    .map((v) => ({ variantId: v.id, inventoryItemCost: v.unitCost, ...marginRow(v, sold.get(v), target) }));
  const withCost = rows.filter((r) => r.margin !== null);
  const revenue = withCost.reduce((s, r) => s + r.revenue, 0);
  const profit = withCost.reduce((s, r) => s + (r.grossProfit ?? 0), 0);
  return {
    target, days,
    summary: {
      variants: rows.length,
      missingCost: rows.length - withCost.length,
      belowTarget: withCost.filter((r) => r.belowTarget).length,
      blendedMargin: revenue > 0 ? profit / revenue : null,
      revenueWithCost: Math.round(revenue * 100) / 100,
      grossProfit: Math.round(profit * 100) / 100,
    },
    rows: rows.sort((a, b) => (a.margin ?? 99) - (b.margin ?? 99)),
  };
}

export async function inventoryForecast(
  shop: string,
  { days = 30, leadTimeDays = 14, coverDays = 30 }: { days?: number; leadTimeDays?: number; coverDays?: number } = {},
) {
  const [catalog, sold] = await Promise.all([loadCatalog(shop), unitsSold(shop, days)]);
  const rows = catalog
    .filter((v) => v.tracked && v.productStatus === 'ACTIVE')
    .map((v) => ({ variantId: v.id, sku: v.sku, unitCost: v.unitCost, ...forecastRow(v, sold.get(v).units, { days, leadTimeDays, coverDays }) }))
    .sort((a, b) => (a.daysOfStock ?? Infinity) - (b.daysOfStock ?? Infinity));
  return {
    params: { days, leadTimeDays, coverDays },
    summary: {
      variants: rows.length,
      stockouts: rows.filter((r) => r.status === 'out_of_stock').length,
      atRisk: rows.filter((r) => r.status === 'reorder_now').length,
      reorderUnits: rows.reduce((s, r) => s + r.reorderQty, 0),
    },
    rows,
  };
}
