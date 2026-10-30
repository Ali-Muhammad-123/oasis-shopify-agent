'use client';

import { AlertCircle, Check, ChevronRight, Loader2 } from 'lucide-react';
import { useState } from 'react';

const LABELS: Record<string, string> = {
  getShopOverview: 'Checked store overview',
  searchOrders: 'Searched orders',
  getOrder: 'Opened order',
  searchProducts: 'Searched products',
  getProduct: 'Opened product',
  getLowInventory: 'Checked low inventory',
  searchCustomers: 'Searched customers',
  getTopCustomers: 'Ranked customers by spend',
  getCustomer: 'Opened customer',
  listDiscounts: 'Listed discounts',
  listDraftOrders: 'Listed draft orders',
  runShopifyQL: 'Ran analytics query',
  runAdminGraphQL: 'Ran GraphQL query',
  listDocuments: 'Listed documents',
  extractDocument: 'Read document',
  reconcileDocument: 'Matched document to catalog',
  saveLiquidSection: 'Saved Liquid page draft',
  listLiquidDrafts: 'Listed page drafts',
  getLiquidDraft: 'Opened page draft',
  scrapeUrl: 'Read web page',
  scrapeSavedPage: 'Read saved web page',
  rememberPreference: 'Saved a store preference',
  listPreferences: 'Checked store preferences',
  forgetPreference: 'Removed a store preference',
  listRecentActions: 'Checked recent changes',
  getMarginReport: 'Calculated margins',
  forecastInventory: 'Forecast inventory',
  createPurchaseOrderCsv: 'Created purchase order',
  previewCustomerSegment: 'Previewed customer segment',
  listCustomerSegments: 'Listed customer segments',
  exportSegmentEmails: 'Exported segment emails',
  getStoreBrief: 'Read the latest store brief',
  generateReport: 'Generated a PDF report',
  getAdPerformance: 'Read Meta Ads performance',
  getRoasReport: 'Calculated return on ad spend',
};

function summary(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const i = input as Record<string, unknown>;
  const v = i.query ?? i.url ?? i.id ?? i.documentId ?? i.draftId ?? i.title ?? i.threshold;
  return v == null || v === '' ? null : String(v);
}

export function ToolStep({ toolName, state, input, output, errorText }: {
  toolName: string; state: string; input: unknown; output?: unknown; errorText?: string;
}) {
  const [open, setOpen] = useState(false);
  const running = state === 'input-streaming' || state === 'input-available';
  const failed = state === 'output-error' || Boolean((output as { error?: unknown })?.error) || Boolean((output as { parseErrors?: unknown[] })?.parseErrors?.length);
  const detail = summary(input);

  return (
    <div className="text-xs text-[var(--viz-text-secondary)]">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex max-w-full items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-black/5">
        {running ? <Loader2 size={12} className="animate-spin" /> : failed ? <AlertCircle size={12} className="text-amber-700" /> : <Check size={12} className="text-[var(--viz-delta-up)]" />}
        <span className="font-medium">{LABELS[toolName] ?? toolName}</span>
        {detail && <code className="truncate rounded bg-black/5 px-1 font-mono text-[11px]">{detail}</code>}
        <ChevronRight size={12} className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <pre className="mt-1 max-h-72 overflow-auto rounded-lg bg-black/[0.04] p-2 font-mono text-[11px] leading-relaxed">
          {JSON.stringify({ input, output: output ?? errorText ?? null }, null, 2)}
        </pre>
      )}
    </div>
  );
}
