import { cn } from '@devias/ui';
import { useState } from 'react';

/** A full stop that ends a word, not a sentence. */
const ABBREVIATION = /\b(?:e\.g|i\.e|etc|vs)$/i;

/** A brief this long still needs the rest: it would not fit the two lines it is given. */
const LONG = 160;

/**
 * What a tool does, as far as a person needs: its first sentence. A tool's description is written for the model (how
 * to call it, what to pass, when to prefer another tool), so most of it is noise in a list of tools.
 */
export const briefOf = (description: string): { brief: string; full: string; more: boolean } => {
  const full = description.replace(/\s+/g, ' ').trim();
  let end = full.length;

  for (const match of full.matchAll(/[.!?](?=\s|$)/g)) {
    if (ABBREVIATION.test(full.slice(0, match.index))) {
      continue;
    }

    end = match.index + 1;
    break;
  }

  const brief = full.slice(0, end);

  return { brief, full, more: brief.length < full.length || brief.length > LONG };
};

/** A tool's description in a line or two, with the model's full text a click away. */
export function ToolDescription({ text, className }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const { brief, full, more } = briefOf(text);

  return (
    <div className={cn('text-xs text-muted-foreground', className)} data-slot="tool-description">
      <p className={cn(!open && 'line-clamp-2')}>{open ? full : brief}</p>
      {more ? (
        <button
          type="button"
          aria-expanded={open}
          className="mt-0.5 font-medium text-foreground/70 underline-offset-2 hover:text-foreground hover:underline"
          onClick={() => setOpen(!open)}
        >
          {open ? 'Less' : 'More'}
        </button>
      ) : null}
    </div>
  );
}
