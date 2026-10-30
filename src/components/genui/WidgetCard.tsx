'use client';

import { Check, Pin, Table2, BarChart3 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { WidgetSpec } from '@/lib/genui/spec';
import { cn } from '@/lib/cn';

type Props = {
  title?: string;
  widget?: WidgetSpec;
  /** Renders a toggle between the visual and its table view. */
  tableView?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Stretch to the parent's height (dashboard grid tiles); the body scrolls if content overflows. */
  fill?: boolean;
  /** Class that marks the header as the drag handle in a grid. */
  handleClassName?: string;
};

export function WidgetCard({ title, widget, tableView, actions, children, className, fill, handleClassName }: Props) {
  const [showTable, setShowTable] = useState(false);
  const [pin, setPin] = useState<'idle' | 'saving' | 'pinned' | 'error'>('idle');

  async function pinWidget() {
    if (!widget) return;
    setPin('saving');
    const res = await fetch('/api/dashboards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(widget),
    });
    setPin(res.ok ? 'pinned' : 'error');
  }

  return (
    <section className={cn('rounded-xl border border-black/10 bg-[var(--viz-surface)] p-4', fill && 'flex h-full flex-col', className)}>
      {(title || widget || tableView || actions) && (
        <header className={cn('mb-3 flex shrink-0 items-start justify-between gap-3', handleClassName)}>
          {title ? <h3 className="text-sm font-semibold text-[var(--viz-text-primary)]">{title}</h3> : <span />}
          <div className="flex shrink-0 items-center gap-1">
            {actions}
            {tableView && (
              <IconButton label={showTable ? 'Show chart' : 'Show table'} onClick={() => setShowTable((v) => !v)}>
                {showTable ? <BarChart3 size={14} /> : <Table2 size={14} />}
              </IconButton>
            )}
            {widget && (
              <IconButton
                label={pin === 'pinned' ? 'Pinned to dashboard' : pin === 'error' ? 'Pin failed, retry' : 'Pin to dashboard'}
                onClick={pinWidget}
                disabled={pin === 'saving' || pin === 'pinned'}
              >
                {pin === 'pinned' ? <Check size={14} /> : <Pin size={14} />}
              </IconButton>
            )}
          </div>
        </header>
      )}
      {fill ? (
        <div className="min-h-0 flex-1 overflow-auto">{showTable && tableView ? tableView : children}</div>
      ) : showTable && tableView ? (
        tableView
      ) : (
        children
      )}
    </section>
  );
}

export function IconButton({
  label, onClick, disabled, children,
}: { label: string; onClick?: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-[var(--viz-text-secondary)] hover:bg-black/5 disabled:opacity-60"
    >
      {children}
    </button>
  );
}
