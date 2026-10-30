'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-oasis text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: (props) => <a {...props} target="_blank" rel="noreferrer" className="text-[var(--series-1)] underline-offset-2 hover:underline" />,
          p: (props) => <p {...props} className="my-2 first:mt-0 last:mb-0" />,
          ul: (props) => <ul {...props} className="my-2 list-disc pl-5" />,
          ol: (props) => <ol {...props} className="my-2 list-decimal pl-5" />,
          li: (props) => <li {...props} className="my-0.5" />,
          h1: (props) => <h3 {...props} className="mt-3 mb-1 font-semibold" />,
          h2: (props) => <h3 {...props} className="mt-3 mb-1 font-semibold" />,
          h3: (props) => <h3 {...props} className="mt-3 mb-1 font-semibold" />,
          code: (props) => <code {...props} className="rounded bg-black/5 px-1 font-mono text-[0.85em]" />,
          pre: (props) => <pre {...props} className="my-2 overflow-auto rounded-lg bg-black/[0.04] p-3 text-xs" />,
          table: (props) => (
            <div className="my-2 overflow-auto">
              <table {...props} className="w-full border-collapse text-xs" />
            </div>
          ),
          th: (props) => <th {...props} className="border-b border-[var(--viz-grid)] px-2 py-1 text-left font-medium" />,
          td: (props) => <td {...props} className="tabular border-b border-[var(--viz-grid)]/60 px-2 py-1" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
