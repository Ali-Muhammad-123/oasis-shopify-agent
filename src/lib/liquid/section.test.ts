import { describe, expect, it } from 'vitest';
import { checkSection, contrastRatio, designErrors, sectionName, settingErrors, slugify, toPortableLiquid } from './section';

const good = `
<div class="hero">{{ section.settings.heading }}</div>
{% for product in collections.all.products limit: 4 %}<a href="{{ product.url }}">{{ product.title }}</a>{% endfor %}
{% style %}.hero { padding: 2rem; }{% endstyle %}
{% schema %}
{ "name": "Season sale", "settings": [{ "id": "heading", "type": "text", "default": "Sale" }], "presets": [{ "name": "Season sale" }] }
{% endschema %}`;

describe('checkSection', () => {
  it('accepts a well-formed section', () => {
    const r = checkSection(good);
    expect(r).toMatchObject({ ok: true, errors: [], warnings: [] });
    expect(r.schema?.name).toBe('Season sale');
  });

  it('requires a schema block with valid JSON', () => {
    expect(checkSection('<p>hi</p>').errors[0]).toMatch(/Missing \{% schema %\}/);
    expect(checkSection('{% schema %}{ name: }{% endschema %}').errors[0]).toMatch(/not valid JSON/);
  });

  it('reports Liquid syntax errors', () => {
    const r = checkSection(good.replace('{% endfor %}', ''));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.startsWith('Liquid syntax error'))).toBe(true);
  });

  it('flags duplicate setting ids, long names and include', () => {
    const r = checkSection(`{% include 'x' %}{% schema %}{"name":"A name that is far too long for Shopify","settings":[{"id":"a","type":"text"},{"id":"a","type":"text"}]}{% endschema %}`);
    expect(r.errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/25 characters/), expect.stringMatching(/Duplicate setting id/), expect.stringMatching(/render/),
    ]));
    expect(r.warnings[0]).toMatch(/presets/);
  });
});

describe('helpers', () => {
  it('converts Shopify block tags to HTML', () => {
    expect(toPortableLiquid('{% style %}a{}{% endstyle %}{% javascript %}x(){% endjavascript %}')).toBe('<style>a{}</style><script>x()</script>');
  });
  it('keeps theme section names within Shopify\'s 50-character key limit', () => {
    const name = sectionName(slugify('TrixHub Rechargeable LED Flashlights 2-Pack PDP'));
    expect(name.length).toBeLessThanOrEqual(40);
    expect(name).toMatch(/^oasis-[a-z0-9-]*[a-z0-9]$/);
    expect(sectionName('short')).toBe('oasis-short');
  });
  it('slugifies titles', () => {
    expect(slugify('End of Season Sale!')).toBe('end-of-season-sale');
  });
});

describe('settingErrors', () => {
  it('requires hex (or palette) color defaults, like Shopify does', () => {
    expect(settingErrors({ id: 'border_color', type: 'color', default: 'rgba(255,255,255,.10)' })[0]).toMatch(/hex color/);
    for (const d of ['#fff', '#ffffff', '#ffffff1a', '{{ settings.colors.primary }}']) expect(settingErrors({ id: 'c', type: 'color', default: d })).toEqual([]);
    expect(settingErrors({ id: 'c', type: 'color' })).toEqual([]);
  });

  it('validates range bounds, steps and step count', () => {
    expect(settingErrors({ id: 'r', type: 'range', min: 0, max: 100, step: 5, default: 40 })).toEqual([]);
    expect(settingErrors({ id: 'r', type: 'range', min: 0, max: 100, step: 5, default: 42 })[0]).toMatch(/step/);
    expect(settingErrors({ id: 'r', type: 'range', min: 0, max: 100, step: 5, default: 120 })[0]).toMatch(/between/);
    expect(settingErrors({ id: 'r', type: 'range', min: 0, max: 1000, step: 1, default: 1 })[0]).toMatch(/101 steps/);
    expect(settingErrors({ id: 'r', type: 'range', min: 0, max: 10, step: 1 })[0]).toMatch(/needs a "default"/);
  });

  it('checks select options, booleans, richtext, url and pickers', () => {
    const options = [{ value: 'left' }, { value: 'center' }];
    expect(settingErrors({ id: 's', type: 'select', options, default: 'center' })).toEqual([]);
    expect(settingErrors({ id: 's', type: 'select', options, default: 'right' })[0]).toMatch(/one of/);
    expect(settingErrors({ id: 'b', type: 'checkbox', default: 'true' })[0]).toMatch(/true or false/);
    expect(settingErrors({ id: 't', type: 'richtext', default: 'Plain text' })[0]).toMatch(/<p>/);
    expect(settingErrors({ id: 'u', type: 'url', default: 'https://example.com' })[0]).toMatch(/collections/);
    expect(settingErrors({ id: 'i', type: 'image_picker', default: 'x.jpg' })[0]).toMatch(/cannot have a default/);
  });

  it('allows header and paragraph settings without ids', () => {
    expect(settingErrors({ type: 'header', content: 'Colors' })).toEqual([]);
    expect(settingErrors({ type: 'paragraph' })[0]).toMatch(/content/);
  });
});

describe('contrastRatio', () => {
  it('matches WCAG reference values', () => {
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 0);
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 1);
    expect(contrastRatio('{{ settings.x }}', '#fff')).toBeNull();
  });
});

describe('designErrors', () => {
  const schema = (settings: object[]) => ({ name: 'x', settings }) as never;
  it('rejects rem/em font sizes', () => {
    expect(designErrors('{% style %}.a { font-size: 1.6rem; } .b { font-size: clamp(2rem, 4vw, 3rem); }{% endstyle %}', null)[0]).toMatch(/px for font sizes/);
    expect(designErrors('{% style %}.a { font-size: 16px; margin: 1rem; }{% endstyle %}', null)).toEqual([]);
  });

  it('requires headings to get a color from the section CSS', () => {
    expect(designErrors('<h2 class="t">Hi</h2>{% style %}.t { font-size: 24px; }{% endstyle %}', null)[0]).toMatch(/explicit color for headings \(h2\)/);
    expect(designErrors('<h2 class="t">Hi</h2>{% style %}.wrap .t { color: #111; }{% endstyle %}', null)).toEqual([]);
    expect(designErrors('<h3>Hi</h3>{% style %}.wrap h2, .wrap h3 { color: var(--ink); }{% endstyle %}', null)).toEqual([]);
    expect(designErrors('<h3>Hi</h3>{% style %}.wrap h3 { background-color: #eee; }{% endstyle %}', null)[0]).toMatch(/headings/);
  });

  it('enforces 4.5:1 contrast between text and background color settings', () => {
    const errs = designErrors('', schema([
      { id: 'background_color', type: 'color', default: '#07111f' },
      { id: 'text_color', type: 'color', default: '#f8fafc' },
      { id: 'heading_color', type: 'color', default: '#1f2937' },
    ]));
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatch(/heading_color.*at least 4\.5:1/);
  });
});
