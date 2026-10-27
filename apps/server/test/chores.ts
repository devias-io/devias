import { defineField, defineModule, defineObject } from '@devias/core';

/** A small to-do object the server tests write records to: a title, a status, a due date and a person. */
const chore = defineObject({
  id: '01a1751f-5f02-7484-9416-08d9207b5437',
  nameSingular: 'chore',
  namePlural: 'chores',
  labelSingular: 'Chore',
  labelPlural: 'Chores',
  icon: 'check-square',
  primaryFieldId: '01a1751f-5f03-74c2-b95d-5b8dd97d297b',
  fields: [
    defineField({
      id: '01a1751f-5f03-74c2-b95d-5b8dd97d297b',
      name: 'title',
      label: 'Title',
      type: 'text',
      isRequired: true,
    }),
    defineField({
      id: '01a1751f-5f03-74c2-b95d-5c1bbcc68b4a',
      name: 'description',
      label: 'Description',
      type: 'rich_text',
    }),
    defineField({
      id: '01a1751f-5f03-74c2-b95d-63888ca7fb25',
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
    defineField({ id: '01a1751f-5f03-74c2-b95d-67822be73586', name: 'assignee', label: 'Assignee', type: 'member' }),
    defineField({ id: '01a1751f-5f03-74c2-b95d-69cc025e67c4', name: 'due_date', label: 'Due date', type: 'date' }),
  ],
});

export const choresManifest = defineModule({
  id: '01a1751f-5f03-74c2-b95d-6e6e78e49bd4',
  version: '0.1.0',
  label: 'Chores',
  description: 'Things to do, for the server tests.',
  objects: [chore],
});
