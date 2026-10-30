'use client';

import { Loader2, Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Section } from './Section';

export function MemorySettings({ facts }: { facts: { id: string; fact: string }[] }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    const res = await fetch('/api/memory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fact: text }) });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? 'Could not save');
    else setText('');
    setBusy(false);
    router.refresh();
  }
  async function remove(id: string) {
    await fetch(`/api/memory/${id}`, { method: 'DELETE' });
    router.refresh();
  }

  return (
    <Section title="Store memory" description="Standing rules the agent applies to every answer. You can also just tell the agent “remember that …” in chat.">
      <ul className="flex flex-col gap-1.5">
        {facts.length === 0 && <li className="text-sm text-[var(--viz-muted)]">Nothing saved yet. Try “Our fiscal week starts Monday” or “Margin target is 40%”.</li>}
        {facts.map((f) => (
          <li key={f.id} className="flex items-center gap-2 rounded-lg bg-black/[0.03] px-3 py-2 text-sm">
            <span className="flex-1">{f.fact}</span>
            <button type="button" onClick={() => remove(f.id)} aria-label={`Forget "${f.fact}"`} className="rounded p-1 text-[var(--viz-muted)] hover:bg-black/5 hover:text-black">
              <X size={13} />
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="mt-3 flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Add a preference, e.g. Exclude orders tagged test"
          className="flex-1 rounded-lg border border-black/15 px-3 py-1.5 text-sm outline-none focus:border-black/40" />
        <button type="submit" disabled={busy || !text.trim()} className="flex items-center gap-1 rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Save
        </button>
      </form>
      {error && <p className="mt-2 text-xs text-[var(--viz-delta-down)]">{error}</p>}
    </Section>
  );
}
