import {
  type CommandContext,
  type CommandDefinition,
  type CommandItem,
  type CommandProvider,
  objectByKey,
  objectIdOf,
} from '@devias/core';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { createSequenceMatcher, type KeyBinding } from '../commands/keybindings';
import { useNewDocument } from '../hooks/use-documents';
import { useNavigateTo } from '../hooks/use-navigate-to';
import { useNewTask } from '../hooks/use-tasks';
import { useAvailablePages } from '../registries';
import { links } from '../router/links';
import { useNavigation } from '../router/navigation';
import { BlockDialog } from '../shell/block-dialog';
import { navTargetHref } from '../shell/nav-targets';
import { useClient } from './client';
import { useOpenCreateRecord } from './create-record';
import { useSchema } from './schema';
import { useStudioConfig } from './studio-config';
import { useWorkspace } from './workspace';

export interface CommandsContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Static commands: registry commands plus the workspace's manifest command items. */
  commands: CommandDefinition[];
  providers: CommandProvider[];
  context: CommandContext;
  run: (command: CommandDefinition) => Promise<void>;
}

const CommandsContext = createContext<CommandsContextValue | null>(null);

const matchesText = (text: string, query: string) => text.toLowerCase().includes(query);

/**
 * Registry + metadata commands, providers, the Cmd+K state and keyboard shortcuts.
 * `ctx.navigate(to)` accepts absolute hrefs or workspace-relative paths (`records/person`).
 */
export function CommandsProvider({ children }: { children: ReactNode }) {
  const config = useStudioConfig();
  const client = useClient();
  const { schema, index } = useSchema();
  const { workspaceId, slug } = useWorkspace();
  const navigation = useNavigation();
  const nav = useNavigateTo();
  const availablePages = useAvailablePages();
  const openCreate = useOpenCreateRecord();
  const newDocument = useNewDocument();
  const newTask = useNewTask();
  const [open, setOpen] = useState(false);
  const [blockId, setBlockId] = useState<string | null>(null);

  const context = useMemo<CommandContext>(
    () => ({
      workspaceId,
      navigate: (to) => navigation.navigate(to.startsWith('/') ? to : links.page(slug, to)),
      openRecord: (object, id) => nav.toRecord(object, id),
      createRecord: (object) => openCreate({ object }),
      createDocument: () => void newDocument(),
      createTask: () => void newTask(),
      schema,
      closeMenu: () => setOpen(false),
    }),
    [workspaceId, slug, navigation, nav, openCreate, newDocument, newTask, schema],
  );

  const commands = useMemo<CommandDefinition[]>(() => {
    const fromItem = (item: CommandItem): CommandDefinition => ({
      id: item.id,
      label: item.label,
      icon: item.icon,
      group: item.group ?? 'Workspace',
      shortcut: item.shortcut,
      run: (ctx) => {
        const action = item.action;

        if (action.kind === 'navigate') {
          const target = navTargetHref(action.target, slug, index, config.registries.pages);

          if (target.external && typeof window !== 'undefined') {
            window.open(target.href, '_blank', 'noopener');
          } else {
            ctx.navigate(target.href);
          }
        } else if (action.kind === 'create_record') {
          ctx.createRecord(action.objectId);
        } else {
          setBlockId(action.blockId);
        }
      },
    });
    // A command for a deleted object ("New invoice" once invoices are gone) would fail: skip it until it is removed.
    const live = schema.commandItems.filter((item) => {
      const object = objectIdOf(item.action);

      return object === undefined || objectByKey(index, object) !== undefined;
    });
    const all = [...config.registries.commands.values(), ...live.map(fromItem)];

    return all.filter((c) => (c.when ? c.when(context) : true));
  }, [config.registries.commands, config.registries.pages, schema.commandItems, slug, index, context]);

  const providers = useMemo<CommandProvider[]>(() => {
    const records: CommandProvider = {
      id: 'studio.records',
      search: async (query) => {
        const text = query.trim();

        if (text.length < 2) {
          return [];
        }

        const hits = await client.records.lookup({ text, limit: 8 });

        return hits.map((hit) => {
          const object = index.objectsByName.get(hit.object);

          return {
            id: `record:${hit.object}:${hit.recordId}`,
            label: hit.title,
            icon: object?.icon ?? 'file',
            group: object?.labelPlural ?? hit.object,
            keywords: hit.subtitle ? [hit.subtitle] : [],
            run: (ctx) => ctx.openRecord(hit.object, hit.recordId),
          };
        });
      },
    };
    const documents: CommandProvider = {
      id: 'studio.documents',
      search: async (query) => {
        const text = query.trim();

        if (text.length < 2) {
          return [];
        }

        const page = await client.documents.list({ search: text, limit: 5 });

        return page.items.map(
          (document): CommandDefinition => ({
            id: `document:${document.id}`,
            label: document.title,
            icon: 'file-text',
            group: 'Documents',
            run: () => nav.toDocument(document.id),
          }),
        );
      },
    };
    const tasks: CommandProvider = {
      id: 'studio.tasks',
      search: async (query) => {
        const text = query.trim();

        if (text.length < 2) {
          return [];
        }

        const page = await client.tasks.list({ search: text, limit: 5 });

        return page.items.map(
          (task): CommandDefinition => ({
            id: `task:${task.id}`,
            label: task.title,
            icon: 'check-square',
            group: 'Tasks',
            run: () => nav.toTask(task.id),
          }),
        );
      },
    };
    const pageCommands: CommandProvider = {
      id: 'studio.pages',
      search: (query) => {
        const q = query.trim().toLowerCase();
        const out: CommandDefinition[] = [];

        for (const page of availablePages.values()) {
          // Pages without a title (a composer, a detail page) are reached from elsewhere, not from the palette.
          if (!page.label) {
            continue;
          }

          const title = page.label;

          if (q && !matchesText(title, q) && !matchesText(page.path, q)) {
            continue;
          }

          out.push({
            id: `page:${page.path}`,
            label: title,
            icon: page.icon ?? 'box',
            group: 'Pages',
            run: (ctx) => ctx.navigate(links.page(slug, page.path)),
          });
        }

        for (const section of config.registries.settingsSections.values()) {
          if (!q || matchesText(section.label, q) || matchesText('settings', q)) {
            out.push({
              id: `settings:${section.name}`,
              label: `Settings · ${section.label}`,
              icon: section.icon ?? 'settings',
              group: 'Settings',
              run: (ctx) => ctx.navigate(links.settings(slug, section.name)),
            });
          }
        }

        return out;
      },
    };

    return [...config.registries.commandProviders.values(), pageCommands, records, documents, tasks];
  }, [client, index, config.registries, availablePages, slug, nav]);

  const run = useCallback(
    async (command: CommandDefinition) => {
      setOpen(false);

      try {
        await command.run(context);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Command failed');
      }
    },
    [context],
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const bindings: KeyBinding[] = [
      { keys: 'mod+k', global: true, run: () => setOpen((value) => !value) },
      ...commands
        .filter((c): c is CommandDefinition & { shortcut: string } => Boolean(c.shortcut))
        .map((c) => ({ keys: c.shortcut, run: () => void run(c) })),
    ];
    const matcher = createSequenceMatcher(bindings);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      if (matcher.handle(event)) {
        event.preventDefault();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => window.removeEventListener('keydown', onKeyDown);
  }, [commands, run]);

  const value = useMemo<CommandsContextValue>(
    () => ({ open, setOpen, commands, providers, context, run }),
    [open, commands, providers, context, run],
  );

  return (
    <CommandsContext.Provider value={value}>
      {children}
      {blockId ? <BlockDialog id={blockId} onClose={() => setBlockId(null)} /> : null}
    </CommandsContext.Provider>
  );
}

export const useCommands = (): CommandsContextValue => {
  const value = useContext(CommandsContext);

  if (!value) {
    throw new Error('useCommands must be used inside a workspace route');
  }

  return value;
};
