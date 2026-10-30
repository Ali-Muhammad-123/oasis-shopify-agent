import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { DashboardGrid } from '@/components/dashboard/DashboardGrid';
import { BriefCard } from '@/components/insights/BriefCard';
import { PrintButton } from '@/components/PrintButton';
import { latestBrief } from '@/lib/insights';
import { loadDashboard } from '@/lib/dashboards';
import { getSessionShop } from '@/lib/session';

async function Dashboard() {
  const shop = await getSessionShop();
  if (!shop) redirect('/');
  const [items, brief] = await Promise.all([loadDashboard(shop.domain), latestBrief(shop.domain)]);
  return (
    <>
      <BriefCard brief={brief ? { summary: brief.summary, findings: brief.findings, createdAt: brief.createdAt.toISOString(), trigger: brief.trigger } : null} />
      <DashboardGrid items={items} />
    </>
  );
}

export default function DashboardPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] px-6 py-6">
        <div className="flex items-center gap-2">
          <h1 className="mr-auto text-xl font-semibold">Dashboard</h1>
          <PrintButton />
        </div>
        <p className="mt-1 text-sm text-[var(--viz-text-secondary)]">
          Store analytics and cards pinned from chat. Live cards re-run their query each time this page loads.
        </p>
        <Suspense fallback={<div className="mt-6 grid gap-4 md:grid-cols-2">{[0, 1].map((i) => <div key={i} className="h-72 animate-pulse rounded-xl bg-black/[0.04]" />)}</div>}>
          <Dashboard />
        </Suspense>
      </div>
    </div>
  );
}
