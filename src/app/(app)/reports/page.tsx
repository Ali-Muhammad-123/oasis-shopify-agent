import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { ReportList } from '@/components/reports/ReportList';
import { listReports } from '@/lib/reports';
import { getSettings } from '@/lib/scheduler';
import { getSessionShop } from '@/lib/session';

const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

async function Reports() {
  const shop = await getSessionShop();
  if (!shop) redirect('/');
  const [reports, settings] = await Promise.all([listReports(shop.domain), getSettings(shop.domain)]);
  return (
    <>
      <p className="mt-1 text-sm text-[var(--viz-text-secondary)]">
        {settings.weeklyReportEnabled
          ? `A weekly PDF is generated every ${DAYS[settings.weeklyReportDay]} after ${settings.briefHour}:00 store time.`
          : 'Scheduled weekly reports are off (change this in Settings).'}{' '}
        You can also export the dashboard or any chat to PDF with its Export button.
      </p>
      <ReportList reports={reports.map((r) => ({ id: r.id, title: r.title, size: r.size, trigger: r.trigger, createdAt: r.createdAt.toISOString() }))} />
    </>
  );
}

export default function ReportsPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-6">
        <h1 className="text-xl font-semibold">Reports</h1>
        <Suspense fallback={<div className="mt-6 h-40 animate-pulse rounded-xl bg-black/[0.04]" />}>
          <Reports />
        </Suspense>
      </div>
    </div>
  );
}
