import { describe, expect, it } from 'vitest';
import { joinDaily, parseInsight, sumInsights } from './meta-parse';

const row = {
  date_start: '2026-10-28', campaign_id: '1', campaign_name: 'Winter launch', spend: '120.50', impressions: '10000', clicks: '250',
  actions: [{ action_type: 'link_click', value: '250' }, { action_type: 'purchase', value: '4' }, { action_type: 'omni_purchase', value: '5' }],
  action_values: [{ action_type: 'omni_purchase', value: '600' }],
};

describe('parseInsight', () => {
  it('reads spend, CTR, CPC and prefers de-duplicated omni purchases', () => {
    const p = parseInsight(row);
    expect(p).toMatchObject({ campaign: 'Winter launch', spend: 120.5, clicks: 250, purchases: 5, purchaseValue: 600, ctr: 0.025 });
    expect(p.cpc).toBeCloseTo(0.482, 3);
    expect(p.roas).toBeCloseTo(4.98, 2);
  });
  it('handles rows with no spend or actions', () => {
    expect(parseInsight({ spend: '0' })).toMatchObject({ spend: 0, purchases: 0, roas: null, ctr: null, cpc: null });
  });
});

describe('sumInsights and joinDaily', () => {
  it('totals campaigns', () => {
    const t = sumInsights([parseInsight(row), parseInsight({ ...row, spend: '79.50', action_values: [{ action_type: 'purchase', value: '200' }] })]);
    expect(t).toMatchObject({ spend: 200, purchaseValue: 800, roas: 4 });
  });
  it('joins store revenue with ad spend per day for blended ROAS', () => {
    const daily = joinDaily([parseInsight(row), parseInsight({ ...row, campaign_id: '2', spend: '79.50' })], [
      { day: '2026-10-28', sales: 1000 },
      { day: '2026-10-29', sales: 300 },
    ]);
    expect(daily[0]).toMatchObject({ day: '2026-10-28', storeRevenue: 1000, adSpend: 200, blendedRoas: 5 });
    expect(daily[1]).toMatchObject({ adSpend: 0, blendedRoas: null });
  });
});
