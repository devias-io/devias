import type { Workflow } from '@devias/core';
import { EngineError } from '@devias/data-engine';

/** A workflow named by its id or by its title, out of the workspace's workflows. */
export const workflowRef = (workflows: Workflow[], ref: string): Workflow => {
  const byId = workflows.find((w) => w.id === ref);

  if (byId) {
    return byId;
  }

  const needle = ref.trim().toLowerCase();
  const named = workflows.filter((w) => w.title.toLowerCase() === needle);

  if (named.length > 1) {
    throw new EngineError(
      'VALIDATION',
      `Several workflows are named "${ref}"; pass the id instead: ${named.map((w) => w.id).join(', ')}`,
    );
  }

  if (named[0]) {
    return named[0];
  }

  const known = workflows.map((w) => `${w.title} (${w.id})`).join(', ');

  throw new EngineError('NOT_FOUND', `Unknown workflow "${ref}". Workflows: ${known || 'none yet'}`);
};
