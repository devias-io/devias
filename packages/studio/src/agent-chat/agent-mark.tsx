import { cn, Icon } from '@devias/ui';
import { useStudioConfig } from '../providers/studio-config';

/**
 * An agent's mark: the image the app maps its icon name to (`agentImages` in the studio config), else its line icon.
 * `className` sizes the image, or the tile when `tile` puts the icon on one; either is a circle; without a tile
 * the icon is drawn bare, at its usual size.
 */
export function AgentMark({
  icon,
  className,
  tile = false,
}: {
  /** The agent's icon name; empty is the default agent icon. */
  icon?: string | null;
  className?: string;
  tile?: boolean;
}) {
  const config = useStudioConfig();
  const name = icon?.trim() || 'bot';
  const image = config.agentImages[name];

  if (image) {
    return (
      <img
        src={image}
        alt=""
        aria-hidden
        draggable={false}
        className={cn('shrink-0 rounded-full object-cover ring-1 ring-foreground/10', className)}
      />
    );
  }

  if (tile) {
    return (
      <span
        aria-hidden
        className={cn(
          'flex shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground ring-1 ring-card-border',
          className,
        )}
      >
        <Icon name={name} className="size-1/2" />
      </span>
    );
  }

  return <Icon name={name} className="size-4 shrink-0 text-muted-foreground" />;
}
