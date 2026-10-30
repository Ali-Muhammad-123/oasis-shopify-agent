import 'server-only';
import { tool } from 'ai';
import { z } from 'zod';
import { runShopifyQL } from '../../dashboards';
import { fetchInsights, MetaError, requireMetaAccount } from '../../meta';
import { joinDaily, sumInsights } from '../../meta-parse';

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const range = (days: number) => ({ since: ymd(new Date(Date.now() - (days - 1) * 86_400_000)), until: ymd(new Date()) });

async function guarded<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof MetaError) return { error: err.message, explainToUser: err.message };
    throw err;
  }
}

export function createAdTools(shop: string) {
  return {
    getAdPerformance: tool({
      description: 'Meta (Facebook/Instagram) ads performance by campaign: spend, impressions, clicks, CTR, CPC, purchases, purchase value and Meta-reported ROAS.',
      inputSchema: z.object({ days: z.number().int().min(1).max(90).default(30) }),
      execute: ({ days }) =>
        guarded(async () => {
          const acct = await requireMetaAccount(shop);
          const { since, until } = range(days);
          const rows = await fetchInsights(acct.token, acct.accountId, { since, until, level: 'campaign', daily: false });
          return {
            account: acct.accountName, currency: acct.currency, since, until,
            total: sumInsights(rows),
            campaigns: rows.sort((a, b) => b.spend - a.spend).slice(0, 25),
          };
        }),
    }),
    getRoasReport: tool({
      description:
        'Return on ad spend: daily Meta ad spend joined with Shopify revenue. Blended ROAS (all store revenue / ad spend) and Meta ' +
        'ROAS (Meta-attributed purchase value / spend). Explain the difference when presenting.',
      inputSchema: z.object({ days: z.number().int().min(7).max(90).default(30) }),
      execute: ({ days }) =>
        guarded(async () => {
          const acct = await requireMetaAccount(shop);
          const { since, until } = range(days);
          const [meta, store] = await Promise.all([
            fetchInsights(acct.token, acct.accountId, { since, until, level: 'account', daily: true }),
            runShopifyQL(shop, `FROM sales SHOW total_sales TIMESERIES day SINCE -${days - 1}d UNTIL today ORDER BY day ASC`),
          ]);
          const daily = joinDaily(meta, store.map((r) => ({ day: String(r.day), sales: Number(r.total_sales ?? 0) })));
          const spend = daily.reduce((s, d) => s + d.adSpend, 0);
          const revenue = daily.reduce((s, d) => s + d.storeRevenue, 0);
          const metaValue = daily.reduce((s, d) => s + d.metaPurchaseValue, 0);
          return {
            account: acct.accountName, adCurrency: acct.currency, since, until,
            summary: { adSpend: spend, storeRevenue: revenue, blendedRoas: spend ? revenue / spend : null, metaRoas: spend ? metaValue / spend : null },
            daily,
          };
        }),
    }),
  };
}
