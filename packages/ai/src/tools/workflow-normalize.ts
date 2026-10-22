import {
  actionAddress,
  CORE_OWNER,
  literalObjectOf,
  type SchemaIndex,
  type WorkflowStepInput,
  type WorkflowTrigger,
} from '@devias/core';
import { EngineError } from '@devias/data-engine';
import { resolveField, resolveObject } from './helpers';

/** Installed modules may be referenced by id or by name. */
const resolveModule = (index: SchemaIndex, ref: string): string => {
  const installed = index.schema.modules;

  if (installed.some((module) => module.moduleId === ref)) {
    return ref;
  }

  const needle = ref.trim().toLowerCase();
  const named = installed.find((module) => module.name.toLowerCase() === needle);

  if (named) {
    return named.moduleId;
  }

  const known = installed
    .filter((module) => module.actions.length > 0 || module.events.length > 0)
    .map((module) => `${module.moduleId} (${module.name})`)
    .join(', ');

  throw new EngineError('NOT_FOUND', `Module "${ref}" is not installed. Modules: ${known || 'none with actions'}`);
};

export const normalizeTrigger = (index: SchemaIndex, trigger: WorkflowTrigger): WorkflowTrigger => {
  switch (trigger.kind) {
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
    case 'manual':
      return { ...trigger, objectId: resolveObject(index, trigger.objectId).id };
    case 'schedule':
      return trigger.objectId ? { ...trigger, objectId: resolveObject(index, trigger.objectId).id } : trigger;
    case 'event':
      return { ...trigger, moduleId: resolveModule(index, trigger.moduleId) };
    case 'task_event':
      return trigger;
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
 * An action is named by its id, `core.update_record` or `mailer.send_email`. The model may also write what it calls the
 * tool: `update_record` for a core one, `mailer__send_email` for a module's; or a module by its name,
 * `Mailer.send_email`. All become the id.
 */
const resolveActionId = (index: SchemaIndex, id: string): string => {
  const dot = id.indexOf('.');

  if (dot > 0) {
    const owner = id.slice(0, dot);

    // The module must be one the workspace has: this names the ones it does (by id or by name).
    return owner === CORE_OWNER ? id : actionAddress(resolveModule(index, owner), id.slice(dot + 1));
  }

  const split = id.indexOf('__');

  return split > 0
    ? actionAddress(resolveModule(index, id.slice(0, split).replace(/_/g, '-')), id.slice(split + 2))
    : actionAddress(CORE_OWNER, id);
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
