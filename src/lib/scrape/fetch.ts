import 'server-only';
import { execFile } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { promisify } from 'node:util';

const run = promisify(execFile);

const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 5;

export class FetchPageError extends Error {}

/** True for loopback, private, link-local, CGNAT and metadata addresses (IPv4 and IPv6). */
export function isPrivateAddress(ip: string): boolean {
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (isIP(v4) === 4) {
    const [a, b] = v4.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || /^fe[89ab]/.test(v6);
}

async function assertPublicUrl(raw: string): Promise<{ url: URL; address: string }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchPageError(`Not a valid URL: ${raw}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new FetchPageError('Only http(s) links can be fetched');
  if (url.username || url.password) throw new FetchPageError('Links with credentials are not allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addresses.length) throw new FetchPageError(`Could not resolve ${host}`);
  if (addresses.some((a) => isPrivateAddress(a.address))) throw new FetchPageError('Links to private or local addresses are not allowed');
  return { url, address: addresses[0].address };
}

/** Bot-check pages some retailers serve to non-browser HTTP clients. */
export function isBotInterstitial(html: string) {
  return html.length < 20_000 && /click the button below to continue shopping|robot check|enter the characters you see|captcha|just a moment\.\.\./i.test(html);
}

type Response1 = { status: number; contentType: string; location: string | null; body: string };

async function nodeFetch(url: URL, headers: Record<string, string>): Promise<Response1> {
  const res = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) }).catch((err) => {
    throw new FetchPageError(`Could not fetch ${url.hostname}: ${(err as Error).message}`);
  });
  const contentType = res.headers.get('content-type') ?? '';
  if (res.status >= 300 && res.status < 400) return { status: res.status, contentType, location: res.headers.get('location'), body: '' };
  if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) throw new FetchPageError('Page is too large');
  const reader = res.body!.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new FetchPageError('Page is too large');
    }
    chunks.push(value);
  }
  return { status: res.status, contentType, location: null, body: Buffer.concat(chunks).toString('utf8') };
}

/**
 * Same request through curl, whose TLS fingerprint some retailers accept where Node's isn't.
 * Arguments go straight to execFile (no shell), redirects are not followed by curl, and
 * --resolve pins the connection to the address that was already checked.
 */
async function curlFetch(url: URL, address: string, headers: Record<string, string>): Promise<Response1> {
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  const pinned = isIP(address) === 6 ? `[${address}]` : address;
  const marker = '\n__OASIS_META__';
  const args = [
    '-sS', '--compressed', '--max-time', String(TIMEOUT_MS / 1000), '--max-filesize', String(MAX_BYTES),
    '--proto', '=http,https', '--max-redirs', '0', '--resolve', `${url.hostname}:${port}:${pinned}`,
    ...Object.entries(headers).flatMap(([k, v]) => ['-H', `${k}: ${v}`]),
    '-w', `${marker}%{http_code} %{content_type}\n%{redirect_url}`, '--', url.toString(),
  ];
  try {
    const { stdout } = await run('curl', args, { maxBuffer: MAX_BYTES + 64 * 1024, encoding: 'utf8' });
    const i = stdout.lastIndexOf(marker.trim());
    const [statusLine, location] = stdout.slice(i + marker.trim().length).split('\n');
    const [status, ...type] = statusLine.trim().split(' ');
    return { status: Number(status), contentType: type.join(' '), location: location?.trim() || null, body: stdout.slice(0, Math.max(0, i - 1)) };
  } catch (err) {
    throw new FetchPageError(`Could not fetch ${url.hostname}: ${(err as Error).message.split('\n')[0]}`);
  }
}

/** Site-specific request tweaks; Amazon localises prices by IP unless a currency preference is sent. */
function headersFor(url: URL): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };
  if (/(^|\.)amazon\.com$/.test(url.hostname)) headers.Cookie = 'i18n-prefs=USD; lc-main=en_US';
  return headers;
}

/** Strips tracking parameters from known retailer URLs: an Amazon product link becomes https://www.amazon.<tld>/dp/<ASIN>. */
export function canonicalUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const asin = url.pathname.match(/\/(?:dp|gp\/product|clp)\/([A-Z0-9]{10})(?:[/?]|$)/i)?.[1];
    if (/(^|\.)amazon\./.test(url.hostname) && asin) return `${url.protocol}//${url.hostname}/dp/${asin.toUpperCase()}`;
    return raw;
  } catch {
    return raw;
  }
}

type Page = { url: string; html: string; via: 'fetch' | 'curl' };
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; page: Page }>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetches a public page, cached for a few hours so repeated reads of the same link don't hit the site again.
 * Bot checks are retried with backoff before giving up.
 */
export async function fetchPage(raw: string): Promise<Page> {
  const key = canonicalUrl(raw);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.page;
  let lastErr: unknown;
  for (const wait of [0, 5_000, 15_000]) {
    if (wait) await sleep(wait);
    try {
      const page = await fetchOnce(key);
      cache.set(key, { at: Date.now(), page });
      return page;
    } catch (err) {
      lastErr = err;
      if (!(err instanceof FetchPageError && /bot check/.test(err.message))) throw err;
    }
  }
  throw lastErr;
}

async function fetchOnce(raw: string): Promise<Page> {
  let target = await assertPublicUrl(raw);
  let viaCurl = false;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const headers = headersFor(target.url);
    let res = viaCurl ? await curlFetch(target.url, target.address, headers) : await nodeFetch(target.url, headers);
    if (!viaCurl && res.status === 200 && isBotInterstitial(res.body)) {
      viaCurl = true;
      res = await curlFetch(target.url, target.address, headers);
    }
    if (res.status >= 300 && res.status < 400 && res.location) {
      target = await assertPublicUrl(new URL(res.location, target.url).toString());
      continue;
    }
    if (res.status < 200 || res.status >= 300) throw new FetchPageError(`${target.url.hostname} responded ${res.status}`);
    if (!/html|xml/i.test(res.contentType)) throw new FetchPageError(`Expected a web page but got ${res.contentType || 'unknown content'}`);
    if (isBotInterstitial(res.body)) {
      throw new FetchPageError(`${target.url.hostname} blocked automated access (bot check). It can last a while. Workaround: open the link in your browser, save it with Cmd+S / Ctrl+S as "Webpage, HTML only", and upload the .html file (paperclip in chat or the Documents page).`);
    }
    return { url: target.url.toString(), html: res.body, via: viaCurl ? 'curl' : 'fetch' };
  }
  throw new FetchPageError('Too many redirects');
}
