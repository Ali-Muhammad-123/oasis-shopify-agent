// Pure parsing for Meta Marketing API insights rows (no I/O; unit-tested).

export type MetaActionStat = { action_type: string; value: string };
export type MetaInsightRow = {
  date_start?: string; date_stop?: string; campaign_id?: string; campaign_name?: string;
  spend?: string; impressions?: string; clicks?: string;
  actions?: MetaActionStat[]; action_values?: MetaActionStat[]; purchase_roas?: MetaActionStat[];
};

// Meta reports purchases under several action types depending on pixel / CAPI setup; prefer the de-duplicated one.
const PURCHASE_TYPES = ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase', 'onsite_web_purchase'];

function firstPurchase(stats: MetaActionStat[] | undefined): number {
  if (!stats?.length) return 0;
  for (const type of PURCHASE_TYPES) {
    const hit = stats.find((s) => s.action_type === type);
    if (hit) return Number(hit.value) || 0;
  }
  return 0;
}

export function parseInsight(row: MetaInsightRow) {
  const spend = Number(row.spend ?? 0);
  const purchaseValue = firstPurchase(row.action_values);
  const clicks = Number(row.clicks ?? 0);
  const impressions = Number(row.impressions ?? 0);
  return {
    date: row.date_start ?? null,
    campaignId: row.campaign_id ?? null,
    campaign: row.campaign_name ?? null,
    spend,
    impressions,
    clicks,
    ctr: impressions > 0 ? clicks / impressions : null,
    cpc: clicks > 0 ? spend / clicks : null,
    purchases: firstPurchase(row.actions),
    purchaseValue,
    roas: spend > 0 ? purchaseValue / spend : null,
  };
}

export type ParsedInsight = ReturnType<typeof parseInsight>;

/** Sums parsed rows into one total (for campaign or account summaries). */
export function sumInsights(rows: ParsedInsight[]) {
  const t = rows.reduce(
    (a, r) => ({ spend: a.spend + r.spend, impressions: a.impressions + r.impressions, clicks: a.clicks + r.clicks, purchases: a.purchases + r.purchases, purchaseValue: a.purchaseValue + r.purchaseValue }),
    { spend: 0, impressions: 0, clicks: 0, purchases: 0, purchaseValue: 0 },
  );
  return { ...t, ctr: t.impressions ? t.clicks / t.impressions : null, cpc: t.clicks ? t.spend / t.clicks : null, roas: t.spend ? t.purchaseValue / t.spend : null };
}

/**
 * Joins daily Meta spend with daily Shopify revenue. Blended ROAS (store revenue / ad spend) counts every sale,
 * so it is an upper bound on what ads drove; Meta ROAS is Meta's own attributed purchase value / spend.
 */
export function joinDaily(meta: ParsedInsight[], shopify: { day: string; sales: number }[]) {
  const spendByDay = new Map<string, { spend: number; purchaseValue: number }>();
  for (const r of meta) {
    if (!r.date) continue;
    const prev = spendByDay.get(r.date) ?? { spend: 0, purchaseValue: 0 };
    spendByDay.set(r.date, { spend: prev.spend + r.spend, purchaseValue: prev.purchaseValue + r.purchaseValue });
  }
  return shopify.map(({ day, sales }) => {
    const m = spendByDay.get(day) ?? { spend: 0, purchaseValue: 0 };
    return { day, storeRevenue: sales, adSpend: m.spend, metaPurchaseValue: m.purchaseValue, blendedRoas: m.spend > 0 ? sales / m.spend : null };
  });
}
