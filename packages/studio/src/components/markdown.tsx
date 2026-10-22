import { parseLink } from '@devias/core';
import { cn } from '@devias/ui';
import type { ComponentProps } from 'react';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useNavigateTo } from '../hooks/use-navigate-to';

/**
 * Links to records, workflows and documents (`record:<object>/<id>`, `workflow:<id>`, `document:<id>`) open them in the
 * studio; everything else opens in a new tab.
 */
const urlTransform = (url: string): string => (parseLink(url) ? url : defaultUrlTransform(url));

const inAppLink = 'font-medium text-primary underline-offset-2 hover:underline';

function Anchor({ href, children }: ComponentProps<'a'>) {
  const nav = useNavigateTo();
  const target = href ? parseLink(href) : null;

  if (target) {
    return (
      <a
        href={nav.href.link(target)}
        className={inAppLink}
        onClick={(event) => {
          event.preventDefault();
          nav.toLink(target);
        }}
      >
        {children}
      </a>
    );
  }

  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">
      {children}
    </a>
  );
}

/** Agent replies: GitHub-flavoured markdown, no raw HTML, compact spacing that fits the panel. */
export function RichMarkdown({ text, className }: { text: string; className?: string }) {
  return (
    <div
      className={cn('flex flex-col gap-2 text-xs leading-relaxed break-words', className)}
      data-slot="agent-chat-markdown"
    >
      <Markdown
        remarkPlugins={[remarkGfm]}
        urlTransform={urlTransform}
        skipHtml
        components={{
          a: Anchor,
          p: ({ children }) => <p>{children}</p>,
          ul: ({ children }) => <ul className="list-disc pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5">{children}</ol>,
          li: ({ children }) => <li className="my-0.5">{children}</li>,
          h1: ({ children }) => <h3 className="text-xs font-semibold">{children}</h3>,
          h2: ({ children }) => <h3 className="text-xs font-semibold">{children}</h3>,
          h3: ({ children }) => <h3 className="text-xs font-semibold">{children}</h3>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          code: ({ children, className: codeClass }) =>
            codeClass ? (
              <code className="block overflow-x-auto rounded-md bg-muted px-2 py-1.5 font-mono text-xs">
                {children}
              </code>
            ) : (
              <code className="rounded-xs bg-muted px-1 py-0.5 font-mono text-xs">{children}</code>
            ),
          pre: ({ children }) => <pre className="overflow-x-auto">{children}</pre>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="border-b border-border px-2 py-1 text-left font-medium">{children}</th>,
          td: ({ children }) => <td className="border-b border-border px-2 py-1 align-top">{children}</td>,
          hr: () => <hr className="border-border" />,
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
