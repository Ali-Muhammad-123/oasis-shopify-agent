import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { DocumentList } from '@/components/documents/DocumentList';
import { listDocuments } from '@/lib/documents/store';
import { getSessionShop } from '@/lib/session';

async function Documents() {
  const shop = await getSessionShop();
  if (!shop) redirect('/');
  const docs = await listDocuments(shop.domain);
  return (
    <DocumentList
      docs={docs.map((d) => ({
        id: d.id, filename: d.filename, mimeType: d.mimeType, size: d.size,
        createdAt: d.createdAt.toISOString(), extracted: Boolean(d.extracted),
      }))}
    />
  );
}

export default function DocumentsPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-6">
        <h1 className="text-xl font-semibold">Documents</h1>
        <p className="mt-1 text-sm text-[var(--viz-text-secondary)]">
          Upload supplier invoices, purchase orders, price lists or stock counts (PDF, CSV or image), or a product page you saved from a site that blocks scraping (.html). The agent reads them,
          matches lines to your catalog and proposes price or inventory updates for your approval.
        </p>
        <Suspense fallback={<div className="mt-6 h-40 animate-pulse rounded-xl bg-black/[0.04]" />}>
          <Documents />
        </Suspense>
      </div>
    </div>
  );
}
