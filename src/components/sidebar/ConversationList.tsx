'use client';

import { Check, Loader2, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { cn } from '@/lib/cn';

type Conversation = { id: string; title: string };

export function ConversationList({ conversations }: { conversations: Conversation[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(id: string) {
    setDeleting(id);
    setError(null);
    const res = await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
    setDeleting(null);
    setConfirming(null);
    if (!res.ok && res.status !== 404) {
      setError('Could not delete that chat');
      return;
    }
    if (pathname === `/chat/${id}`) router.push('/chat');
    router.refresh();
  }

  if (!conversations.length) return <p className="px-2 py-1 text-xs text-[var(--viz-muted)]">No chats yet</p>;

  return (
    <>
      {error && <p className="px-2 py-1 text-xs text-[var(--viz-delta-down)]">{error}</p>}
      <ul className="flex flex-col gap-0.5">
        {conversations.map((c) => {
          const active = pathname === `/chat/${c.id}`;
          const isConfirming = confirming === c.id;
          return (
            <li key={c.id} className={cn('group flex items-center rounded-md', active ? 'bg-black/[0.06]' : 'hover:bg-black/5')}>
              <Link
                href={`/chat/${c.id}`}
                title={c.title}
                aria-current={active ? 'page' : undefined}
                className={cn('min-w-0 flex-1 truncate px-2 py-1.5 text-sm', active ? 'font-medium text-black' : 'text-[var(--viz-text-secondary)] hover:text-black')}
              >
                {c.title}
              </Link>
              {deleting === c.id ? (
                <Loader2 size={13} className="mr-2 shrink-0 animate-spin text-[var(--viz-muted)]" />
              ) : isConfirming ? (
                <span className="mr-1 flex shrink-0 items-center gap-0.5">
                  <button type="button" onClick={() => remove(c.id)} aria-label={`Confirm delete "${c.title}"`} title="Delete"
                    className="rounded p-1 text-[var(--viz-delta-down)] hover:bg-red-50">
                    <Check size={13} />
                  </button>
                  <button type="button" onClick={() => setConfirming(null)} aria-label="Cancel" title="Cancel"
                    className="rounded p-1 text-[var(--viz-muted)] hover:bg-black/5 hover:text-black">
                    <X size={13} />
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirming(c.id)}
                  aria-label={`Delete "${c.title}"`}
                  title="Delete chat"
                  className="mr-1 shrink-0 rounded p-1 text-[var(--viz-muted)] opacity-0 transition-opacity hover:bg-black/5 hover:text-[var(--viz-delta-down)] focus:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
