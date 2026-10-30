import 'server-only';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db, schema } from './db';
import { chartSpec, kpiSpec, tableSpec, type KpiSpec, type WidgetSpec } from './genui/spec';
import { adminGraphql } from './shopify/admin';
import { SHOPIFYQL } from './shopify/queries';

export type GridPlacement = { x: number; y: number; w: number; h: number };

export function parseWidget(input: unknown): WidgetSpec | null {
  const w = input as { kind?: string; spec?: unknown };
  const schemaFor = { chart: chartSpec, kpis: kpiSpec, table: tableSpec }[w?.kind as WidgetSpec['kind']];
  const parsed = schemaFor?.safeParse(w.spec);
  return parsed?.success ? ({ kind: w.kind, spec: parsed.data } as WidgetSpec) : null;
}

export async function addWidget(shop: string, widget: WidgetSpec, layout: GridPlacement | null = null) {
  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${schema.dashboardWidgets.position}), -1) + 1` })
    .from(schema.dashboardWidgets)
    .where(eq(schema.dashboardWidgets.shop, shop));
  const title = widget.spec.title ?? 'KPIs';
  const source = 'source' in widget.spec && widget.spec.source ? { tool: 'runShopifyQL', input: widget.spec.source } : null;
  const [row] = await db
    .insert(schema.dashboardWidgets)
    .values({ shop, title, kind: widget.kind, spec: widget.spec, source, position: next, layout })
    .returning({ id: schema.dashboardWidgets.id });
  return row;
}

export function removeWidget(shop: string, id: string) {
  return db.delete(schema.dashboardWidgets).where(and(eq(schema.dashboardWidgets.id, id), eq(schema.dashboardWidgets.shop, shop)));
}

/** Saves grid placements after a drag or resize; ignores ids that aren't this shop's. */
export async function saveLayout(shop: string, items: (GridPlacement & { i: string })[]) {
  await db.transaction(async (tx) => {
    for (const { i, x, y, w, h } of items) {
      await tx
        .update(schema.dashboardWidgets)
        .set({ layout: { x, y, w, h } })
        .where(and(eq(schema.dashboardWidgets.id, i), eq(schema.dashboardWidgets.shop, shop)));
    }
  });
}

const NUMERIC_TYPES = /^(MONEY|INTEGER|FLOAT|NUMBER|PERCENT|DECIMAL)/i;

/** Runs ShopifyQL and returns rows keyed by column, with numeric columns as numbers (the API returns strings). */
export async function runShopifyQL(shop: string, query: string) {
  type Col = { name: string; dataType: string };
  const { data } = await adminGraphql<{
    shopifyqlQuery: { tableData: { columns: Col[]; rows: unknown[] } | null; parseErrors: unknown[] | null };
  }>(shop, SHOPIFYQL, { query });
  const res = data.shopifyqlQuery;
  if (res.parseErrors?.length) throw new Error(`ShopifyQL error: ${JSON.stringify(res.parseErrors)}`);
  const columns = res.tableData?.columns ?? [];
  const numeric = new Set(columns.filter((c) => NUMERIC_TYPES.test(c.dataType)).map((c) => c.name));
  return (res.tableData?.rows ?? []).map((r) => {
    const row = Array.isArray(r) ? Object.fromEntries(columns.map((c, i) => [c.name, r[i]])) : (r as Record<string, unknown>);
    return Object.fromEntries(
      Object.entries(row).map(([k, v]) => [k, numeric.has(k) && v !== null && v !== '' ? Number(v) : (v as string | null)]),
    );
  }) as Record<string, string | number | null>[];
}

export function refreshKpis(spec: KpiSpec, row: Record<string, string | number | null> | undefined): KpiSpec {
  if (!row) return spec;
  return {
    ...spec,
    items: spec.items.map((item) => {
      const value = item.column != null ? Number(row[item.column]) : NaN;
      const compare = item.compareColumn != null ? Number(row[item.compareColumn]) : NaN;
      return {
        ...item,
        value: Number.isFinite(value) ? value : item.value,
        delta: Number.isFinite(value) && Number.isFinite(compare) && compare !== 0 ? value / compare - 1 : item.delta,
      };
    }),
  };
}

export type DashboardItem = {
  id: string;
  widget: WidgetSpec;
  layout: GridPlacement | null;
  live: boolean;
  refreshError?: string;
};

/** Loads pinned widgets, re-running each ShopifyQL source so they reflect today's data. */
export async function loadDashboard(shop: string): Promise<DashboardItem[]> {
  const rows = await db
    .select()
    .from(schema.dashboardWidgets)
    .where(eq(schema.dashboardWidgets.shop, shop))
    .orderBy(asc(schema.dashboardWidgets.position));

  return Promise.all(
    rows.map(async (row): Promise<DashboardItem> => {
      const base = { id: row.id, layout: row.layout ?? null };
      const widget = parseWidget({ kind: row.kind, spec: row.spec });
      if (!widget) return { ...base, widget: { kind: 'kpis', spec: { items: [{ label: 'Invalid widget', value: 0, format: 'number' }] } }, live: false };
      const query = (row.source?.input as { shopifyql?: string } | undefined)?.shopifyql ?? ('source' in widget.spec ? widget.spec.source?.shopifyql : undefined);
      if (!query) return { ...base, widget, live: false };
      try {
        const fresh = await runShopifyQL(shop, query);
        if (widget.kind === 'kpis') return { ...base, widget: { kind: 'kpis', spec: refreshKpis(widget.spec, fresh[0]) }, live: true };
        if (widget.kind === 'chart') return { ...base, widget: { kind: 'chart', spec: { ...widget.spec, data: fresh } }, live: true };
        return { ...base, widget: { kind: 'table', spec: { ...widget.spec, rows: fresh } }, live: true };
      } catch (err) {
        return { ...base, widget, live: false, refreshError: (err as Error).message };
      }
    }),
  );
}
