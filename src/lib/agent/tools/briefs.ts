import 'server-only';
import { tool } from 'ai';
import { z } from 'zod';
import { env } from '../../env';
import { generateBrief, latestBrief } from '../../insights';
import { generateWeeklyReport } from '../../reports';

export function createBriefTools(shop: string) {
  return {
    getStoreBrief: tool({
      description:
        'The proactive store brief: week-over-week changes, unusual days, returns spikes, stockout risks and margin issues, with a short ' +
        'written summary. Returns the latest one; set refresh to build a new one from current data.',
      inputSchema: z.object({ refresh: z.boolean().default(false) }),
      execute: async ({ refresh }) => {
        try {
          const brief = refresh ? await generateBrief(shop, { trigger: 'manual' }) : (await latestBrief(shop)) ?? (await generateBrief(shop, { trigger: 'manual' }));
          return { createdAt: brief.createdAt, summary: brief.summary, findings: brief.findings, dashboard: new URL('/dashboard', env.APP_URL).toString() };
        } catch (err) {
          return { error: (err as Error).message };
        }
      },
    }),
    generateReport: tool({
      description: 'Generate the weekly PDF report (KPIs vs last week, summary, daily sales chart, top products, stock alerts) and return its link.',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const r = await generateWeeklyReport(shop, 'manual');
          return { title: r.title, viewUrl: new URL(`/api/reports/${r.id}?view`, env.APP_URL).toString(), reportsPage: new URL('/reports', env.APP_URL).toString() };
        } catch (err) {
          return { error: (err as Error).message };
        }
      },
    }),
  };
}
