import { type BlockDefinition, definePageComponent } from '@devias/core';
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  EmptyState,
  Icon,
  Switch,
} from '@devias/ui';
import { useMemo, useState } from 'react';
import { ids } from '../../ids';
import { useSetBreadcrumbs } from '../../providers/breadcrumbs';
import { useCommands } from '../../providers/commands';
import { useSchema } from '../../providers/schema';
import { useWorkspace } from '../../providers/workspace';
import { useBlocks } from '../../registries';
import { ErrorBoundary } from '../../shell/error-boundary';
import { HomeGrid } from './home-grid';
import { resolveLayouts, useHomeLayoutStore } from './layout';

const greeting = (hour: number): string => (hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening');

const MAX_QUICK_ACTIONS = 6;

function HomeBlock({ block, className }: { block: BlockDefinition; className?: string }) {
  const Component = block.component;

  return (
    <div className={cn('min-w-0', className)} data-block={block.id}>
      <ErrorBoundary compact title={`${block.label} failed to load`}>
        <Component config={{}} surface="home" />
      </ErrorBoundary>
    </div>
  );
}

/** The workspace's own shortcuts (its command items: "New company", "Go to billing", …) as chips. */
function QuickActions() {
  const { commands, run } = useCommands();
  const { schema } = useSchema();
  const itemIds = new Set(schema.commandItems.map((item) => item.id));
  const actions = commands.filter((command) => itemIds.has(command.id)).slice(0, MAX_QUICK_ACTIONS);

  if (actions.length === 0) {
    return null;
  }

  return (
    <nav aria-label="Quick actions" className="flex flex-wrap justify-center gap-2">
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          className="flex h-8 items-center gap-2 rounded-sm border border-border bg-card px-3.5 text-[13px] font-medium text-foreground transition-colors hover:bg-muted"
          onClick={() => void run(action)}
        >
          <Icon name={action.icon ?? 'zap'} className="size-4 text-muted-foreground" />
          {action.label}
        </button>
      ))}
    </nav>
  );
}

/** Shown above the grid while customizing: which blocks Home shows, and a way back to the default arrangement. */
function CustomizeBar({
  blocks,
  shown,
  onToggle,
  onReset,
}: {
  blocks: BlockDefinition[];
  shown: Set<string>;
  onToggle: (blockId: string, show: boolean) => void;
  onReset: () => void;
}) {
  return (
    <div
      data-slot="home-customize"
      className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-dashed border-input px-4 py-2.5"
    >
      <p className="min-w-0 flex-1 text-xs text-muted-foreground">
        Drag blocks by their grip, resize them from the edges, or choose which ones to show.
      </p>
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
            <Icon name="layout-grid" />
            Blocks
            <span className="text-muted-foreground tabular-nums">
              {shown.size}/{blocks.length}
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Show on Home</DropdownMenuLabel>
              {blocks.map((block) => (
                <DropdownMenuCheckboxItem
                  key={block.id}
                  checked={shown.has(block.id)}
                  closeOnClick={false}
                  onCheckedChange={(checked) => onToggle(block.id, checked)}
                >
                  {block.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="ghost" size="sm" onClick={onReset}>
          <Icon name="rotate-ccw" />
          Reset
        </Button>
      </div>
    </div>
  );
}

/**
 * The workspace at a glance: a greeting, the blocks modules put on Home (pipeline, tasks, …) on a grid each person
 * arranges for themselves, then a centered column with quick actions and the blocks placed below the grid (the
 * agent composer).
 */
export function HomePage() {
  const { user, workspaceId } = useWorkspace();
  useSetBreadcrumbs([{ label: 'Home' }]);
  const [editing, setEditing] = useState(false);
  const key = `${workspaceId}:${user.id}`;
  const saved = useHomeLayoutStore((s) => s.saved[key]);
  const { arrange, hide, show, reset } = useHomeLayoutStore.getState();
  const blocks = useBlocks('home');
  const gridBlocks = useMemo(
    () => blocks.filter((block) => (block.surfaces.home?.placement ?? 'grid') === 'grid'),
    [blocks],
  );
  const visible = useMemo(
    () => gridBlocks.filter((block) => !saved?.hidden.includes(block.id)),
    [gridBlocks, saved?.hidden],
  );
  const layouts = useMemo(() => resolveLayouts(visible, saved), [visible, saved]);
  const below = blocks.filter((block) => block.surfaces.home?.placement === 'below');
  const firstName = user.name?.trim().split(/\s+/)[0] ?? '';

  return (
    <div className="mx-auto w-full max-w-[90rem] px-6 pt-6 pb-10 sm:px-10" data-slot="home">
      <div className="flex items-end justify-between gap-6">
        <div className="min-w-0">
          <h1 className="font-heading text-heading">
            {greeting(new Date().getHours())}{' '}
            {firstName ? <span className="text-muted-foreground">{firstName}</span> : null}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">here's a quick look at how things are going.</p>
        </div>
        {gridBlocks.length > 0 ? (
          // biome-ignore lint/a11y/noLabelWithoutControl: the switch inside is the control
          <label className="mb-1.5 flex shrink-0 cursor-pointer items-center gap-2 text-xs text-muted-foreground select-none">
            <Switch checked={editing} onCheckedChange={setEditing} />
            Customize
          </label>
        ) : null}
      </div>
      {blocks.length === 0 ? (
        <EmptyState
          className="mt-16"
          icon="house"
          title="Nothing here yet"
          description="Modules add blocks to Home, such as your pipeline or this week's tasks."
        />
      ) : null}
      {editing ? (
        <CustomizeBar
          blocks={gridBlocks}
          shown={new Set(visible.map((block) => block.id))}
          onToggle={(blockId, next) => (next ? show : hide)(key, blockId)}
          onReset={() => reset(key)}
        />
      ) : null}
      {visible.length > 0 ? (
        <div className={editing ? 'mt-5' : 'mt-6'}>
          <HomeGrid
            blocks={visible}
            layouts={layouts}
            editing={editing}
            onArrange={(breakpoint, layout) => arrange(key, breakpoint, layout)}
            onRemove={(blockId) => hide(key, blockId)}
          />
        </div>
      ) : gridBlocks.length > 0 ? (
        <p className="mt-10 rounded-lg border border-dashed border-border px-4 py-10 text-center text-xs text-muted-foreground">
          No blocks on Home. Turn on Customize to add some back.
        </p>
      ) : null}
      {/* The chips may run wider than the column below them, like a toolbar over the composer. */}
      <section className="mx-auto mt-8 flex w-full max-w-3xl flex-col items-center gap-3" data-slot="home-below">
        <QuickActions />
        {below.map((block) => (
          <HomeBlock key={block.id} block={block} className="w-full max-w-2xl" />
        ))}
      </section>
    </div>
  );
}

export const homePage = definePageComponent({ id: ids.pages.home, path: 'home', component: HomePage });
