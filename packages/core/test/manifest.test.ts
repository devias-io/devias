import { describe, expect, it } from 'vitest';
import { declarationsOf, declaresRuntime, describeOutput, parseManifest } from '../src';
import { coreIds } from '../src/core-ids';

const mailer = {
  id: '01a1751f-5f0a-70f6-b258-c2c96a69790f',
  version: '0.1.0',
  label: 'Mailer',
  icon: 'mail',
  connections: [
    { id: '01a1751f-5f0a-70f6-b258-7fe4ff716b07', kind: 'api_key', fields: [{ name: 'api_key', label: 'API key' }] },
  ],
  actions: [
    {
      id: '01a1751f-5f0d-769d-975f-3dec4f4d5066',
      name: 'send',
      label: 'Send',
      input: [{ name: 'to', label: 'To', required: true }],
    },
  ],
  events: [{ id: '01a1751f-5f0d-769d-975f-43976493500f', name: 'delivered' }],
};

const clientId = { id: '01a1751f-5f11-731b-b879-d99c6048dc4a', label: 'Client id', required: true };
const clientSecret = {
  id: '01a1751f-5f11-731b-b879-de468cbf4c92',
  label: 'Client secret',
  secret: true,
  required: true,
};
const oauth = {
  authorizeUrl: 'https://accounts.example/authorize',
  tokenUrl: 'https://accounts.example/token',
  clientId: { variable: clientId.id },
  clientSecret: { variable: clientSecret.id },
};

describe('action input and output', () => {
  const declare = (action: Record<string, unknown>) =>
    parseManifest({
      id: '01a1751f-5f11-731b-b87a-359da5e6aabd',
      version: '0.1.0',
      objects: [
        {
          id: '01a1751f-5f11-731b-b879-e00e7ef08160',
          nameSingular: 'book',
          namePlural: 'books',
          labelSingular: 'Book',
          labelPlural: 'Books',
        },
      ],
      actions: [{ id: '01a1751f-5f0e-7530-b194-eb96c8a64846', name: 'sync', label: 'Sync', ...action }],
    });

  it('needs a name in the form of a key, which is what its tool and its route are called', () => {
    expect(declare({}).actions[0]).toMatchObject({ id: '01a1751f-5f0e-7530-b194-eb96c8a64846', name: 'sync' });
    expect(() => declare({ name: 'a'.repeat(64) })).not.toThrow();

    for (const name of [undefined, '', 'Sync', '1sync', 'sync it', 'a'.repeat(65)]) {
      expect(() => declare({ name })).toThrow();
    }
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
    expect(() => declare({ output: [{ name: 'id', objectId: '01a1751f-5f11-731b-b879-e00e7ef08160' }] })).toThrow(
      /names its `objectId`/,
    );
    expect(
      declare({ output: [{ name: 'id', type: 'record', objectId: '01a1751f-5f11-731b-b879-e00e7ef08160' }] }).actions[0]
        ?.output,
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
        { name: 'id', type: 'record', objectId: '01a1751f-5f11-731b-b879-e00e7ef08160', description: 'The book.' },
        { name: 'total', type: 'number' },
      ]),
    ).toBe('id (the id of a record of 01a1751f-5f11-731b-b879-e00e7ef08160): The book.; total (number)');
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
    expect(parseManifest({ id: '01a1751f-5f05-7675-8a95-6259e0501ad4', version: '1.0.0' })).toMatchObject({
      connections: [],
      variables: [],
      actions: [],
      events: [],
    });
    const google = parseManifest({
      id: '01a1751f-5f0c-7611-94cf-04aad0105afe',
      version: '1.0.0',
      variables: [clientId, clientSecret],
      connections: [{ id: '01a1751f-5f11-731b-b879-e50916f18322', kind: 'oauth2', oauth }],
    });
    expect(google.connections[0]).toMatchObject({ visibility: 'user', oauth: { pkce: true, scopes: [] } });
    expect(google.variables).toMatchObject([
      { id: clientId.id, secret: false, required: true },
      { id: clientSecret.id, secret: true, required: true },
    ]);
  });

  it('refuses duplicate keys, ids and types', () => {
    const [provider] = mailer.connections;
    expect(() => parseManifest({ ...mailer, connections: [provider, provider] })).toThrow(
      'declares the connection "01a1751f-5f0a-70f6-b258-7fe4ff716b07" twice',
    );
    expect(() =>
      parseManifest({
        ...mailer,
        connections: [{ ...provider, fields: [...(provider?.fields ?? []), ...(provider?.fields ?? [])] }],
      }),
    ).toThrow(
      'Connection "01a1751f-5f0a-70f6-b258-7fe4ff716b07" of manifest "01a1751f-5f0a-70f6-b258-c2c96a69790f" declares the field "api_key" twice',
    );
    expect(() => parseManifest({ ...mailer, actions: [...mailer.actions, ...mailer.actions] })).toThrow(
      'declares the action "01a1751f-5f0d-769d-975f-3dec4f4d5066" twice',
    );
    expect(() =>
      parseManifest({
        ...mailer,
        actions: [...mailer.actions, { id: '01a1751f-5f11-731b-b879-eb42da5ee586', name: 'send', label: 'Send again' }],
      }),
    ).toThrow('declares the action name "send" twice');
    // Another module may use the name: the server refuses a clash between the modules it registers.
    expect(() =>
      parseManifest({
        id: '01a1751f-5f12-7042-ae38-d214e7113150',
        version: '0.1.0',
        actions: [{ id: '01a1751f-5f11-731b-b879-eebf9b797f3a', name: 'send', label: 'Send' }],
      }),
    ).not.toThrow();
    expect(() =>
      parseManifest({
        ...mailer,
        events: [
          { id: '01a1751f-5f0a-70f6-b258-a93bb28cc018', name: 'a' },
          { id: '01a1751f-5f0a-70f6-b258-a93bb28cc018', name: 'a' },
        ],
      }),
    ).toThrow('declares the event "a" twice');
    expect(() =>
      parseManifest({
        ...mailer,
        actions: [
          {
            id: '01a1751f-5f0d-769d-975f-3dec4f4d5066',
            name: 'send',
            label: 'Send',
            input: [
              { name: 'to', label: 'To' },
              { name: 'to', label: 'Again' },
            ],
          },
        ],
      }),
    ).toThrow('Action "send" of manifest "01a1751f-5f0a-70f6-b258-c2c96a69790f" declares the input "to" twice');
  });

  it('names an event as the outside service does, each once in the module', () => {
    const parsed = parseManifest({
      ...mailer,
      events: [{ id: '01a1751f-5f11-731b-b879-f17a55e673a3', name: 'customer.subscription.created' }],
    });
    expect(parsed.events[0]).toMatchObject({
      id: '01a1751f-5f11-731b-b879-f17a55e673a3',
      name: 'customer.subscription.created',
    });

    for (const name of ['', 'Email.Sent', '.sent', 'email..sent', 'email-sent', '1email']) {
      expect(
        () => parseManifest({ ...mailer, events: [{ id: '01a1751f-5f11-731b-b879-f17a55e673a3', name }] }),
        name,
      ).toThrow();
    }

    // Two ids, one name: the name is what is told apart, so it is refused.
    expect(() =>
      parseManifest({
        ...mailer,
        events: [
          { id: '01a1751f-5f11-731b-b879-f17a55e673a3', name: 'sent' },
          { id: '01a1751f-5f11-731b-b879-f46e22a2acde', name: 'sent' },
        ],
      }),
    ).toThrow('declares the event "sent" twice');
  });

  it('needs a record field to name the object it takes a record of', () => {
    const action = (field: Record<string, unknown>) => ({
      id: '01a1751f-5f11-731b-b879-f8f86d4c6dfe',
      name: 'sync',
      label: 'Sync',
      input: [{ name: 'company_id', label: 'Company', ...field }],
    });
    expect(() =>
      parseManifest({
        ...mailer,
        actions: [action({ type: 'record', objectId: '01a17356-5c6a-71ce-8397-1797eb07dc68' })],
      }),
    ).not.toThrow();
    expect(() => parseManifest({ ...mailer, actions: [action({ type: 'record' })] })).toThrow('names its `objectId`');
    expect(() =>
      parseManifest({ ...mailer, actions: [action({ objectId: '01a17356-5c6a-71ce-8397-1797eb07dc68' })] }),
    ).toThrow('names its `objectId`');
  });

  it('needs a layout to offer only actions it declares that take a record of its object', () => {
    const objectIds: Record<string, string> = {
      company: '01a1751f-5f11-731b-b87a-03911d374c50',
      invoice: '01a1751f-5f11-731b-b87a-0c5e8d2f4a91',
    };
    const object = (name: string) => ({
      id: objectIds[name],
      nameSingular: name,
      namePlural: `${name}s`,
      labelSingular: name,
      labelPlural: name,
    });
    const layout = (actions: { actionId: string; input?: string }[]) => ({
      id: '01a1751f-5f11-731b-b879-fec4b0f9f6cf',
      objectId: '01a1751f-5f11-731b-b87a-03911d374c50',
      label: 'Company',
      shell: 'tabs',
      tabs: [],
      actions,
    });
    const field = (objectId: string) => ({ name: 'company_id', label: 'Company', type: 'record', objectId });
    const sync = {
      id: '01a1751f-5f11-731b-b879-f8f86d4c6dfe',
      name: 'sync',
      label: 'Sync',
      input: [field('01a1751f-5f11-731b-b87a-03911d374c50')],
    };
    const bill = {
      id: '01a1751f-5f11-731b-b87a-07470b54f863',
      name: 'bill',
      label: 'Bill',
      input: [field('01a1751f-5f11-731b-b87a-0c5e8d2f4a91')],
    };
    const withLayout = (actions: { actionId: string; input?: string }[]) =>
      parseManifest({
        ...mailer,
        objects: [object('company'), object('invoice')],
        actions: [sync, bill],
        layouts: [layout(actions)],
      });
    expect(() => withLayout([{ actionId: '01a1751f-5f11-731b-b879-f8f86d4c6dfe' }])).not.toThrow();
    expect(() => withLayout([{ actionId: '01a1751f-5f11-731b-b879-f8f86d4c6dfe', input: 'company_id' }])).not.toThrow();
    // An action it does not declare may be another module's: it is looked for among the installed modules' when planned.
    expect(() => withLayout([{ actionId: '01a1751f-5f0e-7530-b194-eb96c8a64846' }])).not.toThrow();
    expect(() => withLayout([{ actionId: '01a1751f-5f11-731b-b87a-09cbb3ff68b2' }])).not.toThrow();
    // An action that takes an invoice does not fit a company's page.
    expect(() => withLayout([{ actionId: '01a1751f-5f11-731b-b87a-07470b54f863' }])).toThrow(
      'takes a record of 01a1751f-5f11-731b-b87a-0c5e8d2f4a91',
    );
    expect(() => withLayout([{ actionId: '01a1751f-5f11-731b-b879-f8f86d4c6dfe', input: 'other' }])).toThrow(
      'no record field "other"',
    );
  });

  it('has an OAuth connection name declared variables, and gives a secret no default', () => {
    const base = {
      id: '01a1751f-5f0c-7611-94cf-04aad0105afe',
      version: '1.0.0',
      connections: [{ id: '01a1751f-5f11-731b-b879-e50916f18322', kind: 'oauth2', oauth }],
    };
    expect(() => parseManifest({ ...base, variables: [clientId] })).toThrow(
      'names the variable "01a1751f-5f11-731b-b879-de468cbf4c92", which the manifest does not declare',
    );
    expect(() => parseManifest({ ...base, variables: [clientId, clientSecret] })).not.toThrow();
    expect(() =>
      parseManifest({
        id: '01a1751f-5f12-7042-ae38-d4e336a7dab0',
        version: '1.0.0',
        variables: [{ id: '01a1751f-5f11-731b-b87a-0f8d64f4979f', label: 'Token', secret: true, defaultValue: 'x' }],
      }),
    ).toThrow('is secret, so it has no defaultValue');
    expect(() =>
      parseManifest({
        id: '01a1751f-5f12-7042-ae38-d4e336a7dab0',
        version: '1.0.0',
        variables: [{ id: '01a1751f-5f11-731b-b87a-1132a08f192a', label: 'Region', defaultValue: 'eu' }],
      }),
    ).not.toThrow();
    expect(() =>
      parseManifest({
        id: '01a1751f-5f12-7042-ae38-d4e336a7dab0',
        version: '1.0.0',
        variables: [
          { id: '01a1751f-5f11-731b-b87a-14f58c0dfec0', label: 'A' },
          { id: '01a1751f-5f11-731b-b87a-14f58c0dfec0', label: 'B' },
        ],
      }),
    ).toThrow('declares the variable "01a1751f-5f11-731b-b87a-14f58c0dfec0" twice');
    expect(() =>
      parseManifest({ id: '01a1751f-5f12-7042-ae38-d4e336a7dab0', version: '1.0.0', variables: [{ label: 'No id' }] }),
    ).toThrow();
  });

  it('tells modules with connections, actions or events from the rest', () => {
    expect(declaresRuntime(parseManifest(mailer))).toBe(true);
    expect(declaresRuntime(parseManifest({ id: '01a1751f-5f05-7675-8a95-6259e0501ad4', version: '1.0.0' }))).toBe(
      false,
    );
  });
});

describe('manifest identity and policies', () => {
  const ledger = {
    id: '01a1751f-5f0b-70b0-8818-9290a78dd45b',
    version: '1.0.0',
    engines: { devias: '>=0.4 <1' },
    objects: [
      {
        id: '01a1751f-5f11-731b-b87a-1a1166750984',
        nameSingular: 'entry',
        namePlural: 'entries',
        labelSingular: 'Entry',
        labelPlural: 'Entries',
      },
    ],
    actions: [{ id: '01a1751f-5f11-731b-b87a-1d629af60d71', name: 'post', label: 'Post an entry' }],
    policies: [
      {
        id: '01a1751f-5f11-731b-b87a-22afd5948bef',
        description: 'Posting always needs review.',
        match: { actionId: '01a1751f-5f11-731b-b87a-1d629af60d71' },
        decision: 'review',
      },
      {
        id: '01a1751f-5f0a-70f6-b258-9188c2fd9435',
        description: 'Entries over 1,000 need review.',
        match: { objectId: '01a1751f-5f11-731b-b87a-1a1166750984' },
        when: { fieldId: '01a1751f-5f11-731b-b87a-270ae90d5434', above: 1000 },
        decision: 'review',
      },
    ],
  };

  it('keeps its engines and policies in the declarations', () => {
    const declarations = declarationsOf(parseManifest(ledger));
    expect(declarations).toMatchObject({
      engines: { devias: '>=0.4 <1' },
      policies: [{ id: '01a1751f-5f11-731b-b87a-22afd5948bef' }, { id: '01a1751f-5f0a-70f6-b258-9188c2fd9435' }],
    });
  });

  it('refuses duplicate policies', () => {
    expect(() => parseManifest({ ...ledger, policies: [...ledger.policies, ledger.policies[0]] })).toThrow(
      'declares the policy "01a1751f-5f11-731b-b87a-22afd5948bef" twice',
    );
    // A policy may name another module's action: what it names is not looked for here.
    expect(() =>
      parseManifest({
        ...ledger,
        policies: [
          {
            id: '01a1751f-5f11-731b-b87a-286e10b3f894',
            description: 'Voiding',
            match: { actionId: '01a1751f-5f11-731b-b87a-2c77c266a5be' },
            decision: 'deny',
          },
        ],
      }),
    ).not.toThrow();
  });
});

describe('agents a manifest ships', () => {
  const agent = {
    id: '01a1751f-5f11-731b-b87a-3260948aaa64',
    label: 'Helper',
    actionIds: [coreIds.actions.list_records, '01a1751f-5f0d-769d-975f-3dec4f4d5066'],
  };

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

  it('are listed once, with at least one tool and no tool twice', () => {
    expect(() => parseManifest({ ...mailer, agents: [agent, { ...agent, label: 'Again' }] })).toThrow(/agent .*twice/);
    expect(() => parseManifest({ ...mailer, agents: [{ ...agent, actionIds: [] }] })).toThrow();
    expect(() =>
      parseManifest({
        ...mailer,
        agents: [{ ...agent, actionIds: [coreIds.actions.list_records, coreIds.actions.list_records] }],
      }),
    ).toThrow(`"${coreIds.actions.list_records}" twice`);
    expect(() =>
      parseManifest({ ...mailer, agents: [{ ...agent, starterPrompts: ['a', 'b', 'c', 'd', 'e', 'f'] }] }),
    ).toThrow();
  });
});

describe('what a manifest may leave out', () => {
  it('names the module by its id, and a connection by the module', () => {
    const { label: _name, ...nameless } = mailer;
    const bare = parseManifest(nameless);
    expect(bare.label).toBe('01a1751f-5f0a-70f6-b258-c2c96a69790f');
    expect(bare.connections[0]?.label).toBe('01a1751f-5f0a-70f6-b258-c2c96a69790f');
    expect(parseManifest({ id: '01a1751f-5f11-731b-b87a-359da5e6aabd', version: '0.1.0' }).label).toBe(
      '01a1751f-5f11-731b-b87a-359da5e6aabd',
    );

    const written = parseManifest({ ...mailer, label: 'Mail and more' });
    expect(written.label).toBe('Mail and more');
    expect(written.connections[0]?.label).toBe('Mail and more');
  });

  it('keeps a label and a connection label that are written', () => {
    const manifest = parseManifest({
      ...mailer,
      connections: [{ ...mailer.connections[0], label: 'Mail account' }],
    });
    expect(manifest.label).toBe('Mailer');
    expect(manifest.connections[0]?.label).toBe('Mail account');
    expect(declarationsOf(manifest).label).toBe('Mailer');
  });
});

describe('a module logo', () => {
  const withLogo = (logo: string) => ({ id: '01a1751f-5f11-731b-b87a-359da5e6aabd', version: '0.1.0', logo });

  it('is a path to an image inside the package', () => {
    expect(parseManifest(withLogo('./logo.svg')).logo).toBe('./logo.svg');
    expect(parseManifest(withLogo('assets/Logo.PNG')).logo).toBe('assets/Logo.PNG');
    expect(parseManifest({ id: '01a1751f-5f11-731b-b87a-359da5e6aabd', version: '0.1.0' }).logo).toBeUndefined();
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
  const withSite = (website: string) => ({ id: '01a1751f-5f11-731b-b87a-359da5e6aabd', version: '0.1.0', website });

  it('is optional, and an http(s) address when given', () => {
    expect(parseManifest({ id: '01a1751f-5f11-731b-b87a-359da5e6aabd', version: '0.1.0' }).website).toBeUndefined();
    expect(parseManifest(withSite('https://books.example/app')).website).toBe('https://books.example/app');
    expect(parseManifest(withSite('http://localhost:3000')).website).toBe('http://localhost:3000');
  });

  it('is not another kind of address, or not an address at all', () => {
    for (const bad of ['javascript:alert(1)', 'ftp://books.example', 'books.example', '//books.example', '']) {
      expect(() => parseManifest(withSite(bad)), bad).toThrow();
    }
  });
});
