import { cn, Icon, type IconName } from '@devias/ui';
import { ReactRenderer } from '@tiptap/react';
import type { SuggestionOptions, SuggestionProps } from '@tiptap/suggestion';
import { type ComponentType, useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface MenuEntry {
  key: string;
  title: string;
  hint?: string;
  /** An icon, or a short glyph such as `H1` drawn in a tile (block previews). */
  icon?: IconName;
  glyph?: string;
}

/** The suggestion plugin forwards editor key presses here while a menu is open. */
export type MenuKeys = { current: ((event: KeyboardEvent) => boolean) | null };

export function SuggestionMenu({
  entries,
  onSelect,
  keys,
  heading,
  empty,
  tiles = false,
}: {
  entries: MenuEntry[];
  onSelect: (index: number) => void;
  keys: MenuKeys;
  heading?: string;
  empty: string;
  /** Large rows with a preview tile and the hint underneath (block menu) instead of compact rows. */
  tiles?: boolean;
}) {
  const [active, setActive] = useState(0);
  // New entries start at the top again.
  const [shown, setShown] = useState(entries);

  if (shown !== entries) {
    setShown(entries);
    setActive(0);
  }

  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  useLayoutEffect(() => {
    keys.current = (event) => {
      if (entries.length === 0) {
        return false;
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setActive((current) => (current + step + entries.length) % entries.length);

        return true;
      }

      if (event.key === 'Enter' || event.key === 'Tab') {
        onSelect(active);

        return true;
      }

      return false;
    };
  });

  return (
    <div
      ref={list}
      data-suggestion-menu
      className="z-[60] max-h-80 w-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md"
    >
      {heading ? <div className="px-2 pt-1 pb-1.5 text-xs font-medium text-muted-foreground">{heading}</div> : null}
      {entries.length === 0 ? <div className="px-2 py-1.5 text-xs text-muted-foreground">{empty}</div> : null}
      {entries.map((entry, i) => (
        <button
          key={entry.key}
          type="button"
          data-index={i}
          className={cn(
            'flex w-full items-center gap-2.5 rounded-md px-2 text-left text-xs',
            tiles ? 'py-1.5' : 'py-1',
            i === active && 'bg-accent text-accent-foreground',
          )}
          onMouseEnter={() => setActive(i)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onSelect(i)}
        >
          {tiles ? (
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-background text-xs font-medium text-muted-foreground">
              {entry.glyph ?? (entry.icon ? <Icon name={entry.icon} className="size-4" /> : null)}
            </span>
          ) : entry.icon ? (
            <Icon name={entry.icon} className="size-3.5 shrink-0 text-muted-foreground" />
          ) : null}
          {tiles ? (
            <span className="min-w-0">
              <span className="block truncate">{entry.title}</span>
              {entry.hint ? <span className="block truncate text-xs text-muted-foreground">{entry.hint}</span> : null}
            </span>
          ) : (
            <>
              <span className="truncate">{entry.title}</span>
              {entry.hint ? <span className="ml-auto shrink-0 text-xs text-muted-foreground">{entry.hint}</span> : null}
            </>
          )}
        </button>
      ))}
    </div>
  );
}

/**
 * The `render` option of a suggestion: mounts `Component` next to the cursor and forwards key presses to it.
 * Inside a dialog or popover the menu mounts there, so choosing an entry doesn't count as an outside click.
 */
export const renderSuggestion =
  <I, S>(
    Component: ComponentType<SuggestionProps<I, S> & { keys: MenuKeys }>,
  ): NonNullable<SuggestionOptions<I, S>['render']> =>
  () => {
    let renderer: ReactRenderer | null = null;
    let unmount: (() => void) | undefined;
    const keys: MenuKeys = { current: null };

    return {
      onStart: (props) => {
        renderer = new ReactRenderer(Component, { props: { ...props, keys }, editor: props.editor });
        const host = props.editor.view.dom.closest('[role="dialog"]');

        if (host) {
          host.appendChild(renderer.element);
        }

        unmount = props.mount(renderer.element);
      },
      onUpdate: (props) => renderer?.updateProps({ ...props, keys }),
      onKeyDown: ({ event }) => keys.current?.(event) ?? false,
      onExit: () => {
        unmount?.();

        if (renderer?.element.isConnected) {
          renderer.element.remove();
        }

        renderer?.destroy();
        renderer = null;
      },
    };
  };
