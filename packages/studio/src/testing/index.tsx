import {
  type AiAgent,
  type AiClient,
  DeviasApiError,
  type DeviasClient,
  defineStudio,
  evaluateFilter,
  matchesSearch,
  type Organization,
  type Query,
  type RecordData,
  type ResolvedStudioConfig,
  resolveConfig,
  type StudioConfig,
  sortRecords,
  type WorkspaceSchema,
} from '@devias/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { studio } from '../module';
import { BreadcrumbsProvider } from '../providers/breadcrumbs';
import { ClientValueProvider } from '../providers/client';
import { CommandsProvider } from '../providers/commands';
import { CreateRecordProvider } from '../providers/create-record';
import { LabelsProvider } from '../providers/labels';
import { SchemaValueProvider, schemaContextValue } from '../providers/schema';
import { StudioConfigProvider } from '../providers/studio-config';
import { WorkspaceProvider } from '../providers/workspace';
import { createStaticNavigation, type Navigation, NavigationProvider } from '../router/navigation';

const now = '2026-01-01T00:00:00.000Z';
const base = { workspaceId: 'ws1', createdAt: now, updatedAt: now, moduleId: null as string | null };

/** Two objects (person → company), a saved table view on person filtered to stage=new. */
export const schemaFixture = (): WorkspaceSchema => ({
  workspaceId: 'ws1',
  version: 1,
  objects: [
    {
      ...base,
      id: '01a1751f-5f09-7114-9d75-bebf2c7785e8',
      nameSingular: 'person',
      namePlural: 'people',
      labelSingular: 'Person',
      labelPlural: 'People',
      icon: 'user',
      primaryFieldId: '01a17522-1eb8-7612-9ae6-873de332d467',
      isSystem: false,
      readOnly: false,
    },
    {
      ...base,
      id: '01a1751f-5f09-7114-9d75-c6298b7cb4b3',
      nameSingular: 'company',
      namePlural: 'companies',
      labelSingular: 'Company',
      labelPlural: 'Companies',
      icon: 'building-2',
      primaryFieldId: '01a17526-8e0c-7010-b63c-78778a3a6967',
      isSystem: false,
      readOnly: false,
    },
  ],
  fields: [
    {
      ...base,
      objectId: '01a1751f-5f09-7114-9d75-bebf2c7785e8',
      id: '01a17522-1eb8-7612-9ae6-873de332d467',
      name: 'first_name',
      type: 'text',
      label: 'First name',
      settings: {},
      isRequired: true,
      isUnique: false,
      position: 0,
    },
    {
      ...base,
      objectId: '01a1751f-5f09-7114-9d75-bebf2c7785e8',
      id: '01a17526-8e0c-7010-b63c-609084a6f142',
      name: 'email',
      type: 'email',
      label: 'Email',
      settings: {},
      isRequired: false,
      isUnique: false,
      position: 1,
    },
    {
      ...base,
      objectId: '01a1751f-5f09-7114-9d75-bebf2c7785e8',
      id: '01a17522-948c-716e-8949-3b5c910db6f8',
      name: 'stage',
      type: 'select',
      label: 'Stage',
      settings: {
        options: [
          { value: 'new', label: 'New', color: 'blue' },
          { value: 'won', label: 'Won', color: 'green' },
        ],
      },
      isRequired: false,
      isUnique: false,
      position: 2,
    },
    {
      ...base,
      objectId: '01a1751f-5f09-7114-9d75-bebf2c7785e8',
      id: '01a17526-8e0c-7010-b63c-6c9773d96d19',
      name: 'company',
      type: 'relation',
      label: 'Company',
      settings: { relationType: 'many_to_one', targetObjectId: '01a1751f-5f09-7114-9d75-c6298b7cb4b3' },
      isRequired: false,
      isUnique: false,
      position: 3,
    },
    {
      ...base,
      objectId: '01a1751f-5f09-7114-9d75-c6298b7cb4b3',
      id: '01a17526-8e0c-7010-b63c-78778a3a6967',
      name: 'name',
      type: 'text',
      label: 'Name',
      settings: {},
      isRequired: true,
      isUnique: false,
      position: 0,
    },
  ],
  views: [
    {
      ...base,
      objectId: '01a1751f-5f09-7114-9d75-bebf2c7785e8',
      id: '01a17522-948a-774f-9272-cf1d32843a07',
      label: 'New people',
      type: 'table',
      icon: 'table',
      isDefault: true,
      position: 0,
      config: {
        fields: [
          { fieldId: '01a17522-1eb8-7612-9ae6-873de332d467', width: 200, visible: true },
          { fieldId: '01a17526-8e0c-7010-b63c-609084a6f142', visible: true },
          { fieldId: '01a17522-948c-716e-8949-3b5c910db6f8', visible: true },
        ],
        filter: { field: '01a17522-948c-716e-8949-3b5c910db6f8', op: 'eq', value: 'new' },
        sorts: [{ fieldId: '01a17522-1eb8-7612-9ae6-873de332d467', direction: 'asc' }],
        settings: {},
      },
    },
  ],
  layouts: [],
  navItems: [
    {
      ...base,
      id: '01a1751f-5f09-7114-9d75-bae48e0719e6',
      label: 'People',
      icon: 'user',
      target: { kind: 'object', objectId: '01a1751f-5f09-7114-9d75-bebf2c7785e8' },
      position: 0,
      parentId: null,
      pinned: false,
      overrides: null,
    },
    {
      ...base,
      id: '01a17526-8e0d-76c6-92a0-67e7aa342711',
      label: 'Docs',
      target: { kind: 'url', url: 'https://example.com', external: true },
      position: 1,
      parentId: null,
      pinned: false,
      overrides: null,
    },
  ],
  commandItems: [],
  modules: [],
});

export const recordsFixture = (): Record<string, RecordData[]> => ({
  person: [
    {
      id: 'p1',
      created_at: now,
      updated_at: now,
      first_name: 'Ada',
      email: 'ada@example.com',
      stage: 'new',
      company: 'c1',
    },
    {
      id: 'p2',
      created_at: now,
      updated_at: now,
      first_name: 'Grace',
      email: 'grace@example.com',
      stage: 'won',
      company: 'c1',
    },
    { id: 'p3', created_at: now, updated_at: now, first_name: 'Linus', email: null, stage: 'new', company: null },
  ],
  company: [{ id: 'c1', created_at: now, updated_at: now, name: 'Acme' }],
});

/** An active agent with every tool; override what the test is about. */
export const agentFixture = (overrides: Partial<AiAgent> = {}): AiAgent => ({
  workspaceId: 'ws1',
  id: 'workspace.agent-general',
  label: 'Assistant',
  icon: 'agent',
  description: 'Works with everything in the workspace.',
  instructions: null,
  tools: null,
  skills: null,
  starterPrompts: [],
  approvalOverrides: {},
  takesTasks: false,
  moduleId: null,
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

/** A workspace with no skills, where none can be written. */
export const noSkills: AiClient['skills'] = {
  list: async () => [],
  get: async () => {
    throw new DeviasApiError(404, 'NOT_FOUND', 'not found');
  },
  create: async () => {
    throw new DeviasApiError(422, 'MISSING_DEPENDENCY', 'not configured');
  },
  update: async () => {
    throw new DeviasApiError(422, 'MISSING_DEPENDENCY', 'not configured');
  },
  delete: async () => {},
};

const notConfigured = (): AiClient => ({
  status: async () => ({ configured: false, model: '', effort: '', tools: [], canManage: true }),
  conversations: {
    list: async () => [],
    create: async () => {
      throw new DeviasApiError(422, 'MISSING_DEPENDENCY', 'not configured');
    },
    get: async () => {
      throw new DeviasApiError(404, 'NOT_FOUND', 'not found');
    },
    delete: async () => {},
  },
  send: () => {
    throw new DeviasApiError(422, 'MISSING_DEPENDENCY', 'not configured');
  },
  resolve: () => {
    throw new DeviasApiError(422, 'MISSING_DEPENDENCY', 'not configured');
  },
  cancel: async () => null,
  agents: {
    list: async () => [],
    usage: async () => [],
    activity: async () => ({ days: [] }),
    create: async () => {
      throw new DeviasApiError(422, 'MISSING_DEPENDENCY', 'not configured');
    },
    update: async () => {
      throw new DeviasApiError(422, 'MISSING_DEPENDENCY', 'not configured');
    },
    delete: async () => {},
  },
  skills: noSkills,
  settings: {
    get: async () => ({ defaultAgentId: null, updatedAt: null }),
    update: async (patch) => ({
      defaultAgentId: patch.defaultAgentId ?? null,
      updatedAt: null,
    }),
  },
});

/** A tiny in-memory DeviasClient over the core filter evaluator. Never imports @devias/sdk. */
export const createFakeClient = (
  schema: WorkspaceSchema,
  records: Record<string, RecordData[]>,
  options: {
    ai?: AiClient;
    activity?: DeviasClient['activity'];
    comments?: DeviasClient['comments'];
    notifications?: DeviasClient['notifications'];
    documents?: DeviasClient['documents'];
    assets?: DeviasClient['assets'];
    tasks?: DeviasClient['tasks'];
    workflows?: DeviasClient['workflows'];
    modules?: DeviasClient['modules'];
    import?: DeviasClient['records']['import'];
  } = {},
) => {
  let counter = 100;
  const searchable = (object: string) =>
    schema.fields
      .filter((f) => f.objectId === schema.objects.find((o) => o.nameSingular === object)?.id && f.type === 'text')
      .map((f) => f.name);
  const calls: { list: number } = { list: 0 };
  const client = {
    workspaceId: 'ws1',
    calls,
    records: {
      list: async (query: Query) => {
        calls.list += 1;
        const all = (records[query.object] ?? [])
          .filter((r) => evaluateFilter(r, query.filter))
          .filter((r) => matchesSearch(r, searchable(query.object), query.search ?? ''));
        const sorted = sortRecords(all, query.sort ?? []);

        return { items: sorted.slice(0, query.limit ?? 50), nextCursor: null, totalCount: sorted.length };
      },
      get: async (object: string, id: string) => {
        const record = records[object]?.find((r) => r.id === id);

        if (!record) {
          throw new DeviasApiError(404, 'NOT_FOUND', `${object} ${id} not found`);
        }

        return record;
      },
      create: async (object: string, data: Record<string, unknown>) => {
        const record = { id: `r${counter++}`, created_at: now, updated_at: now, ...data };
        const list = records[object] ?? [];
        list.push(record);
        records[object] = list;

        return record;
      },
      update: async (object: string, id: string, patch: Record<string, unknown>) => {
        const list = records[object] ?? [];
        const index = list.findIndex((r) => r.id === id);

        if (index < 0) {
          throw new DeviasApiError(404, 'NOT_FOUND', 'not found');
        }

        const next = { ...list[index], ...patch, updated_at: now } as RecordData;
        list[index] = next;

        return next;
      },
      delete: async (object: string, ids: string[]) => {
        records[object] = (records[object] ?? []).filter((r) => !ids.includes(r.id));
      },
      upsert: async () => {
        throw new Error('not implemented');
      },
      lookup: async () => [],
      import:
        options.import ??
        (async () => {
          throw new Error('not implemented');
        }),
    },
    metadata: {
      getSchema: async () => schema,
      objects: crud(),
      fields: crud(),
      views: crud(),
      layouts: crud(),
      navItems: {
        ...crud(),
        arrange: async () => [],
        resetAll: async () => [],
        reset: async () => {
          throw new Error('not implemented');
        },
      },
      commandItems: crud(),
    },
    modules: options.modules ?? {
      list: async () => [],
      catalog: async () => [],
      logoUrl: () => undefined,
      plan: async () => {
        throw new Error('not implemented');
      },
      apply: async () => {
        throw new Error('not implemented');
      },
      uninstall: async () => {
        throw new Error('not implemented');
      },
      connections: {
        list: async () => ({ providers: [], connections: [] }),
        get: async () => {
          throw new DeviasApiError(404, 'NOT_FOUND', 'not found');
        },
        create: async () => {
          throw new Error('not implemented');
        },
        update: async () => {
          throw new Error('not implemented');
        },
        authorize: async () => {
          throw new Error('not implemented');
        },
        test: async () => ({ ok: true, testedAt: now }),
        disconnect: async () => {},
      },
      variables: {
        list: async () => [],
        update: async () => [],
      },
      runAction: async () => ({ output: null }),
      events: async () => ({ items: [], nextCursor: null }),
    },
    activity: options.activity ?? {
      list: async () => ({ items: [], nextCursor: null }),
    },
    comments: options.comments ?? {
      list: async () => ({ items: [], nextCursor: null, total: 0 }),
      create: async () => {
        throw new Error('not implemented');
      },
      update: async () => {
        throw new Error('not implemented');
      },
      delete: async () => {},
    },
    notifications: options.notifications ?? {
      list: async () => ({ items: [], nextCursor: null }),
      unreadCount: async () => ({ count: 0 }),
      send: async () => ({ recipients: 0, created: 0, updated: 0 }),
      markRead: async () => {
        throw new Error('not implemented');
      },
      markUnread: async () => {
        throw new Error('not implemented');
      },
      markAllRead: async () => ({ updated: 0 }),
      delete: async () => {},
    },
    workflows: options.workflows ?? {
      list: async () => [],
      get: async () => {
        throw new DeviasApiError(404, 'NOT_FOUND', 'not found');
      },
      create: async () => {
        throw new Error('not implemented');
      },
      update: async () => {
        throw new Error('not implemented');
      },
      delete: async () => {},
      runs: async () => ({ items: [], nextCursor: null }),
      recordRuns: async () => ({ items: [] }),
      activity: async () => ({ days: [], workflows: [] }),
      run: async () => {
        throw new Error('not implemented');
      },
      retryRun: async () => {
        throw new Error('not implemented');
      },
    },
    documents: options.documents ?? {
      list: async () => ({ items: [], nextCursor: null, total: 0 }),
      get: async () => {
        throw new DeviasApiError(404, 'NOT_FOUND', 'document not found');
      },
      create: async () => {
        throw new Error('not implemented');
      },
      update: async () => {
        throw new Error('not implemented');
      },
      append: async () => {
        throw new Error('not implemented');
      },
      activity: async () => ({ items: [], nextCursor: null }),
      comment: async () => {
        throw new Error('not implemented');
      },
      comments: async () => ({ items: [] }),
      updateComment: async () => {
        throw new Error('not implemented');
      },
      deleteComment: async () => {},
      delete: async () => {},
    },
    assets: options.assets ?? {
      list: async () => ({ items: [], nextCursor: null, total: 0 }),
      get: async () => {
        throw new DeviasApiError(404, 'NOT_FOUND', 'file not found');
      },
      upload: async () => {
        throw new Error('not implemented');
      },
      update: async () => {
        throw new Error('not implemented');
      },
      delete: async () => {},
      link: async () => {
        throw new Error('not implemented');
      },
      usage: async () => ({ records: [], mentions: [], total: 0 }),
      workspaceUsage: async () => ({ count: 0, bytes: 0, quotaBytes: null }),
    },
    tasks: options.tasks ?? {
      list: async () => ({ items: [], nextCursor: null, total: 0 }),
      get: async () => {
        throw new DeviasApiError(404, 'NOT_FOUND', 'task not found');
      },
      create: async () => {
        throw new Error('not implemented');
      },
      update: async () => {
        throw new Error('not implemented');
      },
      delete: async () => {},
      activity: async () => ({ items: [], nextCursor: null }),
      comment: async () => {
        throw new Error('not implemented');
      },
      runs: async () => ({ items: [] }),
      stop: async () => {
        throw new Error('not implemented');
      },
      retry: async () => {
        throw new Error('not implemented');
      },
      counts: async () => ({
        open: 0,
        overdue: 0,
        dueToday: 0,
        dueThisWeek: 0,
        inReview: 0,
        mine: 0,
        agentsWorking: 0,
        byStatus: {},
      }),
    },
    events: { subscribe: () => () => {} },
    ai: options.ai ?? notConfigured(),
  } satisfies Omit<DeviasClient, 'records'> & { records: Record<string, unknown>; calls: { list: number } };

  return client as unknown as DeviasClient & { calls: { list: number } };
};

const crud = () => ({
  list: async () => [],
  get: async () => {
    throw new Error('not implemented');
  },
  create: async () => {
    throw new Error('not implemented');
  },
  update: async () => {
    throw new Error('not implemented');
  },
  delete: async () => {},
});

export const resolvedFixture = (overrides: Partial<StudioConfig> = {}): ResolvedStudioConfig =>
  resolveConfig(defineStudio({ title: 'Test Studio', modules: [studio()], ...overrides }));

export const organizationFixture: Organization = { id: 'ws1', name: 'Acme', slug: 'acme' };

/** Everything a view or record component needs, without a router or a real backend. */
export function TestProviders({
  children,
  client,
  schema = schemaFixture(),
  config = resolvedFixture(),
  navigation = createStaticNavigation('/workspaces/acme/records/person'),
  admin = true,
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }),
}: {
  children: ReactNode;
  client: DeviasClient;
  schema?: WorkspaceSchema;
  config?: ResolvedStudioConfig;
  navigation?: Navigation;
  /** Whether the signed-in user (u1) is an admin of the workspace; a plain member otherwise. */
  admin?: boolean;
  /** The query cache, for a test that refreshes it the way live updates do. */
  queryClient?: QueryClient;
}) {
  return (
    <StudioConfigProvider value={config}>
      <NavigationProvider value={navigation}>
        <QueryClientProvider client={queryClient}>
          <WorkspaceProvider
            value={{
              workspaceId: 'ws1',
              slug: 'acme',
              organization: organizationFixture,
              user: { id: 'u1', name: 'Test User', email: 'test@example.com' },
              role: admin ? 'owner' : 'member',
              isAdmin: admin,
              roleStatus: 'ready',
              members: [
                {
                  id: 'm1',
                  userId: 'u1',
                  role: 'owner',
                  user: { id: 'u1', name: 'Test User', email: 'test@example.com' },
                },
                {
                  id: 'm2',
                  userId: 'u2',
                  role: 'member',
                  user: { id: 'u2', name: 'Grace Hopper', email: 'grace@example.com' },
                },
              ],
            }}
          >
            <ClientValueProvider value={client}>
              <SchemaValueProvider value={schemaContextValue(schema)}>
                <LabelsProvider>
                  <BreadcrumbsProvider>
                    <CreateRecordProvider>
                      <CommandsProvider>{children}</CommandsProvider>
                    </CreateRecordProvider>
                  </BreadcrumbsProvider>
                </LabelsProvider>
              </SchemaValueProvider>
            </ClientValueProvider>
          </WorkspaceProvider>
        </QueryClientProvider>
      </NavigationProvider>
    </StudioConfigProvider>
  );
}

// jsdom has no Web Animations: a scroll area (Base UI) asks its viewport for its animations when it measures.
if (typeof Element !== 'undefined' && !('getAnimations' in Element.prototype)) {
  Object.defineProperty(Element.prototype, 'getAnimations', { configurable: true, value: () => [] });
}

/** jsdom has no layout: give scroll containers a size so the virtualizer renders rows. */
export const installLayoutStubs = () => {
  if (typeof ResizeObserver === 'undefined') {
    // React Flow measures nodes and handles from the observer's first callback, so fire once for canvas elements.
    class ResizeObserverStub {
      private readonly callback: (entries: unknown[], observer: ResizeObserverStub) => void;
      constructor(callback: (entries: unknown[], observer: ResizeObserverStub) => void) {
        this.callback = callback;
      }
      observe(target: Element) {
        if (!target.closest('.react-flow')) {
          return;
        }

        queueMicrotask(() =>
          this.callback([{ target, contentRect: target.getBoundingClientRect(), borderBoxSize: [] }], this),
        );
      }
      unobserve() {}
      disconnect() {}
    }
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
  }

  // The command list (cmdk) scrolls the highlighted item into view.
  if (typeof Element.prototype.scrollIntoView !== 'function') {
    Element.prototype.scrollIntoView = () => {};
  }

  // React Flow reads the pane's zoom transform and SVG boxes, which jsdom does not implement.
  if (typeof (globalThis as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly === 'undefined') {
    class DOMMatrixReadOnlyStub {
      m22: number;
      constructor(transform?: string) {
        const scale = transform?.match(/scale\(([1-9.]+)\)/)?.[1];
        this.m22 = scale === undefined ? 1 : Number(scale);
      }
    }
    (globalThis as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly = DOMMatrixReadOnlyStub;
  }

  if (typeof SVGElement !== 'undefined' && !('getBBox' in SVGElement.prototype)) {
    Object.defineProperty(SVGElement.prototype, 'getBBox', {
      configurable: true,
      value: () => ({ x: 0, y: 0, width: 0, height: 0 }),
    });
  }

  const rect = { x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 600, width: 1000, height: 600, toJSON: () => ({}) };
  Element.prototype.getBoundingClientRect = () => rect as DOMRect;
  // ProseMirror scrolls the cursor into view through client rects, for elements and for ranges.
  Element.prototype.getClientRects = () => [rect] as unknown as DOMRectList;

  if (typeof Range !== 'undefined') {
    Range.prototype.getBoundingClientRect = () => rect as DOMRect;
    Range.prototype.getClientRects = () => [rect] as unknown as DOMRectList;
  }

  // @tanstack/virtual-core measures scroll containers with offsetWidth/offsetHeight.
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 600 });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 1000 });
};
