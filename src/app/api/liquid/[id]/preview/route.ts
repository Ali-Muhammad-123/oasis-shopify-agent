import { getDraft } from '@/lib/liquid/drafts';
import { renderSectionPreview } from '@/lib/liquid/preview';
import { themePreviewHead } from '@/lib/liquid/theme-styles';
import { getSessionShop } from '@/lib/session';

// Neutral fallbacks first; the theme's own CSS (when available) follows and wins, as it would on the storefront.
const page = (body: string, themeHead = '') => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#111}img{max-width:100%;height:auto}a{color:inherit}</style>
${themeHead}
</head><body class="gradient">${body}</body></html>`;

/** Renders a draft section with real products for the in-app iframe. Scripts are blocked by the iframe sandbox. */
export async function GET(_req: Request, ctx: RouteContext<'/api/liquid/[id]/preview'>) {
  const shop = await getSessionShop();
  if (!shop) return new Response('Unauthorized', { status: 401 });
  const { id } = await ctx.params;
  const draft = await getDraft(shop.domain, id);
  if (!draft) return new Response('Not found', { status: 404 });
  try {
    const [{ html, errors }, themeHead] = await Promise.all([
      renderSectionPreview(shop.domain, draft.code, draft.target === 'product' ? draft.productId : null),
      themePreviewHead(shop.domain).catch(() => ''),
    ]);
    const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const banner = errors.length
      ? `<div style="font:13px/1.5 system-ui,sans-serif;background:#fef3c7;color:#78350f;padding:10px 16px;border-bottom:1px solid #fcd34d"><strong>Needs fixing before publish:</strong><ul style="margin:4px 0 0 18px;padding:0">${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>`
      : '';
    const body = html ? banner + html : `<pre style="padding:16px;color:#b91c1c">${esc(errors.join('\n'))}</pre>`;
    return new Response(page(body, themeHead), {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "script-src 'none'; frame-ancestors 'self'" },
    });
  } catch (err) {
    return new Response(page(`<pre style="padding:16px;color:#b91c1c">Preview failed: ${String((err as Error).message).replace(/</g, '&lt;')}</pre>`), {
      status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
}
