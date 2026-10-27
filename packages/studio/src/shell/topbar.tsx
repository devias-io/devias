import type { BlockDefinition } from '@devias/core';
import { Button, cn, Icon, Tooltip, TooltipContent, TooltipTrigger, TopBar } from '@devias/ui';
import { formatShortcut } from '../commands/keybindings';
import { useBlocks } from '../registries';
import { useDock } from './dock';
import { LiveStatusDot } from './live-status';
import { SearchBar } from './search-bar';
import { UserMenu } from './user-menu';

const useNoBadge = () => undefined;

/** A panel block's toggle: pressed while its panel is open, with the block's count on it (e.g. unread notifications). */
function PanelToggle({ block }: { block: BlockDefinition }) {
  const open = useDock((state) => state.openId === block.id);
  const toggle = useDock((state) => state.toggle);
  const useBadge = block.surfaces.panel?.useBadge ?? useNoBadge;
  const count = useBadge() ?? 0;
  const shortcut = block.surfaces.panel?.shortcut;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant={open ? 'secondary' : 'ghost'}
            size="icon-lg"
            aria-label={count > 0 ? `${block.label}, ${count} unread` : block.label}
            aria-pressed={open}
            data-panel-toggle={block.id}
            className={cn('relative', !open && 'text-muted-foreground')}
            onClick={() => toggle(block.id)}
          />
        }
      >
        <Icon name={block.icon} className="size-5" />
        {count > 0 ? (
          <span
            aria-hidden
            data-panel-badge
            className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] leading-none font-semibold text-brand-foreground tabular-nums"
          >
            {count > 99 ? '99+' : count}
          </span>
        ) : null}
      </TooltipTrigger>
      <TooltipContent>
        {block.label}
        {shortcut ? ` · ${formatShortcut(shortcut)}` : ''}
      </TooltipContent>
    </Tooltip>
  );
}

/** One toggle per panel block (the agent, notifications), pressed while its panel is open in the dock. */
function PanelToggles() {
  const panels = useBlocks('panel');

  if (panels.length === 0) {
    return null;
  }

  return (
    <>
      {panels.map((block) => (
        <PanelToggle key={block.id} block={block} />
      ))}
    </>
  );
}

/**
 * Built-in top bar: the search field in the middle, panel toggles (e.g. the agent) and the account menu
 * on the right. Breadcrumbs are left to individual views.
 * The live-status dot shows only when updates are degraded.
 */
export function StudioTopbar() {
  return (
    <TopBar
      center={<SearchBar />}
      right={
        <>
          <LiveStatusDot />
          <PanelToggles />
          <UserMenu compact />
        </>
      }
    />
  );
}
