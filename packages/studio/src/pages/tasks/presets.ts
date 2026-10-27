import { CLOSED_TASK_STATUSES, TASK_STATUS_KINDS, TASK_STATUSES, type TaskQuery, type TaskStatus } from '@devias/core';

/** The ways the Tasks page slices work (who has it, when it is due), each a query. Which statuses is chosen apart. */
export interface TaskPreset {
  id: string;
  label: string;
  query: Omit<TaskQuery, 'cursor' | 'limit' | 'search' | 'scope'>;
  /** Which of the counts says how many open tasks are in it. */
  count?: 'open' | 'mine' | 'overdue' | 'dueThisWeek' | 'agentsWorking' | 'inReview';
}

export const TASK_PRESETS: readonly TaskPreset[] = [
  { id: 'open', label: 'All', query: {}, count: 'open' },
  { id: 'mine', label: 'My tasks', query: { assignee: 'me' }, count: 'mine' },
  { id: 'week', label: 'Due this week', query: { due: 'week', sort: 'due' }, count: 'dueThisWeek' },
  { id: 'overdue', label: 'Overdue', query: { due: 'overdue', sort: 'due' }, count: 'overdue' },
  { id: 'agents', label: 'With agents', query: { assignee: 'agents' } },
];

export const presetOf = (id: string | null | undefined): TaskPreset =>
  TASK_PRESETS.find((preset) => preset.id === id) ?? (TASK_PRESETS[0] as TaskPreset);

/** Which statuses the page shows, in the list and on the board alike: open work, closed work, or both. */
export const TASK_STATUS_SCOPES = [
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
  { value: 'all', label: 'All statuses' },
] as const;
export type TaskStatusScope = (typeof TASK_STATUS_SCOPES)[number]['value'];

/** The lanes of a board for a scope, in the order a task moves. */
export const lanesOf = (scope: TaskStatusScope): readonly TaskStatus[] =>
  scope === 'all'
    ? TASK_STATUSES
    : scope === 'closed'
      ? CLOSED_TASK_STATUSES
      : TASK_STATUSES.filter((status) => TASK_STATUS_KINDS[status] !== 'closed');
