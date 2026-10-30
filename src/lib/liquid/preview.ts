import 'server-only';
import { Liquid } from 'liquidjs';
import { adminGraphql } from '../shopify/admin';
import { PRODUCT_FOR_PDP } from '../shopify/mutations';
import { PREVIEW_PRODUCTS } from '../shopify/queries';
import { checkSection, toPortableLiquid } from './section';

type P = {
  title: string; handle: string; vendor: string; productType: string; tags: string[]; description: string;
  featuredMedia: { preview: { image: { url: string; altText: string | null } | null } } | null;
  priceRangeV2: { minVariantPrice: { amount: string; currencyCode: string } };
  compareAtPriceRange: { minVariantCompareAtPrice: { amount: string } } | null;
};

/** Approximates a handful of Shopify storefront filters well enough for a visual preview. */
function previewEngine(currency: string) {
  const engine = new Liquid({ strictFilters: false, strictVariables: false });
  const money = (cents: unknown) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(cents ?? 0) / 100);
  engine.registerFilter('money', money);
  engine.registerFilter('money_with_currency', (c: unknown) => `${money(c)} ${currency}`);
  engine.registerFilter('money_without_trailing_zeros', (c: unknown) => money(c).replace(/\.00$/, ''));
  engine.registerFilter('image_url', (img: unknown, ...args: unknown[]) => {
    const src = typeof img === 'string' ? img : (img as { src?: string } | null)?.src ?? '';
    const width = args.find((a) => Array.isArray(a) && a[0] === 'width') as [string, number] | undefined;
    return src && width ? `${src}${src.includes('?') ? '&' : '?'}width=${width[1]}` : src;
  });
  engine.registerFilter('image_tag', (url: unknown, ...args: unknown[]) => {
    const alt = (args.find((a) => Array.isArray(a) && a[0] === 'alt') as [string, string] | undefined)?.[1] ?? '';
    return url ? `<img src="${url}" alt="${String(alt).replace(/"/g, '&quot;')}" loading="lazy" style="max-width:100%;height:auto">` : '';
  });
  engine.registerFilter('img_url', (img: unknown) => (typeof img === 'string' ? img : (img as { src?: string } | null)?.src ?? ''));
  engine.registerFilter('asset_url', (name: unknown) => `/assets/${name}`);
  engine.registerFilter('t', (key: unknown) => String(key).split('.').pop()?.replace(/_/g, ' ') ?? '');
  engine.registerFilter('handle', (s: unknown) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-'));
  engine.registerFilter('json', (v: unknown) => JSON.stringify(v));
  engine.registerFilter('stylesheet_tag', () => '');
  engine.registerFilter('script_tag', () => '');
  // {% render %} and {% section %} refer to theme files that don't exist outside the theme.
  engine.registerTag('render', { parse() {}, render: () => '<!-- render: theme snippet -->' });
  engine.registerTag('section', { parse() {}, render: () => '' });
  return engine;
}

export async function renderSectionPreview(shop: string, code: string, productId?: string | null) {
  const check = checkSection(code);
  // Only syntax/schema problems prevent rendering; design-rule findings are shown alongside the preview.
  const fatal = check.errors.filter((e) => /Liquid syntax error|schema/i.test(e) && !/^Setting /.test(e));
  if (fatal.length) return { html: null, errors: check.errors };

  const { data } = await adminGraphql<{ shop: { name: string; primaryDomain: { url: string } }; products: { nodes: P[] } }>(
    shop, PREVIEW_PRODUCTS, { first: 24 },
  );
  const currency = data.products.nodes[0]?.priceRangeV2.minVariantPrice.currencyCode ?? 'USD';
  const products = data.products.nodes.map((p) => {
    const image = p.featuredMedia?.preview.image;
    const price = Math.round(Number(p.priceRangeV2.minVariantPrice.amount) * 100);
    const compare = p.compareAtPriceRange ? Math.round(Number(p.compareAtPriceRange.minVariantCompareAtPrice.amount) * 100) : null;
    const featured = image ? { src: image.url, url: image.url, alt: image.altText ?? p.title, width: 1000, height: 1000 } : null;
    return {
      title: p.title, handle: p.handle, vendor: p.vendor, type: p.productType, tags: p.tags, description: p.description,
      url: `/products/${p.handle}`, price, price_min: price, compare_at_price: compare && compare > price ? compare : null,
      available: true, featured_image: featured, featured_media: featured ? { preview_image: featured } : null,
      images: featured ? [featured] : [],
    };
  });
  const all = { title: 'All products', handle: 'all', url: '/collections/all', products, products_count: products.length };
  const settings = Object.fromEntries((check.schema?.settings ?? []).map((s) => [s.id, s.default ?? null]));
  const product = productId ? await pdpProduct(shop, productId) : products[0] ?? null;

  const html = await previewEngine(currency).parseAndRender(toPortableLiquid(code), {
    section: { id: 'preview', settings, blocks: [] },
    shop: { name: data.shop.name, url: data.shop.primaryDomain.url, currency },
    collections: new Proxy({ all } as Record<string, unknown>, { get: (t, k) => t[k as string] ?? all }),
    all_products: Object.fromEntries(products.map((p) => [p.handle, p])),
    request: { locale: { iso_code: 'en' } },
    product,
  });
  return { html, errors: check.errors };
}

type PdpProduct = {
  id: string; title: string; handle: string; vendor: string; productType: string; tags: string[]; descriptionHtml: string;
  options: { name: string; values: string[] }[];
  media: { nodes: { image?: { url: string; altText: string | null; width: number; height: number } }[] };
  variants: { nodes: { id: string; title: string; sku: string | null; price: string; compareAtPrice: string | null; availableForSale: boolean }[] };
  metafields: { nodes: { key: string; value: string }[] };
};

/** Shapes a product like the storefront `product` Liquid object, closely enough for a preview. */
async function pdpProduct(shop: string, id: string) {
  const { data } = await adminGraphql<{ product: PdpProduct | null }>(shop, PRODUCT_FOR_PDP, { id });
  const p = data.product;
  if (!p) return null;
  const images = p.media.nodes.filter((m) => m.image).map((m) => ({ src: m.image!.url, url: m.image!.url, alt: m.image!.altText ?? p.title, width: m.image!.width, height: m.image!.height }));
  const cents = (v: string | null) => (v == null ? null : Math.round(Number(v) * 100));
  const variants = p.variants.nodes.map((v) => ({ id: v.id, title: v.title, sku: v.sku, price: cents(v.price), compare_at_price: cents(v.compareAtPrice), available: v.availableForSale }));
  return {
    id: p.id, title: p.title, handle: p.handle, vendor: p.vendor, type: p.productType, tags: p.tags,
    description: p.descriptionHtml, content: p.descriptionHtml, url: `/products/${p.handle}`,
    price: variants[0]?.price ?? 0, compare_at_price: variants[0]?.compare_at_price ?? null, available: variants.some((v) => v.available),
    featured_image: images[0] ?? null, featured_media: images[0] ? { preview_image: images[0] } : null, images, media: images.map((i) => ({ preview_image: i })),
    variants, selected_or_first_available_variant: variants[0] ?? null, options: p.options.map((o) => o.name),
    options_with_values: p.options.map((o) => ({ name: o.name, values: o.values })),
    metafields: { oasis: Object.fromEntries(p.metafields.nodes.map((m) => [m.key, m.value])) },
  };
}
