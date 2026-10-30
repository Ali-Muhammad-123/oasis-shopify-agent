'use client';

import { GripVertical, Radio, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Responsive, useContainerWidth, type Layout, type LayoutItem } from 'react-grid-layout';
import { GridBackground } from 'react-grid-layout/extras';
import 'react-grid-layout/css/styles.css';
import type { DashboardItem } from '@/lib/dashboards';
import type { WidgetKind } from '@/lib/genui/spec';
import { Widget } from '../genui/Widget';

const COLS = { lg: 12, sm: 1 };
const BREAKPOINTS = { lg: 900, sm: 0 };
const ROW_HEIGHT = 32;
const MARGIN: [number, number] = [16, 16];
const HANDLE = 'oasis-drag-handle';

const DEFAULT_SIZE: Record<WidgetKind, { w: number; h: number }> = { kpis: { w: 12, h: 4 }, chart: { w: 6, h: 9 }, table: { w: 6, h: 9 } };
const MIN_SIZE: Record<WidgetKind, { minW: number; minH: number }> = {
  kpis: { minW: 3, minH: 3 },
  chart: { minW: 3, minH: 6 },
  table: { minW: 3, minH: 5 },
};

/** Saved placements first; widgets without one (newly pinned) go to the bottom at their default size. */
function initialLayout(items: DashboardItem[]): LayoutItem[] {
  let bottom = items.reduce((max, it) => (it.layout ? Math.max(max, it.layout.y + it.layout.h) : max), 0);
  let x = 0;
  return items.map((it) => {
    const kind = it.widget.kind;
    if (it.layout) return { i: it.id, ...it.layout, ...MIN_SIZE[kind] };
    const { w, h } = DEFAULT_SIZE[kind];
    if (x + w > COLS.lg) {
      x = 0;
      bottom += h;
    }
    const placed = { i: it.id, x, y: bottom, w, h, ...MIN_SIZE[kind] };
    x += w;
    return placed;
  });
}

/** One column on narrow screens, keeping the desktop reading order. */
function stacked(layout: Layout): LayoutItem[] {
  return [...layout]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((item, idx) => ({ ...item, x: 0, y: idx * 100, w: 1, minW: 1 }));
}

export function DashboardGrid({ items }: { items: DashboardItem[] }) {
  const router = useRouter();
  const { width, containerRef, mounted } = useContainerWidth();
  const [layout, setLayout] = useState<Layout>(() => initialLayout(items));
  const [breakpoint, setBreakpoint] = useState<'lg' | 'sm'>('lg');
  const [interacting, setInteracting] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState(false);
  const byId = useMemo(() => new Map(items.map((it) => [it.id, it])), [items]);
  const layouts = useMemo(() => ({ lg: layout, sm: stacked(layout) }), [layout]);
  const rows = layout.reduce((max, l) => Math.max(max, l.y + l.h), 0) + 4;

  async function persist(next: Layout) {
    const res = await fetch('/api/dashboards', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layout: next.map(({ i, x, y, w, h }) => ({ i, x, y, w, h })) }),
    });
    setSaveError(!res.ok);
  }

  function onStop(next: Layout) {
    setInteracting(false);
    if (breakpoint !== 'lg') return;
    setLayout(next);
    void persist(next);
  }

  async function remove(id: string) {
    setRemoving(id);
    await fetch(`/api/dashboards/${id}`, { method: 'DELETE' });
    const next = layout.filter((l) => l.i !== id);
    setLayout(next);
    void persist(next);
    setRemoving(null);
    router.refresh();
  }

  if (!items.length) {
    return (
      <div className="mt-8 rounded-xl border border-dashed border-black/20 p-10 text-center">
        <p className="text-sm text-[var(--viz-text-secondary)]">Nothing pinned yet.</p>
        <Link href="/chat" className="mt-2 inline-block text-sm font-medium underline">
          Ask for a chart in chat, then press the pin icon
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <p className="mb-2 text-xs text-[var(--viz-muted)]">
        {breakpoint === 'lg' ? 'Drag a tile by its header and resize from its edges; tiles snap to the grid and the layout saves automatically.' : 'Widen the window to rearrange tiles.'}
        {saveError && <span className="ml-2 text-[var(--viz-delta-down)]">Couldn&apos;t save the layout.</span>}
      </p>
      <div ref={containerRef} className="oasis-grid relative">
        {mounted && (
          <>
            {interacting && breakpoint === 'lg' && (
              <GridBackground
                width={width}
                cols={COLS.lg}
                rowHeight={ROW_HEIGHT}
                margin={MARGIN}
                rows={rows}
                color="rgba(42,120,214,0.06)"
                borderRadius={8}
                className="pointer-events-none absolute inset-0"
              />
            )}
            <Responsive
              width={width}
              layouts={layouts}
              breakpoints={BREAKPOINTS}
              cols={COLS}
              rowHeight={ROW_HEIGHT}
              margin={MARGIN}
              dragConfig={{ enabled: breakpoint === 'lg', handle: `.${HANDLE}`, cancel: 'button, a, input, select, textarea' }}
              resizeConfig={{ enabled: breakpoint === 'lg', handles: ['se', 'e', 's'] }}
              onBreakpointChange={(bp) => setBreakpoint(bp as 'lg' | 'sm')}
              onDragStart={() => setInteracting(true)}
              onResizeStart={() => setInteracting(true)}
              onDragStop={(next) => onStop(next)}
              onResizeStop={(next) => onStop(next)}
            >
              {layout.map((l) => {
                const item = byId.get(l.i);
                if (!item) return <div key={l.i} />;
                return (
                  <div key={l.i} className={removing === l.i ? 'opacity-50' : undefined}>
                    <Widget
                      widget={item.widget}
                      pinnable={false}
                      fill
                      handleClassName={`${HANDLE} cursor-grab active:cursor-grabbing select-none`}
                      actions={
                        <>
                          <GripVertical size={14} className="text-[var(--viz-muted)]" aria-hidden />
                          {item.live ? (
                            <span className="inline-flex items-center gap-1 px-1 text-[11px] text-[var(--viz-muted)]" title="Re-queried each time the dashboard loads">
                              <Radio size={11} /> Live
                            </span>
                          ) : (
                            <span className="px-1 text-[11px] text-[var(--viz-muted)]" title={item.refreshError ?? 'Saved snapshot'}>
                              {item.refreshError ? 'Refresh failed' : 'Snapshot'}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => remove(l.i)}
                            aria-label="Remove from dashboard"
                            title="Remove from dashboard"
                            className="rounded p-1 text-[var(--viz-muted)] hover:bg-black/5 hover:text-[var(--viz-delta-down)]"
                          >
                            <Trash2 size={13} />
                          </button>
                        </>
                      }
                    />
                  </div>
                );
              })}
            </Responsive>
          </>
        )}
      </div>
    </div>
  );
}
