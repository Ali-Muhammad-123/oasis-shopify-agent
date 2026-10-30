import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { getSessionShop } from '@/lib/session';

async function RedirectIfConnected() {
  if (await getSessionShop()) redirect('/chat');
  return null;
}

export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 p-8 text-zinc-900">
      <Suspense>
        <RedirectIfConnected />
      </Suspense>
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Oasis</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Ask questions about your Shopify store, build dashboards, and let an AI agent act on your data with your
          approval.
        </p>
        <form action="/api/auth/install" method="get" className="mt-6 flex flex-col gap-3">
          <label className="text-sm font-medium text-zinc-800" htmlFor="shop">
            Store domain
          </label>
          <input
            id="shop"
            name="shop"
            required
            placeholder="your-store.myshopify.com"
            defaultValue={process.env.SHOPIFY_SHOP}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-zinc-900"
          />
          <button className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700">
            Connect Shopify store
          </button>
        </form>
      </div>
    </main>
  );
}
