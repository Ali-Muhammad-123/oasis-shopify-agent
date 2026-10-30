'use client';

import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import type { KpiSpec } from '@/lib/genui/spec';
import { formatValue } from '@/lib/format';
import { WidgetCard } from './WidgetCard';

export function KpiTiles({ spec, pinnable = true, fill, actions, handleClassName }: {
  spec: KpiSpec; pinnable?: boolean; fill?: boolean; actions?: React.ReactNode; handleClassName?: string;
}) {
  return (
    <WidgetCard title={spec.title} widget={pinnable ? { kind: 'kpis', spec } : undefined} fill={fill} actions={actions} handleClassName={handleClassName}>
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(140px, 1fr))` }}>
        {spec.items.map((item) => {
          const up = (item.delta ?? 0) >= 0;
          return (
            <div key={item.label} className="rounded-lg bg-black/[0.03] p-3">
              <div className="text-xs text-[var(--viz-text-secondary)]">{item.label}</div>
              <div className="mt-1 text-2xl font-semibold text-[var(--viz-text-primary)]">
                {formatValue(item.value, item.format, spec.currency)}
              </div>
              {(item.delta != null || item.hint) && (
                <div className="mt-1 flex items-center gap-1 text-xs text-[var(--viz-text-secondary)]">
                  {item.delta != null && (
                    <span className="inline-flex items-center font-medium" style={{ color: up ? 'var(--viz-delta-up)' : 'var(--viz-delta-down)' }}>
                      {up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                      {formatValue(Math.abs(item.delta), 'percent')}
                    </span>
                  )}
                  {item.hint}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </WidgetCard>
  );
}
