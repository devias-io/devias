import { defineField, defineModule, defineObject } from '@devias/core';

/** A small to-do object the server tests write records to: a title, a status, a due date and a person. */
const chore = defineObject({
  id: 'chores.chore',
  nameSingular: 'chore',
  namePlural: 'chores',
  labelSingular: 'Chore',
  labelPlural: 'Chores',
  icon: 'check-square',
  primaryFieldId: 'chores.chore.title',
  fields: [
    defineField({ id: 'chores.chore.title', name: 'title', label: 'Title', type: 'text', isRequired: true }),
    defineField({ id: 'chores.chore.description', name: 'description', label: 'Description', type: 'rich_text' }),
    defineField({
      id: 'chores.chore.status',
      name: 'status',
      label: 'Status',
      type: 'select',
      settings: {
        options: [
          { value: 'todo', label: 'Todo', color: 'neutral' },
          { value: 'in_progress', label: 'In progress', color: 'orange' },
          { value: 'done', label: 'Done', color: 'green' },
        ],
      },
      defaultValue: 'todo',
      isRequired: true,
    }),
    defineField({ id: 'chores.chore.assignee', name: 'assignee', label: 'Assignee', type: 'member' }),
    defineField({ id: 'chores.chore.due_date', name: 'due_date', label: 'Due date', type: 'date' }),
  ],
});

export const choresManifest = defineModule({
  id: 'chores',
  version: '0.1.0',
  name: 'Chores',
  description: 'Things to do, for the server tests.',
  objects: [chore],
});
