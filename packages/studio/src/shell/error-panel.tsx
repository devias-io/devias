import { Button, Icon } from '@devias/ui';
import { type ReactNode, useState } from 'react';

/**
 * What an unexpected error looks like: what happened in plain words, the message for whoever has to report it, the
 * technical details folded away, and a way forward. Used for a failed route and for a page that failed to render.
 */
export function ErrorPanel({
  title = 'Something went wrong',
  description = 'This page hit an unexpected problem. Nothing you saved is lost: try again, or go back to the start.',
  error,
  onRetry,
  actions,
}: {
  title?: string;
  description?: string;
  error?: unknown;
  /** Shown as the primary button when given. */
  onRetry?: () => void;
  /** Further buttons, after "Try again" (e.g. a link home). */
  actions?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const stack = error instanceof Error ? (error.stack ?? '') : '';
  const details = [message, stack && stack !== message ? stack : ''].filter(Boolean).join('\n\n');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${title}\n\n${details}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard not available: the details are on screen to select.
    }
  };

  return (
    <div
      className="flex min-h-[70vh] flex-1 flex-col items-center justify-center px-6 py-16 text-center"
      role="alert"
      data-slot="error-panel"
    >
      <span className="flex size-12 items-center justify-center rounded-sm bg-destructive/10 text-destructive">
        <Icon name="triangle-alert" className="size-6" />
      </span>
      <h1 className="mt-6 font-heading text-xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-3 max-w-md text-xs leading-relaxed text-muted-foreground">{description}</p>
      {message ? (
        <code className="mt-6 max-w-xl rounded-lg border border-border bg-muted/50 px-3 py-2 text-left font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-muted-foreground">
          {message}
        </code>
      ) : null}
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        {onRetry ? (
          <Button size="lg" onClick={onRetry}>
            <Icon name="rotate-ccw" className="size-4" /> Try again
          </Button>
        ) : null}
        {actions}
      </div>
      {details ? (
        <details className="mt-8 w-full max-w-xl text-left">
          <summary className="cursor-pointer text-center text-xs text-muted-foreground select-none hover:text-foreground">
            Technical details
          </summary>
          <div className="mt-3 rounded-lg border border-border bg-card">
            <pre className="max-h-64 overflow-auto p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
              {details}
            </pre>
            <div className="flex justify-end border-t border-border p-1.5">
              <Button variant="ghost" size="sm" onClick={() => void copy()}>
                <Icon name={copied ? 'check' : 'copy'} className="size-3.5" /> {copied ? 'Copied' : 'Copy details'}
              </Button>
            </div>
          </div>
        </details>
      ) : null}
    </div>
  );
}
