import 'server-only';
import { adminGraphql } from '../shopify/admin';
import * as M from '../shopify/mutations';
import { PREVIEW_THEME_NAME } from './drafts';

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; head: string }>();

type Files = { theme: { files: { nodes: { filename: string; body: { content?: string } }[] } } | null };

const rgbTriplet = (hex: unknown) => {
  const h = String(hex ?? '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(',');
};

/** "helvetica_n4" -> Helvetica; Shopify font handles are family_variant. */
const fontFamily = (handle: unknown) => {
  const family = String(handle ?? '').split('_')[0].replace(/-/g, ' ');
  return family ? family.replace(/\b\w/g, (c) => c.toUpperCase()) : null;
};

/**
 * <head> markup that reproduces the storefront's base styling (the theme's base.css plus the CSS
 * variables theme.liquid derives from settings_data.json), so in-app previews show the same heading
 * colors, root font size and fonts the section will meet on the real theme.
 */
export async function themePreviewHead(shop: string): Promise<string> {
  const hit = cache.get(shop);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.head;

  const { data } = await adminGraphql<{ themes: { nodes: { id: string; name: string; role: string }[] } }>(shop, M.THEMES);
  const theme = data.themes.nodes.find((t) => t.name === PREVIEW_THEME_NAME) ?? data.themes.nodes.find((t) => t.role === 'MAIN');
  if (!theme) return '';

  const files = await adminGraphql<Files>(shop, M.THEME_FILES, { id: theme.id, filenames: ['assets/base.css', 'config/settings_data.json'] });
  const byName = new Map(files.data.theme?.files.nodes.map((n) => [n.filename, n.body.content ?? '']) ?? []);
  const css = byName.get('assets/base.css') ?? '';

  let settings: Record<string, unknown> = {};
  try {
    const raw = JSON.parse((byName.get('config/settings_data.json') ?? '{}').replace(/^\s*\/\*[\s\S]*?\*\/\s*/, ''));
    settings = typeof raw.current === 'string' ? raw.presets?.[raw.current] ?? {} : raw.current ?? {};
  } catch {
    // Unknown settings shape: fall back to neutral defaults below.
  }

  const color = (key: string, fallback: string) => rgbTriplet(settings[key]) ?? fallback;
  const body = fontFamily(settings.type_body_font) ?? 'system-ui';
  const heading = fontFamily(settings.type_header_font) ?? body;
  const vars = `
    :root {
      --font-body-scale: 1; --font-heading-scale: 1;
      --font-body-family: ${body}, system-ui, sans-serif; --font-body-style: normal; --font-body-weight: 400; --font-body-weight-bold: 700;
      --font-heading-family: ${heading}, system-ui, sans-serif; --font-heading-style: normal; --font-heading-weight: 700;
      --color-base-text: ${color('colors_text', '18,18,18')};
      --color-base-background-1: ${color('colors_background_1', '255,255,255')};
      --color-base-background-2: ${color('colors_background_2', '243,243,243')};
      --color-base-solid-button-labels: ${color('colors_solid_button_labels', '255,255,255')};
      --color-base-outline-button-labels: ${color('colors_outline_button_labels', '18,18,18')};
      --color-base-accent-1: ${color('colors_accent_1', '18,18,18')};
      --color-base-accent-2: ${color('colors_accent_2', '51,79,180')};
      --page-width: 120rem;
    }
    html { font-size: calc(var(--font-body-scale) * 62.5%); }
    body { margin: 0; font-size: 1.6rem; }`;

  const head = `<style>${vars}</style>${css ? `<style>${css.replace(/<\/style/gi, '')}</style>` : ''}`;
  cache.set(shop, { at: Date.now(), head });
  return head;
}
