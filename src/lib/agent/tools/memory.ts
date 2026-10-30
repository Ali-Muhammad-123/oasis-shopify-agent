import 'server-only';
import { tool } from 'ai';
import { z } from 'zod';
import { addMemory, listMemory, removeMemory } from '../../memory';

/** Long-term store preferences the merchant asked the agent to keep. Not store writes, so no approval. */
export function createMemoryTools(shop: string) {
  return {
    rememberPreference: tool({
      description:
        'Save a lasting preference ONLY when the user\'s current message explicitly asks you to remember something or states a new ' +
        'standing rule (e.g. "remember our fiscal week starts Monday", "always exclude orders tagged test"). Never save facts you inferred, ' +
        'never re-save or restate a preference that is already listed, and never call this as a side step of another task.',
      inputSchema: z.object({ fact: z.string().min(3).max(500) }),
      execute: async ({ fact }) => {
        try {
          const row = await addMemory(shop, fact);
          return { saved: true, id: row.id, fact: row.fact };
        } catch (err) {
          return { saved: false, error: (err as Error).message };
        }
      },
    }),
    listPreferences: tool({
      description: 'List the saved store preferences with their ids.',
      inputSchema: z.object({}),
      execute: async () => ({ preferences: (await listMemory(shop)).map(({ id, fact }) => ({ id, fact })) }),
    }),
    forgetPreference: tool({
      description: 'Remove a saved preference by id when the user asks you to forget it.',
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => ({ removed: await removeMemory(shop, id) }),
    }),
  };
}
