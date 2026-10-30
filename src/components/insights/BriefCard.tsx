'use client';

import { AlertOctagon, AlertTriangle, CheckCircle2, Info, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Finding } from '@/lib/db/schema';

const ICON = {
  critical: { icon: AlertOctagon, color: 'var(--viz-delta-down)', label: 'Critical' },
  warning: { icon: AlertTriangle, color: '#b45309', label: 'Warning' },
  good: { icon: CheckCircle2, color: 'var(--viz-delta-up)', label: 'Good news' },
  info: { icon: Info, color: 'var(--viz-text-secondary)', label: 'Note' },
} as const;

export type BriefView = { summary: string; findings: Finding[]; createdAt: string; trigger: 'schedule' | 'manual' } | null;

export function BriefCard({ brief }: { brief: BriefView }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runNow() {
    setRunning(true);
    setError(null);
    const res = await fetch('/api/insights', { method: 'POST' });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? 'Could not build the brief');
    setRunning(false);
    router.refresh();
  }

  return (
    <section className="mt-4 rounded-xl border border-black/10 bg-[var(--viz-surface)] p-4" aria-label="Store brief">
      <header className="flex flex-wrap items-center gap-2">
        <Sparkles size={15} className="text-[var(--series-1)]" aria-hidden />
        <h2 className="text-sm font-semibold">Store brief</h2>
        {brief && (
          <span className="text-xs text-[var(--viz-muted)]">
            {new Date(brief.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · {brief.trigger === 'schedule' ? 'scheduled' : 'on demand'}
          </span>
        )}
        <button type="button" onClick={runNow} disabled={running} className="no-print ml-auto flex items-center gap-1 rounded-lg border border-black/15 bg-white px-2.5 py-1 text-xs font-medium hover:bg-black/5 disabled:opacity-60">
          {running ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} {running ? 'Analysing…' : 'Run now'}
        </button>
      </header>
      {error && <p className="mt-2 text-xs text-[var(--viz-delta-down)]">{error}</p>}
      {!brief ? (
        <p className="mt-3 text-sm text-[var(--viz-text-secondary)]">No brief yet. It runs every morning; press Run now to build one from today&apos;s data.</p>
      ) : (
        <>
          <p className="mt-3 max-w-4xl text-sm leading-relaxed text-[var(--viz-text-primary)]">{brief.summary}</p>
          {brief.findings.length > 0 && (
            <ul className="mt-3 grid gap-2 md:grid-cols-2">
              {brief.findings.map((f, i) => {
                const meta = ICON[f.severity];
                const Icon = meta.icon;
                return (
                  <li key={i} className="flex gap-2 rounded-lg bg-black/[0.03] p-2.5">
                    <Icon size={15} style={{ color: meta.color }} className="mt-0.5 shrink-0" aria-label={meta.label} />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-[var(--viz-text-primary)]">{f.title}</div>
                      <div className="text-xs text-[var(--viz-text-secondary)]">{f.detail}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
