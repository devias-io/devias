import type { DocumentSummary } from '@devias/core';
import { Icon } from '@devias/ui';
import { ago } from '../../lib/time';
import { UNTITLED_RECORD_LABEL } from '../../views/view-state';

/** A glimpse of a document as a page preview, over its title and when it was last edited. */
export function DocumentCard({ document, onOpen }: { document: DocumentSummary; onOpen: () => void }) {
  return (
    <button
      type="button"
      data-slot="document-card"
      className="group flex h-52 flex-col overflow-hidden rounded-lg text-left ring-1 ring-border/60 transition-colors ring-inset hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
      onClick={onOpen}
    >
      <div className="min-h-0 flex-1 overflow-hidden bg-accent/30 px-4 pt-3.5 transition-colors group-hover:bg-accent/50">
        <p className="line-clamp-6 text-xs leading-relaxed whitespace-pre-line text-muted-foreground">
          {document.preview}
        </p>
      </div>
      <div className="flex flex-col gap-0.5 border-t border-border/60 px-3.5 py-2.5">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
          <Icon name="file-text" className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{document.title || UNTITLED_RECORD_LABEL}</span>
        </span>
        <span className="h-4 truncate text-xs text-muted-foreground">Edited {ago(document.updatedAt)}</span>
      </div>
    </button>
  );
}
