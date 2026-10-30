import { Document, Page, Rect, StyleSheet, Svg, Text, View } from '@react-pdf/renderer';
import type { Finding } from '../db/schema';

export type ReportData = {
  shopName: string;
  currency: string;
  periodStart: string;
  periodEnd: string;
  summary: string;
  kpis: { label: string; value: number; previous: number; format: 'currency' | 'number' }[];
  daily: { day: string; sales: number }[];
  topProducts: { title: string; sales: number; change: number | null }[];
  stock: { name: string; available: number; daysOfStock: number | null; reorderQty: number; status: string }[];
  findings: Finding[];
  generatedAt: string;
};

// Same reference palette as the in-app charts.
const C = { ink: '#0b0b0b', secondary: '#52514e', muted: '#898781', grid: '#e1e0d9', accent: '#2a78d6', up: '#006300', down: '#d03b3b', surface: '#f9f9f7' };
const SEVERITY = { critical: '#d03b3b', warning: '#b45309', good: '#006300', info: '#52514e' } as const;

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 10, color: C.ink, fontFamily: 'Helvetica' },
  h1: { fontSize: 18, fontFamily: 'Helvetica-Bold' },
  sub: { color: C.secondary, marginTop: 2 },
  section: { marginTop: 18 },
  h2: { fontSize: 12, fontFamily: 'Helvetica-Bold', marginBottom: 6 },
  kpis: { flexDirection: 'row', gap: 8 },
  kpi: { flex: 1, backgroundColor: C.surface, borderRadius: 6, padding: 8 },
  kpiLabel: { color: C.secondary, fontSize: 8 },
  kpiValue: { fontSize: 14, fontFamily: 'Helvetica-Bold', marginTop: 2 },
  summary: { lineHeight: 1.4, fontSize: 10, color: C.ink },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: C.grid, paddingVertical: 4 },
  th: { color: C.secondary, fontSize: 8 },
  finding: { flexDirection: 'row', marginBottom: 5 },
  dot: { width: 6, height: 6, borderRadius: 3, marginTop: 3, marginRight: 6 },
  footer: { position: 'absolute', bottom: 20, left: 36, right: 36, color: C.muted, fontSize: 8, flexDirection: 'row', justifyContent: 'space-between' },
});

function money(n: number, currency: string, digits = 0) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: digits }).format(n);
}
const change = (cur: number, prev: number) => (prev > 0 ? cur / prev - 1 : null);
const pct = (x: number | null) => (x === null ? '—' : `${x >= 0 ? '+' : ''}${Math.round(x * 100)}%`);

function SalesBars({ daily, currency }: { daily: ReportData['daily']; currency: string }) {
  const width = 523;
  const height = 120;
  const max = Math.max(1, ...daily.map((d) => d.sales));
  const slot = width / Math.max(1, daily.length);
  const bar = Math.min(24, slot - 4);
  return (
    <View>
      <Svg width={width} height={height}>
        <Rect x={0} y={height - 0.5} width={width} height={0.5} fill={C.grid} />
        {daily.map((d, i) => {
          const h = Math.max(d.sales > 0 ? 1 : 0, (d.sales / max) * (height - 8));
          return <Rect key={d.day} x={i * slot + (slot - bar) / 2} y={height - h} width={bar} height={h} fill={C.accent} rx={2} />;
        })}
      </Svg>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 3 }}>
        <Text style={{ color: C.muted, fontSize: 7 }}>{daily[0]?.day}</Text>
        <Text style={{ color: C.muted, fontSize: 7 }}>Peak {money(max, currency)}</Text>
        <Text style={{ color: C.muted, fontSize: 7 }}>{daily[daily.length - 1]?.day}</Text>
      </View>
    </View>
  );
}

export function ReportDocument({ data }: { data: ReportData }) {
  return (
    <Document title={`${data.shopName} weekly report ${data.periodEnd}`} author="Oasis">
      <Page size="A4" style={s.page}>
        <Text style={s.h1}>{data.shopName}: weekly report</Text>
        <Text style={s.sub}>
          {data.periodStart} to {data.periodEnd} · compared with the previous 7 days
        </Text>

        <View style={[s.section, s.kpis]}>
          {data.kpis.map((k) => {
            const c = change(k.value, k.previous);
            return (
              <View key={k.label} style={s.kpi}>
                <Text style={s.kpiLabel}>{k.label}</Text>
                <Text style={s.kpiValue}>{k.format === 'currency' ? money(k.value, data.currency) : k.value.toLocaleString('en-US')}</Text>
                <Text style={{ fontSize: 8, marginTop: 2, color: c === null ? C.muted : c >= 0 ? C.up : C.down }}>{pct(c)} vs prior week</Text>
              </View>
            );
          })}
        </View>

        <View style={s.section}>
          <Text style={s.h2}>Summary</Text>
          <Text style={s.summary}>{data.summary}</Text>
        </View>

        <View style={s.section}>
          <Text style={s.h2}>Daily sales · last {data.daily.length} days</Text>
          <SalesBars daily={data.daily} currency={data.currency} />
        </View>

        {data.findings.length > 0 && (
          <View style={s.section}>
            <Text style={s.h2}>What needs attention</Text>
            {data.findings.map((f, i) => (
              <View key={i} style={s.finding}>
                <View style={[s.dot, { backgroundColor: SEVERITY[f.severity] }]} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: 'Helvetica-Bold' }}>{f.title}</Text>
                  <Text style={{ color: C.secondary, marginTop: 1 }}>{f.detail}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={s.section} wrap={false}>
          <Text style={s.h2}>Top products</Text>
          <View style={s.row}>
            <Text style={[s.th, { flex: 3 }]}>Product</Text>
            <Text style={[s.th, { flex: 1, textAlign: 'right' }]}>Sales</Text>
            <Text style={[s.th, { flex: 1, textAlign: 'right' }]}>vs prior</Text>
          </View>
          {data.topProducts.map((p) => (
            <View key={p.title} style={s.row}>
              <Text style={{ flex: 3 }}>{p.title}</Text>
              <Text style={{ flex: 1, textAlign: 'right' }}>{money(p.sales, data.currency, 2)}</Text>
              <Text style={{ flex: 1, textAlign: 'right', color: p.change === null ? C.muted : p.change >= 0 ? C.up : C.down }}>{pct(p.change)}</Text>
            </View>
          ))}
        </View>

        {data.stock.length > 0 && (
          <View style={s.section} wrap={false}>
            <Text style={s.h2}>Stock alerts</Text>
            <View style={s.row}>
              <Text style={[s.th, { flex: 3 }]}>Item</Text>
              <Text style={[s.th, { flex: 1, textAlign: 'right' }]}>Available</Text>
              <Text style={[s.th, { flex: 1, textAlign: 'right' }]}>Days left</Text>
              <Text style={[s.th, { flex: 1, textAlign: 'right' }]}>Reorder</Text>
            </View>
            {data.stock.map((r) => (
              <View key={r.name} style={s.row}>
                <Text style={{ flex: 3 }}>{r.name}</Text>
                <Text style={{ flex: 1, textAlign: 'right' }}>{r.available}</Text>
                <Text style={{ flex: 1, textAlign: 'right' }}>{r.daysOfStock ?? '—'}</Text>
                <Text style={{ flex: 1, textAlign: 'right' }}>{r.reorderQty}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={s.footer} fixed>
          <Text>Generated by Oasis · {data.generatedAt}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
