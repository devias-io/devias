import { cn, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, EmptyState } from '@devias/ui';
import { useBlock } from '../registries';
import { ErrorBoundary } from './error-boundary';

const WIDTH = { sm: 'sm:max-w-md', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl' } as const;

/** A block in a dialog, by id; `open_block` command items open it. */
export function BlockDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const block = useBlock(id);
  const Component = block?.component;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={cn(WIDTH[block?.surfaces.dialog?.size ?? 'md'])}>
        <DialogHeader>
          <DialogTitle>{block?.label ?? 'Block'}</DialogTitle>
          <DialogDescription className="sr-only">{id}</DialogDescription>
        </DialogHeader>
        {block && Component ? (
          <ErrorBoundary compact title={block.label}>
            <Component config={{}} surface="dialog" />
          </ErrorBoundary>
        ) : (
          <EmptyState icon="puzzle" title="Block not registered" description={id} />
        )}
      </DialogContent>
    </Dialog>
  );
}
