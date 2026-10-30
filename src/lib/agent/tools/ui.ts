import 'server-only';
import { tool } from 'ai';
import { refreshKpis, runShopifyQL } from '../../dashboards';
import { chartSpec, kpiSpec, tableSpec, type ChartSpec, type KpiSpec, type TableSpec } from '../../genui/spec';

// Generative UI tools: the client renders each card. When a card carries a ShopifyQL source, the server
// resolves it here (KPI values and deltas, or empty chart/table data) and returns the completed spec, so
// the card never shows placeholder numbers the model left for a later refresh.
export function createUiTools(shop: string) {
  async function resolve<T extends ChartSpec | KpiSpec | TableSpec>(spec: T, fill: (rows: Record<string, string | number | null>[]) => T) {
    const query = spec.source?.shopifyql;
    if (!query) return { rendered: true, spec };
    try {
      return { rendered: true, spec: fill(await runShopifyQL(shop, query)) };
    } catch (err) {
      return { rendered: true, spec, refreshError: (err as Error).message };
    }
  }

  return {
    renderChart: tool({
      description:
        'Show a chart in the chat. Use for trends over time (line/area), comparisons across categories (bar) or part-to-whole shares (pie: one series, <= 6 slices). ' +
        'Pass the data you already fetched; set `source.shopifyql` when it came from runShopifyQL.',
      inputSchema: chartSpec,
      execute: (spec) => resolve(spec, (rows) => (spec.data.length ? spec : { ...spec, data: rows })),
    }),
    renderKpis: tool({
      description:
        'Show a row of headline numbers (KPI tiles), e.g. revenue, orders, average order value, with optional deltas. ' +
        'Always put the real values in `value`; with a one-row ShopifyQL source and `column`s the server re-reads them.',
      inputSchema: kpiSpec,
      execute: async (spec) => {
        const result = await resolve(spec, (rows) => (spec.items.some((i) => i.column) ? refreshKpis(spec, rows[0]) : spec));
        // Guard against placeholder tiles: every value 0 with nothing to re-read them from.
        if (result.spec.items.every((i) => i.value === 0) && !spec.confirmedZero) {
          return {
            rendered: false,
            error: 'Every KPI value is 0. Call renderKpis again with the real numbers from your query results ' +
              '(or set confirmedZero: true if they truly are 0).',
          };
        }
        return result;
      },
    }),
    renderTable: tool({
      description: 'Show a table, e.g. a list of orders, customers or products. Include an adminUrl column and set linkKey to link rows.',
      inputSchema: tableSpec,
      execute: (spec) => resolve(spec, (rows) => (spec.rows.length ? spec : { ...spec, rows })),
    }),
  };
}
