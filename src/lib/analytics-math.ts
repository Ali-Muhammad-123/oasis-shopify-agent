// Pure calculations for margins and stock forecasts (unit-tested; no I/O).

type Variant = { title: string; productTitle: string; price: number; unitCost: number | null; inventoryQuantity: number };

export const variantName = (v: { title: string; productTitle: string }) =>
  v.title === 'Default Title' ? v.productTitle : `${v.productTitle} / ${v.title}`;

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** Gross margin for one variant at its current price, plus profit on what sold in the window. */
export function marginRow(v: Variant, sold: { units: number; sales: number }, target: number) {
  const margin = v.unitCost != null && v.price > 0 ? (v.price - v.unitCost) / v.price : null;
  const revenue = round(sold.sales);
  return {
    name: variantName(v),
    price: v.price,
    unitCost: v.unitCost,
    margin: margin === null ? null : round(margin, 4),
    unitsSold: sold.units,
    revenue,
    grossProfit: v.unitCost == null ? null : round(sold.sales - v.unitCost * sold.units),
    belowTarget: margin !== null && margin < target,
    /** Price that would hit the target margin at the current cost. */
    targetPrice: v.unitCost == null ? null : round(v.unitCost / (1 - target)),
  };
}

export type StockStatus = 'out_of_stock' | 'reorder_now' | 'reorder_soon' | 'ok' | 'no_sales';

/**
 * Days of stock = available / daily velocity. Reorder when stock won't outlast the supplier lead time;
 * order enough to cover lead time plus `coverDays` of demand.
 */
export function forecastRow(
  v: Variant,
  unitsSoldInWindow: number,
  { days, leadTimeDays, coverDays }: { days: number; leadTimeDays: number; coverDays: number },
  today = new Date(),
) {
  const available = Math.max(0, v.inventoryQuantity);
  const velocity = Math.max(0, unitsSoldInWindow) / days;
  const daysOfStock = velocity > 0 ? available / velocity : null;
  const reorderQty = velocity > 0 ? Math.max(0, Math.ceil(velocity * (leadTimeDays + coverDays) - available)) : 0;
  const status: StockStatus =
    available === 0 && velocity > 0 ? 'out_of_stock'
    : daysOfStock === null ? 'no_sales'
    : daysOfStock <= leadTimeDays ? 'reorder_now'
    : daysOfStock <= leadTimeDays + 7 ? 'reorder_soon'
    : 'ok';
  const reorderBy = daysOfStock === null ? null : new Date(today.getTime() + Math.max(0, daysOfStock - leadTimeDays) * 86_400_000);
  return {
    name: variantName(v),
    available,
    unitsSold: unitsSoldInWindow,
    dailyVelocity: round(velocity, 3),
    daysOfStock: daysOfStock === null ? null : round(daysOfStock, 1),
    reorderQty,
    reorderBy: reorderBy ? reorderBy.toISOString().slice(0, 10) : null,
    status,
  };
}

/** Mean and z-score of the latest value against the earlier values (for anomaly flags). */
export function zScore(series: number[]) {
  if (series.length < 8) return null;
  const history = series.slice(0, -1);
  const latest = series[series.length - 1];
  const mean = history.reduce((s, x) => s + x, 0) / history.length;
  const sd = Math.sqrt(history.reduce((s, x) => s + (x - mean) ** 2, 0) / history.length);
  return { latest, mean, sd, z: sd > 0 ? (latest - mean) / sd : 0 };
}

export const pctChange = (current: number, previous: number) => (previous > 0 ? current / previous - 1 : null);
