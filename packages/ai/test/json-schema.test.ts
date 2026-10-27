import { ACTIONS, AI_TOOL_AREAS } from '@devias/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { effectiveApproval, sanitizeOverrides } from '../src/runtime/approval';
import { builtinAdapters } from '../src/tools/adapters';
import { builtinTools as handWrittenTools } from '../src/tools/builtin';
import { assertToolName, toInputSchema } from '../src/tools/json-schema';
import { createToolRegistry } from '../src/tools/registry';

// The platform's curated tools: the hand-written ones, and those made from an action with an adapter.
const handWritten = new Set(handWrittenTools.map((tool) => tool.name));
const adapted = new Set(
  ACTIONS.filter((spec) => spec.id in builtinAdapters).flatMap((spec) => (spec.ai.tool === null ? [] : [spec.ai.tool])),
);
const everyTool = createToolRegistry({
  engine: {} as never,
  actions: { specs: ACTIONS, invoke: async () => undefined },
}).all();
const builtinTools = everyTool.filter((tool) => handWritten.has(tool.name) || adapted.has(tool.name));

describe('tool input schemas', () => {
  it('produces a draft-2020-12 object schema without $schema and keeps descriptions', () => {
    const schema = toInputSchema(
      z.object({
        object: z.string().describe('Object API name'),
        limit: z.number().int().optional(),
        any: z.unknown().optional(),
      }),
    );
    expect(schema.$schema).toBeUndefined();
    expect(schema.type).toBe('object');
    expect((schema.properties as Record<string, { description?: string }>).object?.description).toBe('Object API name');
    expect(schema.required).toEqual(['object']);
  });

  it('inlines a root schema registered with an id, so core schemas can be tool inputs', () => {
    const schema = toInputSchema(z.object({ name: z.string() }).meta({ id: 'NamedThing' }));
    expect(schema.type).toBe('object');
    expect(schema.$ref).toBeUndefined();
    expect(schema.required).toEqual(['name']);
  });

  it('rejects non-object roots and invalid names', () => {
    expect(() => toInputSchema(z.string())).toThrow(/object/);
    expect(() => assertToolName('bad name')).toThrow();
    expect(() => assertToolName('x'.repeat(65))).toThrow();
    expect(() => assertToolName('crm__send_digest')).not.toThrow();
  });

  it('every built-in tool has a valid name, description and object schema', () => {
    for (const tool of builtinTools) {
      expect(() => assertToolName(tool.name)).not.toThrow();
      expect(tool.description.length).toBeGreaterThan(20);
      expect(toInputSchema(tool.input).type).toBe('object');
    }
  });

  it('describes workflow steps recursively, so branches can hold branches', () => {
    const tool = builtinTools.find((t) => t.name === 'create_workflow');

    if (!tool) {
      throw new Error('missing create_workflow');
    }

    const schema = toInputSchema(tool.input) as {
      properties: { steps: { items: { $ref: string } } };
      $defs: Record<string, { oneOf?: { properties: Record<string, unknown> }[] }>;
    };
    expect(schema.properties.steps.items.$ref).toBe('#/$defs/WorkflowStepInput');
    const branch = schema.$defs.WorkflowStepInput?.oneOf?.find(
      (option) => (option.properties.kind as { const?: string }).const === 'branch',
    );
    expect(branch?.properties.yes).toEqual({ type: 'array', items: { $ref: '#/$defs/WorkflowStepInput' } });
    expect(schema.$defs.Filter).toBeDefined();
  });
});

describe('approval policy', () => {
  const byName = new Map(builtinTools.map((t) => [t.name, t]));
  it('ships the balanced defaults', () => {
    const auto = [
      'list_objects',
      'list_records',
      'create_record',
      'update_record',
      'list_workflows',
      'get_workflow',
      'list_workflow_runs',
      'navigate',
    ];
    const approve = [
      'delete_records',
      'create_object',
      'create_field',
      'update_field',
      'delete_field',
      'create_view',
      'update_view',
      'create_workflow',
      'update_workflow',
      'delete_workflow',
      'run_workflow',
    ];

    for (const name of auto) {
      expect(byName.get(name)?.approval, name).toBe('auto');
    }

    for (const name of approve) {
      expect(byName.get(name)?.approval, name).toBe('approve');
    }

    expect(byName.get('delete_field')?.locked).toBe(true);
  });

  it("applies an agent's overrides except on locked tools, refuses unknown ones, and keeps them as given", () => {
    const del = byName.get('delete_records');
    const delField = byName.get('delete_field');

    if (!del || !delField) {
      throw new Error('missing tools');
    }

    expect(effectiveApproval(del, { delete_records: 'auto' })).toBe('auto');
    expect(effectiveApproval(delField, { delete_field: 'auto' })).toBe('approve');
    const result = sanitizeOverrides(
      { delete_records: 'auto', delete_field: 'auto', nope: 'auto', list_objects: 'auto' },
      builtinTools,
    );
    // A mode equal to the tool's default is kept: an agent's own mode is its own, whatever the default is.
    expect(result.accepted).toEqual({ delete_records: 'auto', list_objects: 'auto' });
    expect(result.refused.sort()).toEqual(['delete_field', 'nope']);
  });
});

describe('tool metadata', () => {
  const byName = new Map(builtinTools.map((t) => [t.name, t]));

  it('gives every built-in tool an area from the core list', () => {
    const areas = new Set<string>(AI_TOOL_AREAS.map((area) => area.key));

    for (const tool of builtinTools) {
      expect(areas.has(tool.area), tool.name).toBe(true);
    }
  });

  it('flags the tools that reach beyond their name', () => {
    const escalating = builtinTools.filter((t) => t.escalates).map((t) => t.name);
    expect(escalating.sort()).toEqual(
      [
        'create_api_key',
        'create_workflow',
        'delete_workflow',
        'install_module',
        'run_workflow',
        'update_workflow',
      ].sort(),
    );
  });

  it('locks workflow authoring, whatever the overrides say', () => {
    for (const name of ['create_workflow', 'update_workflow']) {
      const tool = byName.get(name);

      if (!tool) {
        throw new Error(`missing ${name}`);
      }

      expect(tool.locked, name).toBe(true);
      expect(effectiveApproval(tool, { [name]: 'auto' }), name).toBe('approve');
    }

    expect(byName.get('run_workflow')?.locked).toBeFalsy();
    expect(byName.get('delete_workflow')?.locked).toBeFalsy();
  });
});
