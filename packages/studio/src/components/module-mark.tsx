import type { InstalledModule } from '@devias/core';
import { cn, Icon, type IconName } from '@devias/ui';
import { useState } from 'react';
import { useClient } from '../providers/client';

/** What a mark needs of a module: its manifest and its installed row both have them. */
type Markable = Pick<InstalledModule, 'icon' | 'logo'>;

/** A module's line icon, the puzzle piece when it has none. */
export const moduleIcon = (module: Pick<InstalledModule, 'icon'> | undefined): IconName =>
  (module?.icon as IconName | undefined) ?? 'puzzle';

/**
 * A module's mark: the logo it ships (served by the server), drawn edge to edge on nothing, else its line icon. A logo that does not load falls back to the icon. `className` sizes it; with `tile` it is a
 * bordered square of that size, the icon inside at half of it.
 */
export function ModuleMark({
  moduleId,
  module,
  className,
  tile = false,
}: {
  moduleId: string;
  module: Markable | undefined;
  className?: string;
  tile?: boolean;
}) {
  const client = useClient();
  const [failed, setFailed] = useState(false);
  const url = module?.logo && !failed ? client.modules.logoUrl(moduleId) : undefined;

  if (url) {
    // Nothing behind or around it: the logo is a plain square and the corners are rounded here, so every logo has the
    // same ones. The wrapper gives the size.
    return (
      <span aria-hidden className={cn('flex shrink-0 overflow-hidden', tile ? 'rounded-lg' : 'rounded-sm', className)}>
        <img src={url} alt="" draggable={false} onError={() => setFailed(true)} className="size-full object-contain" />
      </span>
    );
  }

  if (tile) {
    return (
      <span
        aria-hidden
        className={cn(
          'flex shrink-0 items-center justify-center rounded-lg border border-border bg-muted/50 text-muted-foreground',
          className,
        )}
      >
        <Icon name={moduleIcon(module)} className="size-1/2" />
      </span>
    );
  }

  return <Icon name={moduleIcon(module)} className={cn('shrink-0 text-muted-foreground', className)} />;
}
