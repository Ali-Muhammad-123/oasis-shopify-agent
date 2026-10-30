import { ArrowLeft, Download, ExternalLink, MessageSquare } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Suspense } from 'react';
import { getDraft } from '@/lib/liquid/drafts';
import { checkSection } from '@/lib/liquid/section';
import { getSessionShop } from '@/lib/session';

async function Draft({ params }: { params: Promise<{ id: string }> }) {
  const shop = await getSessionShop();
  if (!shop) redirect('/');
  const { id } = await params;
  const draft = await getDraft(shop.domain, id);
  if (!draft) notFound();
  const check = checkSection(draft.code);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">{draft.title}</h1>
        <a href={`/api/liquid/${draft.id}/download`} className="flex items-center gap-1 rounded-lg border border-black/15 bg-white px-2.5 py-1.5 text-xs font-medium hover:bg-black/5">
          <Download size={12} /> Download .liquid
        </a>
        <Link
          href={`/chat?prompt=${encodeURIComponent(draft.status === 'published' ? `Revise the page draft ${draft.id}: ` : `Publish the page draft "${draft.title}" (id ${draft.id}) to the preview theme`)}`}
          className="flex items-center gap-1 rounded-lg bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-zinc-700"
        >
          <MessageSquare size={12} /> {draft.status === 'published' ? 'Revise in chat' : 'Publish via chat'}
        </Link>
      </div>
      <p className="mt-1 text-xs text-[var(--viz-muted)]">
        sections/oasis-{draft.handle}.liquid · {draft.status === 'published' ? 'on the Oasis AI preview theme' : 'draft'}
        {draft.previewUrl && (
          <a href={draft.previewUrl} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1 underline">
            Storefront preview <ExternalLink size={10} />
          </a>
        )}
      </p>
      {check.warnings.map((w) => <p key={w} className="mt-2 text-xs text-amber-800">{w}</p>)}

      <h2 className="mt-6 text-sm font-semibold">Preview</h2>
      <p className="text-xs text-[var(--viz-muted)]">Rendered locally with your real products; theme styles and snippets are approximated.</p>
      <iframe
        title="Section preview"
        src={`/api/liquid/${draft.id}/preview`}
        sandbox=""
        className="mt-2 h-[560px] w-full rounded-xl border border-black/10 bg-white"
      />

      <h2 className="mt-6 text-sm font-semibold">Code</h2>
      <pre className="mt-2 max-h-[480px] overflow-auto rounded-xl bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-100">{draft.code}</pre>
    </>
  );
}

export default function DraftPage(props: PageProps<'/pages/[id]'>) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-6">
        <Link href="/pages" className="mb-3 inline-flex items-center gap-1 text-xs text-[var(--viz-text-secondary)] hover:text-black">
          <ArrowLeft size={12} /> Pages
        </Link>
        <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-black/[0.04]" />}>
          <Draft params={props.params} />
        </Suspense>
      </div>
    </div>
  );
}
