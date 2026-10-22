import {
  assigneeRef,
  CLOSED_TASK_STATUSES,
  cleanRichText,
  DeviasApiError,
  decodeTaskActivityCursor,
  decodeTaskCursor,
  EMPTY_DOC,
  encodeTaskActivityCursor,
  encodeTaskCursor,
  isTaskClosed,
  type LinkTarget,
  linkHref,
  linkOfMention,
  listOf,
  markdownToRichText,
  mentionsOf,
  objectByKey,
  parseAssigneeRef,
  parseLink,
  personOf,
  plainText,
  type RichTextDoc,
  richTextProblem,
  richTextToMarkdown,
  TASK_ACTIVITY_DEFAULT_LIMIT,
  TASK_IDS_MAX,
  TASK_MAX_DEPTH,
  TASK_PRIORITIES,
  TASK_PRIORITY_RANK,
  TASK_SORT_DEFAULT_ORDER,
  TASK_STATUSES,
  TASK_WORK_STATES,
  TASKS_DEFAULT_LIMIT,
  type Task,
  type TaskActivityEntry,
  type TaskActivityPage,
  type TaskActivityQuery,
  TaskActivityQuerySchema,
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
  type TaskQuery,
  TaskQuerySchema,
  type TaskRunPage,
  type TaskSort,
  type TaskSummary,
} from '@devias/core';
import type { MockStore, MockTask } from './store';

/** Tasks over the store's task list, with the server's validation, filters, sorts, paging and errors. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const validation = (message: string, details?: unknown): DeviasApiError =>
  new DeviasApiError(400, 'VALIDATION', message, details);

const assertUuid = (id: string, what: string) => {
  if (!UUID.test(id)) {
    throw validation(`Invalid ${what} id "${id}"`, { id });
  }
};

const assertDate = (value: string, path: string) => {
  const date = new Date(`${value}T00:00:00Z`);

  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw validation(`"${value}" is not a date`, { path });
  }
};

const bodyOf = (input: { body?: unknown; markdown?: string | undefined }): RichTextDoc | undefined => {
  if (input.markdown !== undefined) {
    return markdownToRichText(input.markdown);
  }

  if (input.body === undefined) {
    return undefined;
  }

  const problem = richTextProblem(input.body);

  if (problem) {
    throw validation(problem, { path: 'body' });
  }

  return cleanRichText(input.body as RichTextDoc);
};

const checkedBody = (body: RichTextDoc): RichTextDoc => {
  const problem = richTextProblem(body);

  if (problem) {
    throw validation(problem, { path: 'body' });
  }

  return body;
};

type Row = MockTask;

const find = (store: MockStore, id: string): Row => {
  assertUuid(id, 'task');
  const row = store.tasks.find((candidate) => candidate.id === id && !candidate.deleted);

  if (!row) {
    throw new DeviasApiError(404, 'NOT_FOUND', `Task "${id}" not found`);
  }

  return row;
};

const live = (store: MockStore): Row[] => store.tasks.filter((row) => !row.deleted);

const subtasksOf = (store: MockStore, row: Row) => {
  const children = live(store).filter((child) => child.parentId === row.id);

  return { total: children.length, open: children.filter((child) => !isTaskClosed(child.status)).length };
};

const summaryOf = (store: MockStore, row: Row): TaskSummary => ({
  id: row.id,
  title: row.title,
  status: row.status,
  priority: row.priority,
  assignee: row.assignee,
  dueDate: row.dueDate,
  parentId: row.parentId,
  subtasks: subtasksOf(store, row),
  work: row.work,
  runId: null,
  version: row.version,
  createdBy: structuredClone(row.createdBy),
  updatedBy: structuredClone(row.updatedBy),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  statusChangedAt: row.statusChangedAt,
  closedAt: row.closedAt,
});

const publicTask = (store: MockStore, row: Row): Task => ({
  ...summaryOf(store, row),
  body: structuredClone(row.body),
  markdown: richTextToMarkdown(row.body),
  links: structuredClone(row.links),
});

/** The links a body mentions that the server indexes: records of known objects, documents and tasks. */
const mentionLinks = (store: MockStore, body: RichTextDoc, selfId: string): TaskLink[] => {
  const index = store.index();
  const found = new Map<string, TaskLink>();

  for (const mention of mentionsOf(body)) {
    const target = linkOfMention(mention.object, mention.id);

    if (target.kind === 'workflow' || target.kind === 'member' || !UUID.test(target.id)) {
      continue;
    }

    if (target.kind === 'record') {
      const object = objectByKey(index, target.object);

      if (object) {
        found.set(linkHref(target), { link: `record:${object.nameSingular}/${target.id}`, role: 'mention' });
      }
    } else if (!(target.kind === 'task' && target.id === selfId)) {
      found.set(linkHref(target), { link: linkHref(target), role: 'mention' });
    }
  }

  return [...found.values()];
};

const aboutLinks = (store: MockStore, about: string[], selfId: string): TaskLink[] => {
  const index = store.index();
  const found = new Map<string, TaskLink>();

  for (const text of about) {
    const target: LinkTarget | null = parseLink(text);

    if (!target || target.kind === 'workflow' || target.kind === 'member') {
      throw validation(`"${text}" is not a link: use record:<object>/<id>, document:<id> or task:<id>`, {
        path: 'about',
      });
    }

    if (!UUID.test(target.id)) {
      throw validation(`Invalid target id "${target.id}"`, { path: 'about' });
    }

    if (target.kind === 'task' && target.id === selfId) {
      throw validation('A task cannot be about itself', { path: 'about' });
    }

    let link = linkHref(target);

    if (target.kind === 'record') {
      const object = objectByKey(index, target.object);

      if (!object) {
        throw validation(`Unknown object "${target.object}"`, { path: 'about' });
      }

      link = `record:${object.nameSingular}/${target.id}`;
    }

    found.set(link, { link, role: 'about' });
  }

  return [...found.values()];
};

const assigneeOf = (ref: string | null | undefined): string | null => {
  if (ref === null || ref === undefined) {
    return null;
  }

  const assignee = parseAssigneeRef(ref);

  if (!assignee) {
    throw validation(`"${ref}" is not an assignee: use user:<id> or agent:<id>`, { path: 'assignee' });
  }

  return assigneeRef(assignee);
};

const addActivity = (
  store: MockStore,
  taskId: string,
  kind: TaskActivityEntry['kind'],
  content: { body?: string; data?: Record<string, unknown> } = {},
): TaskActivityEntry => {
  const entry: TaskActivityEntry = {
    id: store.newId(),
    taskId,
    kind,
    actor: structuredClone(store.actor),
    body: content.body ?? null,
    data: content.data ?? null,
    cause: null,
    createdAt: store.now(),
  };
  store.taskActivity.push(entry);

  return entry;
};

const subtreeOf = (store: MockStore, id: string): Row[] => {
  const found: Row[] = [];
  const queue = [id];

  while (queue.length > 0) {
    const current = queue.shift() as string;

    for (const row of live(store)) {
      if (row.parentId === current) {
        found.push(row);
        queue.push(row.id);
      }
    }
  }

  return found;
};

const SORT_KEY: Record<TaskSort, (row: Row, order: 'asc' | 'desc') => string> = {
  updated: (row) => row.updatedAt,
  created: (row) => row.createdAt,
  due: (row, order) => row.dueDate ?? (order === 'asc' ? '9999-99-99' : ''),
  priority: (row) => String(TASK_PRIORITY_RANK[row.priority]),
  closed: (row, order) => row.closedAt ?? (order === 'asc' ? '9999' : ''),
  title: (row) => row.title,
};

const oneOf = <T extends string>(value: string | undefined, allowed: readonly T[], path: string): T[] => {
  const items = listOf(value);

  for (const item of items) {
    if (!(allowed as readonly string[]).includes(item)) {
      throw validation(`"${item}" is not one of ${allowed.join(', ')}`, { path });
    }
  }

  return items as T[];
};

const addDays = (day: string, days: number): string => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);

  return date.toISOString().slice(0, 10);
};

const todayOf = (store: MockStore, query: { today?: string | undefined }): string => {
  if (query.today !== undefined) {
    assertDate(query.today, 'today');
  }

  return query.today ?? store.now().slice(0, 10);
};

export const listTasks = (store: MockStore, query: TaskQuery = {}): TaskPage => {
  const parsed = TaskQuerySchema.safeParse(query);

  if (!parsed.success) {
    throw validation('Invalid tasks query', parsed.error.issues);
  }

  const q = parsed.data;
  const statuses = oneOf(q.status, TASK_STATUSES, 'status');
  const priorities = oneOf(q.priority, TASK_PRIORITIES, 'priority');
  const works = oneOf(q.work, TASK_WORK_STATES, 'work');
  const ids = listOf(q.ids);

  if (ids.length > TASK_IDS_MAX) {
    throw validation(`Name at most ${TASK_IDS_MAX} ids`, { path: 'ids' });
  }

  for (const id of ids) {
    assertUuid(id, 'task');
  }

  const sort = q.sort ?? 'updated';
  const order = q.order ?? TASK_SORT_DEFAULT_ORDER[sort];
  const after = q.cursor === undefined ? undefined : decodeTaskCursor(q.cursor);

  if (q.cursor !== undefined && (!after || after.sort !== sort || after.order !== order)) {
    throw new DeviasApiError(400, 'INVALID_CURSOR', 'The tasks cursor is malformed or is for another sort');
  }

  const needle = q.search?.toLowerCase();
  const person = personOf(store.actor);
  const day = q.due ? todayOf(store, q) : '';
  const assigneeTokens = listOf(q.assignee);
  const assigneeTests = assigneeTokens.map((token): ((row: Row) => boolean) => {
    if (token === 'me') {
      return (row) => person !== null && row.assignee === `user:${person}`;
    }

    if (token === 'unassigned') {
      return (row) => row.assignee === null;
    }

    if (token === 'agents') {
      return (row) => row.assignee?.startsWith('agent:') === true;
    }

    if (token === 'people') {
      return (row) => row.assignee?.startsWith('user:') === true;
    }

    const assignee = parseAssigneeRef(token);

    if (!assignee) {
      throw validation(`"${token}" is not an assignee`, { path: 'assignee' });
    }

    return (row) => row.assignee === assigneeRef(assignee);
  });
  let mentions: ((row: Row) => boolean) | undefined;

  if (q.mentions) {
    const target = parseLink(q.mentions);

    if (!target || target.kind === 'workflow' || target.kind === 'member') {
      throw validation('`mentions` must be a link: record:<object>/<id>, document:<id> or task:<id>', {
        path: 'mentions',
      });
    }

    assertUuid(target.id, 'target');
    const object = target.kind === 'record' ? objectByKey(store.index(), target.object) : undefined;

    if (target.kind === 'record' && !object) {
      throw validation(`Unknown object "${target.object}"`, { path: 'mentions' });
    }

    const wanted = target.kind === 'record' ? `record:${object?.nameSingular}/${target.id}` : linkHref(target);
    mentions = (row) => row.links.some((link) => link.link === wanted);
  }

  const rows = live(store)
    .filter((row) => ids.length === 0 || ids.includes(row.id))
    .filter(
      (row) =>
        !needle || row.title.toLowerCase().includes(needle) || plainText(row.body).toLowerCase().includes(needle),
    )
    .filter((row) => statuses.length === 0 || statuses.includes(row.status))
    .filter((row) => !q.scope || isTaskClosed(row.status) === (q.scope === 'closed'))
    .filter((row) => priorities.length === 0 || priorities.includes(row.priority))
    .filter((row) => works.length === 0 || (row.work !== null && works.includes(row.work)))
    .filter((row) => assigneeTests.length === 0 || assigneeTests.some((test) => test(row)))
    .filter((row) => {
      if (!q.due) {
        return true;
      }

      if (q.due === 'none') {
        return row.dueDate === null;
      }

      if (row.dueDate === null) {
        return false;
      }

      return q.due === 'overdue'
        ? row.dueDate < day && !isTaskClosed(row.status)
        : q.due === 'today'
          ? row.dueDate === day
          : row.dueDate >= day && row.dueDate <= addDays(day, 6);
    })
    .filter((row) => {
      if (!q.parent) {
        return true;
      }

      if (q.parent === 'none') {
        return row.parentId === null;
      }

      assertUuid(q.parent, 'task');

      return row.parentId === q.parent;
    })
    .filter((row) => !mentions || mentions(row));
  const sign = order === 'asc' ? 1 : -1;
  const keyed = rows
    .map((row) => ({ row, key: SORT_KEY[sort](row, order) }))
    .sort((a, b) => sign * (a.key === b.key ? a.row.id.localeCompare(b.row.id) : a.key < b.key ? -1 : 1));
  const rest = after
    ? keyed.filter(
        (entry) =>
          sign * (entry.key === after.key ? entry.row.id.localeCompare(after.id) : entry.key < after.key ? -1 : 1) > 0,
      )
    : keyed;
  const limit = q.limit ?? TASKS_DEFAULT_LIMIT;
  const page = rest.slice(0, limit);
  const last = page.at(-1);

  return {
    items: page.map((entry) => summaryOf(store, entry.row)),
    nextCursor: rest.length > limit && last ? encodeTaskCursor(sort, order, last.key, last.row.id) : null,
    total: rows.length,
  };
};

export const getTask = (store: MockStore, id: string): Task => publicTask(store, find(store, id));

export const createTask = (store: MockStore, input: TaskInput): Task => {
  const parsed = TaskInputSchema.safeParse(input);

  if (!parsed.success) {
    throw validation('Invalid task', parsed.error.issues);
  }

  const data = parsed.data;

  if (data.key) {
    const existing = live(store).find((row) => row.key === data.key);

    if (existing) {
      return publicTask(store, existing);
    }
  }

  const body = checkedBody(bodyOf(data) ?? EMPTY_DOC);

  if (data.dueDate) {
    assertDate(data.dueDate, 'dueDate');
  }

  const assignee = assigneeOf(data.assignee);
  const id = store.newId();
  const about = aboutLinks(store, data.about ?? [], id);
  let depth = 0;

  if (data.parent) {
    assertUuid(data.parent, 'task');
    const parent = store.tasks.find((row) => row.id === data.parent && !row.deleted);

    if (!parent) {
      throw validation(`Unknown parent task "${data.parent}"`, { path: 'parent' });
    }

    depth = parent.depth + 1;

    if (depth > TASK_MAX_DEPTH) {
      throw validation(`Subtasks go ${TASK_MAX_DEPTH} levels deep at most`, { path: 'parent' });
    }
  }

  const now = store.now();
  const status = data.status ?? 'todo';
  const row: Row = {
    id,
    title: data.title,
    status,
    priority: data.priority ?? 'none',
    assignee,
    dueDate: data.dueDate ?? null,
    parentId: data.parent ?? null,
    work: null,
    runId: null,
    version: 1,
    createdBy: structuredClone(store.actor),
    updatedBy: structuredClone(store.actor),
    createdAt: now,
    updatedAt: now,
    statusChangedAt: now,
    closedAt: isTaskClosed(status) ? now : null,
    body,
    links: [...mentionLinks(store, body, id), ...about],
    depth,
    ...(data.key ? { key: data.key } : {}),
  };
  store.tasks.push(row);
  addActivity(store, id, 'created');
  store.emit({ type: 'task.changed', taskId: id, action: 'created', status, assignee });

  if (assignee) {
    store.emit({ type: 'task.changed', taskId: id, action: 'assigned', assignee });
  }

  return publicTask(store, row);
};

export const updateTask = (store: MockStore, id: string, patch: TaskPatch): Task => {
  assertUuid(id, 'task');
  const parsed = TaskPatchSchema.safeParse(patch);

  if (!parsed.success) {
    throw validation('Invalid task', parsed.error.issues);
  }

  const data = parsed.data;
  const body = bodyOf(data);

  if (body) {
    checkedBody(body);
  }

  if (data.dueDate) {
    assertDate(data.dueDate, 'dueDate');
  }

  const row = find(store, id);

  if (data.expectedVersion !== undefined && row.version !== data.expectedVersion) {
    throw new DeviasApiError(409, 'CONFLICT', 'This task was changed by someone else since it was read', {
      currentVersion: row.version,
    });
  }

  const assignee = data.assignee === undefined ? undefined : assigneeOf(data.assignee);
  const about = data.about === undefined ? undefined : aboutLinks(store, data.about, id);
  const changes: TaskChange[] = [];
  const now = store.now();

  if (data.parent !== undefined && data.parent !== row.parentId) {
    let depth = 0;

    if (data.parent !== null) {
      assertUuid(data.parent, 'task');
      const subtree = subtreeOf(store, id);
      const parent = store.tasks.find((candidate) => candidate.id === data.parent && !candidate.deleted);

      if (!parent) {
        throw validation(`Unknown parent task "${data.parent}"`, { path: 'parent' });
      }

      if (parent.id === id || subtree.some((member) => member.id === parent.id)) {
        throw validation('A task cannot be moved under itself or its subtasks', { path: 'parent' });
      }

      depth = parent.depth + 1;
    }

    const subtree = subtreeOf(store, id);
    const height = Math.max(0, ...subtree.map((member) => member.depth)) - row.depth;

    if (depth + height > TASK_MAX_DEPTH) {
      throw validation(`Subtasks go ${TASK_MAX_DEPTH} levels deep at most`, { path: 'parent' });
    }

    const delta = depth - row.depth;

    for (const member of subtree) {
      member.depth += delta;
    }

    changes.push({ field: 'parent', from: row.parentId, to: data.parent });
    row.parentId = data.parent;
    row.depth = depth;
  }

  if (data.title !== undefined && data.title !== row.title) {
    changes.push({ field: 'title', from: row.title, to: data.title });
    row.title = data.title;
  }

  if (body && JSON.stringify(body) !== JSON.stringify(row.body)) {
    changes.push({ field: 'description' });
    row.body = body;
    row.links = [...mentionLinks(store, body, id), ...row.links.filter((link) => link.role === 'about')];
  }

  if (data.priority !== undefined && data.priority !== row.priority) {
    changes.push({ field: 'priority', from: row.priority, to: data.priority });
    row.priority = data.priority;
  }

  if (data.dueDate !== undefined && data.dueDate !== row.dueDate) {
    changes.push({ field: 'dueDate', from: row.dueDate, to: data.dueDate });
    row.dueDate = data.dueDate;
  }

  let statusChanged = false;

  if (data.status !== undefined && data.status !== row.status) {
    changes.push({ field: 'status', from: row.status, to: data.status });
    row.status = data.status;
    row.statusChangedAt = now;
    row.closedAt = isTaskClosed(data.status) ? now : null;
    statusChanged = true;

    if (isTaskClosed(data.status)) {
      row.work = null;
    }
  }

  let assigned = false;

  if (assignee !== undefined && assignee !== row.assignee) {
    changes.push({ field: 'assignee', from: row.assignee, to: assignee });
    row.assignee = assignee;
    row.work = null;
    assigned = true;
  }

  if (about !== undefined) {
    const current = row.links
      .filter((link) => link.role === 'about')
      .map((link) => link.link)
      .sort();
    const next = about.map((link) => link.link).sort();

    if (JSON.stringify(current) !== JSON.stringify(next)) {
      changes.push({ field: 'about', from: current, to: next });
      row.links = [...row.links.filter((link) => link.role === 'mention'), ...about];
    }
  }

  if (changes.length === 0) {
    return publicTask(store, row);
  }

  row.version += 1;
  row.updatedBy = structuredClone(store.actor);
  row.updatedAt = now;
  addActivity(store, id, 'changed', { data: { changes } });
  store.emit({ type: 'task.changed', taskId: id, action: 'updated', changes: changes.map((change) => change.field) });

  if (statusChanged) {
    store.emit({ type: 'task.changed', taskId: id, action: 'status_changed', status: row.status });
  }

  if (assigned) {
    store.emit({ type: 'task.changed', taskId: id, action: 'assigned', assignee: row.assignee });
  }

  return publicTask(store, row);
};

export const deleteTask = (store: MockStore, id: string): void => {
  const row = find(store, id);
  const now = store.now();

  for (const removed of [row, ...subtreeOf(store, id)]) {
    removed.deleted = true;
    removed.updatedAt = now;
    delete removed.key;
    store.emit({ type: 'task.changed', taskId: removed.id, action: 'deleted' });
  }
};

export const listTaskActivity = (store: MockStore, id: string, query: TaskActivityQuery = {}): TaskActivityPage => {
  find(store, id);
  const parsed = TaskActivityQuerySchema.safeParse(query);

  if (!parsed.success) {
    throw validation('Invalid timeline query', parsed.error.issues);
  }

  const after = parsed.data.cursor === undefined ? undefined : decodeTaskActivityCursor(parsed.data.cursor);

  if (parsed.data.cursor !== undefined && !after) {
    throw new DeviasApiError(400, 'INVALID_CURSOR', 'The timeline cursor is malformed');
  }

  const all = store.taskActivity
    .filter((entry) => entry.taskId === id)
    .sort((a, b) => (a.createdAt === b.createdAt ? b.id.localeCompare(a.id) : b.createdAt.localeCompare(a.createdAt)));
  const rest = after
    ? all.filter(
        (entry) =>
          entry.createdAt < after.createdAt ||
          (entry.createdAt === after.createdAt && entry.id.localeCompare(after.id) < 0),
      )
    : all;
  const limit = parsed.data.limit ?? TASK_ACTIVITY_DEFAULT_LIMIT;
  const page = rest.slice(0, limit);
  const last = page.at(-1);

  return {
    items: structuredClone(page),
    nextCursor: rest.length > limit && last ? encodeTaskActivityCursor(last.createdAt, last.id) : null,
  };
};

export const commentOnTask = (store: MockStore, id: string, input: TaskComment): TaskActivityEntry => {
  const row = find(store, id);
  const parsed = TaskCommentSchema.safeParse(input);

  if (!parsed.success) {
    throw validation('Invalid comment', parsed.error.issues);
  }

  const entry = addActivity(store, id, 'comment', { body: parsed.data.markdown });
  row.updatedAt = entry.createdAt;
  store.emit({ type: 'task.changed', taskId: id, action: 'commented' });

  return structuredClone(entry);
};

/** The mock runs no agents, so a task has no runs. */
export const listTaskRuns = (store: MockStore, id: string): TaskRunPage => {
  find(store, id);

  return { items: [] };
};

export const stopTask = (store: MockStore, id: string): Task => {
  const row = find(store, id);

  if (row.work !== 'working' && row.work !== 'waiting_on_you') {
    throw new DeviasApiError(409, 'CONFLICT', 'No agent is working on this task');
  }

  row.work = 'failed';
  row.version += 1;
  row.updatedAt = store.now();
  addActivity(store, id, 'run', { data: { outcome: 'stopped' } });
  store.emit({ type: 'task.changed', taskId: id, action: 'updated', changes: ['work'] });

  return publicTask(store, row);
};

export const retryTask = (store: MockStore, id: string): Task => {
  const row = find(store, id);

  if (!row.assignee?.startsWith('agent:') || row.work !== 'failed') {
    throw new DeviasApiError(409, 'CONFLICT', 'The agent has not failed or been stopped on this task');
  }

  row.work = null;
  row.status = 'todo';
  row.closedAt = null;
  row.version += 1;
  row.updatedAt = store.now();
  addActivity(store, id, 'run', { data: { outcome: 'retried' } });
  store.emit({ type: 'task.changed', taskId: id, action: 'updated', changes: ['work'] });

  return publicTask(store, row);
};

export const countTasks = (store: MockStore, query: TaskCountsQuery = {}): TaskCounts => {
  const parsed = TaskCountsQuerySchema.safeParse(query);

  if (!parsed.success) {
    throw validation('Invalid counts query', parsed.error.issues);
  }

  const day = todayOf(store, parsed.data);
  const person = personOf(store.actor);
  const rows = live(store);
  const open = rows.filter((row) => !CLOSED_TASK_STATUSES.includes(row.status));

  return {
    open: open.length,
    overdue: open.filter((row) => row.dueDate !== null && row.dueDate < day).length,
    dueToday: open.filter((row) => row.dueDate === day).length,
    dueThisWeek: open.filter((row) => row.dueDate !== null && row.dueDate >= day && row.dueDate <= addDays(day, 6))
      .length,
    inReview: rows.filter((row) => row.status === 'in_review').length,
    mine: open.filter((row) => person !== null && row.assignee === `user:${person}`).length,
    agentsWorking: rows.filter((row) => row.work === 'working').length,
    byStatus: Object.fromEntries(
      TASK_STATUSES.map((status) => [status, rows.filter((row) => row.status === status).length]),
    ),
  };
};
