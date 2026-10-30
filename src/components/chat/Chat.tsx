'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, getToolName, isToolUIPart, lastAssistantMessageIsCompleteWithApprovalResponses } from 'ai';
import { ArrowUp, Loader2, Mic, Paperclip, Square } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { OasisUIMessage } from '@/lib/agent/types';
import { chartSpec, kpiSpec, tableSpec, type WidgetSpec } from '@/lib/genui/spec';
import { Widget } from '../genui/Widget';
import { PrintButton } from '../PrintButton';
import { ApprovalCard } from './ApprovalCard';
import { Markdown } from './Markdown';
import { ToolStep } from './ToolStep';

const WRITE_TOOLS = new Set([
  'createDiscountCode', 'updateVariantPrices', 'updateProduct', 'adjustInventory', 'setTags',
  'createDraftOrder', 'cancelOrder', 'fulfillOrder', 'publishLiquidPage', 'createProduct', 'undoAction',
  'bulkUpdatePrices', 'bulkTagCustomers', 'updateUnitCosts', 'createCustomerSegment',
]);

const STARTERS = [
  'Give me a snapshot of the store: revenue, orders and AOV for the last 30 days',
  'Chart daily sales for the last 30 days',
  'Who are my top 5 customers by spend?',
  'Which products are running low on stock?',
  'List unfulfilled paid orders',
  'Create a 15% discount code WINTER15 that ends in two weeks',
];

type ModelOption = { id: string; label: string };

/** Parses a UI tool's input into a widget; null while it is still streaming or invalid. */
function widgetFrom(toolName: string, input: unknown): WidgetSpec | null {
  const schema = toolName === 'renderChart' ? chartSpec : toolName === 'renderKpis' ? kpiSpec : toolName === 'renderTable' ? tableSpec : null;
  const parsed = schema?.safeParse(input);
  if (!parsed?.success) return null;
  return { kind: toolName === 'renderChart' ? 'chart' : toolName === 'renderKpis' ? 'kpis' : 'table', spec: parsed.data } as WidgetSpec;
}

export function Chat({
  id: serverId, initialMessages, models, initialModel, shopName, initialPrompt, voiceEnabled = false,
}: {
  id: string; initialMessages: OasisUIMessage[]; models: ModelOption[]; initialModel: string; shopName: string;
  initialPrompt?: string;
  /** Show the mic button (server has a speech-to-text key). */
  voiceEnabled?: boolean;
}) {
  const router = useRouter();
  // The new-chat page mints an id per server render; pin the first one so a re-render during
  // navigation can't swap this conversation for an empty one.
  const [id] = useState(serverId);
  const [model, setModel] = useState(initialModel);
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const isNew = useRef(initialMessages.length === 0);

  const { messages, sendMessage, status, stop, error, addToolApprovalResponse } = useChat<OasisUIMessage>({
    id,
    messages: initialMessages,
    transport: new DefaultChatTransport({ api: '/api/chat' }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onFinish: () => {
      // First exchange of a new chat: move to its permanent URL and refresh the sidebar list.
      if (isNew.current) {
        isNew.current = false;
        window.history.replaceState(null, '', `/chat/${id}`);
      }
      router.refresh();
    },
  });

  const busy = status === 'submitted' || status === 'streaming';
  // Send a ?prompt= once. Deferred so React's dev double-mount cancels the first attempt instead of
  // swallowing it, and the flag is only set when the message actually goes out.
  const sentInitial = useRef(false);
  useEffect(() => {
    if (!initialPrompt || sentInitial.current || messages.length > 0) return;
    const timer = setTimeout(() => {
      sentInitial.current = true;
      // The URL is left alone here (history calls mid-navigation re-sync the router); after the first
      // answer onFinish moves it to /chat/<id>, so a refresh then opens the saved chat instead of resending.
      sendMessage({ text: initialPrompt }, { body: { model } });
    }, 0);
    return () => clearTimeout(timer);
  }, [initialPrompt, messages.length, sendMessage, model]);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, status]);

  function submit(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    // The model travels with each message; approval follow-ups reuse the conversation's saved model.
    sendMessage({ text: t }, { body: { model } });
    setInput('');
  }

  // Voice: record with MediaRecorder, transcribe on the server, drop the text into the input for review.
  const recorder = useRef<MediaRecorder | null>(null);
  const [voice, setVoice] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  async function toggleVoice() {
    if (voice === 'recording') {
      recorder.current?.stop();
      return;
    }
    setVoiceError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setVoice('transcribing');
        const type = rec.mimeType || 'audio/webm';
        const form = new FormData();
        form.set('audio', new Blob(chunks, { type }), `voice.${type.includes('mp4') ? 'mp4' : 'webm'}`);
        const res = await fetch('/api/transcribe', { method: 'POST', body: form });
        const body = await res.json().catch(() => ({}));
        setVoice('idle');
        if (!res.ok) setVoiceError(body.error ?? 'Transcription failed');
        else if (body.text) setInput((prev) => (prev.trim() ? `${prev.trim()} ${body.text}` : body.text));
      };
      recorder.current = rec;
      rec.start();
      setVoice('recording');
    } catch {
      setVoiceError('Microphone access was blocked');
    }
  }

  // Attachments go to the document store; the message tells the agent the id so its tools can read the file.
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  async function attach(file: File | undefined) {
    if (!file || busy) return;
    setUploading(file.name);
    setUploadError(null);
    const form = new FormData();
    form.set('file', file);
    const res = await fetch('/api/documents', { method: 'POST', body: form });
    const body = await res.json().catch(() => ({}));
    setUploading(null);
    if (fileRef.current) fileRef.current.value = '';
    if (!res.ok) {
      setUploadError(body.error ?? 'Upload failed');
      return;
    }
    const note = `I uploaded "${body.filename}" (document id ${body.id}).`;
    sendMessage({ text: input.trim() ? `${note}\n\n${input.trim()}` : note }, { body: { model } });
    setInput('');
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="print-expand flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6">
          {messages.length > 0 && (
            <div className="flex justify-end">
              <PrintButton label="Export chat to PDF" />
            </div>
          )}
          {messages.length === 0 && (
            <div className="mt-10">
              <h1 className="text-xl font-semibold">Ask anything about {shopName}</h1>
              <p className="mt-1 text-sm text-[var(--viz-text-secondary)]">
                Live data from your store. Charts can be pinned to your dashboard; changes always ask for your approval.
              </p>
              <div className="mt-6 grid gap-2 sm:grid-cols-2">
                {STARTERS.map((s) => (
                  <button key={s} type="button" onClick={() => submit(s)}
                    className="rounded-xl border border-black/10 bg-white px-3 py-2.5 text-left text-sm hover:border-black/25">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} className="self-end rounded-2xl bg-zinc-900 px-4 py-2 text-sm text-white max-w-[85%] whitespace-pre-wrap">
                {m.parts.map((p, i) => (p.type === 'text' ? <span key={i}>{p.text}</span> : null))}
              </div>
            ) : (
              <div key={m.id} className="flex flex-col gap-2.5">
                {m.parts.map((part, i) => {
                  if (part.type === 'text') return part.text ? <Markdown key={i}>{part.text}</Markdown> : null;
                  if (!isToolUIPart(part)) return null;
                  const name = getToolName(part);
                  const key = part.toolCallId;
                  if (name.startsWith('render')) {
                    // Prefer the server-resolved spec (live values from the card's query); while a query-backed card
                    // is still resolving, show a placeholder rather than the model's draft numbers.
                    const output = part.state === 'output-available' ? (part.output as { spec?: unknown; rendered?: boolean } | undefined) : undefined;
                    // A card the server rejected (e.g. placeholder zeros) is replaced by the agent's next call; don't draw it.
                    if (output?.rendered === false) return null;
                    const pending = part.state === 'input-available';
                    const widget = part.state === 'input-streaming' || pending ? null : widgetFrom(name, output?.spec ?? part.input);
                    if (widget) return <Widget key={key} widget={widget} />;
                    return part.state === 'input-streaming' || part.state === 'input-available'
                      ? <div key={key} className="h-40 animate-pulse rounded-xl bg-black/[0.04]" />
                      : <ToolStep key={key} toolName={name} state={part.state} input={part.input} output={part.output} errorText={part.errorText} />;
                  }
                  if (WRITE_TOOLS.has(name)) {
                    return (
                      <ApprovalCard
                        key={key}
                        toolName={name}
                        input={part.input}
                        state={part.state}
                        approvalId={'approval' in part ? part.approval?.id : undefined}
                        output={part.output}
                        errorText={part.errorText}
                        onRespond={(approvalId, approved) => addToolApprovalResponse({ id: approvalId, approved })}
                      />
                    );
                  }
                  return <ToolStep key={key} toolName={name} state={part.state} input={part.input} output={part.output} errorText={part.errorText} />;
                })}
              </div>
            ),
          )}

          {status === 'submitted' && (
            <div className="flex items-center gap-2 text-xs text-[var(--viz-text-secondary)]">
              <Loader2 size={14} className="animate-spin" /> Thinking…
            </div>
          )}
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error.message || 'Something went wrong.'}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
        className="border-t border-black/10 bg-[var(--background)] px-4 py-3"
      >
        {(uploadError || voiceError) && <p className="mx-auto mb-2 max-w-3xl text-xs text-[var(--viz-delta-down)]">{uploadError ?? voiceError}</p>}
        {voice === 'recording' && <p className="mx-auto mb-2 max-w-3xl text-xs text-[var(--viz-text-secondary)]">Listening… click the mic again to stop.</p>}
        <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-black/15 bg-white p-2 focus-within:border-black/40">
          <input ref={fileRef} type="file" accept=".html,.htm,.pdf,.csv,.png,.jpg,.jpeg,.webp" className="hidden"
            onChange={(e) => attach(e.target.files?.[0])} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy || Boolean(uploading)}
            aria-label="Attach a file (saved web page, invoice, price list)" title="Attach a saved web page (.html), PDF, CSV or image"
            className="rounded-xl p-2 text-[var(--viz-text-secondary)] hover:bg-black/5 disabled:opacity-40">
            {uploading ? <Loader2 size={16} className="animate-spin" /> : <Paperclip size={16} />}
          </button>
          {voiceEnabled && (
            <button type="button" onClick={toggleVoice} disabled={busy || voice === 'transcribing'}
              aria-label={voice === 'recording' ? 'Stop recording' : 'Speak your question'} aria-pressed={voice === 'recording'}
              title={voice === 'recording' ? 'Stop recording' : 'Speak your question'}
              className={`rounded-xl p-2 disabled:opacity-40 ${voice === 'recording' ? 'animate-pulse bg-red-50 text-[var(--viz-delta-down)]' : 'text-[var(--viz-text-secondary)] hover:bg-black/5'}`}>
              {voice === 'transcribing' ? <Loader2 size={16} className="animate-spin" /> : <Mic size={16} />}
            </button>
          )}
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit(input);
              }
            }}
            rows={1}
            placeholder="Ask about orders, products, customers, sales…"
            className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none"
          />
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            aria-label="Model"
            className="rounded-lg bg-black/5 px-2 py-1.5 text-xs outline-none"
          >
            {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          {busy ? (
            <button type="button" onClick={() => stop()} aria-label="Stop" className="rounded-xl bg-zinc-900 p-2 text-white">
              <Square size={16} />
            </button>
          ) : (
            <button type="submit" aria-label="Send" disabled={!input.trim()} className="rounded-xl bg-zinc-900 p-2 text-white disabled:opacity-40">
              <ArrowUp size={16} />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
