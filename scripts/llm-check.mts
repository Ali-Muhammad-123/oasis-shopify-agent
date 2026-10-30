// Smoke-tests the configured model (with its fallback) on a tool-calling round trip.
// Usage: pnpm llm:check [provider:model-id]
import 'dotenv/config';
import { generateText, isStepCount, tool } from 'ai';
import { z } from 'zod';
import { getModel, resolveModelId } from '../src/lib/agent/model';

const requested = process.argv[2];
const started = Date.now();
const result = await generateText({
  model: getModel(requested),
  prompt: 'What is 17 * 23? Use the multiply tool, then answer in one short sentence.',
  tools: {
    multiply: tool({
      inputSchema: z.object({ a: z.number(), b: z.number() }),
      execute: async ({ a, b }) => ({ result: a * b }),
    }),
  },
  stopWhen: isStepCount(3),
  maxRetries: 0,
});
const calls = result.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName));
console.log(`requested: ${resolveModelId(requested)}`);
console.log(`tool calls: ${calls.join(', ') || 'none'} | ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(`text: ${result.text.trim()}`);
process.exit(calls.includes('multiply') && result.text.includes('391') ? 0 : 1);
