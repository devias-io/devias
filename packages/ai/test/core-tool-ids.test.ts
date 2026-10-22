import { ACTIONS, AGENT_ACTIONS, coreIds, toolNameOfId, toolOfAction } from '@devias/core';
import { expect, it } from 'vitest';
import { createToolRegistry } from '../src/tools/registry';

const registry = () =>
  createToolRegistry({
    engine: {} as never,
    actions: { specs: ACTIONS, invoke: async () => undefined },
  });

it('serves every tool the platform has from an action, or from one of the agent’s own', () => {
  const core = registry()
    .all()
    .filter((tool) => tool.moduleId === null)
    .map((tool) => tool.name)
    .sort();
  const served = [
    ...ACTIONS.flatMap((spec) => (spec.ai.tool === null ? [] : [spec.ai.tool])),
    ...AGENT_ACTIONS.map((one) => one.tool),
  ];

  expect([...new Set(served)].sort()).toEqual(core);
});

it('names the tool an action is served by', () => {
  expect(toolOfAction(coreIds.actions.list_records)).toBe('list_records');
  // A tool may be served by an action with another key: the labelled read is `get_record`.
  expect(toolOfAction(coreIds.actions.get_record_with_labels)).toBe('get_record');
  expect(toolOfAction(coreIds.actions.ask_user)).toBe('ask_user');
  expect(toolOfAction(coreIds.actions.navigate)).toBe('navigate');
  // An action no tool serves, and one that does not exist.
  expect(toolOfAction(coreIds.actions.stop_task_run)).toBe('stop_task_run');
  expect(toolOfAction(coreIds.actions.get_record)).toBeNull();
  expect(toolOfAction('core.fly_to_the_moon')).toBeNull();
  expect(toolOfAction('crm.recalculate_quote')).toBe('crm__recalculate_quote');
});

it('calls a tool by its name: a core tool by what follows `core.`, a module tool by its namespaced action', () => {
  expect(toolNameOfId('core.list_records')).toBe('list_records');
  expect(toolNameOfId('crm.recalculate_quote')).toBe('crm__recalculate_quote');
  expect(toolNameOfId('email-resend.send_email')).toBe('email_resend__send_email');
});
