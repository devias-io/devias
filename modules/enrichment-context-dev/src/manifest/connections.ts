import { defineConnection } from '@devias/core';
import { ids } from './ids';

/** The workspace's Context.dev account: an API key. */
export const connections = [
  defineConnection({
    id: ids.connections.default,
    kind: 'api_key',
    label: 'Context.dev',
    fields: [
      {
        name: 'api_key',
        label: 'API key',
        help: 'From your Context.dev dashboard. Each match costs 20 credits.',
      },
    ],
  }),
];
