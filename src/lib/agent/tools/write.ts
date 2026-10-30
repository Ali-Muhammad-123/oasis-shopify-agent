import 'server-only';
import { randomUUID } from 'node:crypto';
import { tool, type Tool } from 'ai';
import { z } from 'zod';
import { db, schema } from '../../db';
import { adminGraphql, adminUrl, ShopifyError, userErrorMessage } from '../../shopify/admin';
import * as M from '../../shopify/mutations';
import { SHOP_OVERVIEW } from '../../shopify/queries';
import type { ActionPreview } from '../../genui/preview';
import { getDraft, PREVIEW_THEME_NAME, publishDraft } from '../../liquid/drafts';
import { sectionName } from '../../liquid/section';
import { and, eq } from 'drizzle-orm';
import { adjustPrice, unconvertedPriceReason } from '../pricing';
import { segmentMembers } from './growth';

export { unconvertedPriceReason };

async function storeCurrency(shop: string) {
  const row = await db.query.shops.findFirst({ where: eq(schema.shops.domain, shop), columns: { currencyCode: true } });
  return row?.currencyCode ?? null;
}

const toGid = (type: string) => (v: string) => (v.startsWith('gid://') ? v : `gid://shopify/${type}/${v.replace(/\D/g, '')}`);
const gid = (type: string) => z.string().describe(`gid://shopify/${type}/… or numeric id`).transform(toGid(type));
const money = (v: string | number | null | undefined, currency = '') =>
  v == null ? '—' : `${Number(v).toFixed(2)}${currency ? ` ${currency}` : ''}`;

type Ctx = { shop: string };

/** One approvable write: a preview of the live before/after state, and the mutation itself. */
/** How to reverse a write: run another action (op = a WRITE_ACTIONS name or a delete op) with captured args. */
export type UndoPlan = { op: string; args: unknown; summary: string };

type WriteAction<S extends z.ZodType> = {
  description: string;
  inputSchema: S;
  preview: (input: z.output<S>, ctx: Ctx) => Promise<ActionPreview>;
  execute: (input: z.output<S>, ctx: Ctx) => Promise<Record<string, unknown>>;
  /** Captures the before-state needed to undo; runs right before execute. */
  before?: (input: z.output<S>, ctx: Ctx) => Promise<UndoPlan | null>;
  /** Builds the undo from what execute created (e.g. delete the new discount). */
  after?: (input: z.output<S>, result: Record<string, unknown>) => UndoPlan | null;
};
const action = <S extends z.ZodType>(a: WriteAction<S>) => a;

function fail(message: string | null): asserts message is null {
  if (message) throw new ShopifyError(message);
}

async function defaultLocationId(shop: string) {
  const { data } = await adminGraphql<{ locations: { nodes: { id: string; isActive: boolean }[] } }>(shop, SHOP_OVERVIEW);
  const loc = data.locations.nodes.find((l) => l.isActive) ?? data.locations.nodes[0];
  if (!loc) throw new ShopifyError('The store has no locations');
  return loc.id;
}

type PreviewVariant = {
  id: string; title: string; sku: string | null; price: string; compareAtPrice: string | null; inventoryQuantity: number;
  product: { id: string; title: string }; inventoryItem: { id: string; unitCost: { amount: string } | null };
};
async function loadVariants(shop: string, ids: string[]) {
  const { data } = await adminGraphql<{ nodes: (PreviewVariant | null)[] }>(shop, M.VARIANTS_FOR_PREVIEW, { ids });
  return new Map(data.nodes.filter((n): n is PreviewVariant => Boolean(n?.id)).map((v) => [v.id, v]));
}
const variantLabel = (v: PreviewVariant) =>
  `${v.product.title}${v.title !== 'Default Title' ? ` / ${v.title}` : ''}${v.sku ? ` (${v.sku})` : ''}`;

/** Sets price / compare-at price on variants, one productVariantsBulkUpdate per product. */
async function applyVariantPrices(shop: string, changes: { variantId: string; price?: number; compareAtPrice?: number | null }[]) {
  const variants = await loadVariants(shop, changes.map((c) => c.variantId));
  const byProduct = new Map<string, { id: string; price?: string; compareAtPrice?: string | null }[]>();
  for (const c of changes) {
    const v = variants.get(c.variantId);
    if (!v) continue;
    const list = byProduct.get(v.product.id) ?? [];
    list.push({
      id: c.variantId,
      ...(c.price != null ? { price: c.price.toFixed(2) } : {}),
      ...(c.compareAtPrice !== undefined ? { compareAtPrice: c.compareAtPrice == null ? null : c.compareAtPrice.toFixed(2) } : {}),
    });
    byProduct.set(v.product.id, list);
  }
  const updated: unknown[] = [];
  for (const [productId, list] of byProduct) {
    type R = { productVariantsBulkUpdate: { productVariants: unknown[] | null; userErrors: { field: string[]; message: string }[] } };
    const { data } = await adminGraphql<R>(shop, M.PRODUCT_VARIANTS_BULK_UPDATE, { productId, variants: list });
    fail(userErrorMessage(data.productVariantsBulkUpdate));
    updated.push(...(data.productVariantsBulkUpdate.productVariants ?? []));
  }
  return { updated: updated.length, variants: updated };
}

async function applyTags(shop: string, resourceId: string, add: string[], remove: string[]) {
  type R = { userErrors: { field: string[]; message: string }[] };
  if (add.length) {
    const { data } = await adminGraphql<{ tagsAdd: R }>(shop, M.TAGS_ADD, { id: resourceId, tags: add });
    fail(userErrorMessage(data.tagsAdd));
  }
  if (remove.length) {
    const { data } = await adminGraphql<{ tagsRemove: R }>(shop, M.TAGS_REMOVE, { id: resourceId, tags: remove });
    fail(userErrorMessage(data.tagsRemove));
  }
  return { resourceId, added: add, removed: remove };
}

export const WRITE_ACTIONS = {
  createDiscountCode: action({
    description:
      'Create a discount code for the whole store: a percentage or a fixed amount off all products. Requires approval.',
    inputSchema: z
      .object({
        title: z.string().describe('Internal name, e.g. "Black Friday 25%"'),
        code: z.string().min(3).max(40).transform((c) => c.toUpperCase().replace(/\s+/g, '')),
        percentage: z.number().gt(0).max(100).optional().describe('Percent off, e.g. 25 for 25%'),
        amount: z.number().positive().optional().describe('Fixed amount off in store currency'),
        startsAt: z.iso.datetime().optional().describe('Defaults to now'),
        endsAt: z.iso.datetime().optional(),
        appliesOncePerCustomer: z.boolean().default(false),
        usageLimit: z.number().int().positive().optional().describe('Total redemptions allowed'),
        minimumSubtotal: z.number().positive().optional().describe('Minimum order subtotal'),
        segmentId: z.string().optional().describe('Limit the code to one customer segment (gid://shopify/Segment/…)'),
      })
      .refine((v) => (v.percentage == null) !== (v.amount == null), 'Provide exactly one of percentage or amount'),
    async preview(input, { shop }) {
      const { data } = await adminGraphql<{ codeDiscountNodeByCode: { id: string } | null }>(shop, M.DISCOUNT_CODE_EXISTS, { code: input.code });
      return {
        title: `Create discount code ${input.code}`,
        rows: [
          { label: 'Title', after: input.title },
          { label: 'Value', after: input.percentage != null ? `${input.percentage}% off` : `${money(input.amount)} off` },
          { label: 'Applies to', after: input.segmentId ? `All products, customers in segment ${input.segmentId.split('/').pop()}` : 'All products, all customers' },
          { label: 'Starts', after: input.startsAt ?? 'Now' },
          { label: 'Ends', after: input.endsAt ?? 'No end date' },
          ...(input.usageLimit ? [{ label: 'Usage limit', after: String(input.usageLimit) }] : []),
          ...(input.minimumSubtotal ? [{ label: 'Minimum subtotal', after: money(input.minimumSubtotal) }] : []),
          { label: 'Once per customer', after: input.appliesOncePerCustomer ? 'Yes' : 'No' },
        ],
        warnings: data.codeDiscountNodeByCode ? [`A discount with code ${input.code} already exists; creation will fail.`] : [],
      };
    },
    async execute(input, { shop }) {
      const basicCodeDiscount = {
        title: input.title,
        code: input.code,
        startsAt: input.startsAt ?? new Date().toISOString(),
        endsAt: input.endsAt ?? null,
        appliesOncePerCustomer: input.appliesOncePerCustomer,
        usageLimit: input.usageLimit ?? null,
        context: input.segmentId ? { customerSegments: { add: [input.segmentId] } } : { all: 'ALL' },
        customerGets: {
          items: { all: true },
          value: input.percentage != null
            ? { percentage: input.percentage / 100 }
            : { discountAmount: { amount: input.amount, appliesOnEachItem: false } },
        },
        ...(input.minimumSubtotal
          ? { minimumRequirement: { subtotal: { greaterThanOrEqualToSubtotal: input.minimumSubtotal } } }
          : {}),
      };
      type R = { discountCodeBasicCreate: { codeDiscountNode: { id: string } | null; userErrors: { field: string[]; message: string }[] } };
      const { data } = await adminGraphql<R>(shop, M.DISCOUNT_CODE_BASIC_CREATE, { basicCodeDiscount });
      fail(userErrorMessage(data.discountCodeBasicCreate));
      const id = data.discountCodeBasicCreate.codeDiscountNode!.id;
      return { created: input.code, id, adminUrl: adminUrl(shop, id) };
    },
    after: (input, result) => ({ op: 'deleteDiscount', args: { id: result.id }, summary: `Delete discount code ${input.code}` }),
  }),

  updateVariantPrices: action({
    description: 'Change price and/or compare-at price for one or more variants (up to 50). Requires approval.',
    inputSchema: z.object({
      changes: z
        .array(
          z.object({
            variantId: gid('ProductVariant'),
            price: z.number().nonnegative().optional(),
            compareAtPrice: z.number().nonnegative().nullable().optional().describe('null removes the compare-at price'),
          }),
        )
        .min(1)
        .max(50),
    }),
    async preview({ changes }, { shop }) {
      const variants = await loadVariants(shop, changes.map((c) => c.variantId));
      const missing = changes.filter((c) => !variants.has(c.variantId)).map((c) => c.variantId);
      return {
        title: `Update prices for ${changes.length} variant${changes.length === 1 ? '' : 's'}`,
        rows: changes.filter((c) => variants.has(c.variantId)).flatMap((c) => {
          const v = variants.get(c.variantId)!;
          return [
            ...(c.price != null ? [{ label: `${variantLabel(v)} · price`, before: money(v.price), after: money(c.price) }] : []),
            ...(c.compareAtPrice !== undefined
              ? [{ label: `${variantLabel(v)} · compare-at`, before: money(v.compareAtPrice), after: money(c.compareAtPrice) }]
              : []),
          ];
        }),
        warnings: missing.length ? [`Variants not found and will be skipped: ${missing.join(', ')}`] : [],
      };
    },
    async before({ changes }, { shop }) {
      const variants = await loadVariants(shop, changes.map((c) => c.variantId));
      const restore = changes.flatMap((c) => {
        const v = variants.get(c.variantId);
        return v ? [{ variantId: v.id, price: Number(v.price), compareAtPrice: v.compareAtPrice == null ? null : Number(v.compareAtPrice) }] : [];
      });
      return restore.length ? { op: 'updateVariantPrices', args: { changes: restore }, summary: `Restore previous prices on ${restore.length} variant(s)` } : null;
    },
    execute: ({ changes }, { shop }) => applyVariantPrices(shop, changes),
  }),

  updateProduct: action({
    description: 'Update a product\'s title, status (ACTIVE/DRAFT/ARCHIVED), vendor, product type or full tag list. Requires approval.',
    inputSchema: z.object({
      productId: gid('Product'),
      title: z.string().optional(),
      status: z.enum(['ACTIVE', 'DRAFT', 'ARCHIVED']).optional(),
      vendor: z.string().optional(),
      productType: z.string().optional(),
      tags: z.array(z.string()).optional().describe('Replaces all tags; use setTags to add/remove individual tags'),
    }),
    async preview({ productId, ...changes }, { shop }) {
      type P = { id: string; title: string; status: string; tags: string[]; vendor: string; productType: string };
      const { data } = await adminGraphql<{ product: P | null }>(shop, M.PRODUCT_FOR_PREVIEW, { id: productId });
      if (!data.product) return { title: 'Update product', rows: [], warnings: [`Product ${productId} not found`] };
      const p = data.product;
      const show = (v: unknown) => (Array.isArray(v) ? v.join(', ') || '(none)' : String(v ?? '—'));
      return {
        title: `Update product “${p.title}”`,
        link: adminUrl(shop, p.id),
        rows: (Object.keys(changes) as (keyof typeof changes)[])
          .filter((k) => changes[k] !== undefined)
          .map((k) => ({ label: k, before: show(p[k]), after: show(changes[k]) })),
      };
    },
    async before({ productId, ...changes }, { shop }) {
      type P = { title: string; status: string; tags: string[]; vendor: string; productType: string };
      const { data } = await adminGraphql<{ product: P | null }>(shop, M.PRODUCT_FOR_PREVIEW, { id: productId });
      if (!data.product) return null;
      const keys = (Object.keys(changes) as (keyof typeof changes)[]).filter((k) => changes[k] !== undefined);
      const restore = Object.fromEntries(keys.map((k) => [k, data.product![k as keyof P]]));
      return { op: 'updateProduct', args: { productId, ...restore }, summary: `Restore ${keys.join(', ')} on “${data.product.title}”` };
    },
    async execute({ productId, ...changes }, { shop }) {
      type R = { productUpdate: { product: unknown; userErrors: { field: string[]; message: string }[] } };
      const { data } = await adminGraphql<R>(shop, M.PRODUCT_UPDATE, { product: { id: productId, ...changes } });
      fail(userErrorMessage(data.productUpdate));
      return { product: data.productUpdate.product, adminUrl: adminUrl(shop, productId) };
    },
  }),

  adjustInventory: action({
    description:
      'Adjust available inventory by a delta (+ received, - shrinkage) for one or more variants at one location (defaults to the ' +
      'primary location). Requires approval.',
    inputSchema: z.object({
      changes: z.array(z.object({ variantId: gid('ProductVariant'), delta: z.number().int().refine((d) => d !== 0) })).min(1).max(50),
      locationId: gid('Location').optional(),
      reason: z.enum(['correction', 'received', 'damaged', 'shrinkage', 'cycle_count_available', 'restock']).default('correction'),
    }),
    async preview({ changes, locationId, reason }, { shop }) {
      const location = locationId ?? (await defaultLocationId(shop));
      const levels = await Promise.all(changes.map((c) => loadLevel(shop, c.variantId, location)));
      return {
        title: `Adjust inventory for ${changes.length} variant${changes.length === 1 ? '' : 's'} (${reason})`,
        rows: changes.map((c, i) => {
          const l = levels[i];
          return l
            ? { label: `${l.label} @ ${l.locationName}`, before: String(l.available), after: String(l.available + c.delta) }
            : { label: c.variantId, before: '—', after: `${c.delta > 0 ? '+' : ''}${c.delta}` };
        }),
        warnings: [
          ...levels.flatMap((l, i) => (l ? (l.tracked ? [] : [`${l.label} is not inventory-tracked`]) : [`${changes[i].variantId} is not stocked at this location`])),
          ...levels.flatMap((l, i) => (l && l.available + changes[i].delta < 0 ? [`${l.label} would go negative`] : [])),
        ],
      };
    },
    async before({ changes, locationId }, { shop }) {
      const location = locationId ?? (await defaultLocationId(shop));
      return {
        op: 'adjustInventory',
        args: { locationId: location, reason: 'correction', changes: changes.map((c) => ({ variantId: c.variantId, delta: -c.delta })) },
        summary: `Reverse the inventory adjustment on ${changes.length} variant(s)`,
      };
    },
    async execute({ changes, locationId, reason }, { shop }) {
      const location = locationId ?? (await defaultLocationId(shop));
      const levels = await Promise.all(changes.map((c) => loadLevel(shop, c.variantId, location)));
      const input = {
        name: 'available',
        reason,
        changes: changes.flatMap((c, i) => {
          const l = levels[i];
          return l ? [{ inventoryItemId: l.inventoryItemId, locationId: location, delta: c.delta, changeFromQuantity: l.available }] : [];
        }),
      };
      if (!input.changes.length) throw new ShopifyError('None of the variants are stocked at that location');
      type R = { inventoryAdjustQuantities: { inventoryAdjustmentGroup: unknown; userErrors: { field: string[]; message: string }[] } };
      const { data } = await adminGraphql<R>(shop, M.INVENTORY_ADJUST_QUANTITIES, { input, idempotencyKey: randomUUID() });
      fail(userErrorMessage(data.inventoryAdjustQuantities));
      return { adjustment: data.inventoryAdjustQuantities.inventoryAdjustmentGroup };
    },
  }),

  setTags: action({
    description: 'Add and/or remove tags on an order, customer, product or draft order. Requires approval.',
    inputSchema: z
      .object({
        resourceId: z.string().describe('GID of the Order, Customer, Product or DraftOrder'),
        add: z.array(z.string()).default([]),
        remove: z.array(z.string()).default([]),
      })
      .refine((v) => v.add.length + v.remove.length > 0, 'Provide tags to add or remove'),
    async preview({ resourceId, add, remove }, { shop }) {
      type N = { id: string; name?: string; displayName?: string; title?: string; tags?: string[] } | null;
      const { data } = await adminGraphql<{ node: N }>(shop, M.NODE_LABEL, { id: resourceId });
      if (!data.node) return { title: 'Update tags', rows: [], warnings: [`${resourceId} not found`] };
      const before = data.node.tags ?? [];
      const after = [...new Set([...before.filter((t) => !remove.includes(t)), ...add])];
      return {
        title: `Update tags on ${data.node.name ?? data.node.displayName ?? data.node.title}`,
        link: adminUrl(shop, resourceId),
        rows: [{ label: 'Tags', before: before.join(', ') || '(none)', after: after.join(', ') || '(none)' }],
      };
    },
    async before({ resourceId, add, remove }, { shop }) {
      const { data } = await adminGraphql<{ node: { tags?: string[] } | null }>(shop, M.NODE_LABEL, { id: resourceId });
      const before = data.node?.tags ?? [];
      const added = add.filter((t) => !before.includes(t));
      const removed = remove.filter((t) => before.includes(t));
      if (!added.length && !removed.length) return null;
      return { op: 'setTags', args: { resourceId, add: removed, remove: added }, summary: `Revert tag changes on ${resourceId.split('/').slice(-2).join(' ')}` };
    },
    execute: ({ resourceId, add, remove }, { shop }) => applyTags(shop, resourceId, add, remove),
  }),

  createDraftOrder: action({
    description: 'Create a draft order (quote/invoice) for a customer with line items and an optional percentage discount. Requires approval.',
    inputSchema: z.object({
      customerId: gid('Customer').optional(),
      email: z.email().optional(),
      lineItems: z.array(z.object({ variantId: gid('ProductVariant'), quantity: z.number().int().positive() })).min(1).max(50),
      discountPercent: z.number().gt(0).max(100).optional(),
      note: z.string().optional(),
      tags: z.array(z.string()).default([]),
    }),
    async preview(input, { shop }) {
      const variants = await loadVariants(shop, input.lineItems.map((l) => l.variantId));
      let subtotal = 0;
      const rows = input.lineItems.map((l) => {
        const v = variants.get(l.variantId);
        const line = v ? Number(v.price) * l.quantity : 0;
        subtotal += line;
        return { label: v ? variantLabel(v) : l.variantId, after: `${l.quantity} × ${money(v?.price)} = ${money(line)}` };
      });
      const discount = input.discountPercent ? (subtotal * input.discountPercent) / 100 : 0;
      return {
        title: 'Create draft order',
        rows: [
          ...rows,
          ...(discount ? [{ label: `Discount (${input.discountPercent}%)`, after: `−${money(discount)}` }] : []),
          { label: 'Estimated subtotal', after: money(subtotal - discount) },
          ...(input.customerId ? [{ label: 'Customer', after: input.customerId }] : []),
          ...(input.note ? [{ label: 'Note', after: input.note }] : []),
        ],
        warnings: input.lineItems.filter((l) => !variants.has(l.variantId)).map((l) => `Variant ${l.variantId} not found`),
      };
    },
    async execute(input, { shop }) {
      const draft = {
        ...(input.customerId ? { purchasingEntity: { customerId: input.customerId } } : {}),
        ...(input.email ? { email: input.email } : {}),
        lineItems: input.lineItems,
        ...(input.discountPercent
          ? { appliedDiscount: { value: input.discountPercent, valueType: 'PERCENTAGE', title: `${input.discountPercent}% off` } }
          : {}),
        ...(input.note ? { note: input.note } : {}),
        tags: ['oasis', ...input.tags],
      };
      type R = { draftOrderCreate: { draftOrder: { id: string; name: string; invoiceUrl: string } | null; userErrors: { field: string[]; message: string }[] } };
      const { data } = await adminGraphql<R>(shop, M.DRAFT_ORDER_CREATE, { input: draft });
      fail(userErrorMessage(data.draftOrderCreate));
      const d = data.draftOrderCreate.draftOrder!;
      return { draftOrder: d, adminUrl: adminUrl(shop, d.id) };
    },
    after: (_input, result) => {
      const d = result.draftOrder as { id: string; name: string };
      return { op: 'deleteDraftOrder', args: { id: d.id }, summary: `Delete draft order ${d.name}` };
    },
  }),

  cancelOrder: action({
    description: 'Cancel an order, optionally refunding to the original payment method and restocking items. Requires approval.',
    inputSchema: z.object({
      orderId: gid('Order'),
      reason: z.enum(['CUSTOMER', 'DECLINED', 'FRAUD', 'INVENTORY', 'STAFF', 'OTHER']).default('CUSTOMER'),
      refund: z.boolean().default(true),
      restock: z.boolean().default(true),
      notifyCustomer: z.boolean().default(false),
      staffNote: z.string().optional(),
    }),
    async preview(input, { shop }) {
      const order = await loadOrder(shop, input.orderId);
      if (!order) return { title: 'Cancel order', rows: [], warnings: [`Order ${input.orderId} not found`] };
      return {
        title: `Cancel order ${order.name}`,
        link: adminUrl(shop, order.id),
        rows: [
          { label: 'Customer', after: order.customer?.displayName ?? '—' },
          { label: 'Total', after: money(order.totalPriceSet.shopMoney.amount, order.totalPriceSet.shopMoney.currencyCode) },
          { label: 'Status', before: `${order.displayFinancialStatus} / ${order.displayFulfillmentStatus}`, after: 'CANCELLED' },
          { label: 'Refund', after: input.refund ? 'Yes, to original payment method' : 'No' },
          { label: 'Restock items', after: input.restock ? 'Yes' : 'No' },
          { label: 'Notify customer', after: input.notifyCustomer ? 'Yes' : 'No' },
          { label: 'Reason', after: input.reason },
        ],
        warnings: [
          ...(order.cancelledAt ? ['This order is already cancelled.'] : []),
          ...(order.displayFulfillmentStatus === 'FULFILLED' ? ['This order has already been fulfilled.'] : []),
        ],
      };
    },
    async execute(input, { shop }) {
      type R = { orderCancel: { job: { id: string; done: boolean } | null; orderCancelUserErrors: { field: string[]; message: string }[] } };
      const { data } = await adminGraphql<R>(shop, M.ORDER_CANCEL, {
        orderId: input.orderId,
        reason: input.reason,
        restock: input.restock,
        notifyCustomer: input.notifyCustomer,
        refundMethod: input.refund ? { originalPaymentMethodsRefund: true } : null,
        staffNote: input.staffNote ?? null,
      });
      fail(userErrorMessage({ userErrors: data.orderCancel.orderCancelUserErrors }));
      return { cancelled: input.orderId, job: data.orderCancel.job, adminUrl: adminUrl(shop, input.orderId) };
    },
  }),

  fulfillOrder: action({
    description: 'Mark all remaining items of an order as fulfilled, with optional tracking info. Requires approval.',
    inputSchema: z.object({
      orderId: gid('Order'),
      trackingCompany: z.string().optional(),
      trackingNumber: z.string().optional(),
      notifyCustomer: z.boolean().default(false),
    }),
    async preview(input, { shop }) {
      const order = await loadOrder(shop, input.orderId);
      if (!order) return { title: 'Fulfill order', rows: [], warnings: [`Order ${input.orderId} not found`] };
      const open = order.fulfillmentOrders.nodes.filter((fo) => fo.status === 'OPEN' || fo.status === 'IN_PROGRESS');
      return {
        title: `Fulfill order ${order.name}`,
        link: adminUrl(shop, order.id),
        rows: [
          ...open.flatMap((fo) =>
            fo.lineItems.nodes.filter((l) => l.remainingQuantity > 0).map((l) => ({ label: l.lineItem.title, after: `${l.remainingQuantity} to ship` })),
          ),
          { label: 'Tracking', after: input.trackingNumber ? `${input.trackingCompany ?? ''} ${input.trackingNumber}`.trim() : 'None' },
          { label: 'Notify customer', after: input.notifyCustomer ? 'Yes' : 'No' },
        ],
        warnings: open.length ? [] : ['There is nothing left to fulfill on this order.'],
      };
    },
    async execute(input, { shop }) {
      const order = await loadOrder(shop, input.orderId);
      const open = order?.fulfillmentOrders.nodes.filter((fo) => fo.status === 'OPEN' || fo.status === 'IN_PROGRESS') ?? [];
      if (!open.length) throw new ShopifyError('There is nothing left to fulfill on this order');
      const fulfillment = {
        lineItemsByFulfillmentOrder: open.map((fo) => ({ fulfillmentOrderId: fo.id })),
        notifyCustomer: input.notifyCustomer,
        ...(input.trackingNumber ? { trackingInfo: { company: input.trackingCompany, number: input.trackingNumber } } : {}),
      };
      type R = { fulfillmentCreate: { fulfillment: unknown; userErrors: { field: string[]; message: string }[] } };
      const { data } = await adminGraphql<R>(shop, M.FULFILLMENT_CREATE, { fulfillment });
      fail(userErrorMessage(data.fulfillmentCreate));
      return { fulfillment: data.fulfillmentCreate.fulfillment, adminUrl: adminUrl(shop, input.orderId) };
    },
  }),
  createProduct: action({
    description:
      'Create a new product with title, rich HTML description, images (by URL), price, optional compare-at price, SKU, stock, SEO fields and ' +
      'tags; optionally publish it to the Online Store. Use original copy (not text copied from another site). Requires approval.',
    inputSchema: z.object({
      title: z.string().min(1).max(255),
      descriptionHtml: z.string().describe('Original product description as HTML (<p>, <ul><li>, <h3>, <strong>)'),
      vendor: z.string().optional(),
      productType: z.string().optional(),
      tags: z.array(z.string()).default([]),
      status: z.enum(['ACTIVE', 'DRAFT']).default('DRAFT'),
      price: z.number().positive(),
      compareAtPrice: z.number().positive().optional(),
      sku: z.string().optional(),
      inventoryQuantity: z.number().int().min(0).optional().describe('Stock at the primary location; tracked when set'),
      images: z.array(z.object({ url: z.url(), alt: z.string().optional() })).max(10).default([]),
      seoTitle: z.string().max(70).optional(),
      seoDescription: z.string().max(320).optional(),
      sourceUrl: z.url().optional().describe('Page the product was researched from, saved as a metafield'),
      sourcePrice: z
        .object({ amount: z.number().positive(), currency: z.string().length(3) })
        .optional()
        .describe('Price and ISO currency exactly as shown on the source page (from scrapeUrl). `price` must be in the store currency.'),
      publishToOnlineStore: z.boolean().default(true),
    }).refine((v) => !v.sourceUrl || v.sourcePrice, {
      message: 'sourcePrice (amount + currency from the source page) is required when sourceUrl is set',
      path: ['sourcePrice'],
    }),
    async preview(input, { shop }) {
      const currency = await storeCurrency(shop);
      const blocked = unconvertedPriceReason(input, currency);
      const src = input.sourcePrice;
      const plain = input.descriptionHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      return {
        title: `Create product “${input.title}”`,
        images: input.images.map((i) => i.url),
        rows: [
          { label: 'Status', after: input.status === 'ACTIVE' ? 'Active' : 'Draft (hidden until you activate it)' },
          {
            label: 'Price',
            after: input.compareAtPrice
              ? `${money(input.price, currency ?? '')} (compare at ${money(input.compareAtPrice, currency ?? '')})`
              : money(input.price, currency ?? ''),
          },
          ...(src ? [{ label: 'Source price', after: money(src.amount, src.currency.toUpperCase()) }] : []),
          ...(input.vendor ? [{ label: 'Vendor', after: input.vendor }] : []),
          ...(input.productType ? [{ label: 'Type', after: input.productType }] : []),
          ...(input.sku ? [{ label: 'SKU', after: input.sku }] : []),
          { label: 'Stock', after: input.inventoryQuantity != null ? `${input.inventoryQuantity} (tracked)` : 'Not tracked' },
          { label: 'Images', after: `${input.images.length}` },
          { label: 'Description', after: plain.length > 160 ? `${plain.slice(0, 157)}…` : plain || '(empty)' },
          ...(input.tags.length ? [{ label: 'Tags', after: input.tags.join(', ') }] : []),
          ...(input.seoTitle ? [{ label: 'SEO title', after: input.seoTitle }] : []),
          { label: 'Online Store', after: input.publishToOnlineStore ? 'Publish' : 'Not published' },
          ...(input.sourceUrl ? [{ label: 'Source', after: new URL(input.sourceUrl).hostname }] : []),
        ],
        warnings: [
          ...(blocked ? [blocked] : []),
          ...(src && currency && src.currency.toUpperCase() !== currency && !blocked
            ? [`Source is priced in ${src.currency.toUpperCase()}; check the ${currency} price is the one you want to charge.`]
            : []),
          ...(input.images.length ? [] : ['No images: the product page will look empty.']),
          ...(input.sourceUrl && !/myshopify\.com/.test(input.sourceUrl)
            ? ['Images and specs come from a third-party page; make sure you have the right to use them before selling.']
            : []),
        ],
      };
    },
    async execute(input, { shop }) {
      const blocked = unconvertedPriceReason(input, await storeCurrency(shop));
      if (blocked) throw new ShopifyError(blocked);
      const locationId = input.inventoryQuantity != null ? await defaultLocationId(shop) : null;
      const productInput = {
        title: input.title,
        descriptionHtml: input.descriptionHtml,
        vendor: input.vendor,
        productType: input.productType,
        tags: input.tags,
        status: input.status,
        ...(input.seoTitle || input.seoDescription ? { seo: { title: input.seoTitle, description: input.seoDescription } } : {}),
        productOptions: [{ name: 'Title', values: [{ name: 'Default Title' }] }],
        files: input.images.map((img) => ({ originalSource: img.url, contentType: 'IMAGE', alt: img.alt ?? input.title })),
        variants: [{
          optionValues: [{ optionName: 'Title', name: 'Default Title' }],
          price: input.price.toFixed(2),
          ...(input.compareAtPrice ? { compareAtPrice: input.compareAtPrice.toFixed(2) } : {}),
          ...(input.sku ? { sku: input.sku } : {}),
          ...(locationId
            ? { inventoryItem: { tracked: true }, inventoryQuantities: [{ locationId, name: 'available', quantity: input.inventoryQuantity }] }
            : {}),
        }],
        ...(input.sourceUrl
          ? { metafields: [{ namespace: 'oasis', key: 'source_url', type: 'url', value: input.sourceUrl }] }
          : {}),
      };
      type R = {
        productSet: {
          product: { id: string; handle: string; title: string; status: string; onlineStoreUrl: string | null; media: { nodes: { status: string }[] } } | null;
          userErrors: { field: string[]; message: string }[];
        };
      };
      const { data } = await adminGraphql<R>(shop, M.PRODUCT_SET_CREATE, { input: productInput });
      fail(userErrorMessage(data.productSet));
      const product = data.productSet.product!;

      let published: string | null = null;
      if (input.publishToOnlineStore) {
        try {
          const pubs = await adminGraphql<{ publications: { nodes: { id: string; catalog: { title: string } | null }[] } }>(shop, M.PUBLICATIONS);
          const online = pubs.data.publications.nodes.find((p) => /online store/i.test(p.catalog?.title ?? ''));
          if (!online) published = 'Online Store channel not found';
          else {
            const res = await adminGraphql<{ publishablePublish: { userErrors: { field: string[]; message: string }[] } }>(
              shop, M.PUBLISHABLE_PUBLISH, { id: product.id, input: [{ publicationId: online.id }] },
            );
            published = userErrorMessage(res.data.publishablePublish) ?? 'Published to Online Store';
          }
        } catch (err) {
          published = `Not published: ${(err as Error).message}`;
        }
      }
      const storefront = `https://${shop}/products/${product.handle}`;
      return {
        productId: product.id, handle: product.handle, status: product.status, imagesQueued: product.media.nodes.length,
        onlineStore: published, storefrontUrl: storefront, adminUrl: adminUrl(shop, product.id),
        note: product.status === 'DRAFT' ? 'Draft products are not visible on the storefront until activated.' : undefined,
      };
    },
    after: (input, result) => ({ op: 'deleteProduct', args: { id: result.productId }, summary: `Delete product “${input.title}”` }),
  }),

  publishLiquidPage: action({
    description:
      'Publish a saved Liquid draft to the unpublished "Oasis AI preview" theme (a copy of the live theme). Page drafts get an unpublished ' +
      'page; product drafts get a product template assigned to that product. The live theme is never modified. Requires approval.',
    inputSchema: z.object({ draftId: z.string(), pageTitle: z.string().optional() }),
    async preview({ draftId, pageTitle }, { shop }) {
      const draft = await getDraft(shop, draftId);
      if (!draft) return { title: 'Publish draft', rows: [], warnings: [`Draft ${draftId} not found`] };
      const suffix = sectionName(draft.handle);
      const isProduct = draft.target === 'product';
      return {
        title: isProduct ? `Publish product page “${draft.title}” to the preview theme` : `Publish “${pageTitle ?? draft.title}” to the preview theme`,
        link: `/pages/${draft.id}`,
        rows: [
          { label: 'Theme', after: `${PREVIEW_THEME_NAME} (unpublished copy of the live theme)` },
          { label: 'Files', after: `sections/${suffix}.liquid, templates/${isProduct ? 'product' : 'page'}.${suffix}.json` },
          isProduct
            ? { label: 'Product', after: `${draft.productId} → template ${suffix}` }
            : { label: 'Page', after: `/pages/${draft.handle} (unpublished)` },
          { label: 'Section size', after: `${draft.code.length.toLocaleString()} characters` },
        ],
        warnings: [
          ...(draft.status === 'published' ? ['Already published once; this overwrites the preview theme files.'] : []),
          ...(isProduct ? ['The product uses this template on themes that have it; the live theme falls back to its default product page.'] : []),
        ],
      };
    },
    execute: ({ draftId, pageTitle }, { shop }) => publishDraft(shop, draftId, pageTitle),
  }),

  bulkUpdatePrices: action({
    description:
      'Change prices (or compare-at prices) for every variant matching a product search, by a percentage, a fixed amount, or to a set ' +
      'value, with optional rounding to .99/.95/.00. Shows every change in one approval. Up to 500 variants. Requires approval.',
    inputSchema: z.object({
      productQuery: z.string().describe('Shopify product search, e.g. "product_type:snowboard", "tag:winter", "vendor:Oasis Outfitters"'),
      mode: z.enum(['percent', 'amount', 'set']),
      value: z.number().describe('percent: 5 = +5%, -10 = -10%; amount: +/- in store currency; set: the new price'),
      target: z.enum(['price', 'compareAtPrice']).default('price'),
      rounding: z.enum(['none', '.99', '.95', '.00']).default('none'),
    }),
    async preview(input, { shop }) {
      const plan = await planBulkPrices(shop, input);
      return {
        title: `Bulk ${input.target === 'price' ? 'price' : 'compare-at price'} change: ${plan.changes.length} variant${plan.changes.length === 1 ? '' : 's'}`,
        rows: [
          { label: 'Products matching', after: `"${input.productQuery}" (${plan.products} products)` },
          { label: 'Adjustment', after: describeAdjustment(input) },
          ...plan.changes.slice(0, 40).map((c) => ({ label: c.name, before: money(c.before), after: money(c.after) })),
          ...(plan.changes.length > 40 ? [{ label: `…and ${plan.changes.length - 40} more`, after: '' }] : []),
        ],
        warnings: [
          ...(plan.changes.length ? [] : ['No variants would change.']),
          ...(plan.capped ? ['More than 500 variants matched; only the first 500 are included.'] : []),
          ...(plan.changes.some((c) => c.after <= 0.01) ? ['Some prices would drop to the minimum of 0.01.'] : []),
        ],
      };
    },
    async before(input, { shop }) {
      const plan = await planBulkPrices(shop, input);
      if (!plan.changes.length) return null;
      return {
        op: 'restoreVariantPrices',
        args: { changes: plan.changes.map((c) => ({ variantId: c.variantId, price: c.price, compareAtPrice: c.compareAtPrice })) },
        summary: `Restore previous prices on ${plan.changes.length} variant(s)`,
      };
    },
    async execute(input, { shop }) {
      const plan = await planBulkPrices(shop, input);
      if (!plan.changes.length) throw new ShopifyError('No variants matched that search or none would change');
      const changes = plan.changes.map((c) => ({ variantId: c.variantId, [input.target]: c.after }));
      const result = await applyVariantPrices(shop, changes);
      return { ...result, products: plan.products, variants: plan.changes.length };
    },
  }),

  bulkTagCustomers: action({
    description:
      'Add and/or remove tags on every customer in a segment query (e.g. tag everyone who spent over 1000 as "vip"). Up to 250 customers. ' +
      'Requires approval.',
    inputSchema: z
      .object({
        segmentQuery: z.string().describe('Customer segment query, e.g. "amount_spent > 1000"'),
        add: z.array(z.string()).default([]),
        remove: z.array(z.string()).default([]),
      })
      .refine((v) => v.add.length + v.remove.length > 0, 'Provide tags to add or remove'),
    async preview({ segmentQuery, add, remove }, { shop }) {
      const { total, members } = await segmentMembers(shop, { query: segmentQuery, max: 250 });
      const tags = await customerTags(shop, members.slice(0, 25).map((m) => m.id));
      return {
        title: `Tag ${Math.min(total, 250)} customer${total === 1 ? '' : 's'}`,
        rows: [
          { label: 'Segment', after: segmentQuery },
          { label: 'Customers matched', after: String(total) },
          ...(add.length ? [{ label: 'Add tags', after: add.join(', ') }] : []),
          ...(remove.length ? [{ label: 'Remove tags', after: remove.join(', ') }] : []),
          ...members.slice(0, 25).map((m) => {
            const before = tags.get(m.id) ?? [];
            const after = [...new Set([...before.filter((t) => !remove.includes(t)), ...add])];
            return { label: m.displayName, before: before.join(', ') || '(none)', after: after.join(', ') || '(none)' };
          }),
          ...(members.length > 25 ? [{ label: `…and ${members.length - 25} more`, after: '' }] : []),
        ],
        warnings: [...(total ? [] : ['No customers match this segment.']), ...(total > 250 ? [`${total} customers match; only the first 250 will be tagged.`] : [])],
      };
    },
    async before({ segmentQuery, add, remove }, { shop }) {
      const { members } = await segmentMembers(shop, { query: segmentQuery, max: 250 });
      const tags = await customerTags(shop, members.map((m) => m.id));
      const items = members.flatMap((m) => {
        const before = tags.get(m.id) ?? [];
        const added = add.filter((t) => !before.includes(t));
        const removed = remove.filter((t) => before.includes(t));
        return added.length || removed.length ? [{ resourceId: m.id, add: removed, remove: added }] : [];
      });
      return items.length ? { op: 'restoreTagsMany', args: { items }, summary: `Revert tag changes on ${items.length} customer(s)` } : null;
    },
    async execute({ segmentQuery, add, remove }, { shop }) {
      const { members } = await segmentMembers(shop, { query: segmentQuery, max: 250 });
      if (!members.length) throw new ShopifyError('No customers match this segment');
      let updated = 0;
      for (const m of members) {
        await applyTags(shop, m.id, add, remove);
        updated++;
      }
      return { customersUpdated: updated, added: add, removed: remove };
    },
  }),

  updateUnitCosts: action({
    description: 'Set the unit cost (what the store pays per item) on variants, e.g. from a supplier invoice. Used for margin analytics. Requires approval.',
    inputSchema: z.object({
      changes: z.array(z.object({ variantId: gid('ProductVariant'), cost: z.number().nonnegative().nullable() })).min(1).max(250),
    }),
    async preview({ changes }, { shop }) {
      const variants = await loadVariants(shop, changes.map((c) => c.variantId));
      return {
        title: `Update unit cost on ${changes.length} variant${changes.length === 1 ? '' : 's'}`,
        rows: changes.filter((c) => variants.has(c.variantId)).map((c) => {
          const v = variants.get(c.variantId)!;
          const price = Number(v.price);
          const margin = c.cost != null && price > 0 ? ` (margin ${Math.round(((price - c.cost) / price) * 100)}%)` : '';
          return { label: variantLabel(v), before: money(v.inventoryItem.unitCost?.amount), after: `${money(c.cost)}${margin}` };
        }),
        warnings: changes.filter((c) => !variants.has(c.variantId)).map((c) => `Variant ${c.variantId} not found`),
      };
    },
    async before({ changes }, { shop }) {
      const variants = await loadVariants(shop, changes.map((c) => c.variantId));
      const restore = changes.flatMap((c) => {
        const v = variants.get(c.variantId);
        return v ? [{ variantId: v.id, cost: v.inventoryItem.unitCost ? Number(v.inventoryItem.unitCost.amount) : null }] : [];
      });
      return restore.length ? { op: 'updateUnitCosts', args: { changes: restore }, summary: `Restore previous unit costs on ${restore.length} variant(s)` } : null;
    },
    async execute({ changes }, { shop }) {
      const variants = await loadVariants(shop, changes.map((c) => c.variantId));
      let updated = 0;
      for (const c of changes) {
        const v = variants.get(c.variantId);
        if (!v) continue;
        type R = { inventoryItemUpdate: { userErrors: { field: string[]; message: string }[] } };
        const { data } = await adminGraphql<R>(shop, M.INVENTORY_ITEM_UPDATE, { id: v.inventoryItem.id, input: { cost: c.cost } });
        fail(userErrorMessage(data.inventoryItemUpdate));
        updated++;
      }
      return { updated };
    },
  }),

  createCustomerSegment: action({
    description:
      'Save a customer segment in Shopify (usable for targeted discounts, email and ads). Check it first with previewCustomerSegment. Requires approval.',
    inputSchema: z.object({
      name: z.string().min(2).max(255),
      query: z.string().min(3).describe('Customer segment query, e.g. "number_of_orders >= 2 AND last_order_date < -60d"'),
    }),
    async preview({ name, query }, { shop }) {
      try {
        const { total, members } = await segmentMembers(shop, { query, max: 5 });
        return {
          title: `Create customer segment “${name}”`,
          rows: [
            { label: 'Query', after: query },
            { label: 'Customers now', after: String(total) },
            ...members.map((m) => ({ label: 'Example', after: `${m.displayName} · ${m.numberOfOrders} orders` })),
          ],
          warnings: total ? [] : ['No customers match yet; the segment will fill as customers qualify.'],
        };
      } catch (err) {
        return { title: `Create customer segment “${name}”`, rows: [{ label: 'Query', after: query }], warnings: [`Query problem: ${(err as Error).message}`] };
      }
    },
    async execute({ name, query }, { shop }) {
      type R = { segmentCreate: { segment: { id: string; name: string; query: string } | null; userErrors: { field: string[]; message: string }[] } };
      const { data } = await adminGraphql<R>(shop, M.SEGMENT_CREATE, { name, query });
      fail(userErrorMessage(data.segmentCreate));
      return { segment: data.segmentCreate.segment };
    },
    after: (input, result) => {
      const seg = result.segment as { id: string };
      return { op: 'deleteSegment', args: { id: seg.id }, summary: `Delete segment “${input.name}”` };
    },
  }),

  undoAction: action({
    description:
      'Reverse an earlier approved change (find its id with listRecentActions): restores previous prices, product fields, inventory, ' +
      'tags or costs, or deletes something the agent created. Orders that were cancelled or fulfilled and published pages cannot be undone. Requires approval.',
    inputSchema: z.object({ actionId: z.string().describe('Id from listRecentActions') }),
    async preview({ actionId }, { shop }) {
      const a = await getUndoableAction(shop, actionId);
      if (!a) return { title: 'Undo change', rows: [], warnings: ['Action not found'] };
      return {
        title: `Undo: ${a.undo?.summary ?? a.tool}`,
        rows: [
          { label: 'Original change', after: a.tool },
          { label: 'Made', after: a.createdAt.toLocaleString() },
          { label: 'Undo does', after: a.undo?.summary ?? 'Not available' },
        ],
        warnings: [
          ...(a.undoneAt ? ['Already undone.'] : []),
          ...(!a.undo ? [`${a.tool} can't be undone automatically.`] : []),
          ...(a.status !== 'succeeded' ? ['That change failed, so there is nothing to undo.'] : []),
        ],
      };
    },
    // Executed via undoAction() below; createWriteTools routes this tool there so it isn't logged twice.
    execute: async () => ({}),
  }),
};

export type WriteToolName = keyof typeof WRITE_ACTIONS;
export const WRITE_TOOL_NAMES = Object.keys(WRITE_ACTIONS) as WriteToolName[];
export const isWriteTool = (name: string): name is WriteToolName => name in WRITE_ACTIONS;

async function loadLevel(shop: string, variantId: string, locationId: string) {
  type R = {
    productVariant: {
      title: string; sku: string | null; product: { title: string };
      inventoryItem: { id: string; tracked: boolean; inventoryLevel: { location: { name: string }; quantities: { quantity: number }[] } | null };
    } | null;
  };
  const { data } = await adminGraphql<R>(shop, M.INVENTORY_LEVEL_FOR_PREVIEW, { variantId, locationId });
  const v = data.productVariant;
  const level = v?.inventoryItem.inventoryLevel;
  if (!v || !level) return null;
  return {
    label: `${v.product.title}${v.title !== 'Default Title' ? ` / ${v.title}` : ''}`,
    inventoryItemId: v.inventoryItem.id,
    tracked: v.inventoryItem.tracked,
    locationName: level.location.name,
    available: level.quantities[0]?.quantity ?? 0,
  };
}

type PreviewOrder = {
  id: string; name: string; cancelledAt: string | null; displayFinancialStatus: string; displayFulfillmentStatus: string;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } }; customer: { displayName: string } | null;
  fulfillmentOrders: { nodes: { id: string; status: string; lineItems: { nodes: { remainingQuantity: number; lineItem: { title: string } }[] } }[] };
};
async function loadOrder(shop: string, id: string) {
  const { data } = await adminGraphql<{ order: PreviewOrder | null }>(shop, M.ORDER_FOR_PREVIEW, { id });
  return data.order;
}

/** Computes the approval preview for a proposed write, validating the input the same way execution will. */
export async function previewWrite(shop: string, name: string, rawInput: unknown): Promise<ActionPreview> {
  if (!isWriteTool(name)) throw new Error(`Unknown write tool ${name}`);
  const def = WRITE_ACTIONS[name] as WriteAction<z.ZodType>;
  const parsed = def.inputSchema.safeParse(rawInput);
  if (!parsed.success) return { title: name, rows: [], warnings: [z.prettifyError(parsed.error)] };
  try {
    return await def.preview(parsed.data, { shop });
  } catch (err) {
    return { title: name, rows: [], warnings: [`Could not load a preview: ${(err as Error).message}`] };
  }
}

function describeAdjustment(a: { mode: string; value: number; target: string; rounding: string }) {
  const what = a.target === 'price' ? 'price' : 'compare-at price';
  const how = a.mode === 'percent' ? `${a.value >= 0 ? '+' : ''}${a.value}%` : a.mode === 'amount' ? `${a.value >= 0 ? '+' : ''}${money(a.value)}` : `set to ${money(a.value)}`;
  return `${what} ${how}${a.rounding !== 'none' ? `, rounded to ${a.rounding}` : ''}`;
}

type BulkVariant = { id: string; title: string; sku: string | null; price: string; compareAtPrice: string | null };

/** Resolves a product search to the exact per-variant price changes (shared by preview, undo capture and execute). */
async function planBulkPrices(
  shop: string,
  input: { productQuery: string; mode: 'percent' | 'amount' | 'set'; value: number; target: 'price' | 'compareAtPrice'; rounding: 'none' | '.99' | '.95' | '.00' },
) {
  const changes: { variantId: string; name: string; before: number; after: number; price: number; compareAtPrice: number | null }[] = [];
  let after: string | null = null;
  let products = 0;
  let capped = false;
  for (let page = 0; page < 10 && !capped; page++) {
    type R = { products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: { id: string; title: string; variants: { nodes: BulkVariant[] } }[] } };
    const { data }: { data: R } = await adminGraphql(shop, M.BULK_PRODUCTS, { first: 50, after, query: input.productQuery });
    for (const p of data.products.nodes) {
      products++;
      for (const v of p.variants.nodes) {
        const price = Number(v.price);
        const compareAtPrice = v.compareAtPrice == null ? null : Number(v.compareAtPrice);
        const base = input.target === 'price' ? price : compareAtPrice ?? price;
        const next = adjustPrice(base, input);
        if (input.target === 'price' ? next === price : next === compareAtPrice) continue;
        if (changes.length >= 500) { capped = true; break; }
        changes.push({ variantId: v.id, name: `${p.title}${v.title !== 'Default Title' ? ` / ${v.title}` : ''}`, before: input.target === 'price' ? price : compareAtPrice ?? 0, after: next, price, compareAtPrice });
      }
    }
    if (!data.products.pageInfo.hasNextPage) break;
    after = data.products.pageInfo.endCursor;
  }
  return { changes, products, capped };
}

async function customerTags(shop: string, ids: string[]) {
  const out = new Map<string, string[]>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await adminGraphql<{ nodes: ({ id: string; tags: string[] } | null)[] }>(shop, M.CUSTOMER_TAGS, { ids: ids.slice(i, i + 100) });
    for (const n of data.nodes) if (n?.id) out.set(n.id, n.tags);
  }
  return out;
}

/** Runs one write with its undo capture and audit log entry. Shared by the agent tools and the undo API. */
export async function runWrite(
  shop: string,
  name: WriteToolName,
  input: unknown,
  { conversationId = null, undoOf = null }: { conversationId?: string | null; undoOf?: string | null } = {},
) {
  const def = WRITE_ACTIONS[name] as WriteAction<z.ZodType>;
  try {
    // The before-state is read just before the change so the undo restores what the user actually saw.
    // An undo is final: it isn't itself undoable (that would be a redo and confuse "undo the last change").
    const captured = def.before && !undoOf ? await def.before(input, { shop }).catch(() => null) : null;
    const result = await def.execute(input, { shop });
    const undo = undoOf ? null : def.after ? def.after(input, result) : captured;
    const [row] = await db
      .insert(schema.actionLog)
      .values({ shop, conversationId, tool: name, input: input as object, result, status: 'succeeded', undo, undoOf })
      .returning({ id: schema.actionLog.id });
    return { ok: true as const, actionId: row.id, undoable: Boolean(undo), ...result };
  } catch (err) {
    const message = (err as Error).message;
    await db.insert(schema.actionLog).values({ shop, conversationId, tool: name, input: input as object, result: { error: message }, status: 'failed', undoOf });
    return { ok: false as const, error: message };
  }
}

/** Undo-only operations (deletes for creations, unbounded restores for bulk changes); other undos re-run a write action. */
const DELETE_OPS: Record<string, (shop: string, args: never) => Promise<void>> = {
  async restoreVariantPrices(shop, { changes }: { changes: { variantId: string; price: number; compareAtPrice: number | null }[] }) {
    await applyVariantPrices(shop, changes);
  },
  async restoreTagsMany(shop, { items }: { items: { resourceId: string; add: string[]; remove: string[] }[] }) {
    for (const item of items) await applyTags(shop, item.resourceId, item.add, item.remove);
  },
  async deleteDiscount(shop, { id }: { id: string }) {
    const { data } = await adminGraphql<{ discountCodeDelete: { userErrors: { field: string[]; message: string }[] } }>(shop, M.DISCOUNT_CODE_DELETE, { id });
    fail(userErrorMessage(data.discountCodeDelete));
  },
  async deleteDraftOrder(shop, { id }: { id: string }) {
    const { data } = await adminGraphql<{ draftOrderDelete: { userErrors: { field: string[]; message: string }[] } }>(shop, M.DRAFT_ORDER_DELETE, { input: { id } });
    fail(userErrorMessage(data.draftOrderDelete));
  },
  async deleteProduct(shop, { id }: { id: string }) {
    const { data } = await adminGraphql<{ productDelete: { userErrors: { field: string[]; message: string }[] } }>(shop, M.PRODUCT_DELETE, { input: { id } });
    fail(userErrorMessage(data.productDelete));
  },
  async deleteSegment(shop, { id }: { id: string }) {
    const { data } = await adminGraphql<{ segmentDelete: { userErrors: { field: string[]; message: string }[] } }>(shop, M.SEGMENT_DELETE, { id });
    fail(userErrorMessage(data.segmentDelete));
  },
};

/** Recent agent changes with whether each can still be undone (read-only helper for the agent and UI). */
export async function listRecentActions(shop: string, limit = 20) {
  const rows = await db.query.actionLog.findMany({
    where: eq(schema.actionLog.shop, shop),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    limit,
  });
  return rows.map((r) => ({
    id: r.id, tool: r.tool, status: r.status, createdAt: r.createdAt, conversationId: r.conversationId,
    undo: r.undo?.summary ?? null, undoable: Boolean(r.undo) && !r.undoneAt && !r.undoOf && r.status === 'succeeded', undoneAt: r.undoneAt, undoOf: r.undoOf,
  }));
}

export async function getUndoableAction(shop: string, actionId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(actionId)) return null;
  return (await db.query.actionLog.findFirst({ where: and(eq(schema.actionLog.id, actionId), eq(schema.actionLog.shop, shop)) })) ?? null;
}

/** Reverses a logged write and marks it undone. Returns a result shaped like a write tool's. */
export async function undoAction(shop: string, actionId: string, conversationId: string | null = null) {
  const action = await getUndoableAction(shop, actionId);
  if (!action) return { ok: false as const, error: 'Action not found' };
  if (action.status !== 'succeeded') return { ok: false as const, error: 'Only successful actions can be undone' };
  if (action.undoneAt) return { ok: false as const, error: 'This action was already undone' };
  if (action.undoOf) return { ok: false as const, error: 'That entry is itself an undo; undos are final' };
  if (!action.undo) return { ok: false as const, error: `${action.tool} can't be undone automatically` };

  const { op, args, summary } = action.undo;
  let result: { ok: boolean; error?: string };
  if (op in DELETE_OPS) {
    try {
      await DELETE_OPS[op](shop, args as never);
      await db.insert(schema.actionLog).values({ shop, conversationId, tool: `undo:${op}`, input: args as object, result: { summary }, status: 'succeeded', undoOf: actionId });
      result = { ok: true };
    } catch (err) {
      const message = (err as Error).message;
      await db.insert(schema.actionLog).values({ shop, conversationId, tool: `undo:${op}`, input: args as object, result: { error: message }, status: 'failed', undoOf: actionId });
      result = { ok: false, error: message };
    }
  } else if (isWriteTool(op)) {
    const parsed = WRITE_ACTIONS[op].inputSchema.safeParse(args);
    if (!parsed.success) return { ok: false as const, error: `Stored undo is invalid: ${z.prettifyError(parsed.error)}` };
    result = await runWrite(shop, op, parsed.data, { conversationId, undoOf: actionId });
  } else {
    return { ok: false as const, error: `Unknown undo operation ${op}` };
  }
  if (result.ok) await db.update(schema.actionLog).set({ undoneAt: new Date() }).where(eq(schema.actionLog.id, actionId));
  return result.ok ? { ok: true as const, undone: actionId, summary } : { ok: false as const, error: result.error ?? 'Undo failed' };
}

/** Write tools bound to one shop and conversation; every execution is recorded in action_log. */
export function createWriteTools(shop: string, conversationId: string) {
  const tools = {} as Record<WriteToolName, Tool>;
  for (const name of WRITE_TOOL_NAMES) {
    const def = WRITE_ACTIONS[name] as WriteAction<z.ZodType>;
    tools[name] = tool({
      description: def.description,
      inputSchema: def.inputSchema,
      execute: async (input: unknown): Promise<Record<string, unknown>> =>
        name === 'undoAction'
          ? undoAction(shop, (input as { actionId: string }).actionId, conversationId)
          : runWrite(shop, name, input, { conversationId }),
    });
  }
  return tools as { [K in WriteToolName]: Tool<z.input<(typeof WRITE_ACTIONS)[K]['inputSchema']>, Record<string, unknown>> };
}
