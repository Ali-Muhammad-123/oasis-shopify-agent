import { describe, expect, it } from 'vitest';
import { extractProductPage, pageUrlFromHtml, parsePrice } from './extract';

describe('parsePrice', () => {
  it('reads symbols, codes and thousands separators', () => {
    expect(parsePrice('$22.79')).toEqual({ amount: 22.79, currency: 'USD' });
    expect(parsePrice('PKR6,305.42')).toEqual({ amount: 6305.42, currency: 'PKR' });
    expect(parsePrice('€ 1.299,00')).toEqual({ amount: 1299, currency: 'EUR' });
    expect(parsePrice('49', 'CAD')).toEqual({ amount: 49, currency: 'CAD' });
    expect(parsePrice('free')).toBeNull();
  });
});

describe('extractProductPage', () => {
  it('prefers schema.org Product JSON-LD, including inside @graph', () => {
    const html = `<html><head><script type="application/ld+json">{"@graph":[{"@type":"WebPage"},{"@type":"Product","name":"Trail Mug",
      "description":"Enamel mug","brand":{"name":"Camp Co"},"image":["/img/mug.jpg"],"sku":"MUG-1",
      "offers":{"price":"18.50","priceCurrency":"USD"}}]}</script></head><body><h1>ignored</h1></body></html>`;
    const p = extractProductPage(html, 'https://shop.example.com/products/mug');
    expect(p).toMatchObject({
      source: 'json-ld', title: 'Trail Mug', brand: 'Camp Co', description: 'Enamel mug', sku: 'MUG-1',
      price: { amount: 18.5, currency: 'USD' }, images: ['https://shop.example.com/img/mug.jpg'],
    });
  });

  it('falls back to OpenGraph and filters icon-sized images', () => {
    const html = `<html><head><meta property="og:title" content="Lantern"><meta property="og:image" content="https://cdn.example.com/l.jpg">
      <meta property="product:price:amount" content="35"><meta property="product:price:currency" content="GBP"></head>
      <body><main><p>Bright lantern for camping.</p><img src="/icon.svg"><img src="/thumb.png" width="40"><img srcset="/a-400.jpg 400w, /a-1200.jpg 1200w"></main></body></html>`;
    const p = extractProductPage(html, 'https://example.com/lantern');
    expect(p.source).toBe('opengraph');
    expect(p.title).toBe('Lantern');
    expect(p.price).toEqual({ amount: 35, currency: 'GBP' });
    expect(p.images).toEqual(['https://cdn.example.com/l.jpg', 'https://example.com/a-1200.jpg']);
    expect(p.text).toContain('Bright lantern');
  });

  it('reads the ASIN from the page when the URL lacks one', () => {
    const p = extractProductPage('<span id="productTitle">Lamp</span><input type="hidden" id="ASIN" name="ASIN" value="B0TEST1234">', 'https://www.amazon.com/s?k=lamp');
    expect(p.sku).toBe('B0TEST1234');
  });

  it('extracts Amazon title, brand, price, bullets, specs and gallery images', () => {
    const html = `<html><body>
      <span id="productTitle"> Rechargeable Flashlight 2 Pack </span>
      <a id="bylineInfo">Visit the TrixHub Store</a>
      <div id="corePrice_feature_div"><span class="a-price"><span class="a-offscreen">$22.79</span></span></div>
      <div id="feature-bullets"><ul><li>Make sure this fits by entering your model number.</li><li>【BRIGHT】700 lumens</li><li>USB-C charging</li></ul></div>
      <div id="productOverview_feature_div"><table><tr><td>Color</td><td>Black</td></tr></table></div>
      <div id="prodDetails"><table><tr><th>White Brightness</th><td>700 lumens</td></tr><tr><th>Customer Reviews</th><td>4.5</td></tr></table></div>
      <img id="landingImage" data-old-hires="https://m.media-amazon.com/images/I/main.jpg">
      <script>var data = {"hiRes":"https://m.media-amazon.com/images/I/a.jpg"},{"hiRes":"https://m.media-amazon.com/images/I/b.jpg"};</script>
      </body></html>`;
    const p = extractProductPage(html, 'https://www.amazon.com/Some-Name/dp/B0DJQF83C2/ref=sr_1_2');
    expect(p).toMatchObject({
      source: 'amazon', site: 'amazon.com', title: 'Rechargeable Flashlight 2 Pack', brand: 'TrixHub', sku: 'B0DJQF83C2',
      price: { amount: 22.79, currency: 'USD' }, bullets: ['【BRIGHT】700 lumens', 'USB-C charging'],
      specs: { Color: 'Black', 'White Brightness': '700 lumens' },
    });
    expect(p.images).toEqual([
      'https://m.media-amazon.com/images/I/a.jpg', 'https://m.media-amazon.com/images/I/b.jpg', 'https://m.media-amazon.com/images/I/main.jpg',
    ]);
  });
});

describe('pageUrlFromHtml', () => {
  it('recovers the original address of a saved page', () => {
    expect(pageUrlFromHtml('<link rel="canonical" href="https://www.amazon.com/TrixHub/dp/B0DJQF83C2">')).toBe('https://www.amazon.com/TrixHub/dp/B0DJQF83C2');
    expect(pageUrlFromHtml('<meta property="og:url" content="https://shop.example.com/products/mug">')).toBe('https://shop.example.com/products/mug');
  });
  it('returns null when the page has no usable address', () => {
    expect(pageUrlFromHtml('<link rel="canonical" href="/relative">')).toBeNull();
    expect(pageUrlFromHtml('<p>nothing</p>')).toBeNull();
  });
});
