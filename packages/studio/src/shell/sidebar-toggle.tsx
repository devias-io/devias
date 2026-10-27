import { Button, cn, Icon, Tooltip, TooltipContent, TooltipTrigger } from '@devias/ui';
import { useShell } from './shell-context';

/** Collapses the sidebar to an icon rail, or expands it again. */
export function SidebarToggle({ className }: { className?: string }) {
  const { sidebarCollapsed, toggleSidebar } = useShell();
  const label = sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar';

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn('text-muted-foreground', className)}
            aria-label={label}
            onClick={toggleSidebar}
          />
        }
      >
        <Icon name={sidebarCollapsed ? 'panel-left' : 'panel-left-close'} />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
