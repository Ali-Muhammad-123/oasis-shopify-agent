'use client';

import { Download, Eye, FileText, Loader2, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Report = { id: string; title: string; size: number; trigger: 'schedule' | 'manual'; createdAt: string };

export function ReportList({ reports }: { reports: Report[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/reports', { method: 'POST' });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? 'Report failed');
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="mt-5">
      <button type="button" onClick={generate} disabled={busy} className="flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} {busy ? 'Building report…' : 'Generate this week’s report'}
      </button>
      {error && <p className="mt-2 text-sm text-[var(--viz-delta-down)]">{error}</p>}
      <ul className="mt-4 divide-y divide-black/10 rounded-xl border border-black/10 bg-white">
        {reports.length === 0 && <li className="p-4 text-sm text-[var(--viz-muted)]">No reports yet.</li>}
        {reports.map((r) => (
          <li key={r.id} className="flex items-center gap-3 p-3">
            <FileText size={16} className="text-[var(--viz-text-secondary)]" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{r.title}</div>
              <div className="text-xs text-[var(--viz-muted)]">
                {new Date(r.createdAt).toLocaleString()} · {r.trigger === 'schedule' ? 'Scheduled' : 'On demand'} · {(r.size / 1024).toFixed(0)} KB
              </div>
            </div>
            <a href={`/api/reports/${r.id}?view`} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-lg border border-black/15 px-2.5 py-1.5 text-xs font-medium hover:bg-black/5">
              <Eye size={12} /> View
            </a>
            <a href={`/api/reports/${r.id}`} className="flex items-center gap-1 rounded-lg border border-black/15 px-2.5 py-1.5 text-xs font-medium hover:bg-black/5">
              <Download size={12} /> Download
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
