import { Activity, FileBarChart, FileText, LayoutDashboard, LogOut, MessageSquarePlus, PanelsTopLeft, Settings } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { ConversationList } from '@/components/sidebar/ConversationList';
import { listConversations } from '@/lib/conversations';
import { getSessionShop } from '@/lib/session';

const NAV = [
  { href: '/chat', label: 'New chat', icon: MessageSquarePlus },
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/documents', label: 'Documents', icon: FileText },
  { href: '/pages', label: 'Pages', icon: PanelsTopLeft },
  { href: '/reports', label: 'Reports', icon: FileBarChart },
  { href: '/activity', label: 'Activity', icon: Activity },
  { href: '/settings', label: 'Settings', icon: Settings },
];

async function SidebarShop() {
  const shop = await getSessionShop();
  if (!shop) redirect('/');
  const conversations = await listConversations(shop.domain);
  return (
    // min-h-0 lets this column shrink inside the fixed-height sidebar so the chat list scrolls on its own.
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mt-6 px-2 text-[11px] font-medium uppercase tracking-wide text-[var(--viz-muted)]">Recent</div>
      <nav aria-label="Recent chats" className="-mr-1 mt-1 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
        <ConversationList conversations={conversations.map(({ id, title }) => ({ id, title }))} />
      </nav>
      <div className="mt-3 shrink-0 border-t border-black/10 px-2 pt-3">
        <div className="truncate text-sm font-medium">{shop.name}</div>
        <div className="truncate text-xs text-[var(--viz-muted)]">{shop.domain}</div>
        <form action="/api/auth/logout" method="post" className="mt-2">
          <button className="flex items-center gap-1.5 text-xs text-[var(--viz-text-secondary)] hover:text-black">
            <LogOut size={12} /> Disconnect
          </button>
        </form>
      </div>
    </div>
  );
}

export default function AppLayout({ children }: LayoutProps<'/'>) {
  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="flex h-full min-h-0 w-60 shrink-0 flex-col border-r border-black/10 bg-white/60 p-3">
        <Link href="/chat" className="px-2 text-base font-semibold tracking-tight">Oasis</Link>
        <nav className="mt-4 flex flex-col gap-0.5">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-black/5">
              <Icon size={15} className="text-[var(--viz-text-secondary)]" /> {label}
            </Link>
          ))}
        </nav>
        <Suspense fallback={<div className="mt-6 flex-1" />}>
          <SidebarShop />
        </Suspense>
      </aside>
      <main className="h-full min-w-0 flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
