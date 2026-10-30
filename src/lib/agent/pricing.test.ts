import { describe, expect, it } from 'vitest';
import { unconvertedPriceReason } from './pricing';

describe('unconvertedPriceReason', () => {
  it('blocks a foreign source price reused as the store price', () => {
    const reason = unconvertedPriceReason({ price: 20000, sourcePrice: { amount: 20000, currency: 'pkr' } }, 'USD');
    expect(reason).toMatch(/PKR.*USD/);
    expect(reason).toMatch(/ask the user/i);
  });
  it('allows converted prices, same-currency sources and missing data', () => {
    expect(unconvertedPriceReason({ price: 71.5, sourcePrice: { amount: 20000, currency: 'PKR' } }, 'USD')).toBeNull();
    expect(unconvertedPriceReason({ price: 22.79, sourcePrice: { amount: 22.79, currency: 'USD' } }, 'USD')).toBeNull();
    expect(unconvertedPriceReason({ price: 10 }, 'USD')).toBeNull();
    expect(unconvertedPriceReason({ price: 10, sourcePrice: { amount: 10, currency: 'EUR' } }, null)).toBeNull();
  });
});

import { adjustPrice } from './pricing';

describe('adjustPrice', () => {
  it('applies percent, amount and set adjustments', () => {
    expect(adjustPrice(100, { mode: 'percent', value: 5 })).toBe(105);
    expect(adjustPrice(100, { mode: 'percent', value: -12.5 })).toBe(87.5);
    expect(adjustPrice(24.5, { mode: 'amount', value: 2 })).toBe(26.5);
    expect(adjustPrice(24.5, { mode: 'set', value: 19 })).toBe(19);
  });
  it('rounds to price endings and never goes below 0.01', () => {
    expect(adjustPrice(699.95, { mode: 'percent', value: 5, rounding: '.99' })).toBe(734.99);
    expect(adjustPrice(34, { mode: 'percent', value: 10, rounding: '.00' })).toBe(37);
    expect(adjustPrice(5, { mode: 'amount', value: -10 })).toBe(0.01);
  });
});
