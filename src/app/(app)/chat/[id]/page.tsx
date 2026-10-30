import { notFound, redirect } from 'next/navigation';
import { Suspense } from 'react';
import { Chat } from '@/components/chat/Chat';
import { availableModels, resolveModelId } from '@/lib/agent/model';
import type { OasisUIMessage } from '@/lib/agent/types';
import { getConversation } from '@/lib/conversations';
import { getSessionShop } from '@/lib/session';

async function ExistingChat({ params }: { params: Promise<{ id: string }> }) {
  const shop = await getSessionShop();
  if (!shop) redirect('/');
  const { id } = await params;
  const convo = await getConversation(shop.domain, id);
  if (!convo) notFound();
  const models = availableModels().map(({ id: mid, label }) => ({ id: mid, label }));
  return (
    <Chat
      key={id}
      id={id}
      initialMessages={convo.messages as OasisUIMessage[]}
      models={models}
      initialModel={resolveModelId(convo.model)}
      shopName={shop.name ?? shop.domain}
      voiceEnabled={Boolean(process.env.OPENAI_API_KEY)}
    />
  );
}

export default function ChatPage(props: PageProps<'/chat/[id]'>) {
  return (
    <Suspense>
      <ExistingChat params={props.params} />
    </Suspense>
  );
}
