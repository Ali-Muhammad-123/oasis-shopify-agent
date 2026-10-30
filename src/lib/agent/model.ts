import 'server-only';
import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';
import { openai } from '@ai-sdk/openai';
import { APICallError, createProviderRegistry, wrapLanguageModel } from 'ai';
import { env } from '../env';

const registry = createProviderRegistry({ anthropic, openai, google });

/** Models offered in the picker, grouped by the provider key they need. */
export const MODEL_OPTIONS = [
  { id: 'anthropic:claude-sonnet-5-5', label: 'Claude Sonnet 5.5', keyVar: 'ANTHROPIC_API_KEY' },
  { id: 'anthropic:claude-opus-5-5', label: 'Claude Opus 5.5', keyVar: 'ANTHROPIC_API_KEY' },
  { id: 'anthropic:claude-haiku-5-5', label: 'Claude Haiku 5.5', keyVar: 'ANTHROPIC_API_KEY' },
  { id: 'openai:gpt-5.5', label: 'GPT-5.5', keyVar: 'OPENAI_API_KEY' },
  { id: 'openai:gpt-5.4-mini', label: 'GPT-5.4 mini', keyVar: 'OPENAI_API_KEY' },
  { id: 'google:gemini-flash-latest', label: 'Gemini Flash (latest)', keyVar: 'GOOGLE_GENERATIVE_AI_API_KEY' },
  { id: 'google:gemini-3-pro-preview', label: 'Gemini 3 Pro', keyVar: 'GOOGLE_GENERATIVE_AI_API_KEY' },
  { id: 'google:gemini-3-flash-preview', label: 'Gemini 3 Flash', keyVar: 'GOOGLE_GENERATIVE_AI_API_KEY' },
] as const;

export type ModelId = `${'anthropic' | 'openai' | 'google'}:${string}`;

/** Models whose provider has an API key configured; the env default is always included first. */
export function availableModels() {
  const configured = MODEL_OPTIONS.filter((m) => Boolean(process.env[m.keyVar]));
  const hasDefault = configured.some((m) => m.id === env.LLM_MODEL);
  return hasDefault || !isModelId(env.LLM_MODEL)
    ? configured
    : [{ id: env.LLM_MODEL, label: env.LLM_MODEL, keyVar: '' }, ...configured];
}

export function isModelId(id: string): id is ModelId {
  return /^(anthropic|openai|google):[\w.-]+$/.test(id);
}

export function resolveModelId(requested?: string | null): ModelId {
  if (requested && isModelId(requested) && availableModels().some((m) => m.id === requested)) return requested;
  if (isModelId(env.LLM_MODEL)) return env.LLM_MODEL;
  throw new Error(`LLM_MODEL must look like provider:model-id, got "${env.LLM_MODEL}"`);
}

type Model = ReturnType<typeof registry.languageModel>;
const FIRST_RESPONSE_TIMEOUT_MS = 20_000;
const COOL_OFF_MS = 2 * 60_000;
/** Primary models recently seen failing; calls skip straight to the fallback until the time passes. */
const coolingOff = new Map<string, number>();

/** Overloaded (5xx/429), unreachable, or too slow to start responding. */
function isRetryable(err: unknown) {
  if (APICallError.isInstance(err)) return err.statusCode == null || err.statusCode >= 500 || err.statusCode === 429;
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError' || /fetch failed|ECONN|ETIMEDOUT/i.test(err.message));
}

/**
 * Sends a call to `fallback` when `primary` is overloaded or doesn't start responding in time.
 * Only the start of a call is guarded; once a stream is flowing it is never switched mid-answer.
 */
function withFallback(primary: Model, fallback: Model, primaryId: string, fallbackId: string): Model {
  const note = (err: unknown) => {
    coolingOff.set(primaryId, Date.now() + COOL_OFF_MS);
    console.warn(`[llm] ${primaryId} unavailable (${err instanceof Error ? err.message.slice(0, 120) : String(err)}); using ${fallbackId} for ${COOL_OFF_MS / 60_000} min`);
  };

  async function guarded<T>(signal: AbortSignal | undefined, call: (signal: AbortSignal) => PromiseLike<T>, onFallback: () => PromiseLike<T>) {
    if ((coolingOff.get(primaryId) ?? 0) > Date.now()) return onFallback();
    const ctrl = new AbortController();
    const forward = () => ctrl.abort(signal?.reason);
    signal?.addEventListener('abort', forward, { once: true });
    const timer = setTimeout(() => ctrl.abort(Object.assign(new Error('first response timeout'), { name: 'TimeoutError' })), FIRST_RESPONSE_TIMEOUT_MS);
    try {
      return await call(ctrl.signal);
    } catch (err) {
      if (signal?.aborted || !(isRetryable(err) || ctrl.signal.aborted)) throw err;
      note(err);
      return onFallback();
    } finally {
      clearTimeout(timer);
    }
  }

  return wrapLanguageModel({
    model: primary,
    middleware: {
      specificationVersion: 'v4',
      wrapGenerate: ({ params, model }) =>
        guarded(params.abortSignal, (s) => model.doGenerate({ ...params, abortSignal: s }), () => fallback.doGenerate(params)),
      wrapStream: ({ params, model }) =>
        guarded(params.abortSignal, (s) => model.doStream({ ...params, abortSignal: s }), () => fallback.doStream(params)),
    },
  });
}

export function getModel(requested?: string | null) {
  const id = resolveModelId(requested);
  const model = registry.languageModel(id);
  const fallbackId = env.LLM_FALLBACK_MODEL;
  const fallbackUsable = fallbackId && fallbackId !== id && isModelId(fallbackId) && availableModels().some((m) => m.id === fallbackId);
  return fallbackUsable ? withFallback(model, registry.languageModel(fallbackId), id, fallbackId) : model;
}
