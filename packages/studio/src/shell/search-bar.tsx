import { Icon } from '@devias/ui';
import { useCommands } from '../providers/commands';
import { useWorkspace } from '../providers/workspace';

/** Centered top bar field that opens the command palette (⌘K). */
export function SearchBar() {
  const { setOpen } = useCommands();
  const { organization } = useWorkspace();

  return (
    // The field takes what the top bar leaves it, down to the icon: the text is cut short, and the shortcut goes first.
    <div className="@container min-w-0 flex-1">
      <button
        type="button"
        aria-label="Search"
        onClick={() => setOpen(true)}
        className="flex h-9 w-full min-w-0 items-center gap-2 rounded-sm border border-border bg-card px-4 text-xs text-muted-foreground transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <Icon name="search" className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">Search or ask a question in {organization.name}</span>
        <span className="hidden shrink-0 items-center gap-1 text-xs @sm:flex">
          <kbd className="rounded-xs bg-muted px-1.5 py-0.5 font-sans">⌘</kbd>
          <kbd className="rounded-xs bg-muted px-1.5 py-0.5 font-sans">K</kbd>
        </span>
      </button>
    </div>
  );
}
