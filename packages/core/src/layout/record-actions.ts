import type { InstalledModule, LayoutAction } from '../metadata/schema';
import type { ActionDefinition, ActionField } from '../module-runtime';
import type { Filter } from '../query/ir';

/** A module action a record page offers, with every default filled in. */
export interface ResolvedRecordAction {
  /** The action's id. */
  key: string;
  moduleId: string;
  action: ActionDefinition;
  /** The action's field that takes the record's id. */
  input: string;
  label: string;
  icon: string;
  primary: boolean;
  when: Filter | undefined;
}

type ModuleActions = Pick<InstalledModule, 'id' | 'actions'>;

/** The declared action with this id, and the installed module that declares it, if there is one. */
export const findModuleAction = (modules: readonly ModuleActions[], id: string) => {
  for (const module of modules) {
    const action = module.actions.find((candidate) => candidate.id === id);

    if (action) {
      return { module, action };
    }
  }

  return undefined;
};

/** The action's fields that take a record of this object. */
const recordFieldsFor = (action: ActionDefinition, objectAddress: string): ActionField[] =>
  action.input.filter((field) => field.type === 'record' && field.objectId === objectAddress);

/**
 * Which of the action's fields takes the record's id on a page of this object: the one the entry names, else the
 * action's only `record` field for the object. A problem message when there is none, or the entry must say which.
 */
const recordInputOf = (
  entry: LayoutAction,
  action: ActionDefinition,
  objectAddress: string,
): { input: string } | { problem: string } => {
  const fields = recordFieldsFor(action, objectAddress);

  if (entry.input) {
    return fields.some((field) => field.name === entry.input)
      ? { input: entry.input }
      : { problem: `"${entry.actionId}" has no record field "${entry.input}" for this layout's object` };
  }

  const [only, ...more] = fields;

  if (!only) {
    const takes = [
      ...new Set(action.input.flatMap((field) => (field.type === 'record' && field.objectId ? [field.objectId] : []))),
    ];

    return {
      problem: `"${entry.actionId}" takes ${takes.length > 0 ? `a record of ${takes.join(' or ')}` : 'no record'}, not one of this layout's object (${objectAddress})`,
    };
  }

  return more.length > 0
    ? {
        problem: `"${entry.actionId}" needs \`input\`: it has several record fields for this object (${fields.map((field) => field.name).join(', ')})`,
      }
    : { input: only.name };
};

/**
 * What a layout's `actions` entry needs: an installed module's action that takes a record of the layout's object. A
 * problem message, or null when the entry can run.
 */
export const layoutActionProblem = (
  entry: LayoutAction,
  modules: readonly ModuleActions[],
  objectAddress: string,
): string | null => {
  const found = findModuleAction(modules, entry.actionId);

  if (!found) {
    return `"${entry.actionId}" is not an action of an installed module`;
  }

  const resolved = recordInputOf(entry, found.action, objectAddress);

  return 'problem' in resolved ? resolved.problem : null;
};

/**
 * The actions a record page of this object offers, in order: exactly the layout's `actions`, each with what it leaves
 * out filled in from the action. An entry for an action that is not installed, or that does not take a record of this
 * object, is left out.
 */
export const recordActionsOf = (
  objectAddress: string,
  layoutActions: readonly LayoutAction[] | null | undefined,
  modules: readonly InstalledModule[],
): ResolvedRecordAction[] => {
  const seen = new Set<string>();

  return (layoutActions ?? []).flatMap((entry) => {
    const found = findModuleAction(modules, entry.actionId);

    if (!found || seen.has(entry.actionId)) {
      return [];
    }

    const resolved = recordInputOf(entry, found.action, objectAddress);

    if ('problem' in resolved) {
      return [];
    }

    seen.add(entry.actionId);

    return [
      {
        key: entry.actionId,
        moduleId: found.module.id,
        action: found.action,
        input: resolved.input,
        label: entry.label ?? found.action.label,
        icon: entry.icon ?? found.action.icon ?? 'zap',
        primary: entry.primary ?? false,
        when: entry.when,
      },
    ];
  });
};
