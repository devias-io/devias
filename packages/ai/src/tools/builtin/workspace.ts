import { CreateApiKeySchema, coreIds, personOf } from '@devias/core';
import { invokeAction } from '../actions';
import { revealToPerson } from '../secure';
import { defineTool } from '../types';

/** Workspace tools that hand something secret to the person and never to the model. */

export const createApiKey = defineTool({
  name: 'create_api_key',
  area: 'people',
  escalates: true,
  description:
    'Create a workspace API key for a script or another tool. The key is shown once to the person in the card and never to you. Permissions look like { "record": ["read", "write"], "metadata": ["read"] }; without them the key reads records only. Always asks for approval.',
  input: CreateApiKeySchema,
  approval: 'approve',
  locked: true,
  moduleId: null,
  available: (ctx, engine) => engine.permissions.can(ctx, 'apikey.manage') && personOf(ctx.actor) !== null,
  run: async (input, context) => {
    const { key, ...summary } = (await invokeAction(context, coreIds.actions.create_api_key, input)) as {
      key: string;
      name: string | null;
    };

    return revealToPerson({ ...summary, note: 'The key was shown to the person once; you never see it.' }, [
      { label: `API key "${summary.name ?? 'new key'}"`, value: key },
    ]);
  },
});
