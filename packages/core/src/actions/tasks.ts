import { z } from 'zod';
import { coreIds } from '../core-ids';
import {
  TaskActivityEntrySchema,
  TaskActivityPageSchema,
  TaskActivityQuerySchema,
  TaskCommentSchema,
  TaskCountsQuerySchema,
  TaskCountsSchema,
  TaskInputSchema,
  TaskPageSchema,
  TaskPatchSchema,
  TaskQuerySchema,
  TaskRunPageSchema,
  TaskSchema,
} from '../task';
import { defineActionSpec } from './define';

const tags = ['tasks'];
const IdParams = z.object({ id: z.string() });

export const taskActions = {
  list: defineActionSpec({
    id: coreIds.actions.list_tasks,
    ai: {
      tool: 'list_tasks',
      description:
        'List tasks, most recently changed first, with their status, priority, assignee and due date but not their text. Filter with `scope` (open or closed), `status`, `assignee` (me, unassigned, agents, people, user:<id> or agent:<id>), `priority`, `due` (overdue, today, week or none), `parent` (the subtasks of a task, or none for top-level tasks), `mentions` (tasks that mention or are about a record, document or task: a link such as record:<object>/<id>) and `search` (title and text). Read one with get_task. Page with nextCursor.',
    },
    summary: 'List tasks',
    description:
      'Most recently changed first, without their text; page with `nextCursor`. `assignee` is `me`, `unassigned`, `agents`, `people`, `user:<id>` or `agent:<id>`; `scope` is `open` or `closed`; `due` is `overdue`, `today`, `week` or `none`; `parent` keeps the subtasks of a task (or `none` for top-level tasks); `mentions` keeps the tasks that mention or are about a record, a document or a task (`record:<object>/<id>`, `document:<id>`, `task:<id>`); `search` matches the title and the description.',
    tags,
    permission: 'task.read',
    query: TaskQuerySchema,
    output: TaskPageSchema,
    http: {
      method: 'get',
      path: '/api/workspaces/{workspaceId}/tasks',
      errors: [400, 401, 403, 409],
      outputDescription: 'A page of tasks',
    },
  }),
  create: defineActionSpec({
    id: coreIds.actions.create_task,
    ai: {
      tool: 'create_task',
      description:
        'Create a task with a title and, optionally, a description as Markdown, a priority (urgent, high, medium, low or none), a dueDate (YYYY-MM-DD), an assignee, a parent task (to make it a subtask) and what it is about. Mention a record, a document, a task or a person with a link, [Label](record:<object>/<id>), [Label](document:<id>), [Label](task:<id>) or [Name](member:<userId>); each becomes a live @mention. Pass a `key` to make creating safe to repeat. Returns the new task; call navigate afterwards if the person should see it.',
    },
    summary: 'Create a task',
    description:
      'A title and, optionally, the description as `markdown` (or as an editor document in `body`), `priority`, `dueDate` (`YYYY-MM-DD`), an `assignee` (`user:<id>`, `agent:<id>`), a `parent` task and what it is `about` (`record:<object>/<id>`, `document:<id>`). Mention a record, a document, a task or a member with a link: `[Label](record:<object>/<id>)`, `[Label](document:<id>)`, `[Label](task:<id>)`, `[Name](member:<userId>)`. The same `key` twice returns the first task instead of making another.',
    tags,
    permission: 'task.write',
    approval: 'auto',
    body: TaskInputSchema,
    output: TaskSchema,
    http: {
      method: 'post',
      path: '/api/workspaces/{workspaceId}/tasks',
      status: 201,
      errors: [400, 401, 403, 404],
      bodyDescription: 'The task: a title and, optionally, its description, assignee and links',
      outputDescription: 'Created',
    },
  }),
  get: defineActionSpec({
    id: coreIds.actions.get_task,
    ai: {
      tool: 'get_task',
      description:
        'Read one task: its title, status, priority, assignee, due date, its whole description as Markdown (mentions are links such as [Label](record:<object>/<id>)), what it mentions and is about, its subtask counts and its version. Read a task before changing it, and pass the version as expectedVersion.',
    },
    summary: 'Get a task',
    description:
      'The whole task: its description as an editor document (`body`) and as Markdown, what it mentions and is about, its subtask counts and its `version`.',
    tags,
    permission: 'task.read',
    params: IdParams,
    output: TaskSchema,
    http: { method: 'get', path: '/api/workspaces/{workspaceId}/tasks/{id}', outputDescription: 'The task' },
  }),
  update: defineActionSpec({
    id: coreIds.actions.update_task,
    ai: {
      tool: 'update_task',
      description:
        'Change a task: its title, description (`markdown` replaces the whole text), status, priority, dueDate, assignee (null to unassign), parent or what it is about. Send only what changes. Read the task first with get_task and pass its version as expectedVersion, so a change made meanwhile is not lost. To say something about a task without changing it, use comment_on_task.',
    },
    summary: 'Update a task',
    description:
      'Sends only what changes. A new `body` or `markdown` replaces the whole description. With `expectedVersion`, a task that changed since is a `CONFLICT`; without it the change overwrites.  Moving a task to `done` or `canceled` closes it; any other status reopens it.',
    tags,
    permission: 'task.write',
    approval: 'auto',
    params: IdParams,
    body: TaskPatchSchema,
    output: TaskSchema,
    http: {
      method: 'patch',
      path: '/api/workspaces/{workspaceId}/tasks/{id}',
      errors: [400, 401, 403, 404, 409],
      outputDescription: 'Updated',
    },
  }),
  delete: defineActionSpec({
    id: coreIds.actions.delete_task,
    ai: {
      tool: 'delete_task',
      description: 'Delete a task and its subtasks. They stop being listed, readable and linked.',
    },
    summary: 'Delete a task',
    description: 'The task and its subtasks stop being listed, readable and linked.',
    tags,
    permission: 'task.write',
    params: IdParams,
    http: { method: 'delete', path: '/api/workspaces/{workspaceId}/tasks/{id}', outputDescription: 'Deleted' },
  }),
  listActivity: defineActionSpec({
    id: coreIds.actions.list_task_activity,
    ai: { tool: 'list_task_activity' },
    summary: 'List a task’s timeline',
    description: 'Comments, changes and agent runs of one task, newest first; page with `nextCursor`.',
    tags,
    permission: 'task.read',
    params: IdParams,
    query: TaskActivityQuerySchema,
    output: TaskActivityPageSchema,
    http: {
      method: 'get',
      path: '/api/workspaces/{workspaceId}/tasks/{id}/activity',
      errors: [400, 401, 403, 404],
      outputDescription: 'A page of the timeline',
    },
  }),
  comment: defineActionSpec({
    id: coreIds.actions.comment_on_task,
    ai: {
      tool: 'comment_on_task',
      description:
        'Add a comment to a task’s timeline, as Markdown: a question, a finding or a status note. It does not change the task. Mention a record or a person with [Label](record:<object>/<id>) or [Name](member:<userId>).',
    },
    summary: 'Comment on a task',
    description:
      'Adds a comment to the task’s timeline as Markdown; mention with `[Label](record:<object>/<id>)` or `[Name](member:<userId>)`. A comment does not change the task’s version.',
    tags,
    permission: 'task.write',
    approval: 'auto',
    params: IdParams,
    body: TaskCommentSchema,
    output: TaskActivityEntrySchema,
    http: {
      method: 'post',
      path: '/api/workspaces/{workspaceId}/tasks/{id}/comments',
      status: 201,
      errors: [400, 401, 403, 404],
      bodyDescription: 'The comment, as Markdown',
      outputDescription: 'The comment, as a timeline entry',
    },
  }),
  listRuns: defineActionSpec({
    id: coreIds.actions.list_task_runs,
    ai: { tool: 'list_task_runs' },
    summary: 'List the runs of a task',
    description: 'The attempts an agent made at the task, newest first: status, summary and error.',
    tags,
    permission: 'task.read',
    params: IdParams,
    output: TaskRunPageSchema,
    http: {
      method: 'get',
      path: '/api/workspaces/{workspaceId}/tasks/{id}/runs',
      errors: [401, 403, 404],
      outputDescription: 'The runs',
    },
  }),
  stop: defineActionSpec({
    id: coreIds.actions.stop_task_run,
    ai: { tool: 'stop_task_run' },
    summary: 'Stop an agent working on a task',
    description:
      'Cancels the run in progress, declines what it proposed and marks the task as failed until someone retries it.',
    tags,
    permission: 'task.control',
    locked: true,
    sessionOnly: true,
    params: IdParams,
    output: TaskSchema,
    http: {
      method: 'post',
      path: '/api/workspaces/{workspaceId}/tasks/{id}/stop',
      status: 200,
      errors: [401, 403, 404],
      outputDescription: 'The task',
    },
  }),
  retry: defineActionSpec({
    id: coreIds.actions.retry_task,
    ai: { tool: 'retry_task' },
    summary: 'Retry a task',
    description: 'Puts a failed or stopped task back in the agent’s queue.',
    tags,
    permission: 'task.control',
    locked: true,
    sessionOnly: true,
    params: IdParams,
    output: TaskSchema,
    http: {
      method: 'post',
      path: '/api/workspaces/{workspaceId}/tasks/{id}/retry',
      status: 200,
      errors: [401, 403, 404, 409],
      outputDescription: 'The task',
    },
  }),
  counts: defineActionSpec({
    id: coreIds.actions.get_task_counts,
    ai: { tool: 'get_task_counts' },
    summary: 'Count tasks',
    description: 'Open, overdue, due today and this week, in review, the caller’s own and by status.',
    tags,
    permission: 'task.read',
    query: TaskCountsQuerySchema,
    output: TaskCountsSchema,
    http: {
      method: 'get',
      path: '/api/workspaces/{workspaceId}/tasks/counts',
      errors: [400, 401, 403],
      outputDescription: 'Counts',
    },
  }),
};
