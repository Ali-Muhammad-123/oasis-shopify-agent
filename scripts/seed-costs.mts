// Gives every priced variant without a unit cost a plausible cost (45-68% of price) so margin analytics have data.
// Usage: pnpm seed:costs [--shop store.myshopify.com]
import 'dotenv/config';
import { loadCatalog } from '../src/lib/analytics';
import { adminGraphql, userErrorMessage } from '../src/lib/shopify/admin';
import { INVENTORY_ITEM_UPDATE, VARIANTS_FOR_PREVIEW } from '../src/lib/shopify/mutations';

const i = process.argv.indexOf('--shop');
const shop = i >= 0 ? process.argv[i + 1] : process.env.SHOPIFY_SHOP!;
let seed = 77;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

const targets = (await loadCatalog(shop)).filter((v) => v.unitCost == null && v.price > 0 && v.productTitle !== 'Gift Card');
console.log(`${targets.length} variants without a cost`);
let done = 0;
for (let k = 0; k < targets.length; k += 50) {
  const batch = targets.slice(k, k + 50);
  const { data } = await adminGraphql<{ nodes: { id: string; inventoryItem: { id: string } }[] }>(shop, VARIANTS_FOR_PREVIEW, { ids: batch.map((v) => v.id) });
  const itemFor = new Map(data.nodes.filter(Boolean).map((n) => [n.id, n.inventoryItem.id]));
  for (const v of batch) {
    const cost = Math.round(v.price * (0.45 + rand() * 0.23) * 100) / 100;
    const res = await adminGraphql<{ inventoryItemUpdate: { userErrors: { field: string[]; message: string }[] } }>(
      shop, INVENTORY_ITEM_UPDATE, { id: itemFor.get(v.id), input: { cost } },
    );
    const err = userErrorMessage(res.data.inventoryItemUpdate);
    if (err) console.log(`  FAIL ${v.productTitle} / ${v.title}: ${err}`);
    else done++;
  }
}
console.log(`set cost on ${done} variants`);
process.exit(0);
