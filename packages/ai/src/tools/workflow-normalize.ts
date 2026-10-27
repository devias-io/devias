import {
  ACTIONS,
  type InstalledModule,
  literalObjectOf,
  type SchemaIndex,
  type WorkflowStepInput,
  type WorkflowTrigger,
} from '@devias/core';
import { EngineError } from '@devias/data-engine';
import { resolveField, resolveObject } from './helpers';

/** Installed modules may be referenced by id or by label. */
const installedModule = (index: SchemaIndex, ref: string): InstalledModule => {
  const installed = index.schema.modules;
  const needle = ref.trim().toLowerCase();
  const found =
    installed.find((module) => module.id === ref) ?? installed.find((module) => module.label.toLowerCase() === needle);

  if (found) {
    return found;
  }

  const known = installed
    .filter((module) => module.actions.length > 0 || module.events.length > 0)
    .map((module) => `${module.id} (${module.label})`)
    .join(', ');

  throw new EngineError('NOT_FOUND', `Module "${ref}" is not installed. Modules: ${known || 'none with actions'}`);
};

const resolveModule = (index: SchemaIndex, ref: string): string => installedModule(index, ref).id;

export const normalizeTrigger = (index: SchemaIndex, trigger: WorkflowTrigger): WorkflowTrigger => {
  switch (trigger.kind) {
    case 'manual':
      return { ...trigger, objectId: resolveObject(index, trigger.objectId).id };
    case 'schedule':
      return trigger.objectId ? { ...trigger, objectId: resolveObject(index, trigger.objectId).id } : trigger;
    case 'record_event': {
      const object = resolveObject(index, trigger.objectId);

      return {
        ...trigger,
        objectId: object.id,
        ...(trigger.fieldIds
          ? { fieldIds: trigger.fieldIds.map((field) => resolveField(index, object, field).id) }
          : {}),
      };
    }
    case 'task_event':
      return trigger;
    case 'module_event':
      return { ...trigger, moduleId: resolveModule(index, trigger.moduleId) };
  }
};

const normalizeValues = (
  index: SchemaIndex,
  objectName: string | undefined,
  values: Record<string, unknown>,
): Record<string, unknown> => {
  // Without an object the engine rejects the step with a clearer message than a field lookup could.
  const object = objectName ? index.objectsByName.get(objectName) : undefined;

  if (!object) {
    return values;
  }

  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [resolveField(index, object, key).name, value]),
  );
};

/**
 * An action is named by its id. The model may also write what it calls the tool, which is the action's name:
 * `update_record` for a core one, `send_email` for a module's. Both become the id.
 */
const resolveActionId = (index: SchemaIndex, ref: string): string => {
  const installed = index.schema.modules;
  const coreAction = (name: string) => ACTIONS.find((spec) => spec.ai.tool === name);

  // An id as it stands: a core action, or one an installed module declares.
  if (
    ACTIONS.some((spec) => spec.id === ref) ||
    installed.some((module) => module.actions.some((action) => action.id === ref))
  ) {
    return ref;
  }

  // A tool's name: a core action's tool is the one that serves it; a module's action is called by its name, which is unique.
  return (
    coreAction(ref)?.id ??
    installed.flatMap((module) => module.actions).find((action) => action.name === ref)?.id ??
    ref
  );
};

export const normalizeSteps = (
  index: SchemaIndex,
  recordObject: string | undefined,
  steps: WorkflowStepInput[],
): WorkflowStepInput[] =>
  steps.map((step): WorkflowStepInput => {
    if (step.kind === 'action') {
      const action = resolveActionId(index, step.actionId);
      // A records action names its object and fields; accept labels for both.
      const objectRef = literalObjectOf(step.input);

      if (!objectRef) {
        return { ...step, actionId: action };
      }

      const object = resolveObject(index, objectRef);
      const values = step.input.values;

      return {
        ...step,
        actionId: action,
        input: {
          ...step.input,
          object: object.nameSingular,
          ...(values && typeof values === 'object' && !Array.isArray(values)
            ? { values: normalizeValues(index, object.nameSingular, values as Record<string, unknown>) }
            : {}),
        },
      };
    }

    return {
      ...step,
      yes: normalizeSteps(index, recordObject, step.yes),
      no: normalizeSteps(index, recordObject, step.no),
    };
  });
