import Papa from 'papaparse';
import type { Extraction } from './extract';

const COLS = {
  sku: /^(sku|item ?code|code|part ?(no|number)|variant ?sku)$/i,
  title: /(title|name|description|product|item)/i,
  quantity: /(qty|quantity|count|on ?hand|units)/i,
  unitCost: /(unit ?cost|cost|wholesale|net)/i,
  price: /(retail|msrp|price|sell)/i,
};

const num = (v: unknown) => {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

/** CSVs are parsed deterministically: columns are mapped by header name, no model call. */
export function extractCsv(text: string): Extraction {
  const { data, meta } = Papa.parse<Record<string, string>>(text.trim(), { header: true, skipEmptyLines: true });
  const headers = meta.fields ?? [];
  const find = (re: RegExp, exclude: (string | undefined)[] = []) => headers.find((h) => re.test(h.trim()) && !exclude.includes(h));
  const sku = find(COLS.sku);
  const title = find(COLS.title, [sku]);
  const quantity = find(COLS.quantity, [sku, title]);
  const unitCost = find(COLS.unitCost, [sku, title, quantity]);
  const price = find(COLS.price, [sku, title, quantity, unitCost]);
  const lineItems = data.slice(0, 1000).map((r) => ({
    sku: sku ? r[sku]?.trim() || null : null,
    title: (title ? r[title] : r[headers[0]])?.trim() ?? '',
    quantity: quantity ? num(r[quantity]) : null,
    unitCost: unitCost ? num(r[unitCost]) : null,
    price: price ? num(r[price]) : null,
  }));
  const documentType = unitCost && quantity ? 'purchase_order' : price ? 'price_list' : quantity ? 'inventory_count' : 'other';
  return {
    documentType, vendor: null, documentNumber: null, date: null, currency: null, lineItems, total: null,
    notes: `Columns mapped: ${JSON.stringify({ sku, title, quantity, unitCost, price })}`,
    source: 'csv', rowCount: data.length,
  };
}
