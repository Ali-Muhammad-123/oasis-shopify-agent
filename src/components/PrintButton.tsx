'use client';

import { Printer } from 'lucide-react';

/** Export the current page through the browser's print dialog ("Save as PDF"); print styles hide app chrome. */
export function PrintButton({ label = 'Export PDF' }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="no-print flex items-center gap-1 rounded-lg border border-black/15 bg-white px-2.5 py-1 text-xs font-medium hover:bg-black/5">
      <Printer size={12} /> {label}
    </button>
  );
}
