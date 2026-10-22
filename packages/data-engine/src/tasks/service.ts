import {
  type Actor,
  type Assignee,
  assigneeRef,
  CLOSED_TASK_STATUSES,
  decodeTaskCursor,
  encodeTaskCursor,
  isTaskClosed,
  listOf,
  newId,
  parseAssigneeRef,
  parseLink,
  personOf,
  plainText,
  type RichTextDoc,
  richTextToMarkdown,
  type SchemaIndex,
  TASK_IDS_MAX,
  TASK_MAX_DEPTH,
  TASK_PRIORITIES,
  TASK_PRIORITY_RANK,
  TASK_SORT_DEFAULT_ORDER,
  TASK_STATUSES,
  TASK_TIMELINE_ACTIONS,
  TASK_WORK_STATES,
  TASKS_DEFAULT_LIMIT,
  type Task,
  type TaskActivityEntry,
  type TaskActivityPage,
  type TaskActivityQuery,
  type TaskChange,
  type TaskComment,
  TaskCommentSchema,
  type TaskCounts,
  type TaskCountsQuery,
  TaskCountsQuerySchema,
  type TaskInput,
  TaskInputSchema,
  type TaskLink,
  type TaskPage,
  type TaskPatch,
  TaskPatchSchema,
  type TaskPriority,
  type TaskQuery,
  TaskQuerySchema,
  type TaskSort,
  type TaskStatus,
  type TaskSummary,
  type TaskWorkState,
} from '@devias/core';
import { type SQL, sql } from 'drizzle-orm';
import type { EngineContext } from '../context';
import { type Db, parseJson, runRaw, toIso, toNumber } from '../db/exec';
import { EngineError, fromZodError, notFound, validationError } from '../errors';
import type { EventBus } from '../events/bus';
import { type EventDraft, inEventTransaction } from '../events/transaction';
import { type IndexedLink, indexedLinkOf, indexedLinksOf, linkTextOf, replaceMentions, UUID } from '../links';
import type { MetadataService } from '../metadata/service';
import { authorize } from '../permissions/policy';
import { checkedRichText, richTextOf, richTextOrEmpty } from '../rich-text';
import { insertComment, listTimeline, type TimelineRow } from '../timeline';

/** Whether an assignee exists in the workspace: a member for a person, an agent that is not archived. */
export interface AssigneePort {
  exists(ctx: EngineContext, assignee: Assignee): Promise<boolean>;
}

export interface TaskService {
  list(ctx: EngineContext, query?: TaskQuery): Promise<TaskPage>;
  get(ctx: EngineContext, id: string): Promise<Task>;
  create(ctx: EngineContext, input: TaskInput): Promise<Task>;
  update(ctx: EngineContext, id: string, patch: TaskPatch): Promise<Task>;
  /** The task and its subtasks stop being listed, readable and linked. */
  delete(ctx: EngineContext, id: string): Promise<void>;
  /** A task's timeline, newest first. */
  activity(ctx: EngineContext, id: string, query?: TaskActivityQuery): Promise<TaskActivityPage>;
  comment(ctx: EngineContext, id: string, input: TaskComment): Promise<TaskActivityEntry>;
  counts(ctx: EngineContext, query?: TaskCountsQuery): Promise<TaskCounts>;
  /**
   * The next task an agent that takes tasks can start, claimed for it: the most urgent, then the soonest due, then the
   * oldest, `todo`, assigned to one of `agentIds` that has nothing in hand. The platform only (the runner).
   */
  claimNext(ctx: EngineContext, agentIds: string[]): Promise<TaskClaim | null>;
  /** The run of a task ended: a task whose run is still its own goes to review, or is marked failed. The platform only. */
  endRun(ctx: EngineContext, taskId: string, runId: string, result: TaskRunResult): Promise<void>;
  /** Whether the agent is waiting for a person (to approve or answer) or working again. The platform only. */
  setWaiting(ctx: EngineContext, taskId: string, runId: string, waiting: boolean): Promise<void>;
  /** The agent hands its task in for review with what it did; only inside the run of that task. */
  finish(ctx: EngineContext, id: string, input: { summary: string }): Promise<Task>;
  /** A person stops the agent working a task: its run is dropped and the task waits as failed until retried. */
  stop(ctx: EngineContext, id: string): Promise<Task>;
  /** A person puts a failed or stopped task back in the agent's queue, acting for them from now on. */
  retry(ctx: EngineContext, id: string): Promise<Task>;
  /** Who a task may be assigned to is the directory's to say; the server binds it once the directory exists. */
  bindAssignees(port: AssigneePort): void;
}

/** A task the runner took from an agent's queue. */
export interface TaskClaim {
  task: Task;
  runId: string;
  attempt: number;
  /** Who gave the task to the agent: the agent acts for the person behind them, if any. */
  requestedBy: Actor;
}

export type TaskRunResult = { outcome: 'completed'; summary: string | null } | { outcome: 'failed'; error: string };

export interface TaskServiceDeps {
  db: Db;
  metadata: MetadataService;
  bus: EventBus;
  clock: () => Date;
}

interface TaskRow extends Record<string, unknown> {
  id: string;
  title: string;
  description?: unknown;
  status: string;
  priority: string;
  assignee_kind: string | null;
  assignee_id: string | null;
  due_date: string | null;
  parent_id: string | null;
  depth: unknown;
  root_id: string | null;
  work: string | null;
  queued_at: unknown;
  version: unknown;
  created_by: unknown;
  updated_by: unknown;
  created_at: unknown;
  updated_at: unknown;
  status_changed_at: unknown;
  closed_at: unknown;
  sub_total: unknown;
  sub_open: unknown;
  sort_key?: string;
}

/** What each line of agent work is called on the timeline. */
const RUN_OUTCOME: Record<string, string> = {
  run_started: 'started',
  handed_in: 'in_review',
  run_failed: 'failed',
  run_stopped: 'stopped',
  run_retried: 'retried',
};

const CLOSED = sql.join(
  CLOSED_TASK_STATUSES.map((status) => sql`${status}`),
  sql`, `,
);

const SUMMARY_COLUMNS = sql.raw(
  `t.id, t.title, t.status, t.priority, t.assignee_kind, t.assignee_id, t.due_date::text AS due_date, t.parent_id, t.depth, t.root_id, t.work, t.run_id, t.queued_at, t.version,
   t.created_by, t.updated_by, t.created_at, t.updated_at, t.status_changed_at, t.closed_at,
   (SELECT count(*) FROM task c WHERE c.parent_id = t.id AND c.deleted_at IS NULL) AS sub_total,
   (SELECT count(*) FROM task c WHERE c.parent_id = t.id AND c.deleted_at IS NULL AND c.status NOT IN ('done', 'canceled')) AS sub_open`,
);
const FULL_COLUMNS = sql`${SUMMARY_COLUMNS}, t.description`;

const assertUuid = (id: string, what: string) => {
  if (!UUID.test(id)) {
    throw new EngineError('VALIDATION', `Invalid ${what} id "${id}"`, { id });
  }
};

const assertDate = (value: string, path: string) => {
  const date = new Date(`${value}T00:00:00Z`);

  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw validationError(`"${value}" is not a date`, { path });
  }
};

const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (m) => `\\${m}`);

/** The members of a comma-separated query value, each one of `allowed`. */
const oneOf = <T extends string>(value: string | undefined, allowed: readonly T[], path: string): T[] => {
  const items = listOf(value);

  for (const item of items) {
    if (!(allowed as readonly string[]).includes(item)) {
      throw validationError(`"${item}" is not one of ${allowed.join(', ')}`, { path });
    }
  }

  return items as T[];
};

const inList = (values: string[]): SQL =>
  sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  );

/**
 * The sort key of each sort, as a column that is never null (so a keyset cursor can compare it) and the type it casts
 * back to. Tasks without a value (no due date, not closed) sort last in either direction.
 */
const SORT_KEYS: Record<TaskSort, (order: 'asc' | 'desc') => { expr: string; cast: string }> = {
  updated: () => ({ expr: 't.updated_at', cast: 'timestamptz' }),
  created: () => ({ expr: 't.created_at', cast: 'timestamptz' }),
  due: (order) => ({ expr: `COALESCE(t.due_date, '${order === 'asc' ? '' : '-'}infinity'::date)`, cast: 'date' }),
  priority: () => ({ expr: 't.priority_rank', cast: 'int' }),
  closed: (order) => ({
    expr: `COALESCE(t.closed_at, '${order === 'asc' ? '' : '-'}infinity'::timestamptz)`,
    cast: 'timestamptz',
  }),
  title: () => ({ expr: 't.title', cast: 'text' }),
};

/** Whether the queue of agents would pick this task up: assigned to an agent, `todo` and not being worked. */
const queueable = (state: { status: string; assigneeKind: string | null; work: string | null }): boolean =>
  state.status === 'todo' && state.assigneeKind === 'agent' && state.work === null;

/**
 * Tasks: work handed between people and agents, in tables of their own. Everything that reads or writes them goes
 * through here, so who may see which task and how a task moves are decided in one place (`visible`; every member sees
 * every task for now).
 */
export const createTaskService = (deps: TaskServiceDeps): TaskService => {
  const { db, metadata, bus, clock } = deps;
  let assignees: AssigneePort | undefined;

  /** The rows `ctx` may see. Tasks are workspace-wide today; per-task access narrows this and nothing else. */
  const visible = (_ctx: EngineContext): SQL => sql`TRUE`;

  const assigneeOf = (row: Pick<TaskRow, 'assignee_kind' | 'assignee_id'>): string | null =>
    row.assignee_kind && row.assignee_id ? `${row.assignee_kind}:${row.assignee_id}` : null;

  const toSummary = (row: TaskRow): TaskSummary => ({
    id: row.id,
    title: row.title,
    status: row.status as TaskStatus,
    priority: row.priority as TaskPriority,
    assignee: assigneeOf(row),
    dueDate: row.due_date,
    parentId: row.parent_id,
    subtasks: { total: toNumber(row.sub_total), open: toNumber(row.sub_open) },
    work: row.work as TaskWorkState | null,
    runId: (row.run_id as string | null | undefined) ?? null,
    version: toNumber(row.version),
    createdBy: parseJson<Actor>(row.created_by),
    updatedBy: parseJson<Actor>(row.updated_by),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    statusChangedAt: toIso(row.status_changed_at),
    closedAt: row.closed_at === null ? null : toIso(row.closed_at),
  });

  /** A line of a task's timeline, from the event that made it or the comment. */
  const toActivity = (taskId: string, row: TimelineRow): TaskActivityEntry => {
    const base = { id: row.id, taskId, actor: row.actor, cause: row.cause, createdAt: row.at };

    if (row.source === 'comment') {
      return { ...base, kind: 'comment', body: row.body, data: null };
    }

    const payload = row.payload ?? {};
    const action = String(payload.action ?? '');

    if (action === 'created') {
      return { ...base, kind: 'created', body: null, data: null };
    }

    if (action === 'updated') {
      const fields = Array.isArray(payload.changes) ? (payload.changes as string[]) : [];
      const changes = fields.map((field): TaskChange => {
        // A description is a document: the line says it changed, not what it was.
        return field === 'description' || !row.diff
          ? { field: field as TaskChange['field'] }
          : {
              field: field as TaskChange['field'],
              from: row.diff.before[field] ?? null,
              to: row.diff.after[field] ?? null,
            };
      });

      return { ...base, kind: 'changed', body: null, data: { changes } };
    }

    const text = payload.summary ?? payload.error;

    return {
      ...base,
      kind: 'run',
      body: typeof text === 'string' ? text : null,
      data: {
        outcome: RUN_OUTCOME[action] ?? action,
        ...(typeof payload.runId === 'string' ? { runId: payload.runId } : {}),
        ...(typeof payload.attempt === 'number' ? { attempt: payload.attempt } : {}),
      },
    };
  };

  const load = async (tx: Db, ctx: EngineContext, id: string): Promise<TaskRow> => {
    const rows = await runRaw<TaskRow>(
      tx,
      sql`SELECT ${FULL_COLUMNS} FROM task t
        WHERE t.id = ${id}::uuid AND t.workspace_id = ${ctx.workspaceId} AND t.deleted_at IS NULL AND ${visible(ctx)}`,
    );
    const row = rows[0];

    if (!row) {
      throw notFound('Task', id);
    }

    return row;
  };

  const linksOf = async (tx: Db, taskId: string): Promise<(IndexedLink & { role: string })[]> => {
    const rows = await runRaw<{ kind: string; object_id: string; target_id: string; role: string }>(
      tx,
      sql`SELECT kind, object_id, target_id, role FROM mention WHERE entity_kind = 'task' AND entity_id = ${taskId}::uuid ORDER BY role, kind, object_id, target_id`,
    );

    return rows.map((row) => ({
      kind: row.kind as IndexedLink['kind'],
      objectId: row.object_id,
      targetId: row.target_id,
      role: row.role,
    }));
  };

  const toTask = async (tx: Db, index: SchemaIndex, row: TaskRow): Promise<Task> => {
    const body = parseJson<RichTextDoc>(row.description);
    const links: TaskLink[] = (await linksOf(tx, row.id)).map((link) => ({
      link: linkTextOf(index, link),
      role: link.role as TaskLink['role'],
    }));

    return { ...toSummary(row), body, markdown: richTextToMarkdown(body), links };
  };

  const readTask = async (tx: Db, ctx: EngineContext, index: SchemaIndex, id: string): Promise<Task> =>
    toTask(tx, index, await load(tx, ctx, id));

  const assertVersion = (row: TaskRow, expected: number | undefined) => {
    if (expected !== undefined && toNumber(row.version) !== expected) {
      throw new EngineError('CONFLICT', 'This task was changed by someone else since it was read', {
        currentVersion: toNumber(row.version),
      });
    }
  };

  const assigneeFrom = async (ctx: EngineContext, ref: string | null | undefined): Promise<Assignee | null> => {
    if (ref === null || ref === undefined) {
      return null;
    }

    const assignee = parseAssigneeRef(ref);

    if (!assignee) {
      throw validationError(`"${ref}" is not an assignee: use user:<id> or agent:<id>`, { path: 'assignee' });
    }

    if (assignees && !(await assignees.exists(ctx, assignee))) {
      throw validationError(`Unknown ${assignee.kind === 'agent' ? 'agent' : 'member'} "${assignee.id}"`, {
        path: 'assignee',
      });
    }

    return assignee;
  };

  /** The links a task is about, as index rows (`role` `about`). */
  const aboutLinksOf = (index: SchemaIndex, about: string[], selfId: string): (IndexedLink & { role: string })[] => {
    const found = new Map<string, IndexedLink & { role: string }>();

    for (const text of about) {
      const target = parseLink(text);

      if (!target) {
        throw validationError(`"${text}" is not a link: use record:<object>/<id>, document:<id> or task:<id>`, {
          path: 'about',
        });
      }

      const indexed = indexedLinkOf(index, target);

      if (indexed.problem !== undefined) {
        throw validationError(indexed.problem, { path: 'about' });
      }

      if (indexed.link.kind === 'task' && indexed.link.targetId === selfId) {
        throw validationError('A task cannot be about itself', { path: 'about' });
      }

      found.set(`${indexed.link.kind}/${indexed.link.objectId}/${indexed.link.targetId}`, {
        ...indexed.link,
        role: 'about',
      });
    }

    return [...found.values()];
  };

  const writeLinks = (
    tx: Db,
    ctx: EngineContext,
    index: SchemaIndex,
    id: string,
    body: RichTextDoc,
    about: (IndexedLink & { role: string })[],
  ) =>
    replaceMentions(tx, 'task', ctx.workspaceId, id, [
      ...indexedLinksOf(index, body, 'task', id).map((link) => ({ ...link, role: 'mention' })),
      ...about,
    ]);

  /** A `task.changed` event; one made inside a run names it. */
  const event = (
    ctx: EngineContext,
    taskId: string,
    payload: Record<string, unknown>,
    diff?: { before: Record<string, unknown>; after: Record<string, unknown> },
  ): EventDraft => ({
    type: 'task.changed',
    entity: 'task',
    entityId: taskId,
    actor: ctx.actor,
    payload: ctx.run ? { runId: ctx.run.id, ...payload } : payload,
    ...(diff ? { diff } : {}),
  });

  /** Only the platform's own code (the runner) moves a task through a run. */
  const platformOnly = (ctx: EngineContext) => {
    if (ctx.actor.kind !== 'system') {
      throw forbidden('Only the platform moves a task through a run');
    }
  };

  /** The agent's work is in: the task waits for a person in review. */
  const handIn = async (tx: Db, ctx: EngineContext, taskId: string, at: string) => {
    await runRaw(
      tx,
      sql`UPDATE task SET status = 'in_review', status_changed_at = ${at}::timestamptz, closed_at = NULL, work = NULL, run_id = NULL,
          version = version + 1, updated_by = ${JSON.stringify(ctx.actor)}::jsonb, updated_at = ${at}::timestamptz
        WHERE id = ${taskId}::uuid`,
    );
  };

  const forbidden = (message: string) => new EngineError('FORBIDDEN', message);

  /** An agent working a task touches only that task and the ones below it. */
  const assertInRun = async (tx: Db, ctx: EngineContext, id: string) => {
    if (!ctx.run) {
      return;
    }

    const rows = await runRaw(tx, sql`${subtreeOf(ctx.run.taskId)} SELECT 1 FROM sub WHERE id = ${id}::uuid`);

    if (rows.length === 0) {
      throw forbidden('An agent working a task may only touch that task and its subtasks');
    }
  };

  /** The task and every task below it, with their depth. */
  const subtreeOf = (rootId: string): SQL => sql`WITH RECURSIVE sub AS (
      SELECT id, depth FROM task WHERE id = ${rootId}::uuid AND deleted_at IS NULL
      UNION ALL
      SELECT c.id, c.depth FROM task c JOIN sub s ON c.parent_id = s.id WHERE c.deleted_at IS NULL
    )`;

  const today = (query: { today?: string | undefined }): string => {
    if (query.today !== undefined) {
      assertDate(query.today, 'today');
    }

    return query.today ?? clock().toISOString().slice(0, 10);
  };

  const filtersOf = (ctx: EngineContext, index: SchemaIndex, query: TaskQuery): SQL[] => {
    const filters: SQL[] = [sql`t.workspace_id = ${ctx.workspaceId}`, sql`t.deleted_at IS NULL`, visible(ctx)];
    const statuses = oneOf(query.status, TASK_STATUSES, 'status');
    const priorities = oneOf(query.priority, TASK_PRIORITIES, 'priority');
    const works = oneOf(query.work, TASK_WORK_STATES, 'work');
    const ids = listOf(query.ids);

    if (ids.length > TASK_IDS_MAX) {
      throw validationError(`Name at most ${TASK_IDS_MAX} ids`, { path: 'ids' });
    }

    for (const id of ids) {
      assertUuid(id, 'task');
    }

    if (query.search) {
      const needle = `%${escapeLike(query.search)}%`;
      filters.push(sql`(t.title ILIKE ${needle} ESCAPE '\\' OR t.description_text ILIKE ${needle} ESCAPE '\\')`);
    }

    if (statuses.length > 0) {
      filters.push(sql`t.status IN (${inList(statuses)})`);
    }

    if (query.scope) {
      filters.push(query.scope === 'closed' ? sql`t.status IN (${CLOSED})` : sql`t.status NOT IN (${CLOSED})`);
    }

    if (priorities.length > 0) {
      filters.push(sql`t.priority IN (${inList(priorities)})`);
    }

    if (works.length > 0) {
      filters.push(sql`t.work IN (${inList(works)})`);
    }

    if (ids.length > 0) {
      filters.push(
        sql`t.id IN (${sql.join(
          ids.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`,
      );
    }

    if (query.assignee) {
      const person = personOf(ctx.actor);
      const options: SQL[] = [];

      for (const token of listOf(query.assignee)) {
        if (token === 'me') {
          options.push(person ? sql`(t.assignee_kind = 'user' AND t.assignee_id = ${person})` : sql`FALSE`);
        } else if (token === 'unassigned') {
          options.push(sql`t.assignee_id IS NULL`);
        } else if (token === 'agents') {
          options.push(sql`t.assignee_kind = 'agent'`);
        } else if (token === 'people') {
          options.push(sql`t.assignee_kind = 'user'`);
        } else {
          const assignee = parseAssigneeRef(token);

          if (!assignee) {
            throw validationError(`"${token}" is not an assignee`, { path: 'assignee' });
          }

          options.push(sql`(t.assignee_kind = ${assignee.kind} AND t.assignee_id = ${assignee.id})`);
        }
      }

      filters.push(sql`(${sql.join(options, sql` OR `)})`);
    }

    if (query.due) {
      const day = today(query);

      filters.push(
        query.due === 'overdue'
          ? sql`(t.due_date < ${day}::date AND t.status NOT IN (${CLOSED}))`
          : query.due === 'today'
            ? sql`t.due_date = ${day}::date`
            : query.due === 'week'
              ? sql`t.due_date BETWEEN ${day}::date AND (${day}::date + 6)`
              : sql`t.due_date IS NULL`,
      );
    }

    if (query.parent) {
      if (query.parent === 'none') {
        filters.push(sql`t.parent_id IS NULL`);
      } else {
        assertUuid(query.parent, 'task');
        filters.push(sql`t.parent_id = ${query.parent}::uuid`);
      }
    }

    if (query.mentions) {
      const target = parseLink(query.mentions);

      if (!target) {
        throw validationError('`mentions` must be a link: record:<object>/<id>, document:<id> or task:<id>', {
          path: 'mentions',
        });
      }

      const indexed = indexedLinkOf(index, target);

      if (indexed.problem !== undefined) {
        throw validationError(indexed.problem, { path: 'mentions' });
      }

      const { kind, objectId, targetId } = indexed.link;
      filters.push(
        sql`EXISTS (SELECT 1 FROM mention l WHERE l.entity_kind = 'task' AND l.entity_id = t.id AND l.kind = ${kind}
          AND l.object_id = ${objectId} AND l.target_id = ${targetId}::uuid)`,
      );
    }

    return filters;
  };

  return {
    bindAssignees: (port) => {
      assignees = port;
    },

    list: async (ctx, query = {}) => {
      authorize(ctx, 'task.read');
      const parsed = TaskQuerySchema.safeParse(query);

      if (!parsed.success) {
        throw fromZodError(parsed.error, 'Invalid tasks query');
      }

      const sort = parsed.data.sort ?? 'updated';
      const order = parsed.data.order ?? TASK_SORT_DEFAULT_ORDER[sort];
      const after = parsed.data.cursor === undefined ? undefined : decodeTaskCursor(parsed.data.cursor);

      if (parsed.data.cursor !== undefined && (after === undefined || after.sort !== sort || after.order !== order)) {
        throw new EngineError('INVALID_CURSOR', 'The tasks cursor is malformed or is for another sort');
      }

      if (after !== undefined) {
        assertUuid(after.id, 'task');
      }

      const { index } = await metadata.getSnapshot(ctx.workspaceId);
      const where = sql.join(filtersOf(ctx, index, parsed.data), sql` AND `);
      const { expr, cast } = SORT_KEYS[sort](order);
      const key = sql.raw(expr);
      const direction = sql.raw(order === 'asc' ? 'ASC' : 'DESC');
      const compare = sql.raw(order === 'asc' ? '>' : '<');
      const limit = parsed.data.limit ?? TASKS_DEFAULT_LIMIT;
      const rows = await runRaw<TaskRow>(
        db,
        sql`SELECT ${SUMMARY_COLUMNS}, (${key})::text AS sort_key FROM task t
          WHERE ${where}
            ${after === undefined ? sql`` : sql`AND (${key}, t.id) ${compare} (${after.key}::${sql.raw(cast)}, ${after.id}::uuid)`}
          ORDER BY ${key} ${direction}, t.id ${direction}
          LIMIT ${limit + 1}`,
      );
      const totals = await runRaw<{ total: unknown }>(db, sql`SELECT count(*) AS total FROM task t WHERE ${where}`);
      const page = rows.slice(0, limit);
      const last = page.at(-1);

      return {
        items: page.map(toSummary),
        nextCursor: rows.length > limit && last ? encodeTaskCursor(sort, order, last.sort_key ?? '', last.id) : null,
        total: toNumber(totals[0]?.total ?? 0),
      };
    },

    get: async (ctx, id) => {
      authorize(ctx, 'task.read');
      assertUuid(id, 'task');
      const { index } = await metadata.getSnapshot(ctx.workspaceId);

      return readTask(db, ctx, index, id);
    },

    create: async (ctx, input) => {
      authorize(ctx, 'task.write');
      const parsed = TaskInputSchema.safeParse(input);

      if (!parsed.success) {
        throw fromZodError(parsed.error, 'Invalid task');
      }

      const data = parsed.data;
      const body = richTextOrEmpty(data);
      checkedRichText(body);

      if (data.dueDate) {
        assertDate(data.dueDate, 'dueDate');
      }

      if (data.parent) {
        assertUuid(data.parent, 'task');
      }

      const { index } = await metadata.getSnapshot(ctx.workspaceId);
      const assignee = await assigneeFrom(ctx, data.assignee);
      const id = newId();
      const about = aboutLinksOf(index, data.about ?? [], id);
      const status = data.status ?? 'todo';
      const priority = data.priority ?? 'none';
      const actor = JSON.stringify(ctx.actor);

      return inEventTransaction({ db, bus, clock }, ctx, async (tx, now) => {
        if (data.key) {
          const existing = await runRaw<{ id: string }>(
            tx,
            sql`SELECT id FROM task WHERE workspace_id = ${ctx.workspaceId} AND key = ${data.key} AND deleted_at IS NULL`,
          );

          if (existing[0]) {
            return { value: await readTask(tx, ctx, index, existing[0].id), events: [] };
          }
        }

        // In a run the only way to make a task is a subtask of the one being worked.
        if (ctx.run) {
          if (!data.parent) {
            throw forbidden('An agent working a task may only make subtasks of it');
          }

          await assertInRun(tx, ctx, data.parent);
        }

        let depth = 0;
        let rootId = id;

        if (data.parent) {
          const parent = await load(tx, ctx, data.parent).catch((error) => {
            throw error instanceof EngineError && error.code === 'NOT_FOUND'
              ? validationError(`Unknown parent task "${data.parent}"`, { path: 'parent' })
              : error;
          });
          depth = toNumber(parent.depth) + 1;
          rootId = parent.root_id ?? parent.id;

          if (depth > TASK_MAX_DEPTH) {
            throw validationError(`Subtasks go ${TASK_MAX_DEPTH} levels deep at most`, { path: 'parent' });
          }
        }

        const at = now.toISOString();
        const closed = isTaskClosed(status);
        const queued = queueable({ status, assigneeKind: assignee?.kind ?? null, work: null });
        await runRaw(
          tx,
          sql`INSERT INTO task (id, workspace_id, title, description, description_text, status, status_changed_at, priority, priority_rank,
              assignee_kind, assignee_id, assigned_by, due_date, parent_id, depth, root_id, queued_at, key, version, closed_at, created_by, updated_by, created_at, updated_at)
            VALUES (${id}::uuid, ${ctx.workspaceId}, ${data.title}, ${JSON.stringify(body)}::jsonb, ${plainText(body)}, ${status}, ${at}::timestamptz,
              ${priority}, ${TASK_PRIORITY_RANK[priority]}, ${assignee?.kind ?? null}, ${assignee?.id ?? null}, ${assignee ? actor : null}::jsonb, ${data.dueDate ?? null}::date,
              ${data.parent ?? null}::uuid, ${depth}, ${rootId}::uuid, ${queued ? at : null}::timestamptz, ${data.key ?? null}, 1,
              ${closed ? at : null}::timestamptz, ${actor}::jsonb, ${actor}::jsonb, ${at}::timestamptz, ${at}::timestamptz)`,
        );
        await writeLinks(tx, ctx, index, id, body, about);
        const events = [
          event(ctx, id, { action: 'created', status, assignee: assignee ? assigneeRef(assignee) : null }),
        ];

        if (assignee) {
          events.push(event(ctx, id, { action: 'assigned', assignee: assigneeRef(assignee) }));
        }

        return { value: await readTask(tx, ctx, index, id), events };
      });
    },

    update: async (ctx, id, patch) => {
      authorize(ctx, 'task.write');
      assertUuid(id, 'task');
      const parsed = TaskPatchSchema.safeParse(patch);

      if (!parsed.success) {
        throw fromZodError(parsed.error, 'Invalid task');
      }

      const data = parsed.data;
      const body = richTextOf(data);

      if (body) {
        checkedRichText(body);
      }

      if (data.dueDate) {
        assertDate(data.dueDate, 'dueDate');
      }

      if (data.parent) {
        assertUuid(data.parent, 'task');
      }

      const { index } = await metadata.getSnapshot(ctx.workspaceId);
      const assignee = data.assignee === undefined ? undefined : await assigneeFrom(ctx, data.assignee);
      const about = data.about === undefined ? undefined : aboutLinksOf(index, data.about, id);

      return inEventTransaction({ db, bus, clock }, ctx, async (tx, now) => {
        const row = await load(tx, ctx, id);
        await assertInRun(tx, ctx, id);

        if (ctx.run && (data.status !== undefined || data.parent !== undefined)) {
          throw forbidden('An agent working a task may not change its status or move it: it finishes the task instead');
        }

        if (ctx.run && data.assignee !== undefined && id === ctx.run.taskId) {
          throw forbidden('An agent working a task may not hand it to someone else');
        }

        assertVersion(row, data.expectedVersion);
        const changes: TaskChange[] = [];
        const set: SQL[] = [];
        const at = now.toISOString();
        const before = { status: row.status, assigneeKind: row.assignee_kind, work: row.work };
        const after = { ...before };
        let newAssignee: string | null | undefined;

        if (data.title !== undefined && data.title !== row.title) {
          changes.push({ field: 'title', from: row.title, to: data.title });
          set.push(sql`title = ${data.title}`);
        }

        if (body) {
          const current = parseJson<RichTextDoc>(row.description);

          if (JSON.stringify(current) !== JSON.stringify(body)) {
            changes.push({ field: 'description' });
            set.push(sql`description = ${JSON.stringify(body)}::jsonb`, sql`description_text = ${plainText(body)}`);
          }
        }

        if (data.priority !== undefined && data.priority !== row.priority) {
          changes.push({ field: 'priority', from: row.priority, to: data.priority });
          set.push(sql`priority = ${data.priority}`, sql`priority_rank = ${TASK_PRIORITY_RANK[data.priority]}`);
        }

        if (data.dueDate !== undefined && data.dueDate !== row.due_date) {
          changes.push({ field: 'dueDate', from: row.due_date, to: data.dueDate });
          set.push(sql`due_date = ${data.dueDate}::date`);
        }

        if (data.status !== undefined && data.status !== row.status) {
          changes.push({ field: 'status', from: row.status, to: data.status });
          after.status = data.status;
          set.push(
            sql`status = ${data.status}`,
            sql`status_changed_at = ${at}::timestamptz`,
            isTaskClosed(data.status) ? sql`closed_at = ${at}::timestamptz` : sql`closed_at = NULL`,
          );

          // Closing a task, or a person moving it while an agent works it, ends the agent's run.
          if (isTaskClosed(data.status) || row.work !== null) {
            after.work = null;
            set.push(sql`work = NULL`, sql`run_id = NULL`);
          }
        }

        if (assignee !== undefined) {
          const next = assignee ? assigneeRef(assignee) : null;

          if (next !== assigneeOf(row)) {
            newAssignee = next;
            changes.push({ field: 'assignee', from: assigneeOf(row), to: next });
            after.assigneeKind = assignee?.kind ?? null;
            after.work = null;
            set.push(
              sql`assignee_kind = ${assignee?.kind ?? null}`,
              sql`assignee_id = ${assignee?.id ?? null}`,
              sql`assigned_by = ${assignee ? JSON.stringify(ctx.actor) : null}::jsonb`,
              sql`work = NULL`,
              sql`run_id = NULL`,
              sql`attempts = 0`,
            );
          }
        }

        if (data.parent !== undefined && data.parent !== row.parent_id) {
          const target = data.parent;
          let depth = 0;
          let rootId = id;

          if (target !== null) {
            if (target === id) {
              throw validationError('A task cannot be its own subtask', { path: 'parent' });
            }

            const parent = await load(tx, ctx, target).catch((error) => {
              throw error instanceof EngineError && error.code === 'NOT_FOUND'
                ? validationError(`Unknown parent task "${target}"`, { path: 'parent' })
                : error;
            });
            depth = toNumber(parent.depth) + 1;
            rootId = parent.root_id ?? parent.id;
          }

          const subtree = await runRaw<{ id: string; depth: unknown }>(
            tx,
            sql`${subtreeOf(id)} SELECT id, depth FROM sub`,
          );

          if (target !== null && subtree.some((member) => member.id === target)) {
            throw validationError('A task cannot be moved under its own subtasks', { path: 'parent' });
          }

          const height = Math.max(...subtree.map((member) => toNumber(member.depth))) - toNumber(row.depth);

          if (depth + height > TASK_MAX_DEPTH) {
            throw validationError(`Subtasks go ${TASK_MAX_DEPTH} levels deep at most`, { path: 'parent' });
          }

          changes.push({ field: 'parent', from: row.parent_id, to: target });
          set.push(sql`parent_id = ${target}::uuid`, sql`depth = ${depth}`, sql`root_id = ${rootId}::uuid`);
          const delta = depth - toNumber(row.depth);
          await runRaw(
            tx,
            sql`${subtreeOf(id)} UPDATE task SET depth = depth + ${delta}, root_id = ${rootId}::uuid
              WHERE id IN (SELECT id FROM sub) AND id <> ${id}::uuid`,
          );
        }

        let aboutChanged = false;

        if (about !== undefined) {
          const current = (await linksOf(tx, id)).filter((link) => link.role === 'about');
          const texts = (links: IndexedLink[]) => links.map((link) => linkTextOf(index, link)).sort();

          if (JSON.stringify(texts(current)) !== JSON.stringify(texts(about))) {
            aboutChanged = true;
            changes.push({ field: 'about', from: texts(current), to: texts(about) });
          }
        }

        if (changes.length === 0) {
          return { value: await toTask(tx, index, row), events: [] };
        }

        const wasQueued = queueable(before);
        const nowQueued = queueable(after);

        if (nowQueued !== wasQueued || (nowQueued && newAssignee !== undefined)) {
          set.push(nowQueued ? sql`queued_at = ${at}::timestamptz` : sql`queued_at = NULL`);
        }

        await runRaw(
          tx,
          sql`UPDATE task SET ${sql.join(set, sql`, `)}${set.length > 0 ? sql`,` : sql``}
              version = version + 1, updated_by = ${JSON.stringify(ctx.actor)}::jsonb, updated_at = ${at}::timestamptz
            WHERE id = ${id}::uuid`,
        );

        if (body || aboutChanged) {
          const current = body ?? parseJson<RichTextDoc>(row.description);
          const kept = about ?? (await linksOf(tx, id)).filter((link) => link.role === 'about');
          await writeLinks(tx, ctx, index, id, current, kept);
        }

        const fields = changes.map((change) => change.field);
        // The line shows what each field was and became; a description is a document, so only that it changed.
        const shown = changes.filter((change) => change.field !== 'description');
        const events = [
          event(
            ctx,
            id,
            { action: 'updated', changes: fields },
            {
              before: Object.fromEntries(shown.map((change) => [change.field, change.from ?? null])),
              after: Object.fromEntries(shown.map((change) => [change.field, change.to ?? null])),
            },
          ),
        ];

        if (fields.includes('status')) {
          events.push(event(ctx, id, { action: 'status_changed', status: after.status }));
        }

        if (newAssignee !== undefined) {
          events.push(event(ctx, id, { action: 'assigned', assignee: newAssignee }));
        }

        return { value: await readTask(tx, ctx, index, id), events };
      });
    },

    claimNext: async (ctx, agentIds) => {
      platformOnly(ctx);

      if (agentIds.length === 0) {
        return null;
      }

      const { index } = await metadata.getSnapshot(ctx.workspaceId);

      return inEventTransaction({ db, bus, clock }, ctx, async (tx, now) => {
        const next = await runRaw<{ id: string; assignee_id: string; attempts: unknown; assigned_by: unknown }>(
          tx,
          sql`SELECT t.id, t.assignee_id, t.attempts, t.assigned_by FROM task t
            WHERE t.workspace_id = ${ctx.workspaceId} AND t.deleted_at IS NULL AND t.status = 'todo' AND t.work IS NULL
              AND t.assignee_kind = 'agent' AND t.assignee_id IN (${inList(agentIds)})
              AND NOT EXISTS (SELECT 1 FROM task w WHERE w.workspace_id = t.workspace_id AND w.deleted_at IS NULL
                AND w.assignee_kind = 'agent' AND w.assignee_id = t.assignee_id AND w.work IN ('working', 'waiting_on_you'))
            ORDER BY t.priority_rank, t.due_date NULLS LAST, t.created_at, t.id
            LIMIT 1 FOR UPDATE OF t SKIP LOCKED`,
        );
        const row = next[0];

        if (!row) {
          return { value: null, events: [] };
        }

        const runId = newId();
        const attempt = toNumber(row.attempts) + 1;
        const agent: Actor = { kind: 'agent', id: row.assignee_id };
        const acting: EngineContext = { ...ctx, actor: agent, run: { id: runId, taskId: row.id } };
        const at = now.toISOString();
        await runRaw(
          tx,
          sql`UPDATE task SET status = 'in_progress', status_changed_at = ${at}::timestamptz, work = 'working', run_id = ${runId}::uuid,
              attempts = ${attempt}, queued_at = NULL, version = version + 1, updated_by = ${JSON.stringify(agent)}::jsonb,
              updated_at = ${at}::timestamptz
            WHERE id = ${row.id}::uuid`,
        );

        return {
          value: {
            task: await readTask(tx, ctx, index, row.id),
            runId,
            attempt,
            requestedBy: row.assigned_by === null ? agent : parseJson<Actor>(row.assigned_by),
          },
          events: [
            event(acting, row.id, { action: 'run_started', attempt }),
            event(acting, row.id, { action: 'status_changed', status: 'in_progress' }),
          ],
        };
      });
    },

    endRun: async (ctx, taskId, runId, result) => {
      platformOnly(ctx);

      await inEventTransaction({ db, bus, clock }, ctx, async (tx, now) => {
        const rows = await runRaw<TaskRow>(
          tx,
          sql`SELECT ${SUMMARY_COLUMNS} FROM task t WHERE t.id = ${taskId}::uuid AND t.workspace_id = ${ctx.workspaceId} AND t.deleted_at IS NULL`,
        );
        const row = rows[0];

        // A run that is no longer the task's own (it was moved, reassigned, stopped or deleted) changes nothing.
        if (!row || row.run_id !== runId) {
          return { value: true, events: [] };
        }

        const agent: Actor = { kind: 'agent', id: row.assignee_id ?? '' };
        const acting: EngineContext = { ...ctx, actor: agent, run: { id: runId, taskId } };
        const at = now.toISOString();

        if (result.outcome === 'completed') {
          await handIn(tx, acting, taskId, at);

          return {
            value: true,
            events: [
              event(acting, taskId, { action: 'handed_in', ...(result.summary ? { summary: result.summary } : {}) }),
              event(acting, taskId, { action: 'status_changed', status: 'in_review' }),
            ],
          };
        }

        await runRaw(
          tx,
          sql`UPDATE task SET work = 'failed', run_id = NULL, version = version + 1, updated_by = ${JSON.stringify(agent)}::jsonb,
              updated_at = ${at}::timestamptz
            WHERE id = ${taskId}::uuid`,
        );

        return { value: true, events: [event(acting, taskId, { action: 'run_failed', error: result.error })] };
      });
    },

    setWaiting: async (ctx, taskId, runId, waiting) => {
      platformOnly(ctx);

      await inEventTransaction({ db, bus, clock }, ctx, async (tx, now) => {
        const rows = await runRaw(
          tx,
          sql`UPDATE task SET work = ${waiting ? 'waiting_on_you' : 'working'}, updated_at = ${now.toISOString()}::timestamptz
            WHERE id = ${taskId}::uuid AND workspace_id = ${ctx.workspaceId} AND run_id = ${runId}::uuid AND deleted_at IS NULL
              AND work IS DISTINCT FROM ${waiting ? 'waiting_on_you' : 'working'}
            RETURNING id`,
        );

        return {
          value: true,
          events: rows.length > 0 ? [event(ctx, taskId, { action: 'work_changed' })] : [],
        };
      });
    },

    finish: async (ctx, id, input) => {
      authorize(ctx, 'task.write');
      assertUuid(id, 'task');

      if (!ctx.run || ctx.run.taskId !== id) {
        throw forbidden('A task is finished by the agent working it, inside its run');
      }

      const summary = input.summary.trim();

      if (!summary) {
        throw validationError('Say what was done, for whoever reviews it', { path: 'summary' });
      }

      const { index } = await metadata.getSnapshot(ctx.workspaceId);
      const run = ctx.run;

      return inEventTransaction({ db, bus, clock }, ctx, async (tx, now) => {
        const rows = await runRaw<TaskRow & { run_id: string | null }>(
          tx,
          sql`SELECT ${SUMMARY_COLUMNS} FROM task t WHERE t.id = ${id}::uuid AND t.workspace_id = ${ctx.workspaceId} AND t.deleted_at IS NULL`,
        );
        const row = rows[0];

        if (!row) {
          throw notFound('Task', id);
        }

        if (row.run_id !== run.id) {
          throw new EngineError('CONFLICT', 'This run is no longer the task’s: it was stopped, moved or handed on');
        }

        await handIn(tx, ctx, id, now.toISOString());

        return {
          value: await readTask(tx, ctx, index, id),
          events: [
            event(ctx, id, { action: 'handed_in', summary }),
            event(ctx, id, { action: 'status_changed', status: 'in_review' }),
          ],
        };
      });
    },

    stop: async (ctx, id) => {
      authorize(ctx, 'task.control');
      assertUuid(id, 'task');
      const { index } = await metadata.getSnapshot(ctx.workspaceId);

      return inEventTransaction({ db, bus, clock }, ctx, async (tx, now) => {
        const row = await load(tx, ctx, id);

        if (row.work !== 'working' && row.work !== 'waiting_on_you') {
          throw new EngineError('CONFLICT', 'No agent is working on this task');
        }

        await runRaw(
          tx,
          sql`UPDATE task SET work = 'failed', run_id = NULL, version = version + 1, updated_by = ${JSON.stringify(ctx.actor)}::jsonb,
              updated_at = ${now.toISOString()}::timestamptz
            WHERE id = ${id}::uuid`,
        );

        return {
          value: await readTask(tx, ctx, index, id),
          events: [event(ctx, id, { action: 'run_stopped' })],
        };
      });
    },

    retry: async (ctx, id) => {
      authorize(ctx, 'task.control');
      assertUuid(id, 'task');
      const { index } = await metadata.getSnapshot(ctx.workspaceId);

      return inEventTransaction({ db, bus, clock }, ctx, async (tx, now) => {
        const row = await load(tx, ctx, id);

        if (row.assignee_kind !== 'agent') {
          throw new EngineError('CONFLICT', 'Only a task given to an agent can be retried');
        }

        if (row.work !== 'failed') {
          throw new EngineError('CONFLICT', 'The agent has not failed or been stopped on this task');
        }

        const at = now.toISOString();
        await runRaw(
          tx,
          sql`UPDATE task SET status = 'todo', status_changed_at = ${at}::timestamptz, work = NULL, run_id = NULL, attempts = 0,
              queued_at = ${at}::timestamptz, assigned_by = ${JSON.stringify(ctx.actor)}::jsonb, version = version + 1,
              updated_by = ${JSON.stringify(ctx.actor)}::jsonb, updated_at = ${at}::timestamptz, closed_at = NULL
            WHERE id = ${id}::uuid`,
        );
        const events = [event(ctx, id, { action: 'run_retried' })];

        if (row.status !== 'todo') {
          events.push(event(ctx, id, { action: 'status_changed', status: 'todo' }));
        }

        return { value: await readTask(tx, ctx, index, id), events };
      });
    },

    delete: async (ctx, id) => {
      authorize(ctx, 'task.write');
      assertUuid(id, 'task');

      if (ctx.run) {
        throw forbidden('An agent working a task may not delete tasks');
      }

      await inEventTransaction({ db, bus, clock }, ctx, async (tx, now) => {
        await load(tx, ctx, id);
        const removed = await runRaw<{ id: string }>(
          tx,
          sql`${subtreeOf(id)} UPDATE task SET deleted_at = ${now.toISOString()}::timestamptz, updated_at = ${now.toISOString()}::timestamptz, key = NULL
            WHERE id IN (SELECT id FROM sub) RETURNING id`,
        );
        await runRaw(
          tx,
          sql`DELETE FROM mention WHERE entity_kind = 'task' AND entity_id IN (${sql.join(
            removed.map((task) => sql`${task.id}::uuid`),
            sql`, `,
          )})`,
        );

        return {
          value: true,
          events: [id, ...removed.map((task) => task.id).filter((taskId) => taskId !== id)].map((taskId) =>
            event(ctx, taskId, { action: 'deleted' }),
          ),
        };
      });
    },

    activity: async (ctx, id, query = {}) => {
      authorize(ctx, 'task.read');
      assertUuid(id, 'task');
      await load(db, ctx, id);
      const page = await listTimeline(
        db,
        ctx,
        'task',
        id,
        'task.changed',
        sql`e.payload->>'action' IN (${inList([...TASK_TIMELINE_ACTIONS])})`,
        query,
      );

      return { items: page.items.map((row) => toActivity(id, row)), nextCursor: page.nextCursor };
    },

    comment: async (ctx, id, input) => {
      authorize(ctx, 'task.write');
      assertUuid(id, 'task');
      const parsed = TaskCommentSchema.safeParse(input);

      if (!parsed.success) {
        throw fromZodError(parsed.error, 'Invalid comment');
      }

      return inEventTransaction({ db, bus, clock }, ctx, async (tx, now) => {
        await load(tx, ctx, id);
        await assertInRun(tx, ctx, id);
        const entry = await insertComment(tx, ctx, 'task', id, newId(), now, parsed.data.markdown);
        // A comment is not a change of the task, so its version stays; the task does surface as recently active.
        await runRaw(tx, sql`UPDATE task SET updated_at = ${now.toISOString()}::timestamptz WHERE id = ${id}::uuid`);

        return { value: toActivity(id, entry), events: [event(ctx, id, { action: 'commented' })] };
      });
    },

    counts: async (ctx, query = {}) => {
      authorize(ctx, 'task.read');
      const parsed = TaskCountsQuerySchema.safeParse(query);

      if (!parsed.success) {
        throw fromZodError(parsed.error, 'Invalid counts query');
      }

      const day = today(parsed.data);
      const person = personOf(ctx.actor);
      const base = sql`t.workspace_id = ${ctx.workspaceId} AND t.deleted_at IS NULL AND ${visible(ctx)}`;
      const open = sql`t.status NOT IN (${CLOSED})`;
      const totals = await runRaw<Record<string, unknown>>(
        db,
        sql`SELECT
            count(*) FILTER (WHERE ${open}) AS open,
            count(*) FILTER (WHERE ${open} AND t.due_date < ${day}::date) AS overdue,
            count(*) FILTER (WHERE ${open} AND t.due_date = ${day}::date) AS due_today,
            count(*) FILTER (WHERE ${open} AND t.due_date BETWEEN ${day}::date AND (${day}::date + 6)) AS due_week,
            count(*) FILTER (WHERE t.status = 'in_review') AS in_review,
            count(*) FILTER (WHERE ${open} AND t.assignee_kind = 'user' AND t.assignee_id = ${person}) AS mine,
            count(*) FILTER (WHERE t.work = 'working') AS agents_working
          FROM task t WHERE ${base}`,
      );
      const byStatus = await runRaw<{ status: string; total: unknown }>(
        db,
        sql`SELECT t.status, count(*) AS total FROM task t WHERE ${base} GROUP BY t.status`,
      );
      const row = totals[0] ?? {};

      return {
        open: toNumber(row.open ?? 0),
        overdue: toNumber(row.overdue ?? 0),
        dueToday: toNumber(row.due_today ?? 0),
        dueThisWeek: toNumber(row.due_week ?? 0),
        inReview: toNumber(row.in_review ?? 0),
        mine: toNumber(row.mine ?? 0),
        agentsWorking: toNumber(row.agents_working ?? 0),
        byStatus: Object.fromEntries(
          TASK_STATUSES.map((status) => [
            status,
            toNumber(byStatus.find((entry) => entry.status === status)?.total ?? 0),
          ]),
        ),
      };
    },
  };
};
