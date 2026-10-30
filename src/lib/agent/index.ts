import 'server-only';
import { tool, type ToolApprovalConfiguration } from 'ai';
import { z } from 'zod';
import { createAdTools } from './tools/ads';
import { createBriefTools } from './tools/briefs';
import { createDocTools } from './tools/docs';
import { createGrowthTools } from './tools/growth';
import { createLiquidTools } from './tools/liquid';
import { createMemoryTools } from './tools/memory';
import { createReadTools } from './tools/read';
import { createUiTools } from './tools/ui';
import { createWebTools } from './tools/web';
import { createWriteTools, listRecentActions, unconvertedPriceReason, WRITE_TOOL_NAMES } from './tools/write';

export function createAgentTools(shop: string, conversationId: string, modelId: string) {
  return {
    ...createReadTools(shop),
    ...createDocTools(shop, modelId),
    ...createLiquidTools(shop),
    ...createWebTools(shop),
    ...createMemoryTools(shop),
    ...createGrowthTools(shop),
    ...createBriefTools(shop),
    ...createAdTools(shop),
    listRecentActions: tool({
      description: 'Recent store changes made through the agent (newest first) with ids and whether each can still be undone.',
      inputSchema: z.object({ limit: z.number().int().min(1).max(50).default(15) }),
      execute: async ({ limit }) => ({ actions: await listRecentActions(shop, limit) }),
    }),
    ...createUiTools(shop),
    ...createWriteTools(shop, conversationId),
  };
}

export type AgentTools = ReturnType<typeof createAgentTools>;

/**
 * Every write waits for the user's approval in the chat, except proposals that are certainly wrong,
 * which are denied automatically with a reason the model can act on (e.g. an unconverted price).
 */
export function createToolApproval(storeCurrency: string | null): ToolApprovalConfiguration<AgentTools, unknown> {
  const policy = Object.fromEntries(WRITE_TOOL_NAMES.map((name) => [name, 'user-approval' as const])) as Record<string, unknown>;
  policy.createProduct = (input: Parameters<typeof unconvertedPriceReason>[0]) => {
    const reason = unconvertedPriceReason(input, storeCurrency);
    return reason ? { type: 'denied' as const, reason } : ('user-approval' as const);
  };
  return policy as ToolApprovalConfiguration<AgentTools, unknown>;
}
