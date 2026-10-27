import { describe, expect, it } from 'vitest';
import {
  assigneeRef,
  decodeTaskActivityCursor,
  decodeTaskCursor,
  encodeTaskActivityCursor,
  encodeTaskCursor,
  isTaskClosed,
  listOf,
  matchesTaskCondition,
  matchesTaskEventTrigger,
  parseAssigneeRef,
  TASK_FILTER_FIELDS,
  TASK_PRIORITY_RANK,
  TASK_STATUSES,
  type TaskChangedEvent,
  TaskEventTriggerSchema,
  TaskInputSchema,
  TaskPatchSchema,
  taskConditionRecord,
} from '../src';

describe('task contract', () => {
  it('closes with done and canceled only', () => {
    expect(TASK_STATUSES.filter(isTaskClosed)).toEqual(['done', 'canceled']);
    expect(TASK_PRIORITY_RANK.urgent).toBeLessThan(TASK_PRIORITY_RANK.none);
  });

  it('writes assignees as user:<id> or agent:<id>, and takes a bare id for a person', () => {
    expect(assigneeRef({ kind: 'agent', id: 'a1' })).toBe('agent:a1');
    expect(parseAssigneeRef('user:u1')).toEqual({ kind: 'user', id: 'u1' });
    expect(parseAssigneeRef('agent:a1')).toEqual({ kind: 'agent', id: 'a1' });
    expect(parseAssigneeRef('u1')).toEqual({ kind: 'user', id: 'u1' });
    expect(parseAssigneeRef('robot:1')).toBeNull();
    expect(parseAssigneeRef('agent:')).toBeNull();
    expect(parseAssigneeRef('  ')).toBeNull();
  });

  it('round-trips cursors and refuses junk', () => {
    const cursor = encodeTaskCursor('due', 'asc', '2026-10-22', 'id-1');
    expect(decodeTaskCursor(cursor)).toEqual({ sort: 'due', order: 'asc', key: '2026-10-22', id: 'id-1' });
    expect(decodeTaskCursor('junk')).toBeUndefined();
    expect(decodeTaskCursor(btoa(JSON.stringify(['nope', 'asc', 'k', 'i'])))).toBeUndefined();
    const entry = encodeTaskActivityCursor('2026-10-22T10:00:00.000Z', 'x');
    expect(decodeTaskActivityCursor(entry)).toEqual({ createdAt: '2026-10-22T10:00:00.000Z', id: 'x' });
    expect(decodeTaskActivityCursor('nonsense')).toBeUndefined();
    expect(decodeTaskActivityCursor('not a date|x')).toBeUndefined();
  });

  it('splits comma lists once', () => {
    expect(listOf(' a, b ,a,,c')).toEqual(['a', 'b', 'c']);
    expect(listOf(undefined)).toEqual([]);
  });

  it('checks inputs', () => {
    expect(TaskInputSchema.safeParse({ title: 'x' }).success).toBe(true);
    expect(TaskInputSchema.safeParse({ title: '  ' }).success).toBe(false);
    expect(TaskInputSchema.safeParse({ title: 'x', body: { type: 'doc' }, markdown: 'y' }).success).toBe(false);
    expect(TaskInputSchema.safeParse({ title: 'x', dueDate: '22/10/2026' }).success).toBe(false);
    expect(TaskInputSchema.safeParse({ title: 'x', assignee: 'robot:1' }).success).toBe(false);
    expect(TaskPatchSchema.safeParse({}).success).toBe(false);
    expect(TaskPatchSchema.safeParse({ expectedVersion: 1 }).success).toBe(false);
    expect(TaskPatchSchema.safeParse({ assignee: null }).success).toBe(true);
  });
});

describe('task triggers', () => {
  const event = (over: Partial<TaskChangedEvent> = {}): TaskChangedEvent => ({
    type: 'task.changed',
    sequence: 1,
    workspaceId: 'w',
    actor: { kind: 'user', id: 'u' },
    occurredAt: '2026-10-22T00:00:00.000Z',
    taskId: 't1',
    action: 'created',
    ...over,
  });

  it('matches the event type, and for status changes the status moved to', () => {
    const trigger = TaskEventTriggerSchema.parse({
      kind: 'task_event',
      types: ['created', 'status_changed'],
      statuses: ['done'],
    });
    expect(matchesTaskEventTrigger(trigger, event())).toBe(true);
    expect(matchesTaskEventTrigger(trigger, event({ action: 'commented' }))).toBe(false);
    expect(matchesTaskEventTrigger(trigger, event({ action: 'status_changed', status: 'done' }))).toBe(true);
    expect(matchesTaskEventTrigger(trigger, event({ action: 'status_changed', status: 'todo' }))).toBe(false);
    expect(matchesTaskEventTrigger(trigger, event({ action: 'deleted' }))).toBe(false);
    expect(TaskEventTriggerSchema.safeParse({ kind: 'task_event', types: ['deleted'] }).success).toBe(false);
  });

  it('tests the task as it is now over the fields every task has', () => {
    const trigger = TaskEventTriggerSchema.parse({
      kind: 'task_event',
      types: ['created'],
      condition: {
        and: [
          { field: 'priority', op: 'eq', value: 'urgent' },
          { field: 'assignee', op: 'eq', value: 'agent:a1' },
        ],
      },
    });
    const task = {
      id: 't1',
      title: 'x',
      status: 'todo' as const,
      priority: 'urgent' as const,
      assignee: 'agent:a1',
      dueDate: null,
      parentId: null,
    };
    expect(matchesTaskCondition(trigger, taskConditionRecord(task))).toBe(true);
    expect(matchesTaskCondition(trigger, taskConditionRecord({ ...task, priority: 'low' }))).toBe(false);
    expect(TASK_FILTER_FIELDS.map((field) => field.name)).toEqual([
      'title',
      'status',
      'priority',
      'assignee',
      'due_date',
      'parent',
    ]);
  });
});
