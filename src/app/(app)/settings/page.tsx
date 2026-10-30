import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { AutomationSettings } from '@/components/settings/AutomationSettings';
import { MemorySettings } from '@/components/settings/MemorySettings';
import { MetaSettings } from '@/components/settings/MetaSettings';
import { listMemory } from '@/lib/memory';
import { getSettings } from '@/lib/scheduler';
import { getSessionShop } from '@/lib/session';

async function Settings({ searchParams }: { searchParams: Promise<{ meta?: string }> }) {
  const shop = await getSessionShop();
  if (!shop) redirect('/');
  const [memory, settings, { meta }] = await Promise.all([listMemory(shop.domain), getSettings(shop.domain), searchParams]);
  return (
    <div className="mt-6 flex flex-col gap-6">
      <MemorySettings facts={memory.map(({ id, fact }) => ({ id, fact }))} />
      <AutomationSettings
        initial={{ briefEnabled: settings.briefEnabled, briefHour: settings.briefHour, weeklyReportEnabled: settings.weeklyReportEnabled, weeklyReportDay: settings.weeklyReportDay }}
        timezone={shop.timezone ?? 'UTC'}
      />
      <MetaSettings flash={meta ?? null} />
    </div>
  );
}

export default function SettingsPage(props: PageProps<'/settings'>) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-6">
        <h1 className="text-xl font-semibold">Settings</h1>
        <Suspense fallback={<div className="mt-6 h-60 animate-pulse rounded-xl bg-black/[0.04]" />}>
          <Settings searchParams={props.searchParams as Promise<{ meta?: string }>} />
        </Suspense>
      </div>
    </div>
  );
}
