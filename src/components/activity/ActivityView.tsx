'use client';

import { CheckCircle2, ChevronRight, Loader2, RotateCcw, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { cn } from '@/lib/cn';

type Action = {
  id: string; tool: string; status: 'succeeded' | 'failed'; createdAt: string; conversationId: string | null;
  undo: string | null; undoable: boolean; undoneAt: string | null; undoOf: string | null;
};
type Run = {
  id: string; conversationId: string | null; model: string; durationMs: number | null; steps: number; inputTokens: number | null;
  outputTokens: number | null; totalTokens: number | null; shopifyCost: number; toolCalls: { tool: string; ms: number; ok: boolean }[];
  finishReason: string | null; error: string | null; createdAt: string;
};

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const n = (x: number | null) => (x == null ? '—' : x.toLocaleString());

export function ActivityView({ actions, runs }: { actions: Action[]; runs: Run[] }) {
  const [tab, setTab] = useState<'changes' | 'runs'>('changes');
  return (
    <div className="mt-5">
      <div role="tablist" className="flex gap-1 border-b border-black/10">
        {(['changes', 'runs'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} type="button" onClick={() => setTab(t)}
            className={cn('-mb-px border-b-2 px-3 py-2 text-sm', tab === t ? 'border-zinc-900 font-medium' : 'border-transparent text-[var(--viz-text-secondary)] hover:text-black')}>
            {t === 'changes' ? `Store changes (${actions.length})` : `Agent runs (${runs.length})`}
          </button>
        ))}
      </div>
      {tab === 'changes' ? <Changes actions={actions} /> : <Runs runs={runs} />}
    </div>
  );
}

function Changes({ actions }: { actions: Action[] }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function undo(id: string) {
    setWorking(id);
    setError(null);
    const res = await fetch(`/api/actions/${id}/undo`, { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) setError(body.error ?? 'Undo failed');
    setWorking(null);
    setConfirm(null);
    router.refresh();
  }

  if (!actions.length) return <p className="mt-6 text-sm text-[var(--viz-muted)]">The agent hasn&apos;t changed anything yet.</p>;
  return (
    <>
      {error && <p className="mt-3 text-sm text-[var(--viz-delta-down)]">{error}</p>}
      <ul className="mt-3 divide-y divide-black/10 rounded-xl border border-black/10 bg-white">
        {actions.map((a) => (
          <li key={a.id} className="flex items-center gap-3 p-3 text-sm">
            {a.status === 'succeeded' ? <CheckCircle2 size={15} className="shrink-0 text-[var(--viz-delta-up)]" aria-label="Succeeded" /> : <XCircle size={15} className="shrink-0 text-[var(--viz-delta-down)]" aria-label="Failed" />}
            <div className="min-w-0 flex-1">
              <div className="font-medium">
                {a.tool.startsWith('undo:') || a.undoOf ? `Undo · ${a.tool.replace('undo:', '')}` : a.tool}
                {a.undoneAt && <span className="ml-2 rounded bg-black/5 px-1.5 py-0.5 text-[11px] font-normal text-[var(--viz-text-secondary)]">undone</span>}
              </div>
              <div className="text-xs text-[var(--viz-muted)]">
                {when(a.createdAt)}
                {a.conversationId && !a.conversationId.startsWith('check-') && (
                  <> · <Link href={`/chat/${a.conversationId}`} className="underline">open chat</Link></>
                )}
                {a.undo && !a.undoneAt && <> · undo: {a.undo}</>}
              </div>
            </div>
            {a.undoable &&
              (working === a.id ? (
                <Loader2 size={14} className="animate-spin text-[var(--viz-muted)]" />
              ) : confirm === a.id ? (
                <span className="flex items-center gap-1 text-xs">
                  <span className="text-[var(--viz-text-secondary)]">Reverse this change?</span>
                  <button type="button" onClick={() => undo(a.id)} className="rounded-md bg-zinc-900 px-2 py-1 font-medium text-white">Yes, undo</button>
                  <button type="button" onClick={() => setConfirm(null)} className="rounded-md px-2 py-1 hover:bg-black/5">Cancel</button>
                </span>
              ) : (
                <button type="button" onClick={() => setConfirm(a.id)} className="flex items-center gap-1 rounded-lg border border-black/15 px-2.5 py-1.5 text-xs font-medium hover:bg-black/5">
                  <RotateCcw size={12} /> Undo
                </button>
              ))}
          </li>
        ))}
      </ul>
    </>
  );
}

function Runs({ runs }: { runs: Run[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!runs.length) return <p className="mt-6 text-sm text-[var(--viz-muted)]">No agent runs recorded yet.</p>;
  const totals = runs.reduce((t, r) => ({ tokens: t.tokens + (r.totalTokens ?? 0), cost: t.cost + r.shopifyCost, ms: t.ms + (r.durationMs ?? 0) }), { tokens: 0, cost: 0, ms: 0 });
  return (
    <>
      <p className="mt-3 text-xs text-[var(--viz-text-secondary)]">
        Last {runs.length} runs: {totals.tokens.toLocaleString()} tokens · {totals.cost.toLocaleString()} Shopify query points · average {(totals.ms / runs.length / 1000).toFixed(1)}s
      </p>
      <div className="mt-2 overflow-x-auto rounded-xl border border-black/10 bg-white">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-[var(--viz-text-secondary)]">
            <tr className="border-b border-black/10">
              <th className="px-3 py-2 font-medium">When</th><th className="px-3 py-2 font-medium">Model</th>
              <th className="px-3 py-2 text-right font-medium">Time</th><th className="px-3 py-2 text-right font-medium">Steps</th>
              <th className="px-3 py-2 text-right font-medium">Tools</th><th className="px-3 py-2 text-right font-medium">Tokens (in/out)</th>
              <th className="px-3 py-2 text-right font-medium">Shopify cost</th><th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <FragmentRow key={r.id} run={r} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function FragmentRow({ run: r, open, onToggle }: { run: Run; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="tabular border-b border-black/5 hover:bg-black/[0.02]">
        <td className="px-3 py-2 whitespace-nowrap">{when(r.createdAt)}{r.error && <span className="ml-1 text-[var(--viz-delta-down)]">· error</span>}</td>
        <td className="px-3 py-2 whitespace-nowrap text-[var(--viz-text-secondary)]">{r.model.split(':')[1]}</td>
        <td className="px-3 py-2 text-right">{r.durationMs == null ? '—' : `${(r.durationMs / 1000).toFixed(1)}s`}</td>
        <td className="px-3 py-2 text-right">{r.steps}</td>
        <td className="px-3 py-2 text-right">{r.toolCalls.length}</td>
        <td className="px-3 py-2 text-right whitespace-nowrap">{n(r.inputTokens)} / {n(r.outputTokens)}</td>
        <td className="px-3 py-2 text-right">{r.shopifyCost}</td>
        <td className="px-3 py-2 text-right">
          <button type="button" onClick={onToggle} aria-expanded={open} aria-label="Show tool calls" className="rounded p-1 hover:bg-black/5">
            <ChevronRight size={14} className={cn('transition-transform', open && 'rotate-90')} />
          </button>
        </td>
      </tr>
      {open && (
        <tr className="border-b border-black/5 bg-black/[0.02]">
          <td colSpan={8} className="px-3 py-2">
            {r.error && <p className="mb-1 text-xs text-[var(--viz-delta-down)]">{r.error}</p>}
            {r.toolCalls.length === 0 ? (
              <p className="text-xs text-[var(--viz-muted)]">No tools called{r.finishReason ? ` · finished: ${r.finishReason}` : ''}.</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {r.toolCalls.map((t, i) => (
                  <li key={i} className={cn('rounded-md px-2 py-1 text-xs', t.ok ? 'bg-white ring-1 ring-black/10' : 'bg-red-50 text-[var(--viz-delta-down)]')}>
                    {t.tool} · {t.ms} ms
                  </li>
                ))}
              </ul>
            )}
            {r.conversationId && !r.conversationId.startsWith('check-') && (
              <Link href={`/chat/${r.conversationId}`} className="mt-2 inline-block text-xs underline">Open chat</Link>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
