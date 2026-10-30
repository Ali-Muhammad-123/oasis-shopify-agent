import {
  convertToModelMessages,
  createIdGenerator,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  TypeValidationError,
  validateUIMessages,
} from 'ai';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { createAgentTools, createToolApproval } from '@/lib/agent';
import { getModel, resolveModelId } from '@/lib/agent/model';
import { buildInstructions } from '@/lib/agent/prompt';
import type { OasisUIMessage } from '@/lib/agent/types';
import { db, schema } from '@/lib/db';
import { listMemory } from '@/lib/memory';
import { recordRun } from '@/lib/runs';
import { queryCost } from '@/lib/shopify/admin';
import { getSessionShop } from '@/lib/session';

export const maxDuration = 120;

const body = z.object({
  id: z.string().min(1).max(64),
  messages: z.array(z.unknown()).min(1),
  model: z.string().optional(),
});

const titleFrom = (messages: OasisUIMessage[]) => {
  const first = messages.find((m) => m.role === 'user');
  const text = first?.parts.find((p) => p.type === 'text')?.text ?? 'New chat';
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
};

export async function POST(req: Request) {
  const shop = await getSessionShop();
  if (!shop) return Response.json({ error: 'Connect a Shopify store first' }, { status: 401 });

  const parsed = body.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  const { id, model: requestedModel } = parsed.data;

  // A conversation id belongs to exactly one shop.
  const existing = await db.query.conversations.findFirst({ where: eq(schema.conversations.id, id) });
  if (existing && existing.shop !== shop.domain) return Response.json({ error: 'Not found' }, { status: 404 });

  const modelId = resolveModelId(requestedModel ?? existing?.model);
  const tools = createAgentTools(shop.domain, id, modelId);
  let messages: OasisUIMessage[];
  try {
    messages = await validateUIMessages<OasisUIMessage>({ messages: parsed.data.messages, tools });
  } catch (err) {
    if (err instanceof TypeValidationError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }

  // Trace for the run history: tool timings, steps, tokens, and Shopify query cost (tallied via AsyncLocalStorage).
  const startedAt = Date.now();
  const cost = { points: 0, calls: 0 };
  const toolCalls: { tool: string; ms: number; ok: boolean }[] = [];
  let steps = 0;
  const memory = await listMemory(shop.domain);
  const modelMessages = await convertToModelMessages(messages);

  const result = queryCost.run(cost, () =>
    streamText({
      model: getModel(modelId),
      instructions: buildInstructions(shop, memory),
      messages: modelMessages,
      tools,
      toolApproval: createToolApproval(shop.currencyCode),
      stopWhen: isStepCount(15),
      onToolExecutionEnd: ({ toolCall, toolExecutionMs, toolOutput }) => {
        const output = toolOutput.type === 'tool-result' ? (toolOutput.output as { error?: unknown; ok?: boolean } | null) : null;
        const ok = toolOutput.type === 'tool-result' && !output?.error && output?.ok !== false;
        toolCalls.push({ tool: toolCall.toolName, ms: Math.round(toolExecutionMs), ok });
      },
      onStepEnd: () => {
        steps += 1;
      },
      onEnd: ({ totalUsage, finishReason }) =>
        recordRun({
          shop: shop.domain, conversationId: id, model: modelId, durationMs: Date.now() - startedAt, steps,
          inputTokens: totalUsage.inputTokens ?? null, outputTokens: totalUsage.outputTokens ?? null, totalTokens: totalUsage.totalTokens ?? null,
          shopifyCost: Math.round(cost.points), toolCalls, finishReason,
        }),
      onError: ({ error }) =>
        recordRun({
          shop: shop.domain, conversationId: id, model: modelId, durationMs: Date.now() - startedAt, steps,
          shopifyCost: Math.round(cost.points), toolCalls, finishReason: 'error', error: error instanceof Error ? error.message : String(error),
        }),
    }),
  );
  // Run to completion even if the browser disconnects, so the conversation is saved.
  result.consumeStream();

  const save = async (all: OasisUIMessage[]) => {
    const values = { messages: all, model: modelId, updatedAt: new Date() };
    await db
      .insert(schema.conversations)
      .values({ id, shop: shop.domain, title: titleFrom(all), ...values })
      .onConflictDoUpdate({
        target: schema.conversations.id,
        set: values,
        where: and(eq(schema.conversations.shop, shop.domain)),
      });
  };

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      originalMessages: messages,
      generateMessageId: createIdGenerator({ prefix: 'msg', size: 16 }),
      messageMetadata: ({ part }) => {
        if (part.type === 'start') return { createdAt: Date.now(), model: modelId };
        if (part.type === 'finish') return { totalTokens: part.totalUsage.totalTokens };
      },
      onEnd: ({ messages: all }) => save(all as OasisUIMessage[]),
      onError: (err) => (err instanceof Error ? err.message : 'Something went wrong'),
    }),
  });
}
