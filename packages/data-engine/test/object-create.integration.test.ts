import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readEventsAfter } from '../src';
import { createTestEngine, type TestEngine } from './helpers/db';

describe('making an object with what goes with it', () => {
  let t: TestEngine;
  const meta = () => t.engine.metadata;
  const snapshot = async () => (await meta().getSnapshot(t.workspaceId)).index;
  const events = async (after: number) => (await readEventsAfter(t.db, t.workspaceId, after, 100)).map((e) => e.type);

  beforeAll(async () => {
    t = await createTestEngine();
  });
  afterAll(() => t.close());

  it('makes the object, its fields in order, the table that lists them and the sidebar row as one change', async () => {
    const sequence = await t.engine.events.currentSequence(t.workspaceId);
    const version = (await meta().getSnapshot(t.workspaceId)).version;
    const navBefore = (await snapshot()).schema.navItems.length;
    const object = await meta().objects.create(t.owner, {
      nameSingular: 'ticket',
      namePlural: 'tickets',
      labelSingular: 'Ticket',
      labelPlural: 'Tickets',
      icon: 'ticket',
      fields: [
        { name: 'subject', type: 'text', label: 'Subject' },
        { name: 'currency', type: 'text', label: 'Currency' },
        { name: 'price', type: 'money', label: 'Price', settings: { currencyFieldId: 'currency' } },
        {
          name: 'duplicate_of',
          type: 'relation',
          label: 'Duplicate of',
          settings: { relationType: 'many_to_one', targetObjectId: 'ticket' },
        },
      ],
    });

    // One change: one metadata version and one event, whatever it holds.
    expect((await meta().getSnapshot(t.workspaceId)).version).toBe(version + 1);
    expect(await events(sequence)).toEqual(['metadata.changed']);

    const index = await snapshot();
    const fields = index.fieldsByObjectId.get(object.id) ?? [];
    expect(fields.map((f) => [f.name, f.position])).toEqual([
      ['subject', 0],
      ['currency', 1],
      ['price', 2],
      ['duplicate_of', 3],
    ]);
    // The first field names a record, a money field's currency field is the earlier field of that name, and a
    // relation may point at the object being made.
    expect(index.objectsById.get(object.id)?.primaryFieldId).toBe(fields[0]?.id);
    const price = fields.find((f) => f.name === 'price');
    expect(price?.settings).toMatchObject({ currencyFieldId: fields.find((f) => f.name === 'currency')?.id });
    expect(fields.find((f) => f.name === 'duplicate_of')?.settings).toMatchObject({ targetObjectId: object.id });

    const views = index.viewsByObjectId.get(object.id) ?? [];
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({ label: 'All tickets', type: 'table', isDefault: true, moduleId: null });
    expect(views[0]?.config.fields.map((f) => f.fieldId)).toEqual(fields.map((f) => f.id));

    const rows = index.schema.navItems.filter((n) => n.target.kind === 'object' && n.target.objectId === object.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: 'Tickets', icon: 'ticket', parentId: null });
    expect(index.schema.navItems).toHaveLength(navBefore + 1);
  });

  it('makes an object with no fields a table and a row too, and leaves the row out when told to', async () => {
    const bare = await meta().objects.create(t.owner, {
      nameSingular: 'note_card',
      namePlural: 'note_cards',
      labelSingular: 'Note card',
      labelPlural: 'Note cards',
    });
    const quiet = await meta().objects.create(t.owner, {
      nameSingular: 'secret',
      namePlural: 'secrets',
      labelSingular: 'Secret',
      labelPlural: 'Secrets',
      addToNavigation: false,
    });
    const index = await snapshot();
    expect(index.viewsByObjectId.get(bare.id)?.[0]).toMatchObject({ isDefault: true, config: { fields: [] } });
    const rowFor = (id: string) =>
      index.schema.navItems.filter((n) => n.target.kind === 'object' && n.target.objectId === id);
    expect(rowFor(bare.id)).toHaveLength(1);
    expect(rowFor(quiet.id)).toHaveLength(0);
    expect(index.viewsByObjectId.get(quiet.id)).toHaveLength(1);
  });

  it('leaves nothing behind when one of its fields is refused', async () => {
    const sequence = await t.engine.events.currentSequence(t.workspaceId);
    const version = (await meta().getSnapshot(t.workspaceId)).version;
    const before = await snapshot();

    await expect(
      meta().objects.create(t.owner, {
        nameSingular: 'broken',
        namePlural: 'brokens',
        labelSingular: 'Broken',
        labelPlural: 'Brokens',
        fields: [
          { name: 'title', type: 'text', label: 'Title' },
          { name: 'title', type: 'text', label: 'Title again' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const after = await snapshot();
    expect((await meta().getSnapshot(t.workspaceId)).version).toBe(version);
    expect(await events(sequence)).toEqual([]);
    expect(after.objectsByName.has('broken')).toBe(false);
    expect(after.schema.fields).toHaveLength(before.schema.fields.length);
    expect(after.schema.views).toHaveLength(before.schema.views.length);
    expect(after.schema.navItems).toHaveLength(before.schema.navItems.length);
  });

  it('refuses a currency field that is not an earlier field of the new object', async () => {
    await expect(
      meta().objects.create(t.owner, {
        nameSingular: 'invoice_line',
        namePlural: 'invoice_lines',
        labelSingular: 'Line',
        labelPlural: 'Lines',
        fields: [{ name: 'price', type: 'money', label: 'Price', settings: { currencyFieldId: 'currency' } }],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('still refuses a primary field for an object that has no fields yet', async () => {
    await expect(
      meta().objects.create(t.owner, {
        nameSingular: 'pre_primary',
        namePlural: 'pre_primaries',
        labelSingular: 'P',
        labelPlural: 'Ps',
        primaryFieldId: 'workspace.nope',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('shows a new field in the workspace’s table of an object, but not in a module’s', async () => {
    const own = await meta().objects.create(t.owner, {
      nameSingular: 'gadget',
      namePlural: 'gadgets',
      labelSingular: 'Gadget',
      labelPlural: 'Gadgets',
      fields: [{ name: 'name', type: 'text', label: 'Name' }],
    });
    const field = await meta().fields.create(t.owner, {
      objectId: own.id,
      name: 'colour',
      type: 'text',
      label: 'Colour',
    });
    const ownTable = (await snapshot()).viewsByObjectId.get(own.id)?.find((v) => v.isDefault);
    expect(ownTable?.config.fields.map((f) => f.fieldId)).toContain(field.id);

    // The fixture's person has a view of the module's own: a workspace's field leaves it as the module wrote it.
    const person = (await snapshot()).objectsByName.get('person');
    const moduleTable = (await snapshot()).viewsByObjectId.get(person?.id ?? '')?.find((v) => v.moduleId !== null);
    expect(moduleTable).toBeDefined();
    const extra = await meta().fields.create(t.owner, {
      objectId: person?.id ?? '',
      name: 'nickname',
      type: 'text',
      label: 'Nickname',
    });
    const after = (await snapshot()).viewsByObjectId.get(person?.id ?? '')?.find((v) => v.id === moduleTable?.id);
    expect(after?.config.fields.some((f) => f.fieldId === extra.id)).toBe(false);
  });
});
