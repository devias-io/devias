import { describe, expect, it } from 'vitest';
import {
  declarationsOf,
  defineAction,
  defineAgent,
  defineBlock,
  defineCommandItem,
  defineField,
  defineLayout,
  defineModule,
  defineNavItem,
  defineObject,
  defineView,
  idListOf,
  parseManifest,
} from '../src';
import { coreIds } from '../src/core-ids';

const book = defineObject({
  id: '01a1751f-5f14-73f0-9bec-564e7cc13137',
  nameSingular: 'book',
  namePlural: 'books',
  labelSingular: 'Book',
  labelPlural: 'Books',
  fields: [
    defineField({ id: '01a1751f-5f14-73f0-9bec-5a8faebc998d', name: 'title', label: 'Title', type: 'text' }),
    defineField({ id: '01a1751f-5f14-73f0-9bec-5c128e0e440b', name: 'isbn', label: 'ISBN', type: 'text' }),
  ],
});

const shelf = defineObject({
  id: '01a1751f-5f14-73f0-9bec-62d6e7de55ff',
  nameSingular: 'shelf',
  namePlural: 'shelves',
  labelSingular: 'Shelf',
  labelPlural: 'Shelves',
  fields: [
    defineField({
      id: '01a1751f-5f14-73f0-9bec-64676da29d8f',
      name: 'book',
      label: 'Book',
      type: 'relation',
      settings: {
        relationType: 'many_to_one',
        targetObjectId: '01a1751f-5f14-73f0-9bec-564e7cc13137',
        inverseLabel: 'Shelves',
      },
    }),
  ],
});

const library = () =>
  defineModule({
    id: '01a1751f-5f14-73f0-9bec-b03aa04ee080',
    version: '1.0.0',
    objects: [book, shelf],
    fields: [
      defineField({
        id: '01a1751f-5f14-73f0-9bec-6afe3f3c72fb',
        objectId: '01a1751f-5f14-73f0-9bec-6c0a5591fb66',
        name: 'shelf',
        label: 'Shelf',
        type: 'text',
      }),
    ],
    views: [
      defineView({
        id: '01a1751f-5f14-73f0-9bec-7132a87efd50',
        objectId: '01a1751f-5f14-73f0-9bec-564e7cc13137',
        label: 'All books',
      }),
    ],
    layouts: [
      defineLayout({
        id: '01a1751f-5f14-73f0-9bec-76893a50d11c',
        objectId: '01a1751f-5f14-73f0-9bec-564e7cc13137',
        label: 'Book',
        shell: 'column',
        blocks: [
          { name: 'book_card', blockId: '01a1751f-5f14-73f0-9bec-7aaef4adff24' },
          { name: 'comments', blockId: coreIds.blocks.comments },
        ],
        actions: [{ actionId: '01a1751f-5f14-73f0-9bec-7edfce2f4e8c' }],
      }),
    ],
    navItems: [
      defineNavItem({ id: '01a1751f-5f14-73f0-9bec-80d46e8394e2', label: 'Shelves', target: { kind: 'group' } }),
      defineNavItem({
        id: '01a1751f-5f14-73f0-9bec-86006aed1c06',
        label: 'Books',
        target: {
          kind: 'object',
          objectId: '01a1751f-5f14-73f0-9bec-564e7cc13137',
          viewId: '01a1751f-5f14-73f0-9bec-7132a87efd50',
        },
        parentId: '01a1751f-5f14-73f0-9bec-80d46e8394e2',
      }),
    ],
    commandItems: [
      defineCommandItem({
        id: '01a1751f-5f14-73f0-9bec-8b151e7aa525',
        label: 'New book',
        action: { kind: 'create_record', objectId: '01a1751f-5f14-73f0-9bec-564e7cc13137' },
      }),
    ],
    blocks: [defineBlock({ id: '01a1751f-5f14-73f0-9bec-7aaef4adff24', label: 'Book', surfaces: ['record'] })],
    agents: [
      defineAgent({
        id: '01a1751f-5f14-73f0-9bec-8feedbebaea8',
        label: 'Librarian',
        actionIds: [coreIds.actions.list_records],
      }),
    ],
    connections: [
      { id: '01a1751f-5f14-73f0-9bec-9140a9ece9a3', kind: 'api_key', fields: [{ name: 'api_key', label: 'API key' }] },
    ],
    actions: [
      defineAction({
        id: '01a1751f-5f14-73f0-9bec-7edfce2f4e8c',
        name: 'check_out',
        label: 'Check out',
        input: [
          {
            name: 'book_id',
            label: 'Book',
            type: 'record',
            objectId: '01a1751f-5f14-73f0-9bec-564e7cc13137',
            required: true,
          },
        ],
      }),
    ],
    policies: [
      {
        id: '01a1751f-5f14-73f0-9bec-974a6a1de328',
        description: 'Check-outs need review.',
        match: { actionId: '01a1751f-5f14-73f0-9bec-7edfce2f4e8c', objectId: '01a1751f-5f14-73f0-9bec-564e7cc13137' },
        decision: 'review',
      },
    ],
  });

describe('a manifest of written ids', () => {
  it('keeps every id as it was written', () => {
    expect(idListOf(library()).sort()).toEqual(
      [
        '01a1751f-5f14-73f0-9bec-564e7cc13137',
        '01a1751f-5f14-73f0-9bec-5a8faebc998d',
        '01a1751f-5f14-73f0-9bec-5c128e0e440b',
        '01a1751f-5f14-73f0-9bec-62d6e7de55ff',
        '01a1751f-5f14-73f0-9bec-64676da29d8f',
        '01a1751f-5f14-73f0-9bec-6afe3f3c72fb',
        '01a1751f-5f14-73f0-9bec-7132a87efd50',
        '01a1751f-5f14-73f0-9bec-76893a50d11c',
        '01a1751f-5f14-73f0-9bec-80d46e8394e2',
        '01a1751f-5f14-73f0-9bec-86006aed1c06',
        '01a1751f-5f14-73f0-9bec-8b151e7aa525',
        '01a1751f-5f14-73f0-9bec-7aaef4adff24',
        '01a1751f-5f14-73f0-9bec-8feedbebaea8',
        '01a1751f-5f14-73f0-9bec-7edfce2f4e8c',
        '01a1751f-5f14-73f0-9bec-9140a9ece9a3',
        '01a1751f-5f14-73f0-9bec-974a6a1de328',
      ].sort(),
    );
  });

  it('parses a stored manifest again to the same thing', () => {
    const manifest = library();
    expect(parseManifest(JSON.parse(JSON.stringify(manifest)))).toEqual(manifest);
  });

  it('does not read the module out of an id: what a manifest declares is its own, whatever the id', () => {
    const manifest = parseManifest({
      id: '01a1751f-5f14-73f0-9bec-b03aa04ee080',
      version: '1.0.0',
      actions: [{ id: '01a1751f-5f14-73f0-9bec-9a2d40c3ba19', name: 'check_out', label: 'X' }],
      blocks: [{ id: '0198f1c6-7a52-7b3e-9d10-5c2e6f8a1b01', label: 'Card', surfaces: ['record'] }],
    });
    expect(manifest.actions[0]?.id).toBe('01a1751f-5f14-73f0-9bec-9a2d40c3ba19');
    expect(manifest.blocks[0]?.id).toBe('0198f1c6-7a52-7b3e-9d10-5c2e6f8a1b01');
  });

  describe('skills', () => {
    const skill = (id: string) => ({ id, label: 'Count', description: 'When asked to count', body: '1. Count' });

    it('are declared by the module, listed with its ids, and carried by what an installed module shows', () => {
      const manifest = parseManifest({
        id: '01a1751f-5f14-73f0-9bec-b03aa04ee080',
        version: '1.0.0',
        skills: [skill('library.count')],
        agents: [
          {
            id: '01a1751f-5f14-73f0-9bec-8feedbebaea8',
            label: 'Librarian',
            actionIds: [coreIds.actions.list_records],
            skillIds: ['library.count'],
          },
        ],
      });
      expect(manifest.skills).toHaveLength(1);
      expect(manifest.agents[0]?.skillIds).toEqual(['library.count']);
      expect(idListOf(manifest)).toEqual(
        expect.arrayContaining(['library.count', '01a1751f-5f14-73f0-9bec-8feedbebaea8']),
      );
      expect(declarationsOf(manifest).skills).toEqual(manifest.skills);
      // A module with none says so.
      expect(parseManifest({ id: '01a1751f-5f14-73f0-9bec-b03aa04ee080', version: '1.0.0' }).skills).toEqual([]);
    });

    it('are declared once, and are only named by an agent of the module', () => {
      expect(() =>
        parseManifest({
          id: '01a1751f-5f14-73f0-9bec-b03aa04ee080',
          version: '1.0.0',
          skills: [skill('library.count'), skill('library.count')],
        }),
      ).toThrow('declares the skill "library.count" twice');
      expect(() =>
        parseManifest({
          id: '01a1751f-5f14-73f0-9bec-b03aa04ee080',
          version: '1.0.0',
          agents: [
            {
              id: '01a1751f-5f14-73f0-9bec-8feedbebaea8',
              label: 'L',
              actionIds: [coreIds.actions.list_records],
              skillIds: ['01a1751f-5f14-73f0-9bec-a77696f4091f'],
            },
          ],
        }),
      ).toThrow('names the skill "01a1751f-5f14-73f0-9bec-a77696f4091f", which the manifest does not declare');
      expect(() =>
        parseManifest({
          id: '01a1751f-5f14-73f0-9bec-b03aa04ee080',
          version: '1.0.0',
          skills: [skill('library.count')],
          agents: [
            {
              id: '01a1751f-5f14-73f0-9bec-8feedbebaea8',
              label: 'L',
              actionIds: [coreIds.actions.list_records],
              skillIds: ['library.count', 'library.count'],
            },
          ],
        }),
      ).toThrow('names the skill "library.count" twice');
    });

    it('have a label, a line and a text, within their sizes, and at most twenty to a module', () => {
      const bad = (patch: object) =>
        parseManifest({
          id: '01a1751f-5f14-73f0-9bec-b03aa04ee080',
          version: '1.0.0',
          skills: [{ ...skill('library.count'), ...patch }],
        });
      expect(() => bad({ label: '' })).toThrow();
      expect(() => bad({ description: 'x'.repeat(301) })).toThrow();
      expect(() => bad({ body: 'x'.repeat(20_001) })).toThrow();
      expect(() =>
        parseManifest({
          id: '01a1751f-5f14-73f0-9bec-b03aa04ee080',
          version: '1.0.0',
          skills: Array.from({ length: 21 }, (_, i) => skill(`library.s${i}`)),
        }),
      ).toThrow();
    });
  });

  it('refuses a declaration with no id', () => {
    expect(() =>
      parseManifest({
        id: '01a1751f-5f14-73f0-9bec-b03aa04ee080',
        version: '1.0.0',
        blocks: [{ title: 'Card', surfaces: ['record'] }],
      }),
    ).toThrow();
  });

  it('refuses an id declared twice', () => {
    expect(() => parseManifest({ ...library(), blocks: [...library().blocks, ...library().blocks] })).toThrow(
      'declares the block "01a1751f-5f14-73f0-9bec-7aaef4adff24" twice',
    );
  });

  it('takes a field, a view and a layout under any id: none is named inside its object', () => {
    const manifest = parseManifest({
      id: '01a1751f-5f14-73f0-9bec-b03aa04ee080',
      version: '1.0.0',
      objects: [
        {
          id: '01a1751f-5f14-73f0-9bec-564e7cc13137',
          nameSingular: 'book',
          namePlural: 'books',
          labelSingular: 'Book',
          labelPlural: 'Books',
          fields: [{ id: 'f-1a2b3c', name: 'isbn', label: 'ISBN', type: 'text' }],
        },
      ],
      views: [{ id: 'v-4d5e6f', objectId: '01a1751f-5f14-73f0-9bec-564e7cc13137', label: 'All' }],
    });
    expect(manifest.objects[0]?.fields[0]?.id).toBe('f-1a2b3c');
    expect(manifest.views[0]?.id).toBe('v-4d5e6f');
  });

  it('wants the primary field of an object to be one of its own fields', () => {
    const object = (primaryField: string) => ({
      id: '01a1751f-5f14-73f0-9bec-564e7cc13137',
      nameSingular: 'book',
      namePlural: 'books',
      labelSingular: 'Book',
      labelPlural: 'Books',
      primaryFieldId: primaryField,
      fields: [{ id: '01a1751f-5f14-73f0-9bec-5a8faebc998d', name: 'title', label: 'Title', type: 'text' }],
    });

    expect(
      parseManifest({
        id: '01a1751f-5f14-73f0-9bec-b03aa04ee080',
        version: '1.0.0',
        objects: [object('01a1751f-5f14-73f0-9bec-5a8faebc998d')],
      }),
    ).toBeTruthy();
    expect(() =>
      parseManifest({
        id: '01a1751f-5f14-73f0-9bec-b03aa04ee080',
        version: '1.0.0',
        objects: [object('01a1751f-5f14-73f0-9bec-5c128e0e440b')],
      }),
    ).toThrow('names "01a1751f-5f14-73f0-9bec-5c128e0e440b" as its primary field, which is not one of its fields');
    expect(() =>
      parseManifest({ id: '01a1751f-5f14-73f0-9bec-b03aa04ee080', version: '1.0.0', objects: [object('title')] }),
    ).toThrow();
  });

  it('refuses a name that is not one', () => {
    expect(() =>
      parseManifest({
        id: '01a1751f-5f14-73f0-9bec-b03aa04ee080',
        version: '1.0.0',
        objects: [
          {
            id: 'library.quoteItem',
            nameSingular: 'quoteItem',
            namePlural: 'quoteItems',
            labelSingular: 'Q',
            labelPlural: 'Qs',
          },
        ],
      }),
    ).toThrow();
  });
});

describe('a manifest that points at declarations by id', () => {
  it('does not look for what it points at: an id cannot tell its own from another module’s, so planning does', () => {
    expect(() =>
      defineModule({
        id: '01a1751f-5f14-73f0-9bec-b03aa04ee080',
        version: '1.0.0',
        objects: [book],
        views: [
          defineView({
            id: '01a1751f-5f14-73f0-9bec-9dfa6f85eb2e',
            objectId: '01a1751f-5f14-73f0-9bec-a1173e279f7c',
            label: 'All',
          }),
        ],
        layouts: [
          defineLayout({
            id: '01a1751f-5f14-73f0-9bec-76893a50d11c',
            objectId: '01a1751f-5f14-73f0-9bec-564e7cc13137',
            label: 'B',
            shell: 'column',
            blocks: [{ name: 'nope', blockId: '01a1751f-5f14-73f0-9bec-a77696f4091f' }],
            actions: [{ actionId: '01a1751f-5f14-73f0-9bec-abd8c13a9662' }],
          }),
        ],
        navItems: [
          defineNavItem({
            id: '01a1751f-5f14-73f0-9bec-86006aed1c06',
            label: 'B',
            target: { kind: 'group' },
            parentId: '01a1751f-5f14-73f0-9bec-a77696f4091f',
          }),
        ],
      }),
    ).not.toThrow();
  });

  it('lets a declaration point at another module by its id', () => {
    const manifest = defineModule({
      id: '01a1751f-5f14-73f0-9bec-b7a2dd9af24e',
      version: '1.0.0',
      views: [
        defineView({
          id: '01a1751f-5f14-73f0-9bec-ae2504c98cc3',
          objectId: '01a17356-5c6a-71ce-8397-1b7364dcbe27',
          label: 'For deals',
        }),
      ],
    });

    expect(manifest.views[0]?.objectId).toBe('01a17356-5c6a-71ce-8397-1b7364dcbe27');
  });
});
