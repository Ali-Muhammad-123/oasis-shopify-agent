import { describe, expect, it } from 'vitest';
import { extractCsv } from './csv';

describe('extractCsv', () => {
  it('maps common supplier headers to line item fields', () => {
    const csv = 'SKU,Description,Qty,Unit Cost,Retail Price\nBEANIE-CHARCOAL,Alpine Wool Beanie - Charcoal,24,$12.50,36.00\nHOODIE-M,Base Layer Hoodie M,10,30,79';
    const r = extractCsv(csv);
    expect(r.documentType).toBe('purchase_order');
    expect(r.rowCount).toBe(2);
    expect(r.lineItems[0]).toEqual({ sku: 'BEANIE-CHARCOAL', title: 'Alpine Wool Beanie - Charcoal', quantity: 24, unitCost: 12.5, price: 36 });
  });

  it('detects a price list without quantities', () => {
    const r = extractCsv('Item Code,Product Name,MSRP\nWAXKIT,Board Wax Tune-Up Kit,26.00');
    expect(r.documentType).toBe('price_list');
    expect(r.lineItems[0]).toMatchObject({ sku: 'WAXKIT', price: 26, quantity: null, unitCost: null });
  });

  it('falls back to the first column for titles and tolerates blanks', () => {
    const r = extractCsv('Thing,Count\nGloves,\n\nGoggles,3');
    expect(r.lineItems).toEqual([
      { sku: null, title: 'Gloves', quantity: null, unitCost: null, price: null },
      { sku: null, title: 'Goggles', quantity: 3, unitCost: null, price: null },
    ]);
  });
});
