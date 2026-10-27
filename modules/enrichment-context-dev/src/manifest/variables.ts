import { defineVariable } from '@devias/core';
import { ids } from './ids';

/** What a workspace can tune. */
export const variables = [
  defineVariable({
    id: ids.variables.min_match_score,
    label: 'Minimum match score',
    description:
      'How sure Context.dev must be that it found the right person, from 0 to 100. A lower score fills in more people, and risks filling in the wrong one.',
    defaultValue: '70',
  }),
];
