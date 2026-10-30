// Matches extracted document lines to catalog variants: exact SKU first, then fuzzy title.

export type DocLine = { sku?: string | null; title: string; quantity?: number | null; unitCost?: number | null; price?: number | null };
export type CatalogVariant = {
  id: string; sku: string | null; title: string; productTitle: string; price: number;
  inventoryQuantity: number; tracked: boolean; unitCost: number | null;
};
export type Match = {
  line: DocLine;
  variant: CatalogVariant | null;
  matchedBy: 'sku' | 'title' | null;
  confidence: number;
  priceChange: { from: number; to: number } | null;
  costChange: { from: number | null; to: number } | null;
};

const STOP = new Set(['the', 'a', 'an', 'and', 'of', 'for', 'with', 'default', 'title']);

export function normalizeSku(s: string | null | undefined) {
  return (s ?? '').trim().toUpperCase().replace(/[\s_]+/g, '-');
}

export function tokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((t) => t && !STOP.has(t)),
  );
}

/** Dice coefficient on word tokens, 0..1. */
export function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return (2 * shared) / (ta.size + tb.size);
}

const variantName = (v: CatalogVariant) => (v.title === 'Default Title' ? v.productTitle : `${v.productTitle} ${v.title}`);

export function reconcile(lines: DocLine[], catalog: CatalogVariant[], minConfidence = 0.6): Match[] {
  const bySku = new Map(catalog.filter((v) => v.sku).map((v) => [normalizeSku(v.sku), v]));
  return lines.map((line) => {
    let variant: CatalogVariant | null = null;
    let matchedBy: Match['matchedBy'] = null;
    let confidence = 0;

    const skuHit = line.sku ? bySku.get(normalizeSku(line.sku)) : undefined;
    if (skuHit) {
      variant = skuHit;
      matchedBy = 'sku';
      confidence = 1;
    } else {
      for (const v of catalog) {
        const score = similarity(line.title, variantName(v));
        if (score > confidence) {
          confidence = score;
          variant = v;
        }
      }
      if (confidence >= minConfidence) matchedBy = 'title';
      else variant = null;
    }

    const priceChange = variant && line.price != null && Math.abs(line.price - variant.price) >= 0.005
      ? { from: variant.price, to: line.price } : null;
    const costChange = variant && line.unitCost != null && (variant.unitCost == null || Math.abs(line.unitCost - variant.unitCost) >= 0.005)
      ? { from: variant.unitCost, to: line.unitCost } : null;
    return { line, variant, matchedBy, confidence: Math.round(confidence * 100) / 100, priceChange, costChange };
  });
}
