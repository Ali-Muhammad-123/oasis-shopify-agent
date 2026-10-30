import 'server-only';
import { tool } from 'ai';
import { z } from 'zod';
import { inventoryForecast, loadCatalog, marginReport } from '../../analytics';
import { variantName } from '../../analytics-math';
import { toCsv } from '../../csv';
import { saveGeneratedDocument } from '../../documents/store';
import { env } from '../../env';
import { listMemory, marginTargetFrom } from '../../memory';
import { adminGraphql, ShopifyError } from '../../shopify/admin';
import * as M from '../../shopify/mutations';

const downloadUrl = (id: string) => new URL(`/api/documents/${id}`, env.APP_URL).toString();

type Member = {
  id: string; displayName: string; firstName: string | null; lastName: string | null; numberOfOrders: string;
  defaultEmailAddress: { emailAddress: string; marketingState: string } | null; amountSpent: { amount: string; currencyCode: string };
};
type MembersPage = { customerSegmentMembers: { totalCount: number; pageInfo: { hasNextPage: boolean; endCursor: string | null }; edges: { node: Member }[] } };

/** Pages through a segment (by saved id or ad-hoc query), up to `max` members. */
export async function segmentMembers(shop: string, { query, segmentId, max = 250 }: { query?: string; segmentId?: string; max?: number }) {
  const members: Member[] = [];
  let after: string | null = null;
  let total = 0;
  while (members.length < max) {
    const { data }: { data: MembersPage } = await adminGraphql(shop, M.SEGMENT_MEMBERS, {
      query: segmentId ? null : query, segmentId: segmentId ?? null, first: Math.min(100, max - members.length), after,
    });
    total = data.customerSegmentMembers.totalCount;
    // Segment members carry CustomerSegmentMember ids; the numeric part is the customer id that other APIs expect.
    members.push(...data.customerSegmentMembers.edges.map((e) => ({ ...e.node, id: e.node.id.replace('/CustomerSegmentMember/', '/Customer/') })));
    if (!data.customerSegmentMembers.pageInfo.hasNextPage) break;
    after = data.customerSegmentMembers.pageInfo.endCursor;
  }
  return { total, members };
}

const SEGMENT_SYNTAX =
  'Shopify customer segment query syntax, e.g. "number_of_orders >= 2 AND last_order_date < -60d", "amount_spent > 1000", ' +
  '"customer_tags CONTAINS \'vip\'", "email_subscription_status = \'SUBSCRIBED\'", "last_order_date > -30d".';

async function safe<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ShopifyError) return { error: err.message };
    throw err;
  }
}

export function createGrowthTools(shop: string) {
  return {
    getMarginReport: tool({
      description:
        'Gross margin per variant at current price and unit cost, with units sold, revenue and gross profit over a window, the price ' +
        'needed to hit the target margin, and variants missing a cost. Target defaults to the saved store preference (else 40%).',
      inputSchema: z.object({
        targetMargin: z.number().gt(0).lt(1).optional().describe('e.g. 0.4 for 40%'),
        days: z.number().int().min(7).max(365).default(90),
        onlyBelowTarget: z.boolean().default(false),
        limit: z.number().int().min(1).max(100).default(30),
      }),
      execute: ({ targetMargin, days, onlyBelowTarget, limit }) =>
        safe(async () => {
          const target = targetMargin ?? marginTargetFrom(await listMemory(shop));
          const report = await marginReport(shop, { target, days });
          const rows = report.rows.filter((r) => (onlyBelowTarget ? r.belowTarget : true));
          return { ...report, rows: rows.slice(0, limit), truncated: rows.length > limit };
        }),
    }),

    forecastInventory: tool({
      description:
        'Stock forecast per tracked variant: daily sales velocity, days of stock left, status (out_of_stock, reorder_now, reorder_soon, ok, ' +
        'no_sales), reorder quantity covering supplier lead time plus cover days, and the date to reorder by.',
      inputSchema: z.object({
        days: z.number().int().min(7).max(180).default(30).describe('Sales window used for velocity'),
        leadTimeDays: z.number().int().min(0).max(120).default(14),
        coverDays: z.number().int().min(1).max(180).default(30).describe('Demand to cover after the order arrives'),
        onlyAtRisk: z.boolean().default(true),
        limit: z.number().int().min(1).max(100).default(30),
      }),
      execute: ({ onlyAtRisk, limit, ...params }) =>
        safe(async () => {
          const f = await inventoryForecast(shop, params);
          const rows = onlyAtRisk ? f.rows.filter((r) => r.status === 'out_of_stock' || r.status === 'reorder_now' || r.status === 'reorder_soon') : f.rows;
          return { ...f, rows: rows.slice(0, limit), truncated: rows.length > limit };
        }),
    }),

    createPurchaseOrderCsv: tool({
      description:
        'Create a purchase order CSV for a supplier (SKU, product, quantity, unit cost, line total) and save it to Documents. ' +
        'Does not change the store. Use quantities from forecastInventory unless the user says otherwise.',
      inputSchema: z.object({
        supplier: z.string().optional(),
        items: z.array(z.object({ variantId: z.string(), quantity: z.number().int().positive() })).min(1).max(200),
        notes: z.string().optional(),
      }),
      execute: ({ supplier, items, notes }) =>
        safe(async () => {
          const byId = new Map((await loadCatalog(shop)).map((v) => [v.id, v]));
          const missing = items.filter((i) => !byId.has(i.variantId)).map((i) => i.variantId);
          const lines = items.flatMap((i) => {
            const v = byId.get(i.variantId);
            if (!v) return [];
            return [{ sku: v.sku ?? '', product: variantName(v), quantity: i.quantity, unitCost: v.unitCost ?? '', lineTotal: v.unitCost != null ? (v.unitCost * i.quantity).toFixed(2) : '' }];
          });
          const total = lines.reduce((s, l) => s + (l.lineTotal ? Number(l.lineTotal) : 0), 0);
          const date = new Date().toISOString().slice(0, 10);
          const csv = toCsv(
            [...lines, { sku: '', product: 'TOTAL', quantity: lines.reduce((s, l) => s + l.quantity, 0), unitCost: '', lineTotal: total.toFixed(2) }],
            [{ key: 'sku', label: 'SKU' }, { key: 'product', label: 'Product' }, { key: 'quantity', label: 'Quantity' }, { key: 'unitCost', label: 'Unit cost' }, { key: 'lineTotal', label: 'Line total' }],
          );
          const header = `# Purchase order ${date}${supplier ? ` for ${supplier}` : ''}${notes ? ` · ${notes.replace(/\n/g, ' ')}` : ''}\r\n`;
          const doc = await saveGeneratedDocument(shop, `PO-${date}${supplier ? `-${supplier.replace(/[^\w-]+/g, '-')}` : ''}.csv`, 'text/csv', header + csv);
          return { documentId: doc.id, filename: doc.filename, downloadUrl: downloadUrl(doc.id), lines: lines.length, units: lines.reduce((s, l) => s + l.quantity, 0), estimatedTotal: Math.round(total * 100) / 100, missingVariants: missing };
        }),
    }),

    previewCustomerSegment: tool({
      description: `Count and sample the customers matching a segment query before saving it or targeting it. ${SEGMENT_SYNTAX}`,
      inputSchema: z.object({ query: z.string().min(3) }),
      execute: ({ query }) =>
        safe(async () => {
          const { total, members } = await segmentMembers(shop, { query, max: 10 });
          return {
            query, totalCount: total,
            sample: members.map((m) => ({ name: m.displayName, email: m.defaultEmailAddress?.emailAddress, orders: Number(m.numberOfOrders), spent: Number(m.amountSpent.amount) })),
          };
        }),
    }),

    listCustomerSegments: tool({
      description: 'Saved customer segments in the store (id, name, query).',
      inputSchema: z.object({}),
      execute: () =>
        safe(async () => {
          const { data } = await adminGraphql<{ segments: { nodes: { id: string; name: string; query: string; creationDate: string }[] } }>(shop, M.SEGMENTS, { first: 50 });
          return { segments: data.segments.nodes };
        }),
    }),

    exportSegmentEmails: tool({
      description:
        'Export a segment\'s customers (name, email, marketing consent, orders, spend) to a CSV in Documents and return a download link. ' +
        'Mention that only customers with marketing consent (SUBSCRIBED) should receive promotional email.',
      inputSchema: z.object({
        name: z.string().describe('Used in the filename'),
        segmentId: z.string().optional(),
        query: z.string().optional().describe(SEGMENT_SYNTAX),
      }).refine((v) => v.segmentId || v.query, 'Pass segmentId or query'),
      execute: ({ name, segmentId, query }) =>
        safe(async () => {
          const { total, members } = await segmentMembers(shop, { segmentId, query, max: 5000 });
          const rows = members.map((m) => ({
            name: m.displayName, firstName: m.firstName ?? '', lastName: m.lastName ?? '', email: m.defaultEmailAddress?.emailAddress ?? '',
            marketing: m.defaultEmailAddress?.marketingState ?? 'UNKNOWN', orders: Number(m.numberOfOrders), spent: Number(m.amountSpent.amount).toFixed(2),
          }));
          const csv = toCsv(rows, [
            { key: 'name', label: 'Name' }, { key: 'firstName', label: 'First name' }, { key: 'lastName', label: 'Last name' },
            { key: 'email', label: 'Email' }, { key: 'marketing', label: 'Email marketing' }, { key: 'orders', label: 'Orders' }, { key: 'spent', label: 'Amount spent' },
          ]);
          const doc = await saveGeneratedDocument(shop, `segment-${name.replace(/[^\w-]+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv', csv);
          return {
            documentId: doc.id, downloadUrl: downloadUrl(doc.id), customers: rows.length, totalInSegment: total,
            subscribed: rows.filter((r) => r.marketing === 'SUBSCRIBED').length,
            note: 'Only email customers whose marketing status is SUBSCRIBED.',
          };
        }),
    }),
  };
}
