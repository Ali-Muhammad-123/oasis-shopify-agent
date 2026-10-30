import type { InferUITools, UIMessage } from 'ai';
import type { AgentTools } from '.';

export type OasisMetadata = {
  createdAt?: number;
  model?: string;
  totalTokens?: number;
};

export type OasisUIMessage = UIMessage<OasisMetadata, never, InferUITools<AgentTools>>;
