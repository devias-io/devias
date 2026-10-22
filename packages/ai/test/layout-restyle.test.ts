import { type LayoutInput, layoutActions } from '@devias/core';
import { afterEach, describe, expect, it } from 'vitest';
import { text, toolUse } from '../src/testing';
import type { ActionsPort } from '../src/tools/types';
import { createHarness, eventsOf, type Harness, resolve, send } from './helpers';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

/** The two layout actions, run on the engine as the server's registry would. */
const layoutPort = (harness: () => Harness): ActionsPort => ({
  specs: [layoutActions.create, layoutActions.update],
  invoke: async (ctx, id, input) => {
    const { metadata } = harness().engine;

    if (id === 'core.create_layout') {
      return metadata.layouts.create(ctx, input as LayoutInput);
    }

    const { id: layoutId, ...patch } = input as { id: string } & Partial<LayoutInput>;

    return metadata.layouts.update(ctx, layoutId, patch);
  },
});

const cell = (name: string, block: string, config: Record<string, unknown> = {}) => ({
  name,
  blockId: block,
  label: '',
  config,
});

describe('the agent restyling an object', () => {
  it('gives a workspace object a document layout, and corrects a layout its shape refuses', async () => {
    h = await createHarness([], { actions: layoutPort(() => h as Harness) });
    const { engine, owner } = h;
    const object = await engine.metadata.objects.create(owner, {
      nameSingular: 'meeting_note',
      namePlural: 'meeting_notes',
      labelSingular: 'Meeting note',
      labelPlural: 'Meeting notes',
    });
    await engine.metadata.fields.create(owner, { objectId: object.id, name: 'title', type: 'text', label: 'Title' });
    await engine.metadata.fields.create(owner, {
      objectId: object.id,
      name: 'notes',
      type: 'rich_text',
      label: 'Notes',
    });
    const body = [cell('title', 'core.title'), cell('body', 'core.rich_text', { field: 'notes' })];
    h.model.push(
      {
        content: [
          text('Making it read like a document.'),
          // `tabs` belong to the `tabs` shape: a `column` is one list of `blocks`, so the shape refuses it.
          toolUse(
            'create_layout',
            {
              objectId: 'meeting_note',
              label: 'Note',
              isDefault: true,
              shell: 'column',
              tabs: [{ name: 'main', label: 'Note', blocks: body }],
            },
            'tu_bad',
          ),
        ],
      },
      {
        content: [
          toolUse(
            'create_layout',
            {
              objectId: 'meeting_note',
              label: 'Note',
              isDefault: true,
              shell: 'column',
              blocks: body,
            },
            'tu_good',
          ),
        ],
      },
      { content: [text('Done: meeting notes are a column now.')] },
    );
    const id = (await h.service.conversations.create(owner, {})).id;
    let events = await send(h, owner, id, 'make meeting notes look like a document');
    const results = eventsOf(events, 'tool_result');

    // Each call is gated like any change to the data model: approve it and the turn goes on.
    for (let round = 0; round < 4; round++) {
      const pending = eventsOf(events, 'paused')[0]?.pending[0];

      if (!pending) {
        break;
      }

      events = await resolve(h, owner, id, pending.id, true);
      results.push(...eventsOf(events, 'tool_result'));
    }

    // The first call comes back as an error that says what to change; the second goes through.
    expect(results.map((result) => result.isError)).toEqual([true, false]);
    expect(JSON.stringify(results[0]?.result)).toContain('column\\" layout is one list of `blocks`');
    const layouts = (await engine.metadata.layouts.list(owner)).filter((layout) => layout.objectId === object.id);
    expect(layouts).toHaveLength(1);
    const [stored] = layouts;
    expect(stored).toMatchObject({ shell: 'column', isDefault: true });
    expect(stored?.shell === 'column' ? stored.blocks.map((blockCell) => blockCell.blockId) : []).toEqual([
      'core.title',
      'core.rich_text',
    ]);
    expect(stored && 'tabs' in stored).toBe(false);
  });
});
