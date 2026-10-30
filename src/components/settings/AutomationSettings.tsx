'use client';

import { useState } from 'react';
import { Section } from './Section';

type S = { briefEnabled: boolean; briefHour: number; weeklyReportEnabled: boolean; weeklyReportDay: number };
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function AutomationSettings({ initial, timezone }: { initial: S; timezone: string }) {
  const [s, setS] = useState(initial);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  async function update(patch: Partial<S>) {
    const next = { ...s, ...patch };
    setS(next);
    setStatus('saving');
    const res = await fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    setStatus(res.ok ? 'saved' : 'error');
  }

  return (
    <Section title="Automations" description={`Runs inside the app on store time (${timezone}). Briefs appear on the dashboard; reports appear under Reports.`}>
      <div className="flex flex-col gap-3 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={s.briefEnabled} onChange={(e) => update({ briefEnabled: e.target.checked })} />
          Daily store brief at
          <select value={s.briefHour} onChange={(e) => update({ briefHour: Number(e.target.value) })} disabled={!s.briefEnabled && !s.weeklyReportEnabled}
            className="rounded-md border border-black/15 px-2 py-1">
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={s.weeklyReportEnabled} onChange={(e) => update({ weeklyReportEnabled: e.target.checked })} />
          Weekly PDF report every
          <select value={s.weeklyReportDay} onChange={(e) => update({ weeklyReportDay: Number(e.target.value) })} disabled={!s.weeklyReportEnabled}
            className="rounded-md border border-black/15 px-2 py-1">
            {DAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
          </select>
        </label>
        <p className="text-xs text-[var(--viz-muted)]" aria-live="polite">
          {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved.' : status === 'error' ? 'Could not save.' : ' '}
        </p>
      </div>
    </Section>
  );
}
