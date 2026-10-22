import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ACTION_AREA_BY_TAG,
  ACTIONS,
  AI_TOOL_AREAS,
  areaOfAction,
  defineActionSpec,
  getSchema,
  objectActions,
  workflowActions,
} from '../src';

const commentOn = defineActionSpec({
  id: 'core.test_comment',
  summary: 'Comment on a record',
  tags: ['test'],
  permission: 'record.write',
  params: z.object({ object: z.string(), id: z.string() }),
  query: z.object({ notify: z.enum(['true', 'false']).optional() }),
  body: z.object({ body: z.string().min(1), object: z.string().optional() }),
  output: z.object({ ok: z.boolean() }),
  http: { method: 'post', path: '/api/workspaces/{workspaceId}/records/{object}/{id}/comments', status: 201 },
});

describe('defineActionSpec', () => {
  it('derives approval, status, errors and descriptions from the method', () => {
    expect(getSchema.approval).toBe('auto');
    expect(getSchema.http).toMatchObject({ status: 200, errors: [401, 403] });
    expect(objectActions.get.http.errors).toEqual([401, 403, 404]);
    expect(objectActions.create).toMatchObject({ approval: 'approve', locked: false });
    expect(objectActions.create.http.errors).toEqual([400, 401, 403, 404, 409]);
    expect(objectActions.delete.output).toBeNull();
    expect(objectActions.delete.http.status).toBe(204);
  });

  it('merges body, query and path params into one input object, the path winning', () => {
    expect(Object.keys(commentOn.input.shape)).toEqual(['body', 'object', 'notify', 'id']);
    expect(commentOn.parse({ object: 'person', id: 'p1', body: 'Hi', notify: 'true' })).toEqual({
      body: 'Hi',
      notify: 'true',
      object: 'person',
      id: 'p1',
    });
  });

  it('validates each part with its own schema', () => {
    expect(() => commentOn.parse({ object: 'person', id: 'p1', body: '' })).toThrow();
    expect(() => commentOn.parse({ object: 'person', body: 'Hi' })).toThrow();
    expect(() => commentOn.parse('nope')).toThrow();
  });

  it('carries a non-object body under its bodyField', () => {
    const create = defineActionSpec({
      id: 'core.test_create',
      summary: 'Create',
      tags: ['test'],
      permission: 'record.write',
      params: z.object({ object: z.string() }),
      body: z.record(z.string(), z.unknown()),
      bodyField: 'values',
      output: z.object({ id: z.string() }),
      http: { method: 'post', path: '/api/workspaces/{workspaceId}/records/{object}' },
    });
    expect(Object.keys(create.input.shape)).toEqual(['values', 'object']);
    expect(create.parse({ object: 'person', values: { name: 'Ada' } })).toEqual({
      object: 'person',
      values: { name: 'Ada' },
    });
  });

  it('refuses specs whose params do not match the path, or that live outside a workspace', () => {
    const base = { summary: 'x', tags: [], permission: 'record.read' } as const;
    expect(() =>
      defineActionSpec({
        ...base,
        id: 'core.a',
        http: { method: 'get', path: '/api/workspaces/{workspaceId}/records/{object}' },
      }),
    ).toThrow(/must match the path/);
    expect(() => defineActionSpec({ ...base, id: 'core.b', http: { method: 'get', path: '/api/health' } })).toThrow(
      /must live under/,
    );
    expect(() =>
      defineActionSpec({
        ...base,
        id: 'core.c',
        body: z.array(z.string()),
        http: { method: 'post', path: '/api/workspaces/{workspaceId}/things' },
      }),
    ).toThrow(/needs a bodyField/);
  });
});

describe('tool areas', () => {
  it('places every core action in an area', () => {
    // A new tag fails here, so the decision of where it belongs is made rather than defaulted.
    for (const spec of ACTIONS) {
      expect(ACTION_AREA_BY_TAG, spec.id).toHaveProperty(spec.tags[0] ?? '');
    }
  });

  it('places module actions in "actions" and the rest by what they work on', () => {
    expect(areaOfAction({ tags: ['modules'], module: 'email-resend' })).toBe('actions');
    expect(areaOfAction(objectActions.create)).toBe('model');
    expect(areaOfAction(getSchema)).toBe('model');
    expect(areaOfAction(workflowActions.create)).toBe('workflows');
  });

  it('only uses areas the list declares', () => {
    const keys = new Set(AI_TOOL_AREAS.map((a) => a.key));

    for (const area of Object.values(ACTION_AREA_BY_TAG)) {
      expect(keys.has(area)).toBe(true);
    }

    for (const spec of ACTIONS) {
      expect(keys.has(areaOfAction(spec)), spec.id).toBe(true);
    }
  });
});
