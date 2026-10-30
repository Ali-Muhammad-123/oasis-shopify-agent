import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { ActivityView } from '@/components/activity/ActivityView';
import { listRecentActions } from '@/lib/agent/tools/write';
import { listRuns } from '@/lib/runs';
import { getSessionShop } from '@/lib/session';

async function Activity() {
  const shop = await getSessionShop();
  if (!shop) redirect('/');
  const [actions, runs] = await Promise.all([listRecentActions(shop.domain, 100), listRuns(shop.domain, { limit: 100 })]);
  return (
    <ActivityView
      actions={actions.map((a) => ({ ...a, createdAt: a.createdAt.toISOString(), undoneAt: a.undoneAt?.toISOString() ?? null }))}
      runs={runs.map((r) => ({
        id: r.id, conversationId: r.conversationId, model: r.model, durationMs: r.durationMs, steps: r.steps, inputTokens: r.inputTokens,
        outputTokens: r.outputTokens, totalTokens: r.totalTokens, shopifyCost: r.shopifyCost, toolCalls: r.toolCalls, finishReason: r.finishReason,
        error: r.error, createdAt: r.createdAt.toISOString(),
      }))}
    />
  );
}

export default function ActivityPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-6">
        <h1 className="text-xl font-semibold">Activity</h1>
        <p className="mt-1 text-sm text-[var(--viz-text-secondary)]">Every store change the agent made (with undo), and a trace of each agent run.</p>
        <Suspense fallback={<div className="mt-6 h-60 animate-pulse rounded-xl bg-black/[0.04]" />}>
          <Activity />
        </Suspense>
      </div>
    </div>
  );
}
