'use client';

import { CheckCircle2, Loader2, Unplug } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Section } from './Section';

type Status = {
  connected: boolean; appConfigured: boolean; accountId?: string | null; accountName?: string | null; currency?: string | null;
  expiresAt?: string | null; accounts?: { id: string; name: string; currency: string; active: boolean }[]; error?: string;
};

export function MetaSettings({ flash }: { flash: string | null }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(flash?.startsWith('error:') ? flash.slice(6) : null);

  const load = () => fetch('/api/integrations/meta').then((r) => r.json()).then(setStatus).catch(() => setError('Could not load Meta status'));
  useEffect(() => {
    load();
  }, []);

  async function connectWithToken(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/integrations/meta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessToken: token }) });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? 'Could not connect');
    else setToken('');
    setBusy(false);
    load();
  }
  async function choose(accountId: string) {
    const res = await fetch('/api/integrations/meta', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId }) });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? 'Could not select account');
    load();
  }
  async function disconnect() {
    await fetch('/api/integrations/meta', { method: 'DELETE' });
    load();
  }

  return (
    <Section title="Integrations · Meta Ads" description="Connect Facebook/Instagram ads to see campaign performance and return on ad spend next to your Shopify revenue.">
      {!status ? (
        <p className="flex items-center gap-2 text-sm text-[var(--viz-muted)]"><Loader2 size={14} className="animate-spin" /> Checking…</p>
      ) : status.connected ? (
        <div className="flex flex-col gap-3 text-sm">
          <p className="flex items-center gap-2">
            <CheckCircle2 size={15} className="text-[var(--viz-delta-up)]" /> Connected
            {status.expiresAt && <span className="text-xs text-[var(--viz-muted)]">· token valid until {new Date(status.expiresAt).toLocaleDateString()}</span>}
            <button type="button" onClick={disconnect} className="ml-auto flex items-center gap-1 rounded-lg border border-black/15 px-2.5 py-1 text-xs hover:bg-black/5">
              <Unplug size={12} /> Disconnect
            </button>
          </p>
          {status.error && <p className="text-xs text-[var(--viz-delta-down)]">{status.error}</p>}
          {status.accounts && (
            <label className="flex items-center gap-2">
              Ad account
              <select value={status.accountId ?? ''} onChange={(e) => choose(e.target.value)} className="rounded-md border border-black/15 px-2 py-1">
                <option value="" disabled>Choose an ad account</option>
                {status.accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name} ({a.currency}){a.active ? '' : ' · inactive'}</option>
                ))}
              </select>
            </label>
          )}
          {status.accounts?.length === 0 && <p className="text-xs text-[var(--viz-muted)]">This token can&apos;t see any ad accounts.</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          {status.appConfigured ? (
            <a href="/api/integrations/meta/connect" className="w-fit rounded-lg bg-[#1877f2] px-3 py-1.5 font-medium text-white hover:opacity-90">Connect with Facebook</a>
          ) : (
            <p className="text-xs text-[var(--viz-text-secondary)]">
              To use “Connect with Facebook”, set META_APP_ID and META_APP_SECRET and add {typeof window !== 'undefined' ? `${window.location.origin}/api/integrations/meta/callback` : '/api/integrations/meta/callback'} as a valid OAuth redirect URI.
              Or paste a user access token with the <code>ads_read</code> permission (e.g. from the Graph API Explorer):
            </p>
          )}
          <form onSubmit={connectWithToken} className="flex gap-2">
            <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Meta access token (ads_read)" autoComplete="off"
              className="flex-1 rounded-lg border border-black/15 px-3 py-1.5 text-sm outline-none focus:border-black/40" />
            <button type="submit" disabled={busy || token.length < 20} className="flex items-center gap-1 rounded-lg bg-zinc-900 px-3 py-1.5 font-medium text-white disabled:opacity-40">
              {busy && <Loader2 size={14} className="animate-spin" />} Connect
            </button>
          </form>
        </div>
      )}
      {flash === 'connected' && <p className="mt-2 text-xs text-[var(--viz-delta-up)]">Meta Ads connected.</p>}
      {error && <p className="mt-2 text-xs text-[var(--viz-delta-down)]">{error}</p>}
    </Section>
  );
}
