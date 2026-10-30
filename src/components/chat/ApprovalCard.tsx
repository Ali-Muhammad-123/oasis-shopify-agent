'use client';

import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, ShieldQuestion, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ActionPreview } from '@/lib/genui/preview';

type Props = {
  toolName: string;
  input: unknown;
  state: string;
  approvalId?: string;
  output?: unknown;
  errorText?: string;
  onRespond: (approvalId: string, approved: boolean) => void;
};

export function ApprovalCard({ toolName, input, state, approvalId, output, errorText, onRespond }: Props) {
  const [preview, setPreview] = useState<ActionPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const pending = state === 'approval-requested';

  useEffect(() => {
    if (state === 'input-streaming') return;
    let cancelled = false;
    fetch('/api/actions/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: toolName, input }),
    })
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json()).error ?? r.statusText))))
      .then((p: ActionPreview) => !cancelled && setPreview(p))
      .catch((e: Error) => !cancelled && setPreviewError(e.message));
    return () => {
      cancelled = true;
    };
    // The input is final once streaming ends; re-fetching on every render would hammer the API.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolName, state === 'input-streaming']);

  const result = output as { ok?: boolean; error?: string; adminUrl?: string; actionId?: string; undoable?: boolean } | undefined;
  const [undoState, setUndoState] = useState<'idle' | 'confirm' | 'working' | 'done' | 'error'>('idle');
  const [undoError, setUndoError] = useState<string | null>(null);
  async function undo() {
    if (!result?.actionId) return;
    setUndoState('working');
    const res = await fetch(`/api/actions/${result.actionId}/undo`, { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.ok) setUndoState('done');
    else {
      setUndoState('error');
      setUndoError(body.error ?? 'Undo failed');
    }
  }
  const status =
    state === 'output-denied' ? { icon: <XCircle size={14} />, text: 'Denied: no changes made', tone: 'text-[var(--viz-text-secondary)]' }
    : state === 'output-error' || result?.ok === false ? { icon: <XCircle size={14} />, text: `Failed: ${result?.error ?? errorText}`, tone: 'text-[var(--viz-delta-down)]' }
    : state === 'output-available' ? { icon: <CheckCircle2 size={14} />, text: 'Approved and applied', tone: 'text-[var(--viz-delta-up)]' }
    : state === 'approval-responded' ? { icon: <Loader2 size={14} className="animate-spin" />, text: 'Applying…', tone: 'text-[var(--viz-text-secondary)]' }
    : null;

  return (
    <div className="rounded-xl border border-amber-300/70 bg-amber-50/60 p-4">
      <div className="flex items-start gap-2">
        <ShieldQuestion size={16} className="mt-0.5 shrink-0 text-amber-700" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{preview?.title ?? toolName}</h3>
            {preview?.link && (
              <a href={preview.link} target="_blank" rel="noreferrer" className="text-[var(--viz-muted)] hover:text-black" aria-label="Open in Shopify admin">
                <ExternalLink size={12} />
              </a>
            )}
          </div>
          <p className="text-xs text-[var(--viz-text-secondary)]">The agent wants to change your store.</p>

          {!preview && !previewError && (
            <p className="mt-3 flex items-center gap-2 text-xs text-[var(--viz-text-secondary)]">
              <Loader2 size={12} className="animate-spin" /> Loading current values…
            </p>
          )}
          {previewError && <p className="mt-3 text-xs text-[var(--viz-delta-down)]">Preview unavailable: {previewError}</p>}

          {preview?.images && preview.images.length > 0 && (
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {preview.images.map((src) => (
                // eslint-disable-next-line @next/next/no-img-element -- remote product photos of arbitrary hosts
                <img key={src} src={src} alt="" loading="lazy" referrerPolicy="no-referrer"
                  className="h-16 w-16 shrink-0 rounded-md border border-black/10 bg-white object-contain" />
              ))}
            </div>
          )}

          {preview && preview.rows.length > 0 && (
            <table className="mt-3 w-full text-xs">
              <tbody>
                {preview.rows.map((r, i) => (
                  <tr key={i} className="border-t border-amber-200/80 align-top">
                    <td className="py-1.5 pr-3 text-[var(--viz-text-secondary)]">{r.label}</td>
                    <td className="tabular py-1.5 text-right">
                      {r.before !== undefined && <span className="text-[var(--viz-muted)] line-through">{r.before}</span>}
                      {r.before !== undefined && <span className="px-1.5 text-[var(--viz-muted)]">→</span>}
                      <span className="font-medium">{r.after}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {preview?.warnings?.map((w) => (
            <p key={w} className="mt-2 flex items-start gap-1.5 text-xs text-amber-800">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {w}
            </p>
          ))}

          {pending && approvalId && (
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => onRespond(approvalId, true)}
                className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700"
              >
                Approve
              </button>
              <button
                type="button"
                onClick={() => onRespond(approvalId, false)}
                className="rounded-lg border border-black/15 bg-white px-3 py-1.5 text-xs font-medium hover:bg-black/5"
              >
                Deny
              </button>
            </div>
          )}
          {status && (
            <p className={`mt-3 flex items-center gap-1.5 text-xs font-medium ${status.tone}`}>
              {status.icon} {status.text}
              {result?.adminUrl && state === 'output-available' && result.ok !== false && (
                <a href={result.adminUrl} target="_blank" rel="noreferrer" className="ml-1 underline">
                  View in Shopify
                </a>
              )}
            </p>
          )}
          {state === 'output-available' && result?.ok && result.undoable && result.actionId && (
            <div className="mt-2 flex items-center gap-2 text-xs">
              {undoState === 'idle' && (
                <button type="button" onClick={() => setUndoState('confirm')} className="rounded-md border border-black/15 bg-white px-2 py-1 font-medium hover:bg-black/5">
                  Undo
                </button>
              )}
              {undoState === 'confirm' && (
                <>
                  <span className="text-[var(--viz-text-secondary)]">Reverse this change?</span>
                  <button type="button" onClick={undo} className="rounded-md bg-zinc-900 px-2 py-1 font-medium text-white hover:bg-zinc-700">Yes, undo</button>
                  <button type="button" onClick={() => setUndoState('idle')} className="rounded-md px-2 py-1 hover:bg-black/5">Cancel</button>
                </>
              )}
              {undoState === 'working' && <span className="flex items-center gap-1 text-[var(--viz-text-secondary)]"><Loader2 size={12} className="animate-spin" /> Undoing…</span>}
              {undoState === 'done' && <span className="font-medium text-[var(--viz-text-secondary)]">Undone: the previous state was restored.</span>}
              {undoState === 'error' && <span className="text-[var(--viz-delta-down)]">Undo failed: {undoError}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
