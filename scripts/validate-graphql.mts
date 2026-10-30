// Validates every exported GraphQL operation against the Shopify Admin schema using the
// shopify-ai-toolkit validator. Usage: pnpm validate:graphql [ExportName ...]
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const MODULES = ['../src/lib/shopify/queries.ts', '../src/lib/shopify/mutations.ts'];

function findValidator(): string {
  if (process.env.SHOPIFY_VALIDATOR) return process.env.SHOPIFY_VALIDATOR;
  const base = join(homedir(), '.claude/plugins/cache/claude-plugins-official/shopify-ai-toolkit');
  const versions = existsSync(base) ? readdirSync(base).sort().reverse() : [];
  for (const v of versions) {
    const p = join(base, v, 'skills/shopify/scripts/validate.mjs');
    if (existsSync(p)) return p;
  }
  throw new Error('shopify-ai-toolkit validator not found; set SHOPIFY_VALIDATOR to validate.mjs');
}

const only = new Set(process.argv.slice(2));
const validator = findValidator();
let failed = 0;

for (const mod of MODULES) {
  const path = new URL(mod, import.meta.url);
  if (!existsSync(path)) continue;
  const ops = (await import(path.href)) as Record<string, unknown>;
  for (const [name, code] of Object.entries(ops)) {
    if (typeof code !== 'string' || (only.size && !only.has(name))) continue;
    let out = '';
    try {
      out = execFileSync('node', [validator, '--api', 'admin', '--code', code, '--client-name', 'oasis-validate'], {
        encoding: 'utf8',
      });
    } catch (err) {
      out = String((err as { stdout?: string }).stdout ?? err);
    }
    const status = out.match(/\*\*Status:\*\* (.+)/)?.[1] ?? 'unknown';
    const details = out.match(/\*\*Details:\*\* ([\s\S]*?)(?:\n\n|$)/)?.[1]?.trim() ?? out.slice(0, 500);
    const ok = /SUCCESS|INFORM/.test(status);
    if (!ok) failed++;
    console.log(`${ok ? '✓' : '✗'} ${name}${ok && !/INFORM/.test(status) ? '' : `\n    ${details.replace(/\n/g, '\n    ')}`}`);
  }
}

process.exit(failed ? 1 : 0);
