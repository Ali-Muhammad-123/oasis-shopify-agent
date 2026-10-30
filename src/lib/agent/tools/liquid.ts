import 'server-only';
import { tool } from 'ai';
import { z } from 'zod';
import { getDraft, listDrafts, saveDraft } from '../../liquid/drafts';
import { env } from '../../env';
import { checkSection, slugify } from '../../liquid/section';

/** House style for generated sections; checkSection enforces the parts that break legibility. */
const DESIGN_BRIEF = [
  'DESIGN BRIEF (modern, clean, fits any theme):',
  '- Light by default: background #ffffff or a soft neutral (#f8fafc), text #111827, muted text #4b5563, hairlines #e5e7eb, and ONE accent',
  '  color (e.g. #2563eb, or one matching the product). No dark full-width sections or glowing gradients unless the user asks.',
  '- Do not set font-family: inherit the theme\'s fonts. All font sizes in px (themes change rem), e.g. eyebrow 13px uppercase',
  '  letter-spacing .08em; body 16px line-height 1.6; h2 clamp(28px, 4vw, 40px) weight 600 line-height 1.15; h3 20px weight 600; small 14px.',
  '- Expose colors as settings (background_color, text_color, muted_color, accent_color) mapped to CSS variables on the section root,',
  '  and set color explicitly on headings, paragraphs, list items and table cells: themes style headings with their own color.',
  '- Layout: inner max-width 1200px centered, padding 64px 24px (40px 20px under 750px); CSS grid with 24-32px gaps that collapses',
  '  to one column under 750px. Cards: white, 1px solid #e5e7eb border, 16px radius, 24px padding, at most a subtle shadow.',
  '- Content: lead with a short benefit headline and one-line intro, 3-4 feature cards with a short title and one sentence, a clean',
  '  two-column specs table (label muted, value regular, hairline rows), use cases as a simple list, and an FAQ using <details>.',
  '- Accessibility: text contrast at least 4.5:1, one h2 then h3s, alt text on images, no text baked into images, no external scripts.',
].join('\n');

export function createLiquidTools(shop: string) {
  return {
    saveLiquidSection: tool({
      description:
        'Save a Shopify theme section you wrote as a draft page and get validation results. Write ONE self-contained section: ' +
        'HTML + Liquid, scoped CSS inside {% style %}…{% endstyle %} (prefix classes with the section handle), and a ' +
        '{% schema %} JSON with "name" (<= 25 chars), "settings" for editable text/colors, and "presets". ' +
        'Use real store data via Liquid, e.g. {% for product in collections.all.products limit: 8 %}, product.title, product.url, ' +
        'product.price | money, product.featured_image | image_url: width: 600 | image_tag. No external scripts, no {% include %}. ' +
        'If errors come back, fix them and call again with the same draftId. ' +
        'For a product page (PDP) set target "product" and productId: the theme keeps its gallery and buy box, and your section is ' +
        'placed below them, so build product-specific storytelling instead of repeating title/price/add-to-cart: feature highlights, ' +
        'specs table, use cases, what\'s in the box, care/FAQ. Use the `product` object (product.title, product.description, ' +
        'product.featured_image, product.images, product.price | money) and section.settings for editable headings.\n' +
        DESIGN_BRIEF,
      inputSchema: z.object({
        title: z.string().describe('Page title, e.g. "End of Season Sale", or the product name for a PDP'),
        liquid: z.string().describe('Complete section file contents'),
        target: z.enum(['page', 'product']).default('page'),
        productId: z.string().optional().describe('Required when target is "product": gid://shopify/Product/…'),
        draftId: z.string().optional().describe('Pass to update an existing draft'),
      }),
      execute: async ({ title, liquid, draftId, target, productId }) => {
        if (target === 'product' && !productId) return { saved: false, errors: ['productId is required for a product page'] };
        const check = checkSection(liquid);
        if (!check.ok) return { saved: false, errors: check.errors, warnings: check.warnings };
        const gid = productId && !productId.startsWith('gid://') ? `gid://shopify/Product/${productId.replace(/\D/g, '')}` : productId;
        const draft = await saveDraft(shop, {
          id: draftId, title, handle: slugify(target === 'product' && !/\bpdp\b/i.test(title) ? `${title}-pdp` : title), code: liquid,
          target, productId: target === 'product' ? gid : null,
        });
        return {
          saved: true, draftId: draft.id, handle: draft.handle, target: draft.target, warnings: check.warnings,
          previewInApp: new URL(`/pages/${draft.id}`, env.APP_URL).toString(),
          next: 'Tell the user the draft is ready to preview, and offer publishLiquidPage to put it on an unpublished preview theme.',
        };
      },
    }),

    listLiquidDrafts: tool({
      description: 'List saved Liquid page drafts and whether they were published to the preview theme.',
      inputSchema: z.object({}),
      execute: async () => ({
        drafts: (await listDrafts(shop)).map((d) => ({
          id: d.id, title: d.title, handle: d.handle, target: d.target, productId: d.productId, status: d.status, previewUrl: d.previewUrl,
        })),
      }),
    }),

    getLiquidDraft: tool({
      description: 'Get the full code of a saved Liquid draft, e.g. to revise it.',
      inputSchema: z.object({ draftId: z.string() }),
      execute: async ({ draftId }) => {
        const d = await getDraft(shop, draftId);
        return d ? { id: d.id, title: d.title, handle: d.handle, status: d.status, code: d.code } : { error: 'Draft not found' };
      },
    }),
  };
}
