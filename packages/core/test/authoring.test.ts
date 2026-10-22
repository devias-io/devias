import { describe, expect, it } from 'vitest';
import {
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

const book = defineObject({
  id: 'library.book',
  nameSingular: 'book',
  namePlural: 'books',
  labelSingular: 'Book',
  labelPlural: 'Books',
  fields: [
    defineField({ id: 'library.book.title', name: 'title', label: 'Title', type: 'text' }),
    defineField({ id: 'library.book.isbn', name: 'isbn', label: 'ISBN', type: 'text' }),
  ],
});

const shelf = defineObject({
  id: 'library.shelf',
  nameSingular: 'shelf',
  namePlural: 'shelves',
  labelSingular: 'Shelf',
  labelPlural: 'Shelves',
  fields: [
    defineField({
      id: 'library.shelf.book',
      name: 'book',
      label: 'Book',
      type: 'relation',
      settings: {
        relationType: 'many_to_one',
        targetObjectId: 'library.book',
        inverseLabel: 'Shelves',
      },
    }),
  ],
});

const library = () =>
  defineModule({
    id: 'library',
    version: '1.0.0',
    objects: [book, shelf],
    fields: [
      defineField({
        id: 'library.product.shelf',
        objectId: 'products.product',
        name: 'shelf',
        label: 'Shelf',
        type: 'text',
      }),
    ],
    views: [defineView({ id: 'library.book.all_books', objectId: 'library.book', label: 'All books' })],
    layouts: [
      defineLayout({
        id: 'library.book.default',
        objectId: 'library.book',
        label: 'Book',
        shell: 'column',
        blocks: [{ blockId: 'library.book_card' }, { blockId: 'core.notes' }],
        actions: [{ actionId: 'library.check_out' }],
      }),
    ],
    navItems: [
      defineNavItem({ id: 'library.shelves', label: 'Shelves', target: { kind: 'group' } }),
      defineNavItem({
        id: 'library.books',
        label: 'Books',
        target: { kind: 'object', objectId: 'library.book', viewId: 'library.book.all_books' },
        parentId: 'library.shelves',
      }),
    ],
    commandItems: [
      defineCommandItem({
        id: 'library.new_book',
        label: 'New book',
        action: { kind: 'create_record', objectId: 'library.book' },
      }),
    ],
    blocks: [defineBlock({ id: 'library.book_card', label: 'Book', surfaces: ['record'] })],
    agents: [defineAgent({ id: 'library.librarian', name: 'Librarian', actionIds: ['core.list_records'] })],
    connections: [{ id: 'library.default', kind: 'api_key', fields: [{ name: 'api_key', label: 'API key' }] }],
    actions: [
      defineAction({
        id: 'library.check_out',
        label: 'Check out',
        input: [{ name: 'book_id', label: 'Book', type: 'record', objectId: 'library.book', required: true }],
      }),
    ],
    policies: [
      {
        id: 'library.checkouts',
        description: 'Check-outs need review.',
        match: { actionId: 'library.check_out', objectId: 'library.book' },
        decision: 'review',
      },
    ],
  });

describe('a manifest of written ids', () => {
  it('keeps every id as it was written', () => {
    expect(idListOf(library()).sort()).toEqual(
      [
        'library.book',
        'library.book.title',
        'library.book.isbn',
        'library.shelf',
        'library.shelf.book',
        'library.product.shelf',
        'library.book.all_books',
        'library.book.default',
        'library.shelves',
        'library.books',
        'library.new_book',
        'library.book_card',
        'library.librarian',
        'library.check_out',
        'library.default',
        'library.checkouts',
      ].sort(),
    );
  });

  it('parses a stored manifest again to the same thing', () => {
    const manifest = library();
    expect(parseManifest(JSON.parse(JSON.stringify(manifest)))).toEqual(manifest);
  });

  it('refuses an id that does not start with the module', () => {
    expect(() =>
      parseManifest({
        id: 'library',
        version: '1.0.0',
        actions: [{ id: 'crm.check_out', label: 'X' }],
      }),
    ).toThrow('ids must start with "library."');
    expect(() =>
      parseManifest({
        id: 'library',
        version: '1.0.0',
        blocks: [{ id: 'crm.card', label: 'Card', surfaces: ['record'] }],
      }),
    ).toThrow('ids must start with "library."');
  });

  it('refuses a declaration with no id', () => {
    expect(() =>
      parseManifest({ id: 'library', version: '1.0.0', blocks: [{ title: 'Card', surfaces: ['record'] }] }),
    ).toThrow();
  });

  it('refuses an id declared twice', () => {
    expect(() => parseManifest({ ...library(), blocks: [...library().blocks, ...library().blocks] })).toThrow(
      'declares the block "library.book_card" twice',
    );
  });

  it('wants a field, a view and a layout named inside their object', () => {
    expect(() =>
      parseManifest({
        id: 'library',
        version: '1.0.0',
        objects: [
          {
            id: 'library.book',
            nameSingular: 'book',
            namePlural: 'books',
            labelSingular: 'Book',
            labelPlural: 'Books',
            fields: [{ id: 'library.isbn', name: 'isbn', label: 'ISBN', type: 'text' }],
          },
        ],
      }),
    ).toThrow('field "library.isbn" must be named inside its object "library.book"');
    expect(() =>
      parseManifest({
        id: 'library',
        version: '1.0.0',
        objects: [book],
        views: [{ id: 'library.all', objectId: 'library.book', label: 'All' }],
      }),
    ).toThrow('view "library.all" must be named inside its object "library.book"');
  });

  it('wants the primary field of an object to be one of its own fields', () => {
    const object = (primaryField: string) => ({
      id: 'library.book',
      nameSingular: 'book',
      namePlural: 'books',
      labelSingular: 'Book',
      labelPlural: 'Books',
      primaryFieldId: primaryField,
      fields: [{ id: 'library.book.title', name: 'title', label: 'Title', type: 'text' }],
    });

    expect(parseManifest({ id: 'library', version: '1.0.0', objects: [object('library.book.title')] })).toBeTruthy();
    expect(() => parseManifest({ id: 'library', version: '1.0.0', objects: [object('library.book.isbn')] })).toThrow(
      'names "library.book.isbn" as its primary field, which is not one of its fields',
    );
    expect(() => parseManifest({ id: 'library', version: '1.0.0', objects: [object('title')] })).toThrow();
  });

  it('refuses a name that is not one', () => {
    expect(() =>
      parseManifest({
        id: 'library',
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

describe('a manifest that points at its own declarations by id', () => {
  it('refuses what it points at in itself and does not declare', () => {
    const refused = (declarations: object) => () => defineModule({ id: 'library', version: '1.0.0', ...declarations });

    expect(
      refused({
        objects: [book],
        views: [defineView({ id: 'library.boook.all', objectId: 'library.boook', label: 'All' })],
      }),
    ).toThrow('points at the object "library.boook", which it does not declare');
    expect(
      refused({
        objects: [book],
        layouts: [
          defineLayout({
            id: 'library.book.default',
            objectId: 'library.book',
            label: 'B',
            shell: 'column',
            blocks: [{ blockId: 'library.nope' }],
          }),
        ],
      }),
    ).toThrow('points at the block "library.nope", which it does not declare');
    expect(
      refused({
        objects: [book],
        layouts: [
          defineLayout({
            id: 'library.book.default',
            objectId: 'library.book',
            label: 'B',
            shell: 'column',
            blocks: [],
            actions: [{ actionId: 'library.gone' }],
          }),
        ],
      }),
    ).toThrow('offers the action "library.gone", which the manifest does not declare');
    expect(
      refused({
        navItems: [
          defineNavItem({ id: 'library.books', label: 'B', target: { kind: 'group' }, parentId: 'library.nope' }),
        ],
      }),
    ).toThrow('points at the nav item "library.nope", which it does not declare');
  });

  it('lets a declaration point at another module by its id', () => {
    const manifest = defineModule({
      id: 'quotes',
      version: '1.0.0',
      views: [defineView({ id: 'quotes.deal.for_deals', objectId: 'crm.deal', label: 'For deals' })],
    });

    expect(manifest.views[0]?.objectId).toBe('crm.deal');
  });
});
