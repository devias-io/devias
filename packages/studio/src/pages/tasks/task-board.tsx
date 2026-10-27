import { DeviasApiError, TASK_STATUS_OPTIONS, type TaskQuery, type TaskStatus, type TaskSummary } from '@devias/core';
import { Button, cn, Skeleton } from '@devias/ui';
import {
  closestCorners,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { StatusIcon } from '../../components/task-icons';
import { errorMessage } from '../../hooks/use-mutations';
import { useTasks, useUpdateAnyTask } from '../../hooks/use-tasks';
import { useClient } from '../../providers/client';
import { keys } from '../../query/keys';
import { UNTITLED_RECORD_LABEL } from '../../views/view-state';
import { TaskFacts } from './task-row';

const LANE_PAGE = 25;

type LaneFilters = Omit<TaskQuery, 'cursor' | 'limit' | 'status' | 'scope'>;

function BoardCard({ task, className }: { task: TaskSummary; className?: string }) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-xs shadow-xs transition-colors hover:border-strong-border',
        className,
      )}
    >
      <span className="line-clamp-2 leading-snug font-medium">{task.title || UNTITLED_RECORD_LABEL}</span>
      <div className="flex items-center justify-end gap-2.5">
        <TaskFacts task={task} />
      </div>
    </div>
  );
}

function DraggableCard({ task, onOpen }: { task: TaskSummary; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id, data: { task } });

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: dnd-kit's attributes add role="button" and tabIndex
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      data-slot="board-card"
      className={cn(
        'cursor-grab outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
        isDragging && 'opacity-40',
      )}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          onOpen();
        }
      }}
    >
      <BoardCard task={task} />
    </div>
  );
}

function Lane({
  status,
  label,
  filters,
  pending,
  onOpen,
}: {
  status: TaskStatus;
  label: string;
  filters: LaneFilters;
  pending: Map<string, { task: TaskSummary; status: TaskStatus }>;
  onOpen: (task: TaskSummary) => void;
}) {
  const query = useTasks({ ...filters, status, sort: filters.sort ?? 'priority' }, LANE_PAGE);
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const items = useMemo(() => {
    const loaded = query.data?.pages.flatMap((page) => page.items) ?? [];
    const own = loaded.filter((task) => {
      const move = pending.get(task.id);

      return !move || move.status === status;
    });
    const incoming = [...pending.values()]
      .filter((move) => move.status === status && !loaded.some((task) => task.id === move.task.id))
      .map((move) => ({ ...move.task, status }));

    return [...incoming, ...own];
  }, [query.data, pending, status]);
  const total = query.data?.pages[0]?.total;

  return (
    <section
      ref={setNodeRef}
      data-slot="board-lane"
      data-status={status}
      aria-label={label}
      className={cn(
        'flex w-72 shrink-0 flex-col gap-2 rounded-xl bg-muted/40 p-2 transition-colors',
        isOver && 'bg-accent/60',
      )}
    >
      <header className="flex items-center gap-2 px-1.5 pt-1 text-xs font-medium">
        <StatusIcon status={status} />
        <span>{label}</span>
        <span className="text-muted-foreground">{total ?? ''}</span>
      </header>
      <div className="flex min-h-12 flex-col gap-2">
        {query.isPending ? <Skeleton className="h-16 rounded-lg" /> : null}
        {items.map((task) => (
          <DraggableCard key={task.id} task={task} onOpen={() => onOpen(task)} />
        ))}
        {query.hasNextPage ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            Show more
          </Button>
        ) : null}
      </div>
    </section>
  );
}

/** A status the board does not draw as a lane, offered while a card is dragged so it can still be moved there. */
function DropTarget({ status, label }: { status: TaskStatus; label: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div
      ref={setNodeRef}
      data-slot="board-drop-target"
      data-status={status}
      className={cn(
        'flex min-h-16 flex-1 items-center justify-center gap-2 rounded-xl border border-dashed border-border text-xs text-muted-foreground transition-colors',
        isOver && 'border-strong-border bg-accent/60 text-foreground',
      )}
    >
      <StatusIcon status={status} />
      {label}
    </div>
  );
}

/**
 * The lanes of the statuses asked for (every status when none are), tasks dragged between them. The statuses left
 * out show as drop targets while a card is dragged, so it can still be completed or reopened.  tasks dragged between them. A move shows at once and is saved with the version the card was
 * read at: when someone else moved or changed the task first the card goes back and the person is told.
 */
export function TaskBoard({
  filters,
  statuses,
  onOpen,
}: {
  filters: LaneFilters;
  /** The lanes to draw, in order; every status when left out. The others are drop targets while dragging. */
  statuses?: readonly TaskStatus[];
  onOpen: (task: TaskSummary) => void;
}) {
  const client = useClient();
  const queryClient = useQueryClient();
  const update = useUpdateAnyTask();
  const [pending, setPending] = useState<Map<string, { task: TaskSummary; status: TaskStatus }>>(new Map());
  const [dragging, setDragging] = useState<TaskSummary | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const settle = (id: string) =>
    setPending((current) => {
      const next = new Map(current);
      next.delete(id);

      return next;
    });
  const onDragEnd = async (event: DragEndEvent) => {
    setDragging(null);
    const task = event.active.data.current?.task as TaskSummary | undefined;
    const status = event.over?.id as TaskStatus | undefined;

    if (!task || !status || status === task.status) {
      return;
    }

    setPending((current) => new Map(current).set(task.id, { task, status }));

    try {
      await update.mutateAsync({ id: task.id, patch: { status, expectedVersion: task.version } });
    } catch (error) {
      if (error instanceof DeviasApiError && error.code === 'CONFLICT') {
        toast.error('Someone else changed that task. It has been refreshed.');
      } else {
        toast.error(errorMessage(error));
      }
    } finally {
      await queryClient.invalidateQueries({ queryKey: keys.tasks(client.workspaceId) });
      settle(task.id);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={(event) => setDragging((event.active.data.current?.task as TaskSummary | undefined) ?? null)}
      onDragCancel={() => setDragging(null)}
      onDragEnd={(event) => void onDragEnd(event)}
    >
      <div data-slot="task-board" className="flex h-full min-h-0 gap-3 overflow-x-auto px-6 pb-6">
        {TASK_STATUS_OPTIONS.filter((option) => !statuses || statuses.includes(option.value)).map((option) => (
          <Lane
            key={option.value}
            status={option.value}
            label={option.label}
            filters={filters}
            pending={pending}
            onOpen={onOpen}
          />
        ))}
        {dragging && statuses && statuses.length < TASK_STATUS_OPTIONS.length ? (
          <div className="flex w-56 shrink-0 flex-col gap-2">
            {TASK_STATUS_OPTIONS.filter((option) => !statuses.includes(option.value)).map((option) => (
              <DropTarget key={option.value} status={option.value} label={option.label} />
            ))}
          </div>
        ) : null}
      </div>
      <DragOverlay>{dragging ? <BoardCard task={dragging} className="shadow-lg" /> : null}</DragOverlay>
    </DndContext>
  );
}
