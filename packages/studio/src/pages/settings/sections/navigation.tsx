import { defineSettingsSection, type EffectiveNavItem, effectiveNavItem, type NavItem } from '@devias/core';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Icon,
  Input,
} from '@devias/ui';
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  type Modifier,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '../../../hooks/use-mutations';
import { useClient } from '../../../providers/client';
import { useSchema } from '../../../providers/schema';
import { keys } from '../../../query/keys';

/** A dragged row follows the pointer up and down only. */
const keepVertical: Modifier = ({ transform }) => ({ ...transform, x: 0 });

interface Handlers {
  /** Items by the place they sit under: `null` for the top level. */
  childrenOf: (parentId: string | null) => EffectiveNavItem[];
  /** The items an item can be moved into: every section but itself and what sits below it. */
  sectionsFor: (item: EffectiveNavItem) => EffectiveNavItem[];
  raw: (id: string) => NavItem | undefined;
  reorder: (parentId: string | null, orderedIds: string[]) => void;
  rename: (id: string, label: string) => void;
  setHidden: (id: string, hidden: boolean) => void;
  moveTo: (id: string, parentId: string | null) => void;
  reset: (id: string) => void;
  /** Take away an item the workspace made. */
  remove: (id: string) => void;
  busy: boolean;
}

function NavRow({ item, depth, handlers }: { item: EffectiveNavItem; depth: number; handlers: Handlers }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.label);
  const { schema } = useSchema();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const children = handlers.childrenOf(item.id);
  const sections = handlers.sectionsFor(item);
  const commit = () => {
    const label = draft.trim();
    setEditing(false);

    if (label && label !== item.label) {
      handlers.rename(item.id, label);
    } else {
      setDraft(item.label);
    }
  };
  const isGroup = item.target.kind === 'group';
  // What used to be badges on the row, in one line in its menu: who added it, what it is, whether it was changed.
  const origin = [
    item.moduleId
      ? `Added by ${schema.modules.find((module) => module.id === item.moduleId)?.label ?? item.moduleId}`
      : 'Added by you',
    isGroup ? 'Section' : item.target.kind === 'page' ? 'Page' : null,
    item.overridden ? 'Edited' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(depth === 0 && 'rounded-lg bg-card p-1 ring-1 ring-card-border', isDragging && 'relative z-10')}
      data-nav-item={item.id}
    >
      <div
        className={cn(
          'group flex h-9 items-center gap-1.5 rounded-xs pr-1 pl-1 transition-colors hover:bg-muted',
          isDragging && 'bg-card shadow-md ring-1 ring-card-border',
          item.hidden && 'opacity-60',
        )}
      >
        <button
          type="button"
          ref={setActivatorNodeRef}
          aria-label={`Drag ${item.label} to reorder`}
          className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-xs text-muted-foreground hover:bg-muted"
          {...attributes}
          {...listeners}
        >
          <Icon name="grip-vertical" className="size-3.5" />
        </button>
        <span className="flex size-6 shrink-0 items-center justify-center text-muted-foreground">
          {item.icon ? <Icon name={item.icon} className="size-4" /> : null}
        </span>
        {editing ? (
          <Input
            autoFocus
            aria-label={`Name of ${item.label}`}
            className="h-7 flex-1"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                commit();
              }

              if (event.key === 'Escape') {
                setDraft(item.label);
                setEditing(false);
              }
            }}
          />
        ) : (
          <span className={cn('min-w-0 flex-1 truncate text-xs', isGroup ? 'font-semibold' : 'font-medium')}>
            {item.label}
          </span>
        )}
        {item.hidden ? <Badge variant="secondary">hidden</Badge> : null}
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Rename ${item.label}`}
          className="text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          onClick={() => {
            setDraft(item.label);
            setEditing(true);
          }}
        >
          <Icon name="pencil" className="size-3.5" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Move ${item.label} to…`}
                className="text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100"
              />
            }
          >
            <Icon name="more-horizontal" className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="font-normal">{origin}</DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Move to</DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuItem disabled={item.parentId === null} onClick={() => handlers.moveTo(item.id, null)}>
              Top level
            </DropdownMenuItem>
            {sections.map((section) => (
              <DropdownMenuItem
                key={section.id}
                disabled={item.parentId === section.id}
                onClick={() => handlers.moveTo(item.id, section.id)}
              >
                {section.label}
              </DropdownMenuItem>
            ))}
            {item.overridden ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => handlers.reset(item.id)}>
                  <Icon name="rotate-ccw" /> Reset to the module's
                </DropdownMenuItem>
              </>
            ) : null}
            {item.moduleId === null ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => handlers.remove(item.id)}>
                  <Icon name="trash-2" /> Remove from the sidebar
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`${item.hidden ? 'Show' : 'Hide'} ${item.label}`}
          className="text-muted-foreground"
          disabled={handlers.busy}
          onClick={() => handlers.setHidden(item.id, !item.hidden)}
        >
          <Icon name={item.hidden ? 'eye-off' : 'eye'} className="size-3.5" />
        </Button>
      </div>
      {children.length > 0 ? (
        <div className={cn('mt-0.5 ml-5 border-l border-border pl-1', depth > 3 && 'ml-2')}>
          <NavList parentId={item.id} items={children} depth={depth + 1} handlers={handlers} />
        </div>
      ) : null}
    </li>
  );
}

function NavList({
  parentId,
  items,
  depth,
  handlers,
}: {
  parentId: string | null;
  items: EffectiveNavItem[];
  depth: number;
  handlers: Handlers;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) {
      return;
    }

    const ids = items.map((item) => item.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));

    if (from < 0 || to < 0) {
      return;
    }

    handlers.reorder(parentId, arrayMove(ids, from, to));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[keepVertical]} onDragEnd={onDragEnd}>
      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        <ul className={cn('flex flex-col', depth === 0 ? 'gap-3' : 'gap-0.5')}>
          {items.map((item) => (
            <NavRow key={item.id} item={item} depth={depth} handlers={handlers} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function NavigationSettings() {
  const { schema } = useSchema();
  const client = useClient();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  // Pinned items stay where they are put by the module that pins them: they are not arranged here.
  const effective = useMemo(
    () => schema.navItems.filter((item) => !item.pinned).map(effectiveNavItem),
    [schema.navItems],
  );

  const known = useMemo(() => new Set(effective.map((item) => item.id)), [effective]);
  const childrenOf = (parentId: string | null): EffectiveNavItem[] =>
    effective
      .filter((item) =>
        parentId === null ? item.parentId === null || !known.has(item.parentId) : item.parentId === parentId,
      )
      .sort((a, b) => a.position - b.position || a.label.localeCompare(b.label));
  const descendantsOf = (id: string): Set<string> => {
    const out = new Set<string>([id]);

    for (const child of childrenOf(id)) {
      for (const nested of descendantsOf(child.id)) {
        out.add(nested);
      }
    }

    return out;
  };

  const run = async (change: () => Promise<unknown>) => {
    setBusy(true);

    try {
      await change();
      await queryClient.invalidateQueries({ queryKey: keys.schema(client.workspaceId) });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const handlers: Handlers = {
    childrenOf,
    raw: (id) => schema.navItems.find((item) => item.id === id),
    sectionsFor: (item) => {
      const below = descendantsOf(item.id);

      return effective
        .filter((candidate) => candidate.target.kind === 'group' && !below.has(candidate.id))
        .sort((a, b) => a.position - b.position);
    },
    reorder: (parentId, orderedIds) =>
      void run(() => client.metadata.navItems.arrange(orderedIds.map((id, position) => ({ id, parentId, position })))),
    rename: (id, label) => void run(() => client.metadata.navItems.update(id, { label })),
    setHidden: (id, hidden) => void run(() => client.metadata.navItems.update(id, { hidden })),
    moveTo: (id, parentId) =>
      void run(() => client.metadata.navItems.arrange([{ id, parentId, position: childrenOf(parentId).length }])),
    reset: (id) => void run(() => client.metadata.navItems.reset(id)),
    remove: (id) => void run(() => client.metadata.navItems.delete(id)),
    busy,
  };

  const top = childrenOf(null);

  if (top.length === 0) {
    return (
      <EmptyState
        icon="panel-left"
        title="Nothing in the sidebar yet"
        description="Install a module, or create an object, and its items show up here to arrange."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-xs text-muted-foreground">
          Drag items by their grip to put them in order; use the menu to move one into another section. Renaming and
          hiding a module's item is kept as your choice, and a module update leaves it be.
        </p>
        <Button variant="outline" size="sm" className="shrink-0" disabled={busy} onClick={() => setConfirmReset(true)}>
          <Icon name="rotate-ccw" className="size-3.5" /> Reset navigation
        </Button>
      </div>
      <NavList parentId={null} items={top} depth={0} handlers={handlers} />
      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Reset the navigation?</AlertDialogTitle>
            <AlertDialogDescription>
              Every rename, hidden item and move is dropped. Items you created yourself stay.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmReset(false);
                void run(() => client.metadata.navItems.resetAll());
              }}
            >
              Reset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export const navigationSection = defineSettingsSection({
  name: 'navigation',
  label: 'Navigation',
  icon: 'panel-left',
  group: 'workspace',
  requiresRole: 'admin',
  component: NavigationSettings,
});
