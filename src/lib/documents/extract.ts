import 'server-only';
import { generateText, Output } from 'ai';
import { z } from 'zod';
import { getModel } from '../agent/model';
import { extractCsv } from './csv';
import { readDocumentBytes } from './store';

export const extractionSchema = z.object({
  documentType: z.enum(['supplier_invoice', 'purchase_order', 'price_list', 'inventory_count', 'other']),
  vendor: z.string().nullable().describe('Supplier or issuer name'),
  documentNumber: z.string().nullable(),
  date: z.string().nullable().describe('ISO date if present'),
  currency: z.string().nullable().describe('ISO currency code if stated'),
  lineItems: z.array(
    z.object({
      sku: z.string().nullable().describe('SKU / item code exactly as printed'),
      title: z.string().describe('Item description'),
      quantity: z.number().nullable(),
      unitCost: z.number().nullable().describe('What the merchant pays per unit (invoice/PO cost)'),
      price: z.number().nullable().describe('Retail/selling price per unit if listed (price lists, MSRP)'),
    }),
  ),
  total: z.number().nullable(),
  notes: z.string().nullable().describe('Anything else important: payment terms, due date, discrepancies'),
});

export type Extraction = z.infer<typeof extractionSchema> & { source: 'csv' | 'model'; rowCount: number };

/** PDFs and images go to the model as file parts with a strict output schema. */
export async function extractWithModel(doc: { path: string; mimeType: string; filename: string }, modelId?: string | null): Promise<Extraction> {
  const data = await readDocumentBytes(doc);
  const { output } = await generateText({
    model: getModel(modelId),
    output: Output.object({ schema: extractionSchema }),
    instructions:
      'You extract structured data from commerce documents (supplier invoices, purchase orders, price lists, stock counts). ' +
      'Copy SKUs and numbers exactly as printed. Use null for anything not present. Do not invent line items.',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: `Extract every line item from "${doc.filename}".` },
          { type: 'file', mediaType: doc.mimeType, data, filename: doc.filename },
        ],
      },
    ],
  });
  return { ...output, source: 'model', rowCount: output.lineItems.length };
}

export async function extractDocument(doc: { path: string; mimeType: string; filename: string }, modelId?: string | null) {
  if (doc.mimeType === 'text/csv') return extractCsv((await readDocumentBytes(doc)).toString('utf8'));
  return extractWithModel(doc, modelId);
}
