'use client';

import { ExternalLink } from 'lucide-react';
import type { Format } from '@/lib/genui/spec';
import { formatValue } from '@/lib/format';

type Column = { key: string; label: string; format?: Format };
type Props = {
  columns: Column[];
  rows: Record<string, unknown>[];
  linkKey?: string;
  currency?: string;
  /** Let the parent decide the height (grid tiles) instead of capping at 24rem. */
  fill?: boolean;
};

const numeric = (f?: Format) => f === 'number' || f === 'currency' || f === 'percent';

export function DataTable({ columns, rows, linkKey, currency, fill }: Props) {
  if (!rows.length) return <p className="py-6 text-center text-sm text-[var(--viz-muted)]">No rows</p>;
  return (
    <div className={fill ? 'h-full overflow-auto' : 'max-h-96 overflow-auto'}>
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 bg-[var(--viz-surface)]">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={`border-b border-[var(--viz-grid)] px-2 py-1.5 text-xs font-medium text-[var(--viz-text-secondary)] ${numeric(c.format) ? 'text-right' : 'text-left'}`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-black/[0.03]">
              {columns.map((c, j) => {
                const text = formatValue(row[c.key], c.format, currency);
                const href = j === 0 && linkKey ? String(row[linkKey] ?? '') : '';
                return (
                  <td
                    key={c.key}
                    className={`border-b border-[var(--viz-grid)]/60 px-2 py-1.5 text-[var(--viz-text-primary)] ${numeric(c.format) ? 'tabular text-right' : ''}`}
                  >
                    {href ? (
                      <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
                        {text} <ExternalLink size={11} className="text-[var(--viz-muted)]" />
                      </a>
                    ) : (
                      text
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
