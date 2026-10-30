import 'server-only';
import { tool } from 'ai';
import { z } from 'zod';
import { getDocument, readDocumentBytes } from '../../documents/store';
import { extractProductPage, pageUrlFromHtml } from '../../scrape/extract';
import { canonicalUrl, fetchPage, FetchPageError } from '../../scrape/fetch';

export function createWebTools(shop: string) {
  return {
    scrapeUrl: tool({
      description:
        'Fetch a public web page (e.g. a product page on Amazon, a supplier site or another store) and extract product data: ' +
        'title, brand, price + currency, description, bullet points, specs, image URLs, SKU/ASIN and readable page text. ' +
        'Use when the user shares a link. Third-party text and photos may be copyrighted: write original copy rather than copying it verbatim.',
      inputSchema: z.object({ url: z.url().describe('Full http(s) URL the user provided') }),
      execute: async ({ url }) => {
        try {
          const page = await fetchPage(url);
          const product = extractProductPage(page.html, page.url);
          return { ...product, text: product.text.slice(0, 4000), fetchedVia: page.via };
        } catch (err) {
          if (err instanceof FetchPageError) return { error: err.message };
          throw err;
        }
      },
    }),

    scrapeSavedPage: tool({
      description:
        'Extract product data from a web page the user saved and uploaded (.html), e.g. when scrapeUrl was blocked by a bot check. ' +
        'Returns the same fields as scrapeUrl. Pass the original link as url if the user gave it.',
      inputSchema: z.object({
        documentId: z.string().describe('Id of the uploaded .html document (see listDocuments)'),
        url: z.url().optional().describe('Original page address, if known'),
      }),
      execute: async ({ documentId, url }) => {
        const doc = await getDocument(shop, documentId);
        if (!doc) return { error: `Document ${documentId} not found` };
        if (doc.mimeType !== 'text/html') return { error: `${doc.filename} is not a saved web page (.html)` };
        const html = (await readDocumentBytes(doc)).toString('utf8');
        const pageUrl = url ?? pageUrlFromHtml(html);
        if (!pageUrl) return { error: 'Could not tell which site this page came from; ask the user for the original link and pass it as url.' };
        const product = extractProductPage(html, canonicalUrl(pageUrl));
        if (!product.title && !product.images.length) {
          return { error: 'No product details found in this file. It may be a bot-check page; ask the user to save the page again after it fully loads.' };
        }
        return { ...product, text: product.text.slice(0, 4000), fetchedVia: 'upload', filename: doc.filename };
      },
    }),
  };
}
