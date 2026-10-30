import 'server-only';
import { tool } from 'ai';
import { z } from 'zod';
import { extractDocument, type Extraction } from '../../documents/extract';
import { loadCatalog } from '../../analytics';
import { reconcile } from '../../documents/reconcile';
import { getDocument, listDocuments, saveExtraction } from '../../documents/store';

export function createDocTools(shop: string, modelId: string) {
  async function extracted(documentId: string) {
    const doc = await getDocument(shop, documentId);
    if (!doc) return { error: `Document ${documentId} not found` } as const;
    if (doc.extracted) return { doc, extraction: doc.extracted as Extraction };
    const extraction = await extractDocument(doc, modelId);
    await saveExtraction(shop, doc.id, extraction);
    return { doc, extraction };
  }

  return {
    listDocuments: tool({
      description: 'List documents the user uploaded (invoices, price lists, stock counts) with their ids.',
      inputSchema: z.object({}),
      execute: async () => ({
        documents: (await listDocuments(shop)).map((d) => ({
          id: d.id, filename: d.filename, type: d.mimeType, uploadedAt: d.createdAt, extracted: Boolean(d.extracted),
        })),
      }),
    }),

    extractDocument: tool({
      description:
        'Read an uploaded document and return structured data: type, vendor, date, currency and line items (sku, title, quantity, unit cost, price). ' +
        'Results are cached per document.',
      inputSchema: z.object({ documentId: z.string() }),
      execute: async ({ documentId }) => {
        try {
          const doc = await getDocument(shop, documentId);
          if (doc?.mimeType === 'text/html') return { error: 'This is a saved web page; use scrapeSavedPage for it.' };
          const r = await extracted(documentId);
          if ('error' in r) return r;
          const { lineItems, ...rest } = r.extraction;
          return { filename: r.doc.filename, ...rest, lineItems: lineItems.slice(0, 200), truncated: lineItems.length > 200 };
        } catch (err) {
          return { error: `Extraction failed: ${(err as Error).message}` };
        }
      },
    }),

    reconcileDocument: tool({
      description:
        'Match a document\'s line items to store variants (by SKU, then fuzzy title) and report differences: price changes, cost changes, ' +
        'quantities to receive, and unmatched lines. Use the result to propose updateVariantPrices or adjustInventory.',
      inputSchema: z.object({ documentId: z.string() }),
      execute: async ({ documentId }) => {
        try {
          const r = await extracted(documentId);
          if ('error' in r) return r;
          const matches = reconcile(r.extraction.lineItems, await loadCatalog(shop));
          const matched = matches.filter((m) => m.variant);
          return {
            filename: r.doc.filename,
            documentType: r.extraction.documentType,
            summary: {
              lines: matches.length,
              matched: matched.length,
              unmatched: matches.length - matched.length,
              priceChanges: matches.filter((m) => m.priceChange).length,
              costChanges: matches.filter((m) => m.costChange).length,
            },
            rows: matches.slice(0, 200).map((m) => ({
              docSku: m.line.sku, docTitle: m.line.title, quantity: m.line.quantity,
              variantId: m.variant?.id ?? null,
              variant: m.variant ? `${m.variant.productTitle}${m.variant.title !== 'Default Title' ? ` / ${m.variant.title}` : ''}` : null,
              storeSku: m.variant?.sku ?? null, matchedBy: m.matchedBy, confidence: m.confidence,
              currentPrice: m.variant?.price ?? null, docPrice: m.line.price, priceChanged: Boolean(m.priceChange),
              currentCost: m.variant?.unitCost ?? null, docCost: m.line.unitCost,
              currentStock: m.variant?.inventoryQuantity ?? null,
            })),
          };
        } catch (err) {
          return { error: `Reconcile failed: ${(err as Error).message}` };
        }
      },
    }),
  };
}
