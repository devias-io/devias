import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  AGENT_ACTIONS,
  coreBlockDeclarations,
  coreIds,
  idsInTree,
  SYSTEM_FIELD_IDS,
  TASK_FILTER_FIELDS,
} from '../src';

describe('coreIds', () => {
  it("writes down exactly the ids of the platform's actions (the agent's own included), blocks and system fields, and the task object with its fields", () => {
    // The tools are checked against the tool registry, in the ai package.
    expect(idsInTree(coreIds).sort()).toEqual(
      [
        ...ACTIONS.map((action) => action.id),
        ...AGENT_ACTIONS.map((action) => action.id),
        ...coreBlockDeclarations.map((block) => block.id),
        ...Object.values(SYSTEM_FIELD_IDS),
        coreIds.objects.task,
        ...TASK_FILTER_FIELDS.map((field) => field.id),
      ].sort(),
    );
  });
});
