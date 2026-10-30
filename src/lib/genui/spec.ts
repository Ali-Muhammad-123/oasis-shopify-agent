import { z } from 'zod';

export const formatSchema = z.enum(['number', 'currency', 'percent', 'text', 'date']);
export type Format = z.infer<typeof formatSchema>;

const cell = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const row = z.record(z.string(), cell);

/** A ShopifyQL query the data came from; pinned widgets re-run it to stay live. */
const source = z
  .object({ shopifyql: z.string() })
  .optional()
  .describe('Set when data came from runShopifyQL: the exact query, so a pinned copy can refresh itself');

export const chartSpec = z.object({
  title: z.string(),
  type: z.enum(['line', 'bar', 'area', 'pie']),
  data: z.array(row).max(500).describe('Rows; each has the xKey field plus one numeric field per series'),
  xKey: z.string().describe('Field for the x axis (or slice label for pie)'),
  series: z
    .array(z.object({ key: z.string(), label: z.string().optional(), format: formatSchema.default('number') }))
    .min(1)
    .max(6),
  currency: z.string().optional().describe('ISO currency code for currency-formatted series'),
  source,
}).refine((c) => c.type !== 'pie' || (c.data.length <= 6 && c.series.length === 1), {
  message: 'Pie charts take one series and at most 6 slices; use a bar chart for more',
});

export const kpiSpec = z.object({
  title: z.string().optional(),
  items: z
    .array(
      z.object({
        label: z.string(),
        value: z.number().describe('The actual number from the data you fetched, e.g. 106963.29 (never a 0 placeholder)'),
        format: formatSchema.default('number'),
        delta: z.number().optional().describe('Change vs comparison period as a fraction, e.g. 0.12 = +12%'),
        hint: z.string().optional().describe('Small caption, e.g. "vs previous 30 days"'),
        column: z.string().optional().describe('With source: result column holding this value'),
        compareColumn: z.string().optional().describe('With source: column holding the comparison value; delta = value / compare - 1'),
      }),
    )
    .min(1)
    .max(8),
  currency: z.string().optional(),
  source: z
    .object({ shopifyql: z.string() })
    .optional()
    .describe('ShopifyQL returning one row; each item reads its value from `column` so a pinned copy stays live'),
  confirmedZero: z.boolean().optional().describe('Set only when every value really is 0 (e.g. no sales in the period)'),
});

export const tableSpec = z.object({
  title: z.string(),
  columns: z
    .array(z.object({ key: z.string(), label: z.string(), format: formatSchema.default('text') }))
    .min(1)
    .max(10),
  rows: z.array(row).max(200),
  linkKey: z.string().optional().describe('Row field holding a URL (e.g. adminUrl); the first column links to it'),
  currency: z.string().optional(),
  source,
});

export type ChartSpec = z.infer<typeof chartSpec>;
export type KpiSpec = z.infer<typeof kpiSpec>;
export type TableSpec = z.infer<typeof tableSpec>;

export type WidgetKind = 'chart' | 'kpis' | 'table';
export type WidgetSpec =
  | { kind: 'chart'; spec: ChartSpec }
  | { kind: 'kpis'; spec: KpiSpec }
  | { kind: 'table'; spec: TableSpec };

/** Maps the UI tool name to the widget kind it renders. */
export const UI_TOOL_KIND = { renderChart: 'chart', renderKpis: 'kpis', renderTable: 'table' } as const;
