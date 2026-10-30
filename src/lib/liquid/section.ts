import { Liquid } from 'liquidjs';

type Setting = {
  id?: string; type: string; default?: unknown; label?: string; content?: string;
  min?: number; max?: number; step?: number; options?: { value: unknown; label?: string }[];
};

export type SectionSchema = {
  name: string;
  settings?: Setting[];
  presets?: { name: string }[];
  [key: string]: unknown;
};

export type SectionCheck = { ok: boolean; errors: string[]; warnings: string[]; schema: SectionSchema | null };

const SCHEMA_RE = /{%-?\s*schema\s*-?%}([\s\S]*?){%-?\s*endschema\s*-?%}/;

/** Converts Shopify-only block tags into plain HTML so a generic Liquid engine can parse/render the rest. */
export function toPortableLiquid(code: string) {
  return code
    .replace(SCHEMA_RE, '')
    .replace(/{%-?\s*(style|stylesheet)\s*-?%}/g, '<style>')
    .replace(/{%-?\s*end(style|stylesheet)\s*-?%}/g, '</style>')
    .replace(/{%-?\s*javascript\s*-?%}/g, '<script>')
    .replace(/{%-?\s*endjavascript\s*-?%}/g, '</script>');
}

/**
 * Theme section/template name for a draft. Shopify caps theme file keys at 50 characters,
 * so the handle is trimmed to keep `oasis-<handle>` comfortably under the limit.
 */
export function sectionName(handle: string) {
  return `oasis-${handle.slice(0, 34).replace(/-+$/, '')}`;
}

export function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'page';
}

const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const PALETTE_REF = /^{{\s*settings\.[\w.]+\s*}}$/;
const NO_DEFAULT = new Set(['image_picker', 'video', 'product', 'collection', 'page', 'blog', 'article', 'product_list', 'collection_list', 'metaobject', 'metaobject_list']);

/**
 * Mirrors the default-value rules Shopify enforces when a theme file is saved, so mistakes surface
 * while drafting instead of as a failed publish.
 */
export function settingErrors(s: Setting): string[] {
  const where = `Setting "${s.id ?? s.type}"`;
  const d = s.default;
  if (s.type === 'header' || s.type === 'paragraph') return s.content ? [] : [`${where} (${s.type}) needs "content".`];
  if (!s.id || !s.type) return [`Every input setting needs "id" and "type" (got ${JSON.stringify(s)}).`];
  if (d === undefined) {
    return s.type === 'range' ? [`${where} (range) needs a "default".`] : [];
  }
  switch (s.type) {
    case 'color':
      return typeof d === 'string' && (HEX_COLOR.test(d) || PALETTE_REF.test(d))
        ? [] : [`${where} (color) default must be a hex color like "#1a2b3c" (or "#1a2b3c1a" with alpha), not ${JSON.stringify(d)}.`];
    case 'checkbox':
      return typeof d === 'boolean' ? [] : [`${where} (checkbox) default must be true or false.`];
    case 'number':
      return typeof d === 'number' ? [] : [`${where} (number) default must be a number.`];
    case 'range': {
      const { min, max, step } = s;
      if ([min, max, step].some((v) => typeof v !== 'number')) return [`${where} (range) needs numeric "min", "max" and "step".`];
      const errs: string[] = [];
      if (typeof d !== 'number' || d < min! || d > max!) errs.push(`${where} (range) default must be a number between ${min} and ${max}.`);
      else if (Math.abs(((d - min!) / step!) - Math.round((d - min!) / step!)) > 1e-9) errs.push(`${where} (range) default must land on a step of ${step} from ${min}.`);
      if ((max! - min!) / step! > 101) errs.push(`${where} (range) allows at most 101 steps; increase "step" or narrow min/max.`);
      return errs;
    }
    case 'select':
    case 'radio': {
      const values = (s.options ?? []).map((o) => o.value);
      if (!values.length) return [`${where} (${s.type}) needs "options".`];
      return values.includes(d) ? [] : [`${where} (${s.type}) default must be one of ${JSON.stringify(values)}.`];
    }
    case 'richtext':
      return typeof d === 'string' && /^\s*<(p|ul|ol|h[1-6])[\s>]/i.test(d) ? [] : [`${where} (richtext) default must start with <p> (or a list/heading tag).`];
    case 'url':
      return d === '/collections' || d === '/collections/all' ? [] : [`${where} (url) default may only be "/collections" or "/collections/all"; omit it otherwise.`];
    case 'link_list':
      return d === 'main-menu' || d === 'footer' ? [] : [`${where} (link_list) default may only be "main-menu" or "footer".`];
    default:
      return NO_DEFAULT.has(s.type) ? [`${where} (${s.type}) cannot have a default; remove it.`] : [];
  }
}

/** WCAG relative luminance contrast ratio between two hex colors, or null if either isn't a plain hex. */
export function contrastRatio(a: string, b: string): number | null {
  const rgb = (hex: string) => {
    const h = hex.replace('#', '');
    if (!/^([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(h)) return null;
    const full = h.length <= 4 ? h.slice(0, 3).split('').map((c) => c + c).join('') : h.slice(0, 6);
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  };
  const lum = (c: number[]) => {
    const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ca = rgb(a);
  const cb = rgb(b);
  if (!ca || !cb) return null;
  const [hi, lo] = [lum(ca), lum(cb)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT_SETTING = /(text|heading|title|foreground|copy|body|muted)/i;
const BACKGROUND_SETTING = /^(section_)?(background|bg)(_color)?$/i;

/**
 * Readability rules that keep a section legible inside any theme: themes style headings and change
 * the root font size (Dawn-style themes set 1rem = 10px), so sections must set their own heading
 * colors and use px sizes, and their text colors must contrast with their background.
 */
export function designErrors(code: string, schema: SectionSchema | null): string[] {
  const errors: string[] = [];
  const styles = [...code.matchAll(/{%-?\s*(?:style|stylesheet)\s*-?%}([\s\S]*?){%-?\s*end(?:style|stylesheet)\s*-?%}|<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map((m) => m[1] ?? m[2] ?? '').join('\n');
  const markup = code.replace(SCHEMA_RE, '').replace(/{%-?\s*(?:style|stylesheet)\s*-?%}[\s\S]*?{%-?\s*end(?:style|stylesheet)\s*-?%}|<style[^>]*>[\s\S]*?<\/style>/g, '');

  const remSizes = [...styles.matchAll(/font-size\s*:\s*([^;}]*\d(?:rem|em)\b[^;}]*)/g)].map((m) => m[1].trim());
  if (remSizes.length) {
    errors.push(`Use px for font sizes (themes change the root size, e.g. 1rem = 10px in Dawn), not rem/em: ${[...new Set(remSizes)].slice(0, 4).join(', ')}.`);
  }

  // Every heading needs a color from this section's own CSS, via a heading selector or one of its classes.
  const rules = [...styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1], body: m[2] }));
  const colored = rules.filter((r) => /(^|[;\s{])color\s*:/.test(r.body)).map((r) => r.selector);
  const headingTagColored = colored.some((sel) => /(^|[\s,>+~])h[1-6]\b/.test(sel));
  const uncolored = [...markup.matchAll(/<(h[1-6])\b([^>]*)>/gi)].filter(([, , attrs]) => {
    if (headingTagColored) return false;
    const classes = attrs.match(/class\s*=\s*["']([^"']*)["']/)?.[1].split(/\s+/).filter(Boolean) ?? [];
    return !classes.some((c) => colored.some((sel) => sel.includes(`.${c}`)));
  });
  if (uncolored.length) {
    errors.push(`Set an explicit color for headings (${[...new Set(uncolored.map((m) => m[1].toLowerCase()))].join(', ')}): themes give headings their own color, which can vanish on this section's background. Add e.g. ".your-section h2, .your-section h3 { color: var(--your-text); }".`);
  }

  const colors = (schema?.settings ?? []).filter((x) => x.type === 'color' && x.id && typeof x.default === 'string');
  const background = colors.find((x) => BACKGROUND_SETTING.test(x.id!));
  if (background) {
    for (const t of colors.filter((x) => TEXT_SETTING.test(x.id!) && !/background|bg/i.test(x.id!))) {
      const ratio = contrastRatio(String(t.default), String(background.default));
      if (ratio !== null && ratio < 4.5) {
        errors.push(`Text color "${t.id}" (${t.default}) on "${background.id}" (${background.default}) has contrast ${ratio.toFixed(2)}:1; it needs at least 4.5:1.`);
      }
    }
  }
  return errors;
}

/** Static checks for a generated theme section: syntax, a valid schema, and a few theme-safety rules. */
export function checkSection(code: string): SectionCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  let schema: SectionSchema | null = null;

  const match = code.match(SCHEMA_RE);
  if (!match) {
    errors.push('Missing {% schema %} … {% endschema %} block.');
  } else {
    try {
      schema = JSON.parse(match[1]) as SectionSchema;
      if (!schema.name || typeof schema.name !== 'string') errors.push('Schema needs a "name" string.');
      if (schema.name && schema.name.length > 25) errors.push('Schema "name" must be 25 characters or fewer.');
      const ids = new Set<string>();
      for (const s of schema.settings ?? []) {
        errors.push(...settingErrors(s));
        if (!s.id) continue;
        if (ids.has(s.id)) errors.push(`Duplicate setting id "${s.id}".`);
        ids.add(s.id);
      }
      if (!schema.presets?.length) warnings.push('No "presets": the section cannot be added from the theme editor, only via templates.');
    } catch (err) {
      errors.push(`Schema is not valid JSON: ${(err as Error).message}`);
    }
  }

  errors.push(...designErrors(code, schema));
  if (/{%-?\s*include\s/.test(code)) errors.push('Use {% render %} instead of the deprecated {% include %}.');
  if (/<script[^>]+src=["']https?:/i.test(code)) warnings.push('External scripts slow the storefront; prefer inline or none.');
  if (/{{\s*content_for_header\s*}}/.test(code)) errors.push('content_for_header belongs in layout/theme.liquid, not a section.');

  try {
    new Liquid().parse(toPortableLiquid(code));
  } catch (err) {
    errors.push(`Liquid syntax error: ${(err as Error).message.split('\n')[0]}`);
  }

  return { ok: errors.length === 0, errors, warnings, schema };
}
