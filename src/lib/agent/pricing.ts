/**
 * Guards against listing a foreign-currency price as if it were in the store currency
 * (e.g. PKR 20,000 from a supplier page becoming USD 20,000). Returns a reason when blocked.
 */
export function unconvertedPriceReason(
  input: { price: number; sourcePrice?: { amount: number; currency: string } },
  storeCurrency: string | null | undefined,
): string | null {
  const src = input.sourcePrice;
  if (!src || !storeCurrency || src.currency.toUpperCase() === storeCurrency.toUpperCase()) return null;
  if (Math.abs(input.price - src.amount) >= 0.005) return null;
  return `The price ${input.price} equals the source price in ${src.currency.toUpperCase()}, but the store sells in ${storeCurrency}. ` +
    `Do not reuse the foreign amount: ask the user what ${storeCurrency} price to charge (you may suggest an approximate conversion, ` +
    `clearly labelled approximate), then call createProduct again with that price.`;
}

export type PriceAdjustment = { mode: 'percent' | 'amount' | 'set'; value: number; rounding?: 'none' | '.99' | '.95' | '.00' };

/** New price after a bulk adjustment, optionally rounded to a price ending (never below 0.01). */
export function adjustPrice(current: number, { mode, value, rounding = 'none' }: PriceAdjustment): number {
  let next = mode === 'percent' ? current * (1 + value / 100) : mode === 'amount' ? current + value : value;
  if (rounding === '.99' || rounding === '.95') next = Math.floor(next) + Number(rounding);
  else if (rounding === '.00') next = Math.round(next);
  return Math.max(0.01, Math.round(next * 100) / 100);
}
