import { describe, expect, it } from 'vitest';
import { declarationsOf, declaresRuntime, describeOutput, parseManifest } from '../src';

const mailer = {
  id: 'mailer',
  version: '0.1.0',
  name: 'Mailer',
  icon: 'mail',
  connections: [{ id: 'mailer.default', kind: 'api_key', fields: [{ name: 'api_key', label: 'API key' }] }],
  actions: [{ id: 'mailer.send', label: 'Send', input: [{ name: 'to', label: 'To', required: true }] }],
  events: [{ id: 'mailer.delivered' }],
};

const oauth = {
  authorizeUrl: 'https://accounts.example/authorize',
  tokenUrl: 'https://accounts.example/token',
  clientId: { variable: 'CLIENT_ID' },
  clientSecret: { variable: 'CLIENT_SECRET' },
};

describe('action input and output', () => {
  const declare = (action: Record<string, unknown>) =>
    parseManifest({
      id: 'books',
      version: '0.1.0',
      objects: [
        {
          id: 'books.book',
          nameSingular: 'book',
          namePlural: 'books',
          labelSingular: 'Book',
          labelPlural: 'Books',
        },
      ],
      actions: [{ id: 'books.sync', label: 'Sync', ...action }],
    });

  it('takes `input` and `output` as lists, each empty by default, an output field being text unless it says more', () => {
    expect(declare({}).actions[0]).toMatchObject({ input: [], output: [] });
    expect(
      declare({ output: [{ name: 'id' }, { name: 'total', type: 'number', description: 'The total.' }] }).actions[0]
        ?.output,
    ).toEqual([
      { name: 'id', type: 'text' },
      { name: 'total', type: 'number', description: 'The total.' },
    ]);
  });

  it('wants a record output to name its object, and nothing else to', () => {
    expect(() => declare({ output: [{ name: 'id', type: 'record' }] })).toThrow(/names its `objectId`/);
    expect(() => declare({ output: [{ name: 'id', objectId: 'books.book' }] })).toThrow(/names its `objectId`/);
    expect(
      declare({ output: [{ name: 'id', type: 'record', objectId: 'books.book' }] }).actions[0]?.output,
    ).toHaveLength(1);
  });

  it('refuses an input or an output declared twice', () => {
    expect(() =>
      declare({
        input: [
          { name: 'a', label: 'A' },
          { name: 'a', label: 'A again' },
        ],
      }),
    ).toThrow(/input "a" twice/);
    expect(() => declare({ output: [{ name: 'a' }, { name: 'a' }] })).toThrow(/output "a" twice/);
  });

  it('tells the agent each output field on its own', () => {
    expect(
      describeOutput([
        { name: 'id', type: 'record', objectId: 'books.book', description: 'The book.' },
        { name: 'total', type: 'number' },
      ]),
    ).toBe('id (the id of a record of books.book): The book.; total (number)');
  });
});

describe('manifest connections, variables, actions and events', () => {
  it('applies defaults to the declarations', () => {
    const manifest = parseManifest(mailer);
    expect(manifest.connections[0]).toMatchObject({
      kind: 'api_key',
      visibility: 'workspace',
      fields: [{ name: 'api_key', secret: true, required: true }],
    });
    expect(manifest.actions[0]).toMatchObject({ approval: 'approve', input: [{ name: 'to', type: 'text' }] });
    expect(parseManifest({ id: 'plain', version: '1.0.0' })).toMatchObject({
      connections: [],
      variables: [],
      actions: [],
      events: [],
    });
    const google = parseManifest({
      id: 'google',
      version: '1.0.0',
      variables: [
        { key: 'CLIENT_ID', label: 'Client id', server: true },
        { key: 'CLIENT_SECRET', label: 'Client secret', server: true, secret: true },
      ],
      connections: [{ id: 'google.google', kind: 'oauth2', oauth }],
    });
    expect(google.connections[0]).toMatchObject({ visibility: 'user', oauth: { pkce: true, scopes: [] } });
  });

  it('refuses duplicate keys, ids and types', () => {
    const [provider] = mailer.connections;
    expect(() => parseManifest({ ...mailer, connections: [provider, provider] })).toThrow(
      'declares the connection "default" twice',
    );
    expect(() =>
      parseManifest({
        ...mailer,
        connections: [{ ...provider, fields: [...(provider?.fields ?? []), ...(provider?.fields ?? [])] }],
      }),
    ).toThrow('Connection "default" of manifest "mailer" declares the field "api_key" twice');
    expect(() => parseManifest({ ...mailer, actions: [...mailer.actions, ...mailer.actions] })).toThrow(
      'declares the action "send" twice',
    );
    expect(() => parseManifest({ ...mailer, events: [{ id: 'mailer.a' }, { id: 'mailer.a' }] })).toThrow(
      'declares the event "a" twice',
    );
    expect(() =>
      parseManifest({
        ...mailer,
        actions: [
          {
            id: 'mailer.send',
            label: 'Send',
            input: [
              { name: 'to', label: 'To' },
              { name: 'to', label: 'Again' },
            ],
          },
        ],
      }),
    ).toThrow('Action "send" of manifest "mailer" declares the input "to" twice');
  });

  it('needs a record field to name the object it takes a record of', () => {
    const action = (field: Record<string, unknown>) => ({
      id: 'mailer.sync',
      label: 'Sync',
      input: [{ name: 'company_id', label: 'Company', ...field }],
    });
    expect(() =>
      parseManifest({ ...mailer, actions: [action({ type: 'record', objectId: 'crm.company' })] }),
    ).not.toThrow();
    expect(() => parseManifest({ ...mailer, actions: [action({ type: 'record' })] })).toThrow('names its `objectId`');
    expect(() => parseManifest({ ...mailer, actions: [action({ objectId: 'crm.company' })] })).toThrow(
      'names its `objectId`',
    );
  });

  it('needs a layout to offer only its own module’s actions that exist and take a record of its object', () => {
    const object = (name: string) => ({
      id: `mailer.${name}`,
      nameSingular: name,
      namePlural: `${name}s`,
      labelSingular: name,
      labelPlural: name,
    });
    const layout = (actions: { actionId: string; input?: string }[]) => ({
      id: 'mailer.company.default',
      objectId: 'mailer.company',
      label: 'Company',
      shell: 'tabs',
      tabs: [],
      actions,
    });
    const field = (objectId: string) => ({ name: 'company_id', label: 'Company', type: 'record', objectId });
    const sync = { id: 'mailer.sync', label: 'Sync', input: [field('mailer.company')] };
    const bill = { id: 'mailer.bill', label: 'Bill', input: [field('mailer.invoice')] };
    const withLayout = (actions: { actionId: string; input?: string }[]) =>
      parseManifest({
        ...mailer,
        objects: [object('company'), object('invoice')],
        actions: [sync, bill],
        layouts: [layout(actions)],
      });
    expect(() => withLayout([{ actionId: 'mailer.sync' }])).not.toThrow();
    expect(() => withLayout([{ actionId: 'mailer.sync', input: 'company_id' }])).not.toThrow();
    // Another module's actions are checked when they are installed, not here.
    expect(() => withLayout([{ actionId: 'books.sync' }])).not.toThrow();
    expect(() => withLayout([{ actionId: 'mailer.missing' }])).toThrow(
      'offers the action "mailer.missing", which the manifest does not declare',
    );
    // An action that takes an invoice does not fit a company's page.
    expect(() => withLayout([{ actionId: 'mailer.bill' }])).toThrow('takes a record of mailer.invoice');
    expect(() => withLayout([{ actionId: 'mailer.sync', input: 'other' }])).toThrow('no record field "other"');
  });

  it('keeps OAuth client credentials on the server and workspace secrets in connections', () => {
    const base = { id: 'google', version: '1.0.0', connections: [{ id: 'google.google', kind: 'oauth2', oauth }] };
    expect(() =>
      parseManifest({ ...base, variables: [{ key: 'CLIENT_ID', label: 'Client id', server: true }] }),
    ).toThrow('names the variable "CLIENT_SECRET", which it must declare as a server variable');
    expect(() =>
      parseManifest({
        ...base,
        variables: [
          { key: 'CLIENT_ID', label: 'Client id' },
          { key: 'CLIENT_SECRET', label: 'Client secret', server: true, secret: true },
        ],
      }),
    ).toThrow('names the variable "CLIENT_ID"');
    expect(() =>
      parseManifest({ id: 'vars', version: '1.0.0', variables: [{ key: 'TOKEN', label: 'Token', secret: true }] }),
    ).toThrow("a workspace's secrets belong in a connection");
    expect(() =>
      parseManifest({ id: 'vars', version: '1.0.0', variables: [{ key: 'token', label: 'Token' }] }),
    ).toThrow();
  });

  it('tells modules with connections, actions or events from the rest', () => {
    expect(declaresRuntime(parseManifest(mailer))).toBe(true);
    expect(declaresRuntime(parseManifest({ id: 'plain', version: '1.0.0' }))).toBe(false);
  });
});

describe('manifest identity and policies', () => {
  const ledger = {
    id: 'ledger',
    version: '1.0.0',
    publisher: { id: 'acme', name: 'Acme', url: 'https://acme.test' },
    engines: { devias: '>=0.4 <1' },
    objects: [
      {
        id: 'ledger.entry',
        nameSingular: 'entry',
        namePlural: 'entries',
        labelSingular: 'Entry',
        labelPlural: 'Entries',
      },
    ],
    actions: [{ id: 'ledger.post', label: 'Post an entry' }],
    policies: [
      {
        id: 'ledger.posting',
        description: 'Posting always needs review.',
        match: { actionId: 'ledger.post' },
        decision: 'review',
      },
      {
        id: 'ledger.large',
        description: 'Entries over 1,000 need review.',
        match: { objectId: 'ledger.entry' },
        when: { fieldId: 'ledger.entry.amount', above: 1000 },
        decision: 'review',
      },
    ],
  };

  it('keeps who publishes it and its policies in the declarations', () => {
    const declarations = declarationsOf(parseManifest(ledger));
    expect(declarations).toMatchObject({
      publisher: { id: 'acme', name: 'Acme' },
      engines: { devias: '>=0.4 <1' },
      policies: [{ id: 'ledger.posting' }, { id: 'ledger.large' }],
    });
  });

  it('refuses a bad publisher url, duplicate policies and policies naming what it does not declare', () => {
    // The publisher's url is a link in the studio.
    expect(() =>
      parseManifest({ ...ledger, publisher: { id: 'acme', name: 'Acme', url: 'javascript:alert(1)' } }),
    ).toThrow();
    expect(() => parseManifest({ ...ledger, policies: [...ledger.policies, ledger.policies[0]] })).toThrow(
      'declares the policy "posting" twice',
    );
    expect(() =>
      parseManifest({
        ...ledger,
        policies: [{ id: 'ledger.void', description: 'Voiding', match: { actionId: 'ledger.void' }, decision: 'deny' }],
      }),
    ).toThrow('names the action "ledger.void", which it does not declare');
  });
});

describe('agents a manifest ships', () => {
  const agent = { id: 'mailer.helper', name: 'Helper', actionIds: ['core.list_records', 'mailer.send'] };

  it('are kept with their defaults, in the declarations an installed module carries', () => {
    const manifest = parseManifest({ ...mailer, agents: [agent] });
    expect(manifest.agents).toEqual([{ ...agent, starterPrompts: [], skillIds: [] }]);
    expect(declarationsOf(manifest).agents).toEqual(manifest.agents);
    expect(parseManifest(mailer).agents).toEqual([]);
  });

  it('change the manifest hash-relevant content, so an update is noticed', () => {
    const one = parseManifest({ ...mailer, agents: [agent] });
    const other = parseManifest({ ...mailer, agents: [{ ...agent, instructions: 'Be brief.' }] });
    expect(JSON.stringify(one)).not.toEqual(JSON.stringify(other));
  });

  it("must be the module's own, listed once, with at least one tool and no tool twice", () => {
    expect(() => parseManifest({ ...mailer, agents: [{ ...agent, id: 'other.helper' }] })).toThrow(
      /must start with "mailer\."/,
    );
    expect(() => parseManifest({ ...mailer, agents: [agent, { ...agent, name: 'Again' }] })).toThrow(/agent .*twice/);
    expect(() => parseManifest({ ...mailer, agents: [{ ...agent, actionIds: [] }] })).toThrow();
    expect(() =>
      parseManifest({ ...mailer, agents: [{ ...agent, actionIds: ['core.list_records', 'core.list_records'] }] }),
    ).toThrow(/"core.list_records" twice/);
    expect(() =>
      parseManifest({ ...mailer, agents: [{ ...agent, starterPrompts: ['a', 'b', 'c', 'd', 'e', 'f'] }] }),
    ).toThrow();
  });
});

describe('what a manifest may leave out', () => {
  it('names the module by its id, and a connection by the module', () => {
    const { name: _name, ...nameless } = mailer;
    const bare = parseManifest(nameless);
    expect(bare.name).toBe('mailer');
    expect(bare.connections[0]?.label).toBe('mailer');
    expect(parseManifest({ id: 'books', version: '0.1.0' }).name).toBe('books');

    const written = parseManifest({ ...mailer, name: 'Mail and more' });
    expect(written.name).toBe('Mail and more');
    expect(written.connections[0]?.label).toBe('Mail and more');
  });

  it('keeps a name and a label that are written', () => {
    const manifest = parseManifest({
      ...mailer,
      connections: [{ ...mailer.connections[0], label: 'Mail account' }],
    });
    expect(manifest.name).toBe('Mailer');
    expect(manifest.connections[0]?.label).toBe('Mail account');
    expect(declarationsOf(manifest).name).toBe('Mailer');
  });
});

describe('a module logo', () => {
  const withLogo = (logo: string) => ({ id: 'books', version: '0.1.0', logo });

  it('is a path to an image inside the package', () => {
    expect(parseManifest(withLogo('./logo.svg')).logo).toBe('./logo.svg');
    expect(parseManifest(withLogo('assets/Logo.PNG')).logo).toBe('assets/Logo.PNG');
    expect(parseManifest({ id: 'books', version: '0.1.0' }).logo).toBeUndefined();
  });

  it('is not an address, an absolute path, a way out of the package or another kind of file', () => {
    for (const bad of [
      'https://example.com/logo.svg',
      '//example.com/logo.svg',
      '/logo.svg',
      '../logo.svg',
      'a/../../logo.svg',
      'a\\logo.svg',
      './logo.gif',
      './logo',
    ]) {
      expect(() => parseManifest(withLogo(bad)), bad).toThrow();
    }
  });

  it('is carried to the installed module', () => {
    expect(declarationsOf(parseManifest(withLogo('./logo.svg'))).logo).toBe('./logo.svg');
  });
});

describe('a module website', () => {
  const withSite = (website: string) => ({ id: 'books', version: '0.1.0', website });

  it('is optional, and an http(s) address when given', () => {
    expect(parseManifest({ id: 'books', version: '0.1.0' }).website).toBeUndefined();
    expect(parseManifest(withSite('https://books.example/app')).website).toBe('https://books.example/app');
    expect(parseManifest(withSite('http://localhost:3000')).website).toBe('http://localhost:3000');
  });

  it('is not another kind of address, or not an address at all', () => {
    for (const bad of ['javascript:alert(1)', 'ftp://books.example', 'books.example', '//books.example', '']) {
      expect(() => parseManifest(withSite(bad)), bad).toThrow();
    }
  });
});
