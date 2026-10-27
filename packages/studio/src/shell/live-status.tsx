import { Button, cn, Tooltip, TooltipContent, TooltipTrigger } from '@devias/ui';
import { useLiveStatus } from '../providers/live-updates';

const LABELS = {
  open: 'Live updates connected',
  connecting: 'Connecting to live updates…',
  reconnecting: 'Reconnecting… (polling every 30 s)',
  closed: 'Live updates off (polling every 30 s)',
} as const;

/** Connection indicator for live updates; hidden while they work. */
export function LiveStatusDot() {
  const status = useLiveStatus();

  // Healthy (or still connecting on load) is the normal state: only surface the dot when updates degrade.
  if (status === 'open' || status === 'connecting') {
    return null;
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label={LABELS[status]} data-live-status={status} />}
      >
        <span
          className={cn(
            'size-2 rounded-full',
            status === 'reconnecting' && 'bg-warning animate-pulse',
            status === 'closed' && 'bg-muted-foreground',
          )}
        />
      </TooltipTrigger>
      <TooltipContent>{LABELS[status]}</TooltipContent>
    </Tooltip>
  );
}
