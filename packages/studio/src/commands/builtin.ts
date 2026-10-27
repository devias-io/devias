import {
  type CommandDefinition,
  type CommandProvider,
  coreIds,
  defineCommand,
  defineCommandProvider,
} from '@devias/core';
import { applyTheme, getTheme, resolveTheme } from '@devias/ui';
import { ids } from '../ids';
import { useDock } from '../shell/dock';

const contains = (text: string, query: string) => text.toLowerCase().includes(query);

/** Core commands that only need the command context. */
export const builtinCommands: CommandDefinition[] = [
  defineCommand({
    id: ids.commands.new_document,
    label: 'New document',
    icon: 'file-text',
    group: 'Create',
    keywords: ['write', 'page'],
    run: (ctx) => ctx.createDocument(),
  }),
  defineCommand({
    id: ids.commands.new_task,
    label: 'New task',
    icon: 'check-square',
    group: 'Create',
    keywords: ['todo', 'work'],
    run: (ctx) => ctx.createTask(),
  }),
  defineCommand({
    id: ids.commands.go_records,
    label: 'Go to records',
    icon: 'database',
    group: 'Navigate',
    shortcut: 'g r',
    run: (ctx) => ctx.navigate('records'),
  }),
  defineCommand({
    id: ids.commands.go_settings,
    label: 'Open settings',
    icon: 'settings',
    group: 'Navigate',
    shortcut: 'g s',
    run: (ctx) => ctx.navigate('settings'),
  }),
  defineCommand({
    id: ids.commands.go_workspaces,
    label: 'Switch workspace',
    icon: 'layers',
    group: 'Navigate',
    run: (ctx) => ctx.navigate('/workspaces'),
  }),
  defineCommand({
    id: ids.commands.toggle_notifications,
    label: 'Toggle notifications',
    icon: 'bell',
    group: 'Navigate',
    keywords: ['inbox', 'bell'],
    run: () => useDock.getState().toggle(coreIds.blocks.notifications),
  }),
  defineCommand({
    id: ids.commands.toggle_theme,
    label: 'Toggle dark mode',
    icon: 'moon',
    group: 'Preferences',
    keywords: ['theme', 'light', 'dark'],
    run: () => applyTheme(resolveTheme(getTheme()) === 'dark' ? 'light' : 'dark'),
  }),
];

/** Navigation over objects and views of the workspace schema. */
export const navigationProvider: CommandProvider = defineCommandProvider({
  id: ids.command_providers.navigation,
  search: (query, ctx) => {
    const q = query.trim().toLowerCase();
    const out: CommandDefinition[] = [];

    for (const object of ctx.schema.objects) {
      if (q && !contains(object.labelPlural, q) && !contains(object.nameSingular, q)) {
        continue;
      }

      out.push({
        id: `nav:object:${object.id}`,
        label: object.labelPlural,
        icon: object.icon ?? 'box',
        group: 'Objects',
        run: (c) => c.navigate(`records/${object.nameSingular}`),
      });
    }

    if (q) {
      for (const view of ctx.schema.views) {
        const object = ctx.schema.objects.find((o) => o.id === view.objectId);

        if (!object) {
          continue;
        }

        const title = `${object.labelPlural} · ${view.label}`;

        if (!contains(title, q)) {
          continue;
        }

        out.push({
          id: `nav:view:${view.id}`,
          label: title,
          icon: view.icon ?? 'table',
          group: 'Views',
          run: (c) => c.navigate(`records/${object.nameSingular}?view=${encodeURIComponent(view.id)}`),
        });
      }
    }

    return out;
  },
});

/** "New <object>" for every writable object. */
export const createRecordProvider: CommandProvider = defineCommandProvider({
  id: ids.command_providers.create,
  search: (query, ctx) => {
    const q = query.trim().toLowerCase();

    return ctx.schema.objects
      .filter((o) => !o.readOnly)
      .map((object) => ({ object, title: `New ${object.labelSingular.toLowerCase()}` }))
      .filter(({ title, object }) => !q || contains(title, q) || contains(object.labelSingular, q))
      .map(({ object, title }) => ({
        id: `create:${object.id}`,
        label: title,
        icon: object.icon ?? 'plus',
        group: 'Create',
        run: (c) => c.createRecord(object.nameSingular),
      }));
  },
});
