#!/usr/bin/env node
// Seeds a Shopify dev store with customers, products, orders, discounts and draft orders.
// Usage: node seed.mjs <store>.myshopify.com [--orders 60] [--customers 25] [--drafts 5] [--seed N]
// Requires: shopify store auth --store <store> --scopes read_products,write_products,
//   read_customers,write_customers,read_orders,write_orders,read_draft_orders,
//   write_draft_orders,read_inventory,write_inventory,read_locations,read_discounts,write_discounts,
//   read_merchant_managed_fulfillment_orders,write_merchant_managed_fulfillment_orders
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const store = args.find((a) => a.endsWith('.myshopify.com'));
if (!store) {
  console.error('Usage: node seed.mjs <store>.myshopify.com [--orders N] [--customers N]');
  process.exit(1);
}
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : dflt;
};
const ORDER_COUNT = flag('orders', 60);
const CUSTOMER_COUNT = flag('customers', 25);
const DRAFT_COUNT = flag('drafts', 5);

const gqlDir = join(dirname(fileURLToPath(import.meta.url)), 'graphql');
const gql = (name) => readFileSync(join(gqlDir, `${name}.graphql`), 'utf8');

function run(name, variables = {}, { mutation = true } = {}) {
  const cmdArgs = ['store', 'execute', '-s', store, '-j', '-q', gql(name), '-v', JSON.stringify(variables)];
  if (mutation) cmdArgs.push('--allow-mutations');
  let out;
  try {
    out = execFileSync('shopify', cmdArgs, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 50 * 1024 * 1024,
      env: { ...process.env, SHOPIFY_CLI_AGENT_INFO: 'n:claude-code|v:2.1.312|p:anthropic|m:claude-opus-5-5' },
    });
  } catch (err) {
    throw new Error(`${name} failed: ${err.stdout || ''}${err.stderr || err.message}`);
  }
  // Output may include NDJSON progress lines before the final pretty-printed result.
  const start = out.search(/^\{\s*$/m);
  const res = JSON.parse(start >= 0 ? out.slice(start) : out);
  if (res.errors) throw new Error(`${name}: ${JSON.stringify(res.errors)}`);
  return res.data;
}

function userErrors(payload) {
  const errs = payload.userErrors || payload.orderCancelUserErrors || [];
  return errs.length ? errs.map((e) => `${(e.field || []).join('.')}: ${e.message}`).join('; ') : null;
}

// Deterministic randomness so reruns produce the same shape of data.
let seed = flag('seed', 20261029);
const rand = () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const int = (min, max) => min + Math.floor(rand() * (max - min + 1));
const money = (n) => n.toFixed(2);

const FIRST = ['Ava', 'Liam', 'Maya', 'Noah', 'Zara', 'Ethan', 'Leila', 'Omar', 'Chloe', 'Lucas', 'Priya', 'Mateo',
  'Hana', 'Jonah', 'Sofia', 'Kai', 'Amara', 'Diego', 'Nora', 'Yusuf', 'Isla', 'Theo', 'Mina', 'Felix', 'Aisha', 'Ravi',
  'Elena', 'Sami', 'Grace', 'Arjun'];
const LAST = ['Patel', 'Nguyen', 'Garcia', 'Kim', 'Okafor', 'Smith', 'Haddad', 'Rossi', 'Cohen', 'Tanaka', 'Silva',
  'Khan', 'Martin', 'Dubois', 'Larsen', 'Moreau', 'Ali', 'Brown', 'Novak', 'Reyes'];
const ADDRESSES = [
  { address1: '123 Market St', city: 'San Francisco', provinceCode: 'CA', countryCode: 'US', zip: '94103' },
  { address1: '45 W 34th St', city: 'New York', provinceCode: 'NY', countryCode: 'US', zip: '10001' },
  { address1: '900 Congress Ave', city: 'Austin', provinceCode: 'TX', countryCode: 'US', zip: '78701' },
  { address1: '1201 3rd Ave', city: 'Seattle', provinceCode: 'WA', countryCode: 'US', zip: '98101' },
  { address1: '233 S Wacker Dr', city: 'Chicago', provinceCode: 'IL', countryCode: 'US', zip: '60606' },
  { address1: '1600 Glenarm Pl', city: 'Denver', provinceCode: 'CO', countryCode: 'US', zip: '80202' },
  { address1: '100 Peachtree St NW', city: 'Atlanta', provinceCode: 'GA', countryCode: 'US', zip: '30303' },
  { address1: '200 Burrard St', city: 'Vancouver', provinceCode: 'BC', countryCode: 'CA', zip: 'V6C 3L6' },
  { address1: '100 King St W', city: 'Toronto', provinceCode: 'ON', countryCode: 'CA', zip: 'M5X 1A9' },
  { address1: '4000 Whistler Way', city: 'Whistler', provinceCode: 'BC', countryCode: 'CA', zip: 'V8E 1J2' },
];

const NEW_PRODUCTS = [
  { title: 'Alpine Wool Beanie', productType: 'Accessories', vendor: 'Oasis Outfitters', tags: ['winter', 'accessories'],
    option: 'Color', values: ['Charcoal', 'Forest', 'Rust'], price: 34.0, sku: 'BEANIE' },
  { title: 'Summit Insulated Gloves', productType: 'Accessories', vendor: 'Oasis Outfitters', tags: ['winter', 'gloves'],
    option: 'Size', values: ['S', 'M', 'L', 'XL'], price: 59.0, sku: 'GLOVE' },
  { title: 'Clearview Snow Goggles', productType: 'Eyewear', vendor: 'Oasis Optics', tags: ['goggles', 'eyewear'],
    option: 'Lens', values: ['Smoke', 'Rose', 'Mirror Blue'], price: 129.0, sku: 'GOGGLE' },
  { title: 'Base Layer Hoodie', productType: 'Apparel', vendor: 'Oasis Outfitters', tags: ['apparel', 'hoodie'],
    option: 'Size', values: ['XS', 'S', 'M', 'L', 'XL'], price: 79.0, sku: 'HOODIE' },
  { title: 'Board Wax Tune-Up Kit', productType: 'Maintenance', vendor: 'Oasis Workshop', tags: ['maintenance'],
    option: 'Title', values: ['Default Title'], price: 24.5, sku: 'WAXKIT' },
  { title: 'Backcountry Pack 28L', productType: 'Bags', vendor: 'Oasis Outfitters', tags: ['bags', 'backcountry'],
    option: 'Color', values: ['Black', 'Glacier'], price: 149.0, sku: 'PACK28' },
];

const DISCOUNTS = [
  { title: 'Welcome 10% off', code: 'WELCOME10', percentage: 0.1, oncePerCustomer: true },
  { title: 'Winter sale 20% off', code: 'SNOW20', percentage: 0.2, oncePerCustomer: false },
  { title: 'VIP 15% off', code: 'VIP15', percentage: 0.15, oncePerCustomer: false },
];

const log = (...m) => console.log(...m);
const daysAgo = (d) => new Date(Date.now() - d * 86400000 - int(0, 86399) * 1000).toISOString();

// ---- Lookup existing data ------------------------------------------------
log(`Seeding ${store}\n`);
let data = run('lookup', {}, { mutation: false });
const currencyCode = data.shop.currencyCode;
const location = data.locations.nodes.find((l) => l.name === 'Shop location') || data.locations.nodes[0];
const existingTitles = new Set(data.products.nodes.map((p) => p.title));
const existingEmails = new Set(data.customers.nodes.map((c) => c.defaultEmailAddress?.emailAddress).filter(Boolean));

// ---- Products ------------------------------------------------------------
log('Products');
for (const p of NEW_PRODUCTS) {
  if (existingTitles.has(p.title)) { log(`  skip  ${p.title} (exists)`); continue; }
  const input = {
    title: p.title,
    descriptionHtml: `<p>${p.title} from ${p.vendor}. Built for long days on the mountain.</p>`,
    vendor: p.vendor,
    productType: p.productType,
    tags: p.tags,
    status: 'ACTIVE',
    productOptions: [{ name: p.option, values: p.values.map((name) => ({ name })) }],
    variants: p.values.map((v) => ({
      optionValues: [{ optionName: p.option, name: v }],
      price: money(p.price),
      sku: p.values.length > 1 ? `${p.sku}-${v.toUpperCase().replace(/\s+/g, '')}` : p.sku,
      inventoryItem: { tracked: true },
      inventoryQuantities: [{ locationId: location.id, name: 'available', quantity: int(15, 80) }],
    })),
  };
  const res = run('productSet', { input }).productSet;
  const err = userErrors(res);
  log(err ? `  FAIL  ${p.title}: ${err}` : `  ok    ${p.title}`);
}

// ---- Customers -----------------------------------------------------------
log('\nCustomers');
for (let i = 0; i < CUSTOMER_COUNT; i++) {
  const firstName = FIRST[i % FIRST.length];
  const lastName = LAST[(i * 7) % LAST.length];
  const email = `${firstName}.${lastName}.${i + 1}@example.com`.toLowerCase();
  if (existingEmails.has(email)) { log(`  skip  ${email} (exists)`); continue; }
  const addr = pick(ADDRESSES);
  const tags = [];
  if (rand() < 0.2) tags.push('vip');
  if (rand() < 0.15) tags.push('wholesale');
  if (rand() < 0.5) tags.push('newsletter');
  const input = {
    firstName, lastName, email, tags,
    phone: `+1415555${String(1000 + i).padStart(4, '0')}`,
    note: rand() < 0.3 ? 'Prefers email contact. Seeded test customer.' : null,
    addresses: [{ ...addr, firstName, lastName }],
    emailMarketingConsent: tags.includes('newsletter')
      ? { marketingState: 'SUBSCRIBED', marketingOptInLevel: 'SINGLE_OPT_IN' }
      : undefined,
  };
  const res = run('customerCreate', { input }).customerCreate;
  const err = userErrors(res);
  log(err ? `  FAIL  ${email}: ${err}` : `  ok    ${email}`);
}

// ---- Discounts -----------------------------------------------------------
log('\nDiscounts');
for (const d of DISCOUNTS) {
  const basicCodeDiscount = {
    title: d.title,
    code: d.code,
    startsAt: daysAgo(120),
    appliesOncePerCustomer: d.oncePerCustomer,
    context: { all: 'ALL' },
    customerGets: { value: { percentage: d.percentage }, items: { all: true } },
  };
  const res = run('discountCreate', { basicCodeDiscount }).discountCodeBasicCreate;
  const err = userErrors(res);
  log(!err ? `  ok    ${d.code}` : /unique/i.test(err) ? `  skip  ${d.code} (exists)` : `  FAIL  ${d.code}: ${err}`);
}

// ---- Reload products/customers for orders --------------------------------
data = run('lookup', {}, { mutation: false });
const variants = data.products.nodes
  .filter((p) => p.title !== 'Gift Card')
  .flatMap((p) => p.variants.nodes.map((v) => ({ ...v, productTitle: p.title, price: Number(v.price) })))
  .filter((v) => v.price > 0);
const customers = data.customers.nodes.filter((c) => c.defaultEmailAddress?.emailAddress);
log(`\nUsing ${variants.length} variants and ${customers.length} customers for orders`);

// ---- Orders --------------------------------------------------------------
// orderCreate needs an offline app token, which `shopify store auth` does not issue, so
// orders are made by completing draft orders. Shopify dates them at completion time.
log('\nOrders');
const tally = {};
for (let i = 0; i < ORDER_COUNT; i++) {
  const customer = pick(customers);
  const addr = pick(ADDRESSES);
  const [firstName, lastName] = [pick(FIRST), pick(LAST)];

  const lineCount = rand() < 0.6 ? 1 : int(2, 4);
  const chosen = new Map();
  while (chosen.size < lineCount) {
    const v = pick(variants);
    chosen.set(v.id, { variantId: v.id, quantity: rand() < 0.8 ? 1 : int(2, 3), price: v.price });
  }
  const subtotal = [...chosen.values()].reduce((s, l) => s + l.price * l.quantity, 0);
  const discount = rand() < 0.2 ? pick(DISCOUNTS) : null;
  const shipping = subtotal * (1 - (discount?.percentage || 0)) >= 100 ? 0 : 9.99;

  // Target end state for this order.
  const r = rand();
  const outcome = r < 0.55 ? 'paid_fulfilled' : r < 0.72 ? 'paid_unfulfilled' : r < 0.86 ? 'pending'
    : r < 0.93 ? 'refunded' : 'cancelled';

  const input = {
    purchasingEntity: { customerId: customer.id },
    email: customer.defaultEmailAddress.emailAddress,
    lineItems: [...chosen.values()].map(({ variantId, quantity }) => ({ variantId, quantity })),
    shippingAddress: { ...addr, firstName, lastName },
    billingAddress: { ...addr, firstName, lastName },
    shippingLine: {
      title: shipping ? 'Standard Shipping' : 'Free Shipping',
      priceWithCurrency: { amount: money(shipping), currencyCode },
    },
    ...(discount ? {
      appliedDiscount: { title: discount.code, value: discount.percentage * 100, valueType: 'PERCENTAGE' },
    } : {}),
    tags: ['seed', ...(rand() < 0.15 ? ['gift'] : [])],
    note: rand() < 0.15 ? 'Please leave at the front desk.' : null,
  };
  const draft = run('draftOrderCreate', { input }).draftOrderCreate;
  let err = userErrors(draft);
  if (err) { log(`  FAIL  order ${i + 1} (draft): ${err}`); continue; }

  const done = run('draftOrderComplete', { id: draft.draftOrder.id, paymentPending: outcome === 'pending' }).draftOrderComplete;
  err = userErrors(done);
  if (err) { log(`  FAIL  order ${i + 1} (complete): ${err}`); continue; }
  const order = done.draftOrder.order;

  if (outcome === 'paid_fulfilled') {
    const fos = run('fulfillmentOrders', { id: order.id }, { mutation: false }).order.fulfillmentOrders.nodes
      .filter((fo) => fo.status === 'OPEN');
    const fulfillment = {
      lineItemsByFulfillmentOrder: fos.map((fo) => ({ fulfillmentOrderId: fo.id })),
      notifyCustomer: false,
      trackingInfo: { company: pick(['UPS', 'FedEx', 'USPS', 'Canada Post']), number: `1Z${int(100000000, 999999999)}` },
    };
    err = fos.length ? userErrors(run('fulfillmentCreate', { fulfillment }).fulfillmentCreate) : 'no open fulfillment order';
    if (err) log(`  warn  ${order.name} fulfillment: ${err}`);
  } else if (outcome === 'refunded' || outcome === 'cancelled') {
    const refundMethod = outcome === 'refunded' ? { originalPaymentMethodsRefund: true } : null;
    err = userErrors(run('orderCancel', { orderId: order.id, refundMethod }).orderCancel);
    if (err) log(`  warn  ${order.name} cancel: ${err}`);
  }
  tally[outcome] = (tally[outcome] || 0) + 1;
  log(`  ok    ${order.name}  ${money(subtotal).padStart(9)} ${currencyCode}  ${outcome}${discount ? `  (${discount.code})` : ''}`);
}
log(`\nOrder outcomes: ${JSON.stringify(tally)}`);


// ---- Draft orders --------------------------------------------------------
log('\nDraft orders');
for (let i = 0; i < DRAFT_COUNT; i++) {
  const customer = pick(customers);
  const input = {
    purchasingEntity: { customerId: customer.id },
    email: customer.defaultEmailAddress.emailAddress,
    lineItems: [pick(variants), pick(variants)].map((v) => ({ variantId: v.id, quantity: int(1, 2) })),
    shippingAddress: { ...pick(ADDRESSES), firstName: pick(FIRST), lastName: pick(LAST) },
    note: pick(['Wholesale quote', 'Phone order - awaiting payment', 'Custom bundle request', null]),
    tags: ['seed'],
  };
  const res = run('draftOrderCreate', { input }).draftOrderCreate;
  const err = userErrors(res);
  log(err ? `  FAIL  draft ${i + 1}: ${err}` : `  ok    ${res.draftOrder.name}`);
}

log('\nDone.');
