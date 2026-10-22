import { defineActionSpec } from '@devias/core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { shapeOutput, toolsFromActions } from '../src/tools/actions';
import type { ActionsPort, ToolRunContext } from '../src/tools/types';

const archive = defineActionSpec({
  id: 'core.things_archive',
  summary: 'Archive a thing',
  description: 'It disappears from lists.',
  tags: ['things'],
  permission: 'record.write',
  params: z.object({ id: z.string() }),
  output: z.object({ id: z.string(), archived: z.boolean() }),
  http: { method: 'post', path: '/api/workspaces/{workspaceId}/things/{id}/archive' },
});
const list = defineActionSpec({
  id: 'core.things_list',
  summary: 'List things',
  tags: ['things'],
  permission: 'record.read',
  ai: { tool: 'list_things_by_hand' },
  output: z.array(z.string()),
  http: { method: 'get', path: '/api/workspaces/{workspaceId}/things' },
});
const secret = defineActionSpec({
  id: 'core.things_secret',
  summary: 'Reveal a secret',
  tags: ['things'],
  permission: 'ai.manage',
  sessionOnly: true,
  locked: true,
  ai: { tool: 'reveal_secret' },
  http: { method: 'post', path: '/api/workspaces/{workspaceId}/things/secret' },
});
const hidden = defineActionSpec({
  id: 'core.things_hidden',
  summary: 'Hidden',
  tags: ['things'],
  permission: 'record.read',
  ai: { tool: null, category: 'covered_by', reason: 'Served elsewhere.' },
  http: { method: 'get', path: '/api/workspaces/{workspaceId}/things/hidden' },
});

const engine = {
  permissions: {
    can: (ctx: { role: string | null }, action: string) =>
      ctx.role === 'owner' || (ctx.role === 'member' && action.startsWith('record.')),
  },
} as never;

describe('tools generated from actions', () => {
  const invoke = vi.fn(async (_ctx: unknown, id: string, input: unknown) =>
    id === 'core.things_archive' ? { id: (input as { id: string }).id, archived: true } : undefined,
  );
  const port: ActionsPort = { specs: [archive, list, secret, hidden], invoke };
  const tools = toolsFromActions(port, new Set(['list_things_by_hand']));

  it('generates one tool per exposed action that nothing hand-writes', () => {
    expect(tools.map((tool) => tool.name)).toEqual(['things_archive', 'reveal_secret']);
    const [tool] = tools;

    if (!tool) {
      throw new Error('missing things_archive');
    }

    expect(tool).toMatchObject({
      approval: 'approve',
      locked: false,
      moduleId: null,
      area: 'actions',
      escalates: false,
    });
    expect(tool.description).toBe('Archive a thing. It disappears from lists.');
    expect(Object.keys((tool.input as z.ZodObject).shape)).toEqual(['id']);
  });

  it('offers a tool only to callers with its permission, and session-only tools only to people', () => {
    const [archiveTool, secretTool] = tools;
    const member = { workspaceId: 'w', actor: { kind: 'user', id: 'u' }, role: 'member' };
    const owner = { ...member, role: 'owner' };
    const key = { workspaceId: 'w', actor: { kind: 'api_key', id: 'k' }, role: 'owner' };
    expect(archiveTool?.available?.(member as never, engine)).toBe(true);
    expect(secretTool?.available?.(member as never, engine)).toBe(false);
    expect(secretTool?.available?.(owner as never, engine)).toBe(true);
    expect(secretTool?.available?.(key as never, engine)).toBe(false);
  });

  it('runs through the host and shapes the result', async () => {
    const [archiveTool, secretTool] = tools;
    const context = { ctx: { workspaceId: 'w' }, actions: port } as unknown as ToolRunContext;
    expect(await archiveTool?.run({ id: 't1' }, context)).toEqual({ id: 't1', archived: true });
    expect(invoke).toHaveBeenCalledWith({ workspaceId: 'w' }, 'core.things_archive', { id: 't1' });
    expect(await secretTool?.run({}, context)).toEqual({ done: true });
    await expect(archiveTool?.run({ id: 't1' }, { ctx: {} } as unknown as ToolRunContext)).rejects.toMatchObject({
      code: 'MISSING_DEPENDENCY',
    });
  });

  it('refuses two actions naming the same tool when nothing hand-writes it', () => {
    const twin = defineActionSpec({
      id: 'core.things_twin',
      summary: 'Twin',
      tags: [],
      permission: 'record.read',
      ai: { tool: 'things_archive' },
      http: { method: 'get', path: '/api/workspaces/{workspaceId}/twin' },
    });
    expect(() => toolsFromActions({ specs: [archive, twin], invoke }, new Set())).toThrow(/both name the tool/);
  });
});

describe('shapeOutput', () => {
  it('passes small results through and stands in for empty ones', () => {
    expect(shapeOutput({ a: 1 })).toEqual({ a: 1 });
    expect(shapeOutput(undefined)).toEqual({ done: true });
  });

  it('keeps the first items of a long list and cuts what is still too large', () => {
    const long = shapeOutput(Array.from({ length: 120 }, (_, i) => i)) as { items: number[]; total: number };
    expect(long.items).toHaveLength(50);
    expect(long.total).toBe(120);
    const huge = shapeOutput({ blob: 'x'.repeat(50_000) }) as { truncated: string; preview: string };
    expect(huge.truncated).toMatch(/too large/);
    expect(huge.preview.length).toBe(20_000);
  });
});
