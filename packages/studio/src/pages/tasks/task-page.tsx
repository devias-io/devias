import { DeviasApiError, type Task, type TaskPatch } from '@devias/core';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Icon,
  Input,
  Page,
  Skeleton,
} from '@devias/ui';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDeleteDialog } from '../../components/confirm-delete-dialog';
import { TitleField } from '../../components/title-field';
import { RichTextEditor, type RichTextEditorHandle } from '../../editor';
import { useAutosave } from '../../hooks/use-autosave';
import { useCreateTask, useDeleteTask, useTask, useTasks, useUpdateTask } from '../../hooks/use-tasks';
import { useSetBreadcrumbs } from '../../providers/breadcrumbs';
import { useWorkspace } from '../../providers/workspace';
import { MentionedInList } from '../../record/blocks/mentioned-in';
import { saveStatusText } from '../../record/shells/column-shell';
import { links } from '../../router/links';
import { useNavigation } from '../../router/navigation';
import { UNTITLED_RECORD_LABEL } from '../../views/view-state';
import { AgentPanel } from './agent-panel';
import { TaskProperties } from './task-properties';
import { TaskRow } from './task-row';
import { TaskTimeline } from './task-timeline';

/** How long after typing stops a task's title or description saves. */
const SAVE_DELAY_MS = 3000;

/** A change was refused because the task moved on: the error carries `CONFLICT`. */
const isConflict = (error: unknown): boolean => error instanceof DeviasApiError && error.code === 'CONFLICT';

/** The subtasks of a task, with a line to add one. */
function Subtasks({ task, onOpen }: { task: Task; onOpen: (id: string) => void }) {
  const children = useTasks({ parent: task.id, sort: 'created', order: 'asc' });
  const create = useCreateTask();
  const [title, setTitle] = useState('');
  const items = children.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section data-slot="subtasks" className="flex flex-col gap-2">
      <h2 className="font-heading text-sub">Subtasks</h2>
      {items.length > 0 ? (
        <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
          {items.map((child) => (
            <li key={child.id}>
              <TaskRow task={child} onOpen={() => onOpen(child.id)} />
            </li>
          ))}
        </ul>
      ) : null}
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const text = title.trim();

          if (text) {
            create.mutate({ title: text, parent: task.id }, { onSuccess: () => setTitle('') });
          }
        }}
      >
        <Icon name="plus" className="size-4 text-muted-foreground" />
        <Input
          aria-label="Add a subtask"
          placeholder="Add a subtask"
          className="h-8 border-none bg-transparent shadow-none focus-visible:ring-0"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </form>
    </section>
  );
}

/**
 * One task, written in place: the title and description beside its properties, then its subtasks and its activity.
 * Title and description save together after typing stops, properties at once, each naming the version it was made
 * from; when someone else changed the task first the page says so and offers to load their version instead of
 * overwriting it. Mounted per task and per reload.
 */
function TaskEditor({ task, onReload }: { task: Task; onReload: () => void }) {
  const { slug } = useWorkspace();
  const navigation = useNavigation();
  const update = useUpdateTask(task.id);
  const remove = useDeleteTask();
  const newSubtask = useCreateTask();
  const [confirm, setConfirm] = useState(false);
  const [conflict, setConflict] = useState(false);
  const editor = useRef<RichTextEditorHandle | null>(null);
  // The version the page last saw or saved. A newer copy that arrives while the person is typing is not adopted, so
  // their next save is refused rather than overwriting it.
  const version = useRef(task.version);
  const typing = useRef(false);
  const lost = useRef(false);

  if (!typing.current && task.version > version.current) {
    version.current = task.version;
  }

  const save = async (patch: TaskPatch) => {
    if (lost.current) {
      throw new Error('This task changed elsewhere');
    }

    try {
      const saved = await update.mutateAsync({ ...patch, expectedVersion: version.current });
      version.current = saved.version;
    } catch (error) {
      if (isConflict(error)) {
        lost.current = true;
        setConflict(true);
      }

      throw error;
    }
  };
  const autosave = useAutosave((patch) => save(patch as TaskPatch), { delayMs: SAVE_DELAY_MS });
  useSetBreadcrumbs([{ label: 'Tasks', href: links.tasks(slug) }, { label: task.title || UNTITLED_RECORD_LABEL }]);
  const fresh = task.title === UNTITLED_RECORD_LABEL && task.version === 1;

  return (
    <Page fullBleed>
      <div
        data-slot="task-page"
        className="mx-auto grid min-h-full w-full max-w-6xl gap-x-12 px-6 pt-3 pb-16 sm:px-12 lg:grid-cols-[minmax(0,1fr)_17rem]"
        onFocusCapture={() => {
          typing.current = true;
        }}
        onBlurCapture={() => {
          typing.current = false;
        }}
      >
        <div className="flex min-w-0 flex-col gap-8 lg:col-span-2 lg:grid lg:grid-cols-subgrid">
          <div className="flex min-h-7 items-center justify-end gap-2 text-xs text-muted-foreground lg:col-span-2">
            <span aria-live="polite">{saveStatusText(autosave.status, task.updatedAt)}</span>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Task actions"
                    title="Actions"
                    className="text-muted-foreground"
                  />
                }
              >
                <Icon name="more-horizontal" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-44">
                <DropdownMenuItem
                  onClick={() => {
                    void navigator.clipboard
                      ?.writeText(window.location.href)
                      .then(() => toast.success('Link copied'))
                      .catch(() => toast.error('Could not copy'));
                  }}
                >
                  <Icon name="link" /> Copy link
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    void navigator.clipboard
                      ?.writeText(task.markdown)
                      .then(() => toast.success('Copied as Markdown'))
                      .catch(() => toast.error('Could not copy'));
                  }}
                >
                  <Icon name="file-text" /> Copy as Markdown
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    void newSubtask
                      .mutateAsync({ title: UNTITLED_RECORD_LABEL, parent: task.id })
                      .then((child) => navigation.navigate(links.task(slug, child.id)))
                  }
                >
                  <Icon name="plus" /> Add a subtask
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => setConfirm(true)}>
                  <Icon name="trash-2" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {conflict ? (
            <div
              role="alert"
              data-slot="task-conflict"
              className="flex items-center gap-3 rounded-md border border-border bg-muted/50 px-3 py-2 text-xs lg:col-span-2"
            >
              <Icon name="triangle-alert" className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex-1">This task changed elsewhere. Your latest edits were not saved.</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  autosave.discard();
                  onReload();
                }}
              >
                Load the latest
              </Button>
            </div>
          ) : null}
          <div className="flex min-w-0 flex-col gap-8">
            <div className="flex flex-col gap-4">
              <TitleField
                value={task.title}
                readOnly={false}
                className="text-2xl"
                selectOnMount={fresh}
                onChange={(title) => autosave.queue({ title }, SAVE_DELAY_MS)}
                onBlur={autosave.flush}
                onEnter={() => {
                  editor.current?.view.focus();
                  editor.current?.commands.focus('start');
                }}
              />
              <RichTextEditor
                variant="page"
                value={task.body}
                editorRef={editor}
                onChange={(body) => autosave.queue({ body }, SAVE_DELAY_MS)}
                onBlur={autosave.flush}
              />
            </div>
            <Subtasks task={task} onOpen={(id) => navigation.navigate(links.task(slug, id))} />
            <MentionedInList target={{ kind: 'task', id: task.id }} />
            <TaskTimeline taskId={task.id} />
          </div>
          <aside className="flex min-w-0 flex-col gap-6 lg:pt-1" aria-label="Properties">
            <AgentPanel task={task} />
            <TaskProperties
              task={task}
              disabled={conflict}
              onChange={(patch) => {
                // Properties save at once; what is typed saves with it, so nothing is saved out of order.
                autosave.flush();
                void save(patch).catch((error) => {
                  if (!isConflict(error)) {
                    toast.error(error instanceof Error ? error.message : 'Could not save');
                  }
                });
              }}
            />
          </aside>
        </div>
      </div>
      <ConfirmDeleteDialog
        noun="task"
        open={confirm}
        onOpenChange={setConfirm}
        onConfirm={async () => {
          setConfirm(false);
          autosave.discard();
          lost.current = true;
          await remove.mutateAsync(task.id);
          navigation.navigate(links.tasks(slug));
        }}
      />
    </Page>
  );
}

/** `/tasks/:taskId`. */
export function TaskPage() {
  const { params, navigate } = useNavigation();
  const { slug } = useWorkspace();
  const id = params.taskId ?? '';
  const query = useTask(id);
  // Loading the latest remounts the editor, so it starts from what the server has.
  const [epoch, setEpoch] = useState(0);

  if (query.isPending) {
    return (
      <Page className="mx-auto w-full max-w-6xl px-6 pt-8 sm:px-12">
        <Skeleton className="mb-8 h-12 w-80" />
        <Skeleton className="h-64 w-full" />
      </Page>
    );
  }

  if (query.isError || !query.data) {
    return (
      <EmptyState
        icon="circle-help"
        title="Task not found"
        description="It may have been deleted."
        action={
          <Button size="lg" variant="outline" onClick={() => navigate(links.tasks(slug))}>
            Back to tasks
          </Button>
        }
      />
    );
  }

  return (
    <TaskEditor
      key={`${query.data.id}:${epoch}`}
      task={query.data}
      onReload={() => void query.refetch().then(() => setEpoch((n) => n + 1))}
    />
  );
}
