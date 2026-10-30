import { openai } from '@ai-sdk/openai';
import { transcribe } from 'ai';
import { getSessionShop } from '@/lib/session';

export const maxDuration = 60;
const MAX_BYTES = 10 * 1024 * 1024;

/** Speech to text for the chat mic button (OpenAI gpt-4o-mini-transcribe). */
export async function POST(req: Request) {
  const shop = await getSessionShop();
  if (!shop) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!process.env.OPENAI_API_KEY) return Response.json({ error: 'Voice input needs OPENAI_API_KEY' }, { status: 501 });
  const audio = (await req.formData()).get('audio');
  if (!(audio instanceof File) || audio.size === 0) return Response.json({ error: 'No audio received' }, { status: 400 });
  if (audio.size > MAX_BYTES) return Response.json({ error: 'Recording is too long' }, { status: 413 });
  try {
    const { text } = await transcribe({
      model: openai.transcription('gpt-4o-mini-transcribe'),
      audio: new Uint8Array(await audio.arrayBuffer()),
      maxRetries: 1,
    });
    return Response.json({ text: text.trim() });
  } catch (err) {
    return Response.json({ error: `Transcription failed: ${(err as Error).message}` }, { status: 502 });
  }
}
