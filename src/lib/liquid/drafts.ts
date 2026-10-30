import 'server-only';
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '../db';
import { adminGraphql, ShopifyError, userErrorMessage } from '../shopify/admin';
import * as M from '../shopify/mutations';
import { sectionName } from './section';

export const PREVIEW_THEME_NAME = 'Oasis AI preview';

export function listDrafts(shop: string) {
  return db.select().from(schema.liquidDrafts).where(eq(schema.liquidDrafts.shop, shop)).orderBy(desc(schema.liquidDrafts.createdAt));
}

export async function getDraft(shop: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return (await db.query.liquidDrafts.findFirst({ where: and(eq(schema.liquidDrafts.id, id), eq(schema.liquidDrafts.shop, shop)) })) ?? null;
}

type DraftValues = { id?: string; title: string; handle: string; code: string; target?: 'page' | 'product'; productId?: string | null };

export async function saveDraft(shop: string, { id, ...values }: DraftValues) {
  const fields = { ...values, target: values.target ?? 'page', productId: values.productId ?? null };
  if (id) {
    const [row] = await db
      .update(schema.liquidDrafts)
      .set({ ...fields, status: 'draft' })
      .where(and(eq(schema.liquidDrafts.id, id), eq(schema.liquidDrafts.shop, shop)))
      .returning();
    if (row) return row;
  }
  const [row] = await db.insert(schema.liquidDrafts).values({ shop, ...fields }).returning();
  return row;
}

/** Theme JSON templates may start with a comment block that JSON.parse rejects. */
function parseTemplateJson(content: string) {
  return JSON.parse(content.replace(/^\s*\/\*[\s\S]*?\*\/\s*/, ''));
}

/**
 * Builds templates/product.<suffix>.json from the theme's own product template so the standard
 * gallery/buy box stays, then adds the generated section right after the main product section.
 */
async function productTemplateFor(shop: string, themeId: string, sectionType: string) {
  type F = { theme: { files: { nodes: { filename: string; body: { content?: string } }[] } } | null };
  const { data } = await adminGraphql<F>(shop, M.THEME_FILES, { id: themeId, filenames: ['templates/product.json'] });
  const content = data.theme?.files.nodes[0]?.body.content;
  const base = content ? parseTemplateJson(content) : { sections: {}, order: [] };
  const sections = { ...(base.sections ?? {}), 'oasis-pdp': { type: sectionType, settings: {} } };
  const order: string[] = (base.order ?? []).filter((k: string) => k !== 'oasis-pdp');
  const mainIndex = order.findIndex((k) => /main/.test(k) || /main-product|product-information/.test(sections[k]?.type ?? ''));
  order.splice(mainIndex >= 0 ? mainIndex + 1 : order.length, 0, 'oasis-pdp');
  return JSON.stringify({ ...base, sections, order }, null, 2);
}

type Theme = { id: string; name: string; role: string };

/** The unpublished preview theme, duplicated from the live theme the first time. Never the live theme itself. */
export async function ensurePreviewTheme(shop: string): Promise<Theme> {
  const { data } = await adminGraphql<{ themes: { nodes: Theme[] } }>(shop, M.THEMES);
  const existing = data.themes.nodes.find((t) => t.name === PREVIEW_THEME_NAME && t.role === 'UNPUBLISHED');
  if (existing) return existing;
  const main = data.themes.nodes.find((t) => t.role === 'MAIN');
  if (!main) throw new ShopifyError('The store has no live theme to copy');
  type R = { themeDuplicate: { newTheme: Theme | null; userErrors: { field: string[]; message: string }[] } };
  const dup = await adminGraphql<R>(shop, M.THEME_DUPLICATE, { id: main.id, name: PREVIEW_THEME_NAME });
  const err = userErrorMessage(dup.data.themeDuplicate);
  if (err) throw new ShopifyError(err);
  return dup.data.themeDuplicate.newTheme!;
}

export async function publishDraft(shop: string, draftId: string, pageTitle?: string) {
  const draft = await getDraft(shop, draftId);
  if (!draft) throw new ShopifyError(`Draft ${draftId} not found`);
  const theme = await ensurePreviewTheme(shop);
  const suffix = sectionName(draft.handle);

  type U = { themeFilesUpsert: { upsertedThemeFiles: { filename: string }[] | null; userErrors: { field: string[]; message: string }[] } };
  const isProduct = draft.target === 'product';
  if (isProduct && !draft.productId) throw new ShopifyError('This product page draft is not linked to a product');
  const template = isProduct
    ? { filename: `templates/product.${suffix}.json`, value: await productTemplateFor(shop, theme.id, suffix) }
    : { filename: `templates/page.${suffix}.json`, value: JSON.stringify({ sections: { main: { type: suffix, settings: {} } }, order: ['main'] }, null, 2) };
  const files = [
    { filename: `sections/${suffix}.liquid`, body: { type: 'TEXT', value: draft.code } },
    { filename: template.filename, body: { type: 'TEXT', value: template.value } },
  ];
  try {
    const up = await adminGraphql<U>(shop, M.THEME_FILES_UPSERT, { themeId: theme.id, files });
    const err = userErrorMessage(up.data.themeFilesUpsert);
    if (err) throw new ShopifyError(err);
  } catch (err) {
    const msg = (err as Error).message;
    if (/access denied|exemption|ACCESS_DENIED/i.test(msg)) {
      throw new ShopifyError(
        `Shopify denied theme file access (writing theme files needs an exemption for this app). ` +
        `Download the section from the Pages screen and push it with: shopify theme push --theme "${PREVIEW_THEME_NAME}" --only sections/${suffix}.liquid ${template.filename}`,
      );
    }
    throw err;
  }

  const themeNum = theme.id.split('/').pop();
  if (isProduct) {
    type T = { productUpdate: { product: { id: string; handle: string } | null; userErrors: { field: string[]; message: string }[] } };
    const res = await adminGraphql<T>(shop, M.PRODUCT_TEMPLATE_SET, { product: { id: draft.productId, templateSuffix: suffix } });
    const err = userErrorMessage(res.data.productUpdate);
    if (err) throw new ShopifyError(err);
    const handle = res.data.productUpdate.product!.handle;
    const previewUrl = `https://${shop}/products/${handle}?preview_theme_id=${themeNum}`;
    await db
      .update(schema.liquidDrafts)
      .set({ status: 'published', themeId: theme.id, pageId: draft.productId, previewUrl })
      .where(eq(schema.liquidDrafts.id, draft.id));
    return {
      theme: theme.name, product: handle, template: `product.${suffix}`, previewUrl,
      editorUrl: `https://admin.shopify.com/store/${shop.replace('.myshopify.com', '')}/themes/${themeNum}/editor?previewPath=${encodeURIComponent(`/products/${handle}`)}`,
      note: 'Preview links work for staff. The product must be active and on the Online Store to render.',
    };
  }

  // Create the page, or point an existing page with this handle at the new template.
  const title = pageTitle ?? draft.title;
  const found = await adminGraphql<{ pages: { nodes: { id: string; handle: string }[] } }>(shop, M.PAGE_BY_HANDLE, { query: `handle:${draft.handle}` });
  let page: { id: string; handle: string };
  type P = { page: { id: string; handle: string } | null; userErrors: { field: string[]; message: string }[] };
  if (found.data.pages.nodes[0]) {
    const res = await adminGraphql<{ pageUpdate: P }>(shop, M.PAGE_UPDATE, { id: found.data.pages.nodes[0].id, page: { title, templateSuffix: suffix } });
    const err = userErrorMessage(res.data.pageUpdate);
    if (err) throw new ShopifyError(err);
    page = res.data.pageUpdate.page!;
  } else {
    // Unpublished so it doesn't appear on the live store until the merchant chooses to publish it.
    const res = await adminGraphql<{ pageCreate: P }>(shop, M.PAGE_CREATE, {
      page: { title, handle: draft.handle, templateSuffix: suffix, isPublished: false, body: '' },
    });
    const err = userErrorMessage(res.data.pageCreate);
    if (err) throw new ShopifyError(err);
    page = res.data.pageCreate.page!;
  }

  const previewUrl = `https://${shop}/pages/${page.handle}?preview_theme_id=${themeNum}`;
  const editorUrl = `https://admin.shopify.com/store/${shop.replace('.myshopify.com', '')}/themes/${themeNum}/editor?previewPath=${encodeURIComponent(`/pages/${page.handle}`)}`;
  await db
    .update(schema.liquidDrafts)
    .set({ status: 'published', themeId: theme.id, pageId: page.id, previewUrl })
    .where(eq(schema.liquidDrafts.id, draft.id));
  return { theme: theme.name, page: page.handle, previewUrl, editorUrl, note: 'The page is unpublished; preview links work for staff.' };
}
