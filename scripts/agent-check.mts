// Sends one prompt through the running app's /api/chat (same path as the browser) and prints the
// agent's tool calls, approval requests and final text. Usage:
//   pnpm agent:check "How many orders this week?" [--model openai:gpt-5.4-mini]
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { sign } from '../src/lib/crypto';
import { SESSION_COOKIE } from '../src/lib/session';

const args = process.argv.slice(2);
const mi = args.indexOf('--model');
const model = mi >= 0 ? args[mi + 1] : undefined;
const prompt = (mi >= 0 ? args.filter((_, i) => i !== mi && i !== mi + 1) : args).join(' ');
if (!prompt) throw new Error('Pass a prompt');

export type AgentRun = { text: string; tools: { name: string; input: unknown; output?: unknown }[]; approvals: string[]; errors: string[]; ms: number };

export async function runAgent(text: string, opts: { model?: string; base?: string } = {}): Promise<AgentRun> {
  const shop = process.env.SHOPIFY_SHOP!;
  const started = Date.now();
  const res = await fetch(`${opts.base ?? process.env.APP_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `${SESSION_COOKIE}=${sign(shop)}` },
    body: JSON.stringify({
      id: `check-${randomUUID()}`,
      model: opts.model,
      messages: [{ id: randomUUID(), role: 'user', parts: [{ type: 'text', text }] }],
    }),
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

  const run: AgentRun = { text: '', tools: [], approvals: [], errors: [], ms: 0 };
  const byId = new Map<string, AgentRun['tools'][number]>();
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      const ev = JSON.parse(data) as Record<string, unknown> & { type: string };
      if (ev.type === 'text-delta') run.text += String(ev.delta ?? '');
      else if (ev.type === 'tool-input-available') {
        const t = { name: String(ev.toolName), input: ev.input };
        byId.set(String(ev.toolCallId), t);
        run.tools.push(t);
      } else if (ev.type === 'tool-output-available') {
        const t = byId.get(String(ev.toolCallId));
        if (t) t.output = ev.output;
      } else if (ev.type === 'tool-approval-request') run.approvals.push(byId.get(String(ev.toolCallId))?.name ?? String(ev.toolCallId));
      else if (ev.type === 'error') run.errors.push(String(ev.errorText));
    }
  }
  run.ms = Date.now() - started;
  return run;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const run = await runAgent(prompt, { model });
  for (const t of run.tools) {
    const out = JSON.stringify(t.output ?? null);
    console.log(`tool ${t.name} ${JSON.stringify(t.input).slice(0, 160)}\n  -> ${out.slice(0, 220)}${out.length > 220 ? '…' : ''}`);
  }
  if (run.approvals.length) console.log(`approval requested: ${run.approvals.join(', ')}`);
  if (run.errors.length) console.log(`errors: ${run.errors.join(' | ')}`);
  console.log(`\n${run.text.trim()}\n\n(${(run.ms / 1000).toFixed(1)}s)`);
  process.exit(run.errors.length ? 1 : 0);
}
