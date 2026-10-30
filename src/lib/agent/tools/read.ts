import 'server-only';
import { tool } from 'ai';
import { z } from 'zod';
import { adminGraphql, adminUrl, ShopifyError } from '../../shopify/admin';
import { guardReadOnlyQuery } from '../../shopify/guard';
import * as Q from '../../shopify/queries';
import { runShopifyQL } from '../../dashboards';

type Money = { shopMoney: { amount: string; currencyCode: string } } | null | undefined;
const amount = (m: Money) => (m ? Number(m.shopMoney.amount) : 0);
const nodes = <T>(conn: { nodes: T[] } | null | undefined) => conn?.nodes ?? [];

const MAX_OUTPUT_CHARS = 24_000;

/** Keeps tool results small enough for the context window. */
function clip<T>(value: T): T | { truncated: true; preview: string } {
  const json = JSON.stringify(value);
  return json.length <= MAX_OUTPUT_CHARS ? value : { truncated: true, preview: json.slice(0, MAX_OUTPUT_CHARS) };
}

/** Turns Shopify failures into a result the model can read and recover from, instead of a thrown error. */
async function safely<T>(fn: () => Promise<T>) {
  try {
    return clip(await fn());
  } catch (err) {
    if (err instanceof ShopifyError) {
      if (/protected-customer-data|not approved to access the (Order|Customer|DraftOrder)|Level 2 access/i.test(err.message)) {
        return {
          error: err.message,
          blockedBy: 'protected_customer_data',
          explainToUser:
            'Shopify is withholding orders, customers and analytics until the app declares protected customer data access. ' +
            'Fix (one time, no review for dev stores): Partner Dashboard -> Apps -> Oasis Agent -> API access requests -> ' +
            'Protected customer data access -> select the data and the Name, Email, Phone and Address fields with reasons -> Save. ' +
            'Products, inventory and discounts still work meanwhile.',
        };
      }
      return { error: err.message };
    }
    throw err;
  }
}

const gid = (type: string) =>
  z.string().describe(`Shopify GID like gid://shopify/${type}/123, or the numeric id`).transform((v) =>
    v.startsWith('gid://') ? v : `gid://shopify/${type}/${v.replace(/\D/g, '')}`,
  );

const page = {
  first: z.number().int().min(1).max(100).default(25).describe('Page size (max 100)'),
  after: z.string().optional().describe('Cursor from a previous page (pageInfo.endCursor)'),
  reverse: z.boolean().default(true).describe('true = descending'),
};

/** Read-only tools bound to one shop. */
export function createReadTools(shop: string) {
  const run = <T>(query: string, variables?: Record<string, unknown>) => adminGraphql<T>(shop, query, variables);

  return {
    getShopOverview: tool({
      description: 'Store basics: name, currency, timezone, plan, counts of orders/products/customers, open work, and locations.',
      inputSchema: z.object({}),
      execute: () =>
        safely(async () => {
          const { data } = await run<{
            shop: { name: string; myshopifyDomain: string; currencyCode: string; ianaTimezone: string; plan: { publicDisplayName: string } };
            orders: { count: number }; openUnfulfilled: { count: number }; pendingPayment: { count: number };
            products: { count: number }; customers: { count: number };
            locations: { nodes: { id: string; name: string; isActive: boolean }[] };
          }>(Q.SHOP_OVERVIEW);
          return {
            ...data.shop,
            plan: data.shop.plan.publicDisplayName,
            counts: {
              orders: data.orders.count,
              openUnfulfilledOrders: data.openUnfulfilled.count,
              pendingPaymentOrders: data.pendingPayment.count,
              products: data.products.count,
              customers: data.customers.count,
            },
            locations: data.locations.nodes,
          };
        }),
    }),

    searchOrders: tool({
      description:
        'List or filter orders. `query` uses Shopify search syntax, e.g. "financial_status:paid", "fulfillment_status:unfulfilled", ' +
        '"status:cancelled", "created_at:>=2026-10-01", "customer_id:123", "tag:gift", "sku:HOODIE-M", "discount_code:SNOW20". ' +
        'Combine terms with spaces (AND) or OR. For totals/trends over many orders prefer runShopifyQL.',
      inputSchema: z.object({
        query: z.string().optional(),
        sortKey: z.enum(['CREATED_AT', 'PROCESSED_AT', 'TOTAL_PRICE', 'ORDER_NUMBER', 'CUSTOMER_NAME', 'UPDATED_AT']).default('PROCESSED_AT'),
        ...page,
      }),
      execute: (input) =>
        safely(async () => {
          type Order = {
            id: string; name: string; createdAt: string; processedAt: string; cancelledAt: string | null; sourceName: string | null;
            tags: string[]; displayFinancialStatus: string; displayFulfillmentStatus: string; totalPriceSet: Money; totalRefundedSet: Money;
            discountCodes: string[]; customer: { id: string; displayName: string } | null; currentSubtotalLineItemsQuantity: number;
            lineItems: { nodes: { title: string; quantity: number; sku: string | null }[] };
          };
          const { data } = await run<{ orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Order[] } }>(
            Q.SEARCH_ORDERS, input,
          );
          return {
            orders: data.orders.nodes.map((o) => ({
              id: o.id, name: o.name, processedAt: o.processedAt, cancelledAt: o.cancelledAt,
              financialStatus: o.displayFinancialStatus, fulfillmentStatus: o.displayFulfillmentStatus,
              total: amount(o.totalPriceSet), refunded: amount(o.totalRefundedSet), currency: o.totalPriceSet?.shopMoney.currencyCode,
              customer: o.customer, items: o.currentSubtotalLineItemsQuantity,
              lineItems: nodes(o.lineItems).map((l) => `${l.quantity}× ${l.title}`),
              discountCodes: o.discountCodes, tags: o.tags, source: o.sourceName, adminUrl: adminUrl(shop, o.id),
            })),
            pageInfo: data.orders.pageInfo,
          };
        }),
    }),

    getOrder: tool({
      description: 'Full details for one order: line items, totals, discounts, transactions, fulfillments and tracking, shipping address.',
      inputSchema: z.object({ id: gid('Order') }),
      execute: ({ id }) =>
        safely(async () => {
          const { data } = await run<{ order: Record<string, unknown> | null }>(Q.GET_ORDER, { id });
          if (!data.order) return { error: `Order ${id} not found` };
          return { ...data.order, adminUrl: adminUrl(shop, id) };
        }),
    }),

    searchProducts: tool({
      description:
        'List or filter products. `query` uses Shopify search syntax, e.g. "status:active", "vendor:\'Oasis Outfitters\'", ' +
        '"product_type:Accessories", "tag:winter", "title:*snowboard*", "inventory_total:<10".',
      inputSchema: z.object({
        query: z.string().optional(),
        sortKey: z.enum(['TITLE', 'CREATED_AT', 'UPDATED_AT', 'INVENTORY_TOTAL', 'PRODUCT_TYPE', 'VENDOR']).default('TITLE'),
        ...page,
        reverse: z.boolean().default(false),
      }),
      execute: (input) =>
        safely(async () => {
          type P = {
            id: string; title: string; handle: string; status: string; vendor: string; productType: string; tags: string[];
            totalInventory: number; variantsCount: { count: number };
            priceRangeV2: { minVariantPrice: { amount: string }; maxVariantPrice: { amount: string } };
          };
          const { data } = await run<{ products: { pageInfo: unknown; nodes: P[] } }>(Q.SEARCH_PRODUCTS, input);
          return {
            products: data.products.nodes.map((p) => ({
              id: p.id, title: p.title, handle: p.handle, status: p.status, vendor: p.vendor, type: p.productType, tags: p.tags,
              totalInventory: p.totalInventory, variants: p.variantsCount.count,
              minPrice: Number(p.priceRangeV2.minVariantPrice.amount), maxPrice: Number(p.priceRangeV2.maxVariantPrice.amount),
              adminUrl: adminUrl(shop, p.id),
            })),
            pageInfo: data.products.pageInfo,
          };
        }),
    }),

    getProduct: tool({
      description: 'One product with all variants (id, sku, price, compare-at price) and inventory by location.',
      inputSchema: z.object({ id: gid('Product') }),
      execute: ({ id }) =>
        safely(async () => {
          const { data } = await run<{ product: Record<string, unknown> | null }>(Q.GET_PRODUCT, { id });
          if (!data.product) return { error: `Product ${id} not found` };
          return { ...data.product, adminUrl: adminUrl(shop, id) };
        }),
    }),

    getLowInventory: tool({
      description: 'Variants at or below a stock threshold, lowest first. Only inventory-tracked variants are meaningful.',
      inputSchema: z.object({
        threshold: z.number().int().default(10),
        first: z.number().int().min(1).max(100).default(25),
      }),
      execute: ({ threshold, first }) =>
        safely(async () => {
          type V = {
            id: string; title: string; sku: string | null; inventoryQuantity: number; price: string;
            inventoryItem: { tracked: boolean }; product: { id: string; title: string; status: string };
          };
          const { data } = await run<{ productVariants: { nodes: V[] } }>(Q.LOW_INVENTORY, {
            first, query: `inventory_quantity:<=${threshold} product_status:active`,
          });
          return {
            variants: data.productVariants.nodes
              .filter((v) => v.inventoryItem.tracked)
              .map((v) => ({
                id: v.id, product: v.product.title, productId: v.product.id, variant: v.title, sku: v.sku,
                available: v.inventoryQuantity, price: Number(v.price),
              })),
          };
        }),
    }),

    searchCustomers: tool({
      description:
        'List or filter customers with lifetime spend and order count. `query` examples: "tag:vip", "country:Canada", ' +
        '"orders_count:>2", "total_spent:>500", "email:ava*". Use RELEVANCE sort only with a query; for top spenders use getTopCustomers.',
      inputSchema: z.object({
        query: z.string().optional(),
        sortKey: z.enum(['NAME', 'CREATED_AT', 'UPDATED_AT', 'LOCATION', 'RELEVANCE', 'ID']).default('UPDATED_AT'),
        ...page,
      }),
      execute: (input) =>
        safely(async () => {
          type C = {
            id: string; displayName: string; createdAt: string; tags: string[]; numberOfOrders: string;
            defaultEmailAddress: { emailAddress: string } | null; amountSpent: { amount: string; currencyCode: string };
            defaultAddress: { city: string; provinceCode: string; countryCodeV2: string } | null;
            lastOrder: { id: string; name: string; createdAt: string } | null;
          };
          const { data } = await run<{ customers: { pageInfo: unknown; nodes: C[] } }>(Q.SEARCH_CUSTOMERS, input);
          return {
            customers: data.customers.nodes.map((c) => ({
              id: c.id, name: c.displayName, email: c.defaultEmailAddress?.emailAddress, tags: c.tags,
              orders: Number(c.numberOfOrders), amountSpent: Number(c.amountSpent.amount), currency: c.amountSpent.currencyCode,
              location: c.defaultAddress ? `${c.defaultAddress.city}, ${c.defaultAddress.provinceCode} ${c.defaultAddress.countryCodeV2}` : null,
              lastOrder: c.lastOrder, since: c.createdAt, adminUrl: adminUrl(shop, c.id),
            })),
            pageInfo: data.customers.pageInfo,
          };
        }),
    }),

    getTopCustomers: tool({
      description: 'Customers ranked by lifetime amount spent (highest first).',
      inputSchema: z.object({ limit: z.number().int().min(1).max(50).default(10) }),
      execute: ({ limit }) =>
        safely(async () => {
          // The customers connection can't sort by spend, so rank one page of up to 250 locally.
          type C = { id: string; displayName: string; numberOfOrders: string; amountSpent: { amount: string; currencyCode: string } };
          const { data } = await run<{ customers: { nodes: C[] } }>(Q.SEARCH_CUSTOMERS, { first: 250, query: 'orders_count:>0' });
          return {
            customers: data.customers.nodes
              .map((c) => ({ id: c.id, name: c.displayName, orders: Number(c.numberOfOrders), amountSpent: Number(c.amountSpent.amount) }))
              .sort((a, b) => b.amountSpent - a.amountSpent)
              .slice(0, limit),
          };
        }),
    }),

    getCustomer: tool({
      description: 'One customer: contact info, marketing consent, tags, notes, lifetime spend and their 20 most recent orders.',
      inputSchema: z.object({ id: gid('Customer') }),
      execute: ({ id }) =>
        safely(async () => {
          const { data } = await run<{ customer: Record<string, unknown> | null }>(Q.GET_CUSTOMER, { id });
          if (!data.customer) return { error: `Customer ${id} not found` };
          return { ...data.customer, adminUrl: adminUrl(shop, id) };
        }),
    }),

    listDiscounts: tool({
      description: 'Discounts (codes and automatic) with status, value, usage count and dates. Optional search, e.g. "status:active".',
      inputSchema: z.object({ query: z.string().optional(), first: z.number().int().min(1).max(100).default(50) }),
      execute: (input) =>
        safely(async () => {
          const { data } = await run<{ discountNodes: { nodes: { id: string; discount: Record<string, unknown> }[] } }>(Q.LIST_DISCOUNTS, input);
          return { discounts: data.discountNodes.nodes.map((n) => ({ id: n.id, ...n.discount })) };
        }),
    }),

    listDraftOrders: tool({
      description: 'Draft orders, newest first. Optional search, e.g. "status:open", "tag:seed".',
      inputSchema: z.object({ query: z.string().optional(), first: z.number().int().min(1).max(100).default(25) }),
      execute: (input) =>
        safely(async () => {
          type D = {
            id: string; name: string; status: string; createdAt: string; note2: string | null; tags: string[];
            customer: { displayName: string } | null; totalPriceSet: Money; order: { name: string } | null;
            lineItems: { nodes: { title: string; quantity: number }[] };
          };
          const { data } = await run<{ draftOrders: { nodes: D[] } }>(Q.LIST_DRAFT_ORDERS, input);
          return {
            draftOrders: data.draftOrders.nodes.map((d) => ({
              id: d.id, name: d.name, status: d.status, createdAt: d.createdAt, customer: d.customer?.displayName,
              total: amount(d.totalPriceSet), convertedToOrder: d.order?.name ?? null, note: d.note2, tags: d.tags,
              lineItems: nodes(d.lineItems).map((l) => `${l.quantity}× ${l.title}`), adminUrl: adminUrl(shop, d.id),
            })),
          };
        }),
    }),

    runShopifyQL: tool({
      description:
        'Run a ShopifyQL analytics query (aggregated sales/orders/products/customers metrics, time series, comparisons). ' +
        'Syntax: FROM <schema> SHOW <metrics> [GROUP BY <dims>] [TIMESERIES day|week|month] [SINCE <start> UNTIL <end> | DURING <named range>] ' +
        '[COMPARE TO previous_period] [ORDER BY ...] [LIMIT n]. Examples: ' +
        '"FROM sales SHOW total_sales, orders TIMESERIES day SINCE -30d UNTIL today ORDER BY day ASC", ' +
        '"FROM sales SHOW total_sales, orders GROUP BY product_title SINCE -90d UNTIL today ORDER BY total_sales DESC LIMIT 10", ' +
        '"FROM sales SHOW gross_sales, discounts, returns, net_sales, total_sales DURING last_month". ' +
        'If parseErrors come back, fix the query and retry.',
      inputSchema: z.object({ query: z.string().describe('ShopifyQL text (FROM ... SHOW ...), not GraphQL') }),
      execute: ({ query }) =>
        safely(async () => {
          try {
            const rows = await runShopifyQL(shop, query);
            return { columns: rows[0] ? Object.keys(rows[0]) : [], rows, rowCount: rows.length };
          } catch (err) {
            const msg = (err as Error).message;
            if (msg.startsWith('ShopifyQL error:')) return { parseErrors: msg.slice(16).trim(), query };
            throw err;
          }
        }),
    }),

    runAdminGraphQL: tool({
      description:
        'Escape hatch: run an arbitrary read-only Admin GraphQL query when no other tool fits. Mutations are rejected. ' +
        'Keep selections small and use first: <= 50.',
      inputSchema: z.object({
        query: z.string(),
        variables: z.record(z.string(), z.unknown()).optional(),
      }),
      execute: ({ query, variables }) =>
        safely(async () => {
          const guard = guardReadOnlyQuery(query);
          if (!guard.ok) return { error: guard.reason };
          const { data, cost } = await run(query, variables);
          return { data, cost: cost?.actualQueryCost };
        }),
    }),
  };
}
