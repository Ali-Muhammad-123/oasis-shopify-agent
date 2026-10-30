import { describe, expect, it } from 'vitest';
import { forecastRow, marginRow, pctChange, zScore } from './analytics-math';

const v = (over: object = {}) => ({ title: 'M', productTitle: 'Hoodie', price: 80, unitCost: 32, inventoryQuantity: 20, ...over });

describe('marginRow', () => {
  it('computes margin, profit on sales and the price that hits the target', () => {
    const r = marginRow(v(), { units: 10, sales: 800 }, 0.4);
    expect(r).toMatchObject({ name: 'Hoodie / M', margin: 0.6, grossProfit: 480, belowTarget: false, targetPrice: 53.33 });
  });
  it('flags variants under target and handles missing cost', () => {
    expect(marginRow(v({ unitCost: 60 }), { units: 1, sales: 80 }, 0.4).belowTarget).toBe(true);
    expect(marginRow(v({ unitCost: null }), { units: 1, sales: 80 }, 0.4)).toMatchObject({ margin: null, grossProfit: null, belowTarget: false });
  });
});

describe('forecastRow', () => {
  const opts = { days: 30, leadTimeDays: 14, coverDays: 30 };
  const today = new Date('2026-10-30T00:00:00Z');
  it('derives velocity, days of stock and a reorder quantity covering lead time plus cover', () => {
    const r = forecastRow(v({ inventoryQuantity: 20 }), 60, opts, today);
    expect(r).toMatchObject({ dailyVelocity: 2, daysOfStock: 10, reorderQty: 68, status: 'reorder_now', reorderBy: '2026-10-30' });
  });
  it('classifies out of stock, soon, ok and no sales', () => {
    expect(forecastRow(v({ inventoryQuantity: 0 }), 30, opts, today).status).toBe('out_of_stock');
    expect(forecastRow(v({ inventoryQuantity: 18 }), 30, opts, today).status).toBe('reorder_soon');
    expect(forecastRow(v({ inventoryQuantity: 100 }), 30, opts, today)).toMatchObject({ status: 'ok', reorderQty: 0 });
    expect(forecastRow(v({ inventoryQuantity: 5 }), 0, opts, today)).toMatchObject({ status: 'no_sales', daysOfStock: null, reorderQty: 0 });
  });
});

describe('zScore and pctChange', () => {
  it('scores the latest value against history', () => {
    const z = zScore([10, 12, 11, 9, 10, 11, 10, 40])!;
    expect(z.z).toBeGreaterThan(3);
    expect(zScore([1, 2, 3])).toBeNull();
  });
  it('returns null change when there is no baseline', () => {
    expect(pctChange(150, 100)).toBeCloseTo(0.5);
    expect(pctChange(10, 0)).toBeNull();
  });
});
