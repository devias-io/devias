import { TASK_PRIORITY_OPTIONS, type TaskPriority, type TaskQuery, type TaskSummary } from '@devias/core';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  EmptyState,
  Icon,
  Input,
  Page,
  PageHeader,
  Skeleton,
  ToggleGroup,
  ToggleGroupItem,
  UnderlineTabs,
} from '@devias/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SearchInput } from '../../components/search-input';
import { PriorityIcon } from '../../components/task-icons';
import { useCreateTask, useTaskCounts, useTasks } from '../../hooks/use-tasks';
import { browserStorage } from '../../lib/browser-storage';
import { useWorkspace } from '../../providers/workspace';
import { links } from '../../router/links';
import { useNavigation } from '../../router/navigation';
import { lanesOf, presetOf, TASK_PRESETS, TASK_STATUS_SCOPES, type TaskStatusScope } from './presets';
import { TaskBoard } from './task-board';
import { TaskRow } from './task-row';

type TasksView = 'list' | 'board';

const VIEW_KEY = 'devias.studio.tasks.view';
const PRESET_KEY = 'devias.studio.tasks.preset';
const SCOPE_KEY = 'devias.studio.tasks.scope';

const remembered = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
  try {
    const value = browserStorage('local')().getItem(key);

    return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
};

const remember = (key: string, value: string) => {
  try {
    browserStorage('local')().setItem(key, value);
  } catch {
    // a view that is not remembered is still a view
  }
};

/** Add a task by typing its title: it joins the list as `todo`, and is the person's own on "My tasks". */
function QuickCreate({ assignToMe }: { assignToMe: boolean }) {
  const { user } = useWorkspace();
  const create = useCreateTask();
  const [title, setTitle] = useState('');

  return (
    <form
      className="flex items-center gap-2 px-6 pb-3"
      onSubmit={(event) => {
        event.preventDefault();
        const text = title.trim();

        if (!text) {
          return;
        }

        create.mutate(
          { title: text, ...(assignToMe ? { assignee: `user:${user.id}` } : {}) },
          { onSuccess: () => setTitle('') },
        );
      }}
    >
      <Icon name="plus" className="size-4 text-muted-foreground" />
      <Input
        aria-label="Add a task"
        placeholder="Add a task and press Enter"
        className="h-8 border-none bg-transparent shadow-none focus-visible:ring-0"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
    </form>
  );
}

/** Which statuses to show: the same in the list and on the board. */
function StatusFilter({ value, onChange }: { value: TaskStatusScope; onChange: (next: TaskStatusScope) => void }) {
  const current = TASK_STATUS_SCOPES.find((option) => option.value === value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" aria-label="Status" />}>
        <Icon name="list-checks" />
        {current?.label ?? 'Status'}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuRadioGroup value={value} onValueChange={(next) => onChange(next as TaskStatusScope)}>
          {TASK_STATUS_SCOPES.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PriorityFilter({
  value,
  onChange,
}: {
  value: TaskPriority | '';
  onChange: (next: TaskPriority | '') => void;
}) {
  const current = TASK_PRIORITY_OPTIONS.find((option) => option.value === value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" aria-label="Priority" />}>
        {current ? <PriorityIcon priority={current.value} /> : <Icon name="sliders-horizontal" />}
        {current ? current.label : 'Priority'}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuRadioGroup value={value} onValueChange={(next) => onChange(next as TaskPriority | '')}>
          <DropdownMenuRadioItem value="">Any priority</DropdownMenuRadioItem>
          {TASK_PRIORITY_OPTIONS.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              <PriorityIcon priority={option.value} />
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TaskList({
  query,
  onOpen,
}: {
  query: Omit<TaskQuery, 'cursor' | 'limit'>;
  onOpen: (task: TaskSummary) => void;
}) {
  const result = useTasks(query);
  const tasks = result.data?.pages.flatMap((page) => page.items) ?? [];
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = result;
  useEffect(() => {
    const target = sentinel.current;

    if (!target || !hasNextPage || typeof IntersectionObserver === 'undefined') {
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && !isFetchingNextPage) {
        void fetchNextPage();
      }
    });
    observer.observe(target);

    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (result.isPending) {
    return (
      <div className="flex flex-col gap-1 px-6">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-10 rounded-md" />
        ))}
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <EmptyState
        icon="check-square"
        title={query.search ? 'No tasks match' : 'Nothing here'}
        description={query.search ? 'Try another word, or clear the search.' : 'Add a task above to get started.'}
      />
    );
  }

  return (
    <div data-slot="task-list" className="min-h-0 flex-1 overflow-y-auto">
      <ul className="divide-y divide-border/60 border-y border-border/60">
        {tasks.map((task) => (
          <li key={task.id}>
            <TaskRow task={task} onOpen={() => onOpen(task)} />
          </li>
        ))}
      </ul>
      {hasNextPage ? <div ref={sentinel} className="h-8" /> : null}
    </div>
  );
}

/** Work to do: a list or a board of tasks, in the presets people reach for, with a search and a priority filter. */
export function TasksPage() {
  const { slug } = useWorkspace();
  const navigation = useNavigation();
  const counts = useTaskCounts();
  const [presetId, setPresetId] = useState(() =>
    remembered(
      PRESET_KEY,
      TASK_PRESETS.map((preset) => preset.id),
      'open',
    ),
  );
  const [view, setView] = useState<TasksView>(() => remembered<TasksView>(VIEW_KEY, ['list', 'board'], 'list'));
  const [scope, setScope] = useState<TaskStatusScope>(() =>
    remembered<TaskStatusScope>(
      SCOPE_KEY,
      TASK_STATUS_SCOPES.map((option) => option.value),
      'open',
    ),
  );
  const [search, setSearch] = useState('');
  const [priority, setPriority] = useState<TaskPriority | ''>('');
  const preset = presetOf(presetId);
  const filters = useMemo(
    () => ({
      ...preset.query,
      ...(scope === 'all' ? {} : { scope }),
      // What closed lately first, unless the tab sorts by something of its own.
      ...(scope === 'closed' && !preset.query.sort ? { sort: 'closed' as const } : {}),
      ...(search ? { search } : {}),
      ...(priority ? { priority } : {}),
    }),
    [preset, scope, search, priority],
  );
  // A board gives each lane its own status, so the scope is the lanes drawn, not a filter on each.
  const boardFilters = useMemo(() => {
    const { scope: _scope, ...rest } = filters;

    return rest;
  }, [filters]);
  const lanes = lanesOf(scope);
  const open = useCallback((task: TaskSummary) => navigation.navigate(links.task(slug, task.id)), [navigation, slug]);

  return (
    <Page fullBleed>
      <div className="px-6 pt-4">
        <PageHeader
          title="Tasks"
          description="Work for people and agents. Type @ to mention a record, a document, a task or a person."
          actions={
            <>
              <SearchInput label="Search tasks" value={search} onChange={setSearch} />
              <StatusFilter
                value={scope}
                onChange={(next) => {
                  setScope(next);
                  remember(SCOPE_KEY, next);
                }}
              />
              <PriorityFilter value={priority} onChange={setPriority} />
              <ToggleGroup
                variant="outline"
                size="sm"
                aria-label="View"
                value={[view]}
                onValueChange={(next) => {
                  const chosen = next[0] as TasksView | undefined;

                  if (chosen) {
                    setView(chosen);
                    remember(VIEW_KEY, chosen);
                  }
                }}
              >
                <ToggleGroupItem value="list" aria-label="List">
                  <Icon name="list" />
                </ToggleGroupItem>
                <ToggleGroupItem value="board" aria-label="Board">
                  <Icon name="kanban" />
                </ToggleGroupItem>
              </ToggleGroup>
            </>
          }
        />
        <div className="border-b border-border/60">
          <UnderlineTabs
            aria-label="Tasks"
            value={presetId}
            onValueChange={(next) => {
              setPresetId(next);
              remember(PRESET_KEY, next);
            }}
            tabs={TASK_PRESETS.map((item) => ({
              id: item.id,
              label: item.label,
              ...(item.count && counts.data ? { count: counts.data[item.count] } : {}),
            }))}
          />
        </div>
      </div>
      <div className="pt-3" />
      <QuickCreate assignToMe={presetId === 'mine'} />
      {view === 'board' ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <TaskBoard filters={boardFilters} statuses={lanes} onOpen={open} />
        </div>
      ) : (
        <TaskList query={filters} onOpen={open} />
      )}
    </Page>
  );
}
