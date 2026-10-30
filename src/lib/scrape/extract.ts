import { load, type CheerioAPI } from 'cheerio';

export type ScrapedProduct = {
  url: string;
  site: string;
  title: string | null;
  brand: string | null;
  price: { amount: number; currency: string } | null;
  description: string | null;
  bullets: string[];
  specs: Record<string, string>;
  images: string[];
  sku: string | null;
  gtin: string | null;
  /** Readable page text for anything the structured fields missed. */
  text: string;
  /** Text and image URLs come from a third-party page; rights to reuse them are not implied. */
  source: 'json-ld' | 'amazon' | 'opengraph' | 'html';
};

const clean = (s: string | undefined | null) => (s ?? '').replace(/\s+/g, ' ').trim();
const CURRENCY_SYMBOLS: Record<string, string> = { $: 'USD', '£': 'GBP', '€': 'EUR', '¥': 'JPY', '₹': 'INR', C$: 'CAD', A$: 'AUD' };

export function parsePrice(raw: string | null | undefined, fallbackCurrency?: string | null) {
  const s = clean(raw);
  if (!s) return null;
  // The last "." or "," followed by 1-2 digits is the decimal mark; every other separator groups thousands.
  const digits = s.replace(/[^0-9.,]/g, '');
  const decimals = digits.match(/[.,](\d{1,2})$/);
  const whole = (decimals ? digits.slice(0, -decimals[0].length) : digits).replace(/[.,]/g, '');
  const amount = Number(decimals ? `${whole}.${decimals[1]}` : whole);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const code = s.match(/(?:^|[^A-Z])([A-Z]{3})(?![A-Z])/)?.[1];
  const symbol = Object.keys(CURRENCY_SYMBOLS).sort((a, b) => b.length - a.length).find((k) => s.includes(k));
  return { amount, currency: code ?? (symbol ? CURRENCY_SYMBOLS[symbol] : fallbackCurrency ?? 'USD') };
}

function absolute(src: string | undefined, base: string) {
  if (!src || src.startsWith('data:')) return null;
  try {
    return new URL(src, base).toString();
  } catch {
    return null;
  }
}

/** Finds the first schema.org Product in any JSON-LD block (including @graph arrays). */
function jsonLdProduct($: CheerioAPI): Record<string, unknown> | null {
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    try {
      const data = JSON.parse($(el).text());
      const queue = Array.isArray(data) ? [...data] : [data];
      while (queue.length) {
        const node = queue.shift();
        if (!node || typeof node !== 'object') continue;
        const type = (node as { '@type'?: unknown })['@type'];
        if (type === 'Product' || (Array.isArray(type) && type.includes('Product'))) return node as Record<string, unknown>;
        if (Array.isArray((node as { '@graph'?: unknown })['@graph'])) queue.push(...(node as { '@graph': unknown[] })['@graph']);
      }
    } catch {
      // Malformed JSON-LD is common; skip it.
    }
  }
  return null;
}

function readableText($: CheerioAPI, limit = 6000) {
  const root = $('main').length ? $('main') : $('body');
  const copy = root.clone();
  copy.find('script, style, noscript, svg, nav, footer, header, iframe').remove();
  return clean(copy.text()).slice(0, limit);
}

function genericImages($: CheerioAPI, base: string) {
  const urls: string[] = [];
  $('img').each((_, el) => {
    const img = $(el);
    const srcset = img.attr('srcset') ?? img.attr('data-srcset');
    const best = srcset ? srcset.split(',').map((s) => s.trim().split(/\s+/)[0]).pop() : undefined;
    const src = absolute(best ?? img.attr('data-src') ?? img.attr('src'), base);
    const w = Number(img.attr('width') ?? 0);
    if (!src || /\.svg(\?|$)|sprite|icon|logo|pixel|spacer|1x1/i.test(src) || (w > 0 && w < 200)) return;
    urls.push(src);
  });
  return urls;
}

function amazon($: CheerioAPI, html: string, base: string): Partial<ScrapedProduct> {
  const specs: Record<string, string> = {};
  $('#productOverview_feature_div tr').each((_, tr) => {
    const [k, v] = $(tr).find('td').toArray().map((td) => clean($(td).text()));
    if (k && v) specs[k] = v;
  });
  $('#prodDetails tr, #productDetails_techSpec_section_1 tr, #productDetails_detailBullets_sections1 tr').each((_, tr) => {
    const k = clean($(tr).find('th').text());
    const v = clean($(tr).find('td').text());
    if (k && v && !/customer reviews|best sellers rank/i.test(k)) specs[k] = v;
  });
  $('#detailBullets_feature_div li').each((_, li) => {
    const [k, ...rest] = clean($(li).text()).split(':');
    if (k && rest.length && !/customer reviews|best sellers rank/i.test(k)) specs[clean(k.replace(/[‎‏]/g, ''))] = clean(rest.join(':'));
  });

  // Gallery images live in an inline script as "hiRes" URLs; fall back to the main image.
  const hiRes = [...html.matchAll(/"hiRes":"(https:\/\/[^"]+)"/g)].map((m) => m[1]);
  const main = $('#landingImage').attr('data-old-hires') || $('#landingImage').attr('src');
  const images = [...new Set([...hiRes, ...(main ? [main] : [])])].map((u) => absolute(u, base)!).filter(Boolean);

  const brand = clean($('#bylineInfo').text()).replace(/^(Visit the|Brand:)\s*/i, '').replace(/\s*Store$/i, '') || specs.Brand || null;
  const asin = base.match(/\/(?:dp|gp\/product|clp)\/([A-Z0-9]{10})/)?.[1] ?? ($('input#ASIN, input[name="ASIN"]').attr('value') || null);
  return {
    title: clean($('#productTitle').text()) || null,
    brand,
    price: parsePrice($('#corePrice_feature_div .a-offscreen').first().text() || $('.a-price .a-offscreen').first().text()),
    bullets: $('#feature-bullets li').toArray().map((li) => clean($(li).text())).filter((t) => t && !/^make sure this fits/i.test(t)),
    description: clean($('#productDescription').text()) || null,
    specs,
    images,
    sku: asin,
  };
}

/** The original address of a saved web page, from its canonical link or og:url. */
export function pageUrlFromHtml(html: string): string | null {
  const $ = load(html);
  const candidates = [$('link[rel="canonical"]').attr('href'), $('meta[property="og:url"]').attr('content')];
  for (const c of candidates) {
    try {
      if (c && /^https?:\/\//.test(c)) return new URL(c).toString();
    } catch {
      // ignore malformed values
    }
  }
  return null;
}

export function extractProductPage(html: string, url: string): ScrapedProduct {
  const $ = load(html);
  const site = new URL(url).hostname.replace(/^www\./, '');
  const meta = (name: string) => $(`meta[property="${name}"], meta[name="${name}"]`).attr('content') ?? null;
  const ld = jsonLdProduct($);

  const base: ScrapedProduct = {
    url, site, title: null, brand: null, price: null, description: null, bullets: [], specs: {}, images: [],
    sku: null, gtin: null, text: readableText($), source: 'html',
  };

  if (ld) {
    const offers = (Array.isArray(ld.offers) ? ld.offers[0] : ld.offers) as Record<string, unknown> | undefined;
    const img = ld.image;
    const brand = ld.brand as { name?: string } | string | undefined;
    Object.assign(base, {
      source: 'json-ld',
      title: clean(String(ld.name ?? '')) || null,
      description: clean(String(ld.description ?? '')) || null,
      brand: typeof brand === 'string' ? brand : brand?.name ?? null,
      price: offers?.price != null ? parsePrice(String(offers.price), String(offers.priceCurrency ?? '') || null) : null,
      images: (Array.isArray(img) ? img : img ? [img] : [])
        .map((i) => absolute(typeof i === 'string' ? i : (i as { url?: string }).url, url))
        .filter((u): u is string => Boolean(u)),
      sku: ld.sku ? String(ld.sku) : null,
      gtin: String(ld.gtin13 ?? ld.gtin12 ?? ld.gtin ?? '') || null,
    });
  }

  if (/(^|\.)amazon\./.test(site)) {
    const a = amazon($, html, url);
    Object.assign(base, Object.fromEntries(Object.entries(a).filter(([, v]) => v != null && (!Array.isArray(v) || v.length) && (typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length))));
    base.source = 'amazon';
  }

  // OpenGraph / meta fill whatever is still missing.
  base.title ??= clean(meta('og:title') ?? $('h1').first().text() ?? $('title').text()) || null;
  base.description ??= clean(meta('og:description') ?? meta('description')) || null;
  base.price ??= parsePrice(meta('product:price:amount') ?? meta('og:price:amount'), meta('product:price:currency') ?? meta('og:price:currency'));
  if (!base.images.length) {
    const og = absolute(meta('og:image') ?? undefined, url);
    base.images = [...new Set([...(og ? [og] : []), ...genericImages($, url)])];
    if (base.source === 'html' && og) base.source = 'opengraph';
  }
  base.images = [...new Set(base.images)].slice(0, 20);
  return base;
}
