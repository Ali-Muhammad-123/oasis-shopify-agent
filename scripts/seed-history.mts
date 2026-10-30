// Backfills order history so analytics have shape: orders spread over the last N days, created with
// orderCreate (needs the app's offline token, stored by the OAuth install) and backdated via processedAt.
// Dev stores throttle API order creation to a few per minute, so orders are paced (--delay ms) and retried when throttled.
// Usage: pnpm seed:history [--orders 150] [--days 90] [--delay 13000] [--seed 4242] [--shop store.myshopify.com]
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { adminGraphql, userErrorMessage } from '../src/lib/shopify/admin';

const args = process.argv.slice(2);
const flag = (name: string, dflt: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const ORDERS = Number(flag('orders', '150'));
const DAYS = Number(flag('days', '90'));
const DELAY_MS = Number(flag('delay', '13000'));
const shop = flag('shop', process.env.SHOPIFY_SHOP ?? '');
if (!shop) throw new Error('Pass --shop or set SHOPIFY_SHOP');

const ORDER_CREATE = readFileSync(new URL('./shopify-seed/graphql/orderCreate.graphql', import.meta.url), 'utf8');
const LOOKUP = /* GraphQL */ `
  query SeedLookup {
    shop { currencyCode }
    products(first: 100, query: "status:active") {
      nodes { title variants(first: 10) { nodes { id price } } }
    }
    customers(first: 100) { nodes { id defaultEmailAddress { emailAddress } defaultAddress { address1 city provinceCode countryCodeV2 zip firstName lastName } } }
  }
`;

let seed = Number(flag('seed', '4242'));
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

type Lookup = {
  shop: { currencyCode: string };
  products: { nodes: { title: string; variants: { nodes: { id: string; price: string }[] } }[] };
  customers: { nodes: { id: string; defaultEmailAddress: { emailAddress: string } | null; defaultAddress: Record<string, string> | null }[] };
};
const { data } = await adminGraphql<Lookup>(shop, LOOKUP);
const currencyCode = data.shop.currencyCode;
const variants = data.products.nodes
  .filter((p) => p.title !== 'Gift Card')
  .flatMap((p) => p.variants.nodes.map((v) => ({ id: v.id, price: Number(v.price) })))
  .filter((v) => v.price > 0);
const customers = data.customers.nodes.filter((c) => c.defaultEmailAddress && c.defaultAddress);
// Query shape -> MailingAddressInput (the input names the country field countryCode).
const toAddressInput = ({ countryCodeV2, ...rest }: Record<string, string>) => ({ ...rest, countryCode: countryCodeV2 });
console.log(`Seeding ${ORDERS} historical orders over ${DAYS} days for ${shop} (${variants.length} variants, ${customers.length} customers)`);

// Weight recent days and weekends a little higher so charts show a trend, not noise.
function processedAt() {
  const daysAgo = Math.floor(Math.pow(rand(), 1.3) * DAYS) + 1;
  const d = new Date(Date.now() - daysAgo * 86_400_000);
  if ((d.getDay() === 0 || d.getDay() === 6) && rand() < 0.3) d.setDate(d.getDate() - 1);
  d.setHours(int(8, 22), int(0, 59), int(0, 59));
  return d.toISOString();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let ok = 0;
for (let i = 0; i < ORDERS; i++) {
  const customer = pick(customers);
  const when = processedAt();
  const lines = new Map<string, { variantId: string; quantity: number; price: number }>();
  const count = rand() < 0.6 ? 1 : int(2, 3);
  while (lines.size < count) {
    const v = pick(variants);
    lines.set(v.id, { variantId: v.id, quantity: rand() < 0.85 ? 1 : 2, price: v.price });
  }
  const subtotal = [...lines.values()].reduce((s, l) => s + l.price * l.quantity, 0);
  const shipping = subtotal >= 100 ? 0 : 9.99;
  const r = rand();
  const financialStatus = r < 0.9 ? 'PAID' : r < 0.96 ? 'REFUNDED' : 'PENDING';
  const order = {
    customer: { toAssociate: { id: customer.id } },
    email: customer.defaultEmailAddress!.emailAddress,
    lineItems: [...lines.values()].map(({ variantId, quantity }) => ({ variantId, quantity })),
    processedAt: when,
    financialStatus,
    ...(financialStatus === 'PAID' ? { fulfillmentStatus: 'FULFILLED' } : {}),
    transactions: financialStatus === 'PENDING' ? [] : [{
      kind: 'SALE', status: 'SUCCESS', gateway: 'manual', processedAt: when,
      amountSet: { shopMoney: { amount: (subtotal + shipping).toFixed(2), currencyCode } },
    }],
    shippingAddress: toAddressInput(customer.defaultAddress!),
    billingAddress: toAddressInput(customer.defaultAddress!),
    shippingLines: [{ title: shipping ? 'Standard Shipping' : 'Free Shipping', priceSet: { shopMoney: { amount: shipping.toFixed(2), currencyCode } } }],
    tags: ['seed', 'history'],
  };
  let fatal = false;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const res = await adminGraphql<{ orderCreate: { order: { name: string } | null; userErrors: { field: string[]; message: string }[] } }>(
        shop, ORDER_CREATE, { order, options: { inventoryBehaviour: 'BYPASS', sendReceipt: false, sendFulfillmentReceipt: false } },
      );
      const err = userErrorMessage(res.data.orderCreate);
      if (err && /too many attempts/i.test(err)) throw new Error(err);
      if (err) console.log(`  FAIL  ${i + 1}: ${err}`);
      else {
        ok++;
        if (ok % 10 === 0) console.log(`  ${ok} created (latest ${res.data.orderCreate.order?.name} @ ${when.slice(0, 10)})`);
      }
      break;
    } catch (err) {
      const msg = (err as Error).message;
      if (/too many attempts/i.test(msg) && attempt < 6) {
        console.log(`  throttled on order ${i + 1}; waiting 65s (attempt ${attempt})`);
        await sleep(65_000);
        continue;
      }
      console.log(`  FAIL  ${i + 1}: ${msg}`);
      fatal = /access|scope|401/i.test(msg);
      break;
    }
  }
  if (fatal) break;
  if (i < ORDERS - 1) await sleep(DELAY_MS);
}
console.log(`Done: ${ok}/${ORDERS} orders created.`);
process.exit(0);
