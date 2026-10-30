import { describe, expect, it } from 'vitest';
import { reconcile, similarity, type CatalogVariant } from './reconcile';

const v = (over: Partial<CatalogVariant>): CatalogVariant => ({
  id: 'gid://shopify/ProductVariant/1', sku: null, title: 'Default Title', productTitle: 'X',
  price: 10, inventoryQuantity: 5, tracked: true, unitCost: null, ...over,
});

const catalog = [
  v({ id: 'v1', sku: 'BEANIE-CHARCOAL', title: 'Charcoal', productTitle: 'Alpine Wool Beanie', price: 34 }),
  v({ id: 'v2', sku: 'HOODIE-M', title: 'M', productTitle: 'Base Layer Hoodie', price: 79, unitCost: 30 }),
  v({ id: 'v3', sku: 'WAXKIT', productTitle: 'Board Wax Tune-Up Kit', price: 24.5 }),
];

describe('similarity', () => {
  it('scores shared words and ignores case and punctuation', () => {
    expect(similarity('Board Wax Tune-Up Kit', 'board wax tune up kit')).toBe(1);
    expect(similarity('Wool Beanie', 'Alpine Wool Beanie Charcoal')).toBeCloseTo(0.67, 2);
    expect(similarity('Gloves', 'Hoodie')).toBe(0);
  });
});

describe('reconcile', () => {
  it('matches by SKU regardless of case and spacing', () => {
    const [m] = reconcile([{ sku: 'beanie charcoal', title: 'whatever', price: 36 }], catalog);
    expect(m.variant?.id).toBe('v1');
    expect(m.matchedBy).toBe('sku');
    expect(m.priceChange).toEqual({ from: 34, to: 36 });
  });

  it('falls back to fuzzy title matching above the threshold', () => {
    const [m] = reconcile([{ title: 'Wax Tune-Up Kit for boards', unitCost: 9 }], catalog);
    expect(m.variant?.id).toBe('v3');
    expect(m.matchedBy).toBe('title');
    expect(m.costChange).toEqual({ from: null, to: 9 });
  });

  it('leaves weak matches unmatched', () => {
    const [m] = reconcile([{ title: 'Snow shovel' }], catalog);
    expect(m.variant).toBeNull();
    expect(m.matchedBy).toBeNull();
  });

  it('reports no change when price and cost match', () => {
    const [m] = reconcile([{ sku: 'HOODIE-M', title: 'Hoodie M', price: 79, unitCost: 30 }], catalog);
    expect(m.priceChange).toBeNull();
    expect(m.costChange).toBeNull();
  });
});
