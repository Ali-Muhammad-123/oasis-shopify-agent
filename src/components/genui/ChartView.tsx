'use client';

import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps,
} from 'recharts';
import type { ChartSpec, TableSpec } from '@/lib/genui/spec';
import { formatValue, SERIES_COLORS } from '@/lib/format';
import { DataTable } from './DataTable';
import { WidgetCard } from './WidgetCard';

const axisProps = {
  tick: { fill: 'var(--viz-muted)', fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: 'var(--viz-axis)' },
} as const;

/** Shortens ISO dates on the x axis; leaves other labels alone. */
function formatX(v: unknown) {
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s.length === 10 ? `${s}T00:00:00` : s);
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return s.length > 14 ? `${s.slice(0, 13)}…` : s;
}

function ChartTooltip({ active, payload, label, spec }: TooltipContentProps & { spec: ChartSpec }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-black/10 bg-white px-3 py-2 text-xs shadow-sm">
      {spec.type !== 'pie' && <div className="mb-1 font-medium text-[var(--viz-text-primary)]">{formatX(label)}</div>}
      {payload.map((p) => {
        const s = spec.series.find((x) => x.key === p.dataKey) ?? spec.series[0];
        return (
          <div key={String(p.dataKey) + String(p.name)} className="flex items-center gap-2 text-[var(--viz-text-secondary)]">
            <span className="h-2 w-2 rounded-full" style={{ background: p.color ?? (p.payload as { fill?: string })?.fill }} />
            <span>{spec.type === 'pie' ? String(p.name) : (s.label ?? s.key)}</span>
            <span className="tabular ml-auto pl-3 font-medium text-[var(--viz-text-primary)]">
              {formatValue(p.value, s.format, spec.currency)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function toTableSpec(spec: ChartSpec): TableSpec {
  return {
    title: spec.title,
    columns: [{ key: spec.xKey, label: spec.xKey, format: 'text' }, ...spec.series.map((s) => ({ key: s.key, label: s.label ?? s.key, format: s.format }))],
    rows: spec.data,
    currency: spec.currency,
  };
}

type ChartViewProps = {
  spec: ChartSpec;
  pinnable?: boolean;
  height?: number;
  /** Grid tile mode: the chart fills the card instead of using a fixed height. */
  fill?: boolean;
  actions?: React.ReactNode;
  handleClassName?: string;
};

export function ChartView({ spec, pinnable = true, height = 260, fill, actions, handleClassName }: ChartViewProps) {
  const table = toTableSpec(spec);
  const multi = spec.series.length > 1;
  const yFormat = spec.series[0].format;
  const yTick = (v: number) => formatValue(v, yFormat, spec.currency, true);
  const legend = multi ? <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: 'var(--viz-text-secondary)' }} /> : null;
  const tooltip = <Tooltip content={(p) => <ChartTooltip {...p} spec={spec} />} cursor={{ stroke: 'var(--viz-axis)', fill: 'rgba(0,0,0,0.03)' }} />;
  const grid = <CartesianGrid vertical={false} stroke="var(--viz-grid)" />;
  const x = <XAxis dataKey={spec.xKey} {...axisProps} tickFormatter={formatX} minTickGap={16} />;
  const y = <YAxis {...axisProps} axisLine={false} tickFormatter={yTick} width={56} />;

  let chart: React.ReactElement;
  if (spec.type === 'pie') {
    const s = spec.series[0];
    chart = (
      <PieChart>
        <Pie data={spec.data} dataKey={s.key} nameKey={spec.xKey} innerRadius="55%" outerRadius="85%" stroke="var(--viz-surface)" strokeWidth={2}>
          {spec.data.map((_, i) => <Cell key={i} fill={SERIES_COLORS[i % SERIES_COLORS.length]} />)}
        </Pie>
        {tooltip}
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: 'var(--viz-text-secondary)' }} />
      </PieChart>
    );
  } else if (spec.type === 'bar') {
    chart = (
      <BarChart data={spec.data} barGap={2} barCategoryGap="20%">
        {grid}{x}{y}{tooltip}{legend}
        {spec.series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.label ?? s.key} fill={SERIES_COLORS[i]} maxBarSize={24} radius={[4, 4, 0, 0]} />
        ))}
      </BarChart>
    );
  } else if (spec.type === 'area') {
    chart = (
      <AreaChart data={spec.data}>
        {grid}{x}{y}{tooltip}{legend}
        {spec.series.map((s, i) => (
          <Area key={s.key} type="monotone" dataKey={s.key} name={s.label ?? s.key} stroke={SERIES_COLORS[i]} strokeWidth={2}
            fill={SERIES_COLORS[i]} fillOpacity={0.1} activeDot={{ r: 4, stroke: 'var(--viz-surface)', strokeWidth: 2 }} />
        ))}
      </AreaChart>
    );
  } else {
    chart = (
      <LineChart data={spec.data}>
        {grid}{x}{y}{tooltip}{legend}
        {spec.series.map((s, i) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.label ?? s.key} stroke={SERIES_COLORS[i]} strokeWidth={2}
            strokeLinecap="round" strokeLinejoin="round" dot={spec.data.length <= 2 ? { r: 4 } : false}
            activeDot={{ r: 4, stroke: 'var(--viz-surface)', strokeWidth: 2 }} />
        ))}
      </LineChart>
    );
  }

  return (
    <WidgetCard
      fill={fill}
      actions={actions}
      handleClassName={handleClassName}
      title={spec.title}
      widget={pinnable ? { kind: 'chart', spec } : undefined}
      tableView={<DataTable columns={table.columns} rows={table.rows} currency={spec.currency} fill={fill} />}
    >
      {spec.data.length === 0 ? (
        <p className="py-10 text-center text-sm text-[var(--viz-muted)]">No data for this range</p>
      ) : (
        <div style={{ height: fill ? '100%' : height, minHeight: fill ? 120 : undefined }} role="img" aria-label={`${spec.type} chart: ${spec.title}`}>
          <ResponsiveContainer width="100%" height="100%">{chart}</ResponsiveContainer>
        </div>
      )}
    </WidgetCard>
  );
}
