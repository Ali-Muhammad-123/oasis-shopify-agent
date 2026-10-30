import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { Chat } from '@/components/chat/Chat';
import { availableModels, resolveModelId } from '@/lib/agent/model';
import { getSessionShop } from '@/lib/session';

async function NewChat({ searchParams }: { searchParams: Promise<{ prompt?: string | string[] }> }) {
  const shop = await getSessionShop();
  if (!shop) redirect('/');
  const prompt = (await searchParams).prompt;
  const models = availableModels().map(({ id, label }) => ({ id, label }));
  return <Chat key="new" id={randomUUID()} initialMessages={[]} models={models} initialModel={resolveModelId()} shopName={shop.name ?? shop.domain}
      voiceEnabled={Boolean(process.env.OPENAI_API_KEY)}
    initialPrompt={typeof prompt === 'string' ? prompt.slice(0, 2000) : undefined} />;
}

export default function NewChatPage(props: PageProps<'/chat'>) {
  return (
    <Suspense>
      <NewChat searchParams={props.searchParams} />
    </Suspense>
  );
}
