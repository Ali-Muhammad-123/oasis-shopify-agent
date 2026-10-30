import { PanelsTopLeft } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { listDrafts } from '@/lib/liquid/drafts';
import { getSessionShop } from '@/lib/session';

async function Drafts() {
  const shop = await getSessionShop();
  if (!shop) redirect('/');
  const drafts = await listDrafts(shop.domain);
  if (!drafts.length) {
    return (
      <div className="mt-8 rounded-xl border border-dashed border-black/20 p-10 text-center text-sm text-[var(--viz-text-secondary)]">
        No page drafts yet.{' '}
        <Link href={`/chat?prompt=${encodeURIComponent('Build an "End of Season Sale" landing page featuring our snowboards and accessories')}`} className="font-medium underline">
          Ask the agent to build one
        </Link>
      </div>
    );
  }
  return (
    <ul className="mt-6 divide-y divide-black/10 rounded-xl border border-black/10 bg-white">
      {drafts.map((d) => (
        <li key={d.id}>
          <Link href={`/pages/${d.id}`} className="flex items-center gap-3 p-3 hover:bg-black/[0.02]">
            <PanelsTopLeft size={16} className="text-[var(--viz-text-secondary)]" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{d.title}</div>
              <div className="text-xs text-[var(--viz-muted)]">/pages/{d.handle} · {d.createdAt.toLocaleString()}</div>
            </div>
            <span className={`rounded-full px-2 py-0.5 text-xs ${d.status === 'published' ? 'bg-green-100 text-green-800' : 'bg-black/5 text-[var(--viz-text-secondary)]'}`}>
              {d.status === 'published' ? 'On preview theme' : 'Draft'}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function PagesPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-6">
        <h1 className="text-xl font-semibold">Pages</h1>
        <p className="mt-1 text-sm text-[var(--viz-text-secondary)]">
          Liquid sections the agent generated. Publishing writes to an unpublished preview theme, never your live theme.
        </p>
        <Suspense fallback={<div className="mt-6 h-40 animate-pulse rounded-xl bg-black/[0.04]" />}>
          <Drafts />
        </Suspense>
      </div>
    </div>
  );
}
