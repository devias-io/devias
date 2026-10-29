import {
  coreIds,
  linkHref,
  TASK_ABOUT_MAX,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TITLE_MAX_LENGTH,
  type Task,
  TaskQuerySchema,
  type TaskSummary,
} from '@devias/core';
import { z } from 'zod';
import { rewriteWarning, withWarnings } from '../helpers';
import { carrying, type ToolAdapters } from './types';

const linkOf = (id: string) => linkHref({ kind: 'task', id });

const TaskId = z.string().min(1).describe('Task id');
const Title = z.string().trim().min(1).max(TASK_TITLE_MAX_LENGTH);
const Markdown = z.string().max(200_000).describe('The description, as Markdown');
const Assignee = z
  .string()
  .min(1)
  .max(200)
  .describe('`user:<userId>` (a person: take the id from list_members), `agent:<agentId>` or a bare user id');
const About = z
  .array(z.string().min(1).max(300))
  .max(TASK_ABOUT_MAX)
  .describe('What the task is about: links such as record:<object>/<id>, document:<id>, task:<id> or asset:<id>');
const DueDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/** A task in a list: what the model needs to pick one, never its description. */
const summaryOf = (task: TaskSummary) => ({
  id: task.id,
  title: task.title,
  status: task.status,
  priority: task.priority,
  assignee: task.assignee,
  dueDate: task.dueDate,
  parentId: task.parentId,
  subtasks: task.subtasks,
  ...(task.work ? { work: task.work } : {}),
  version: task.version,
  updatedAt: task.updatedAt,
  link: linkOf(task.id),
});

/** A task as the model reads it: its description as Markdown, never the editor's JSON. */
const shapeTask = (task: Task) => ({
  ...summaryOf(task),
  markdown: task.markdown,
  links: task.links,
  createdAt: task.createdAt,
  closedAt: task.closedAt,
});

const IdOnly = z.object({ id: TaskId });

/** The model reads and writes tasks as Markdown, with a link back; the actions do the work. */
export const taskAdapters: ToolAdapters = {
  [coreIds.actions.list_tasks]: {
    input: TaskQuerySchema.pick({
      search: true,
      scope: true,
      status: true,
      assignee: true,
      priority: true,
      due: true,
      parent: true,
      mentions: true,
      sort: true,
      cursor: true,
      limit: true,
    }),
    shape: (page) => ({
      tasks: page.items.map(summaryOf),
      total: page.total,
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    }),
  },
  [coreIds.actions.get_task]: { input: IdOnly, shape: shapeTask },
  [coreIds.actions.create_task]: {
    input: z.object({
      title: Title,
      markdown: Markdown.optional(),
      status: z.enum(TASK_STATUSES).optional(),
      priority: z.enum(TASK_PRIORITIES).optional(),
      dueDate: DueDate.optional(),
      assignee: Assignee.optional(),
      parent: z.string().min(1).optional().describe('The id of the task this is a subtask of'),
      about: About.optional(),
      key: z.string().trim().min(1).max(200).optional().describe('Creating twice with the same key makes one task'),
    }),
    shape: (task) => ({ created: true, ...shapeTask(task) }),
  },
  [coreIds.actions.update_task]: {
    input: z
      .object({
        id: TaskId,
        title: Title.optional(),
        markdown: Markdown.optional(),
        status: z.enum(TASK_STATUSES).optional(),
        priority: z.enum(TASK_PRIORITIES).optional(),
        dueDate: DueDate.nullable().optional(),
        assignee: Assignee.nullable().optional(),
        parent: z.string().min(1).nullable().optional(),
        about: About.optional(),
        expectedVersion: z.number().int().min(1).optional().describe('The version you read; a newer one is a conflict'),
      })
      .refine(
        (input) =>
          Object.entries(input).some(
            ([key, value]) => key !== 'id' && key !== 'expectedVersion' && value !== undefined,
          ),
        'Nothing to change',
      ),
    // Replacing the description goes through Markdown: say what the task held that Markdown cannot carry.
    toAction: async (input, { read }) => {
      const current =
        input.markdown === undefined
          ? null
          : ((await read(coreIds.actions.get_task, { id: input.id }).catch(() => null)) as Task | null);
      const warning = current ? rewriteWarning('description of the task', current.body) : null;

      return carrying(input, warning ? [warning] : []);
    },
    shape: (task, _input, _context, warnings: string[]) =>
      withWarnings({ updated: true, ...shapeTask(task) }, warnings),
  },
  [coreIds.actions.comment_on_task]: {
    input: z.object({
      id: TaskId,
      markdown: z.string().trim().min(1).max(20_000).describe('The comment, as Markdown'),
    }),
    shape: (entry, { id }) => ({ commented: true, id: entry.id, taskId: id, link: linkOf(id) }),
  },
  [coreIds.actions.delete_task]: {
    input: IdOnly,
    shape: (_output, { id }) => ({ deleted: true, id }),
  },
};
