import type { ReactNode } from 'react';

export function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-black/10 bg-white p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-[var(--viz-text-secondary)]">{description}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}
