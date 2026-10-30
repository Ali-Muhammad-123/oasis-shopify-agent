import type { Format } from './genui/spec';

export function formatValue(value: unknown, format: Format = 'text', currency?: string, compact = false): string {
  if (value == null || value === '') return '—';
  if (format === 'text') return String(value);
  if (format === 'date') {
    const d = new Date(String(value));
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString(undefined, { dateStyle: 'medium' });
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  const notation = compact ? 'compact' : 'standard';
  if (format === 'percent') return new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 }).format(n);
  if (format === 'currency' && currency) {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, notation, maximumFractionDigits: compact ? 1 : 2 }).format(n);
  }
  return new Intl.NumberFormat(undefined, { notation, maximumFractionDigits: compact ? 1 : 2 }).format(n);
}

export const SERIES_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)'];
