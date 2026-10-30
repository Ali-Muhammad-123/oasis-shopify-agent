'use client';

import { FileSpreadsheet, FileText, Globe, Image as ImageIcon, Loader2, MessageSquare, Trash2, Upload } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

type Doc = { id: string; filename: string; mimeType: string; size: number; createdAt: string; extracted: boolean };

const icon = (mime: string) =>
  mime === 'text/csv' ? <FileSpreadsheet size={16} /> : mime.startsWith('image/') ? <ImageIcon size={16} /> : mime === 'text/html' ? <Globe size={16} /> : <FileText size={16} />;

export function DocumentList({ docs }: { docs: Doc[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setError(null);
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.set('file', file);
      const res = await fetch('/api/documents', { method: 'POST', body: form });
      if (!res.ok) setError(`${file.name}: ${(await res.json()).error ?? res.statusText}`);
    }
    setUploading(false);
    if (inputRef.current) inputRef.current.value = '';
    router.refresh();
  }

  async function remove(id: string) {
    await fetch(`/api/documents/${id}`, { method: 'DELETE' });
    router.refresh();
  }

  return (
    <div className="mt-6">
      <label
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          upload(e.dataTransfer.files);
        }}
        className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-black/25 bg-white p-8 text-sm text-[var(--viz-text-secondary)] hover:border-black/40"
      >
        {uploading ? <Loader2 size={20} className="animate-spin" /> : <Upload size={20} />}
        <span>{uploading ? 'Uploading…' : 'Drop files here or click to upload'}</span>
        <span className="text-xs text-[var(--viz-muted)]">PDF, CSV, images, or a saved web page (.html) up to 10 MB</span>
        <input ref={inputRef} type="file" multiple accept=".pdf,.csv,.png,.jpg,.jpeg,.webp,.html,.htm" className="hidden" onChange={(e) => upload(e.target.files)} />
      </label>
      {error && <p className="mt-2 text-sm text-[var(--viz-delta-down)]">{error}</p>}

      <ul className="mt-6 divide-y divide-black/10 rounded-xl border border-black/10 bg-white">
        {docs.length === 0 && <li className="p-4 text-sm text-[var(--viz-muted)]">No documents yet. Try the samples in fixtures/.</li>}
        {docs.map((d) => (
          <li key={d.id} className="flex items-center gap-3 p-3">
            <span className="text-[var(--viz-text-secondary)]">{icon(d.mimeType)}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{d.filename}</div>
              <div className="text-xs text-[var(--viz-muted)]">
                {(d.size / 1024).toFixed(0)} KB · {new Date(d.createdAt).toLocaleString()} · {d.extracted ? 'Extracted' : 'Not read yet'}
              </div>
            </div>
            <Link
              href={`/chat?prompt=${encodeURIComponent(d.mimeType === 'text/html'
                ? `Read the saved product page "${d.filename}" (id ${d.id}) and add that product to my store with a product page made for it.`
                : `Analyze the document "${d.filename}" (id ${d.id}): what is it, and how does it compare to my catalog?`)}`}
              className="flex items-center gap-1 rounded-lg border border-black/15 px-2.5 py-1.5 text-xs font-medium hover:bg-black/5"
            >
              <MessageSquare size={12} /> Analyze in chat
            </Link>
            <button type="button" onClick={() => remove(d.id)} aria-label={`Delete ${d.filename}`} className="rounded p-1.5 text-[var(--viz-muted)] hover:bg-black/5 hover:text-black">
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
