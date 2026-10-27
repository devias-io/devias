import {
  ACTIONS,
  AGENT_ACTIONS,
  type AnyActionSpec,
  coreIds,
  defineModule,
  moduleActionSpec,
  toolOfAction,
} from '@devias/core';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { createToolRegistry } from '../src/tools/registry';

const registry = (...specs: AnyActionSpec[]) =>
  createToolRegistry({
    engine: {} as never,
    actions: { specs: [...ACTIONS, ...specs], invoke: async () => undefined },
  });

const actionIds = new Map<string, string>();
/** The id of the action a module's `key` stands for: made once, so a test can name it again. */
const actionId = (module: string, key: string): string => {
  const at = `${module}:${key}`;
  actionIds.set(at, actionIds.get(at) ?? crypto.randomUUID());

  return actionIds.get(at) as string;
};

/** The specs of a module whose actions are `key: name` pairs: the id is made for the key, the tool is called the name. */
const moduleSpecs = (id: string, names: Record<string, string>): AnyActionSpec[] => {
  const manifest = defineModule({
    id,
    version: '0.1.0',
    actions: Object.entries(names).map(([key, name]) => ({ id: actionId(id, key), name, label: name })),
  });

  return manifest.actions.map((action) => moduleActionSpec(manifest, action, z.object({})));
};

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
  expect(toolOfAction('53c588d8-0909-4517-9dd7-ca87667bbf31')).toBeNull();
});

it('names a module action’s tool from its declaration: its `name`, not the end of its id', () => {
  const declared = [{ id: '01a1751f-5f18-7600-95e3-dd5d8976e579', name: 'recalc_quote' }];
  expect(toolOfAction('01a1751f-5f18-7600-95e3-dd5d8976e579', declared)).toBe('recalc_quote');
  expect(toolOfAction('01a1751f-5f18-7600-95e3-dd5d8976e579')).toBeNull();
  expect(toolOfAction('ec60d92a-d7cc-4550-a578-bf95de038f64', declared)).toBeNull();
});

it('calls a module’s tool by the action’s name alone, with no module in front of it', () => {
  const tools = registry(...moduleSpecs('01a1751f-5f0c-7611-94cf-03db7e1f9fa4', { send_email: 'send_mail' }));
  expect(tools.get('send_mail')).toMatchObject({ moduleId: '01a1751f-5f0c-7611-94cf-03db7e1f9fa4' });
  expect(tools.get('resend__send_email')).toBeUndefined();
  expect(tools.get('resend__send_mail')).toBeUndefined();
});

it('refuses a module action called like a tool core has, or like another module’s', () => {
  // A hand-written core tool: it would have answered the call, and the module's action had no tool.
  expect(() => registry(...moduleSpecs('01a1751f-5f0a-70f6-b258-c2c96a69790f', { send: 'list_modules' }))).toThrow(
    `The action "${actionId('01a1751f-5f0a-70f6-b258-c2c96a69790f', 'send')}" is called "list_modules", the name of a tool core has`,
  );
  // A core tool made from an action.
  expect(() => registry(...moduleSpecs('01a1751f-5f0a-70f6-b258-c2c96a69790f', { send: 'list_records' }))).toThrow(
    new RegExp(
      `"${actionId('01a1751f-5f0a-70f6-b258-c2c96a69790f', 'send')}".*"list_records"|"list_records".*"${actionId('01a1751f-5f0a-70f6-b258-c2c96a69790f', 'send')}"`,
    ),
  );
  // Another module's.
  expect(() =>
    registry(
      ...moduleSpecs('01a1751f-5f0a-70f6-b258-c2c96a69790f', { send: 'send' }),
      ...moduleSpecs('01a1751f-5f12-7042-ae38-d214e7113150', { send: 'send' }),
    ),
  ).toThrow(
    `The actions "${actionId('01a1751f-5f0a-70f6-b258-c2c96a69790f', 'send')}" and "${actionId('01a1751f-5f12-7042-ae38-d214e7113150', 'send')}" are both called "send"`,
  );
  // The same key is no clash when the names differ.
  expect(() =>
    registry(
      ...moduleSpecs('01a1751f-5f0a-70f6-b258-c2c96a69790f', { send: 'send_mail' }),
      ...moduleSpecs('01a1751f-5f12-7042-ae38-d214e7113150', { send: 'send_text' }),
    ),
  ).not.toThrow();
});
