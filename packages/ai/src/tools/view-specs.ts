import type { ObjectMetadata, SchemaIndex } from '@devias/core';
import { EngineError } from '@devias/data-engine';
import { resolveField } from './helpers';

export const fieldIds = (index: SchemaIndex, object: ObjectMetadata, refs: string[]) =>
  refs.map((ref) => resolveField(index, object, ref).id);

export const assertGroupBy = (
  index: SchemaIndex,
  object: ObjectMetadata,
  type: string,
  groupBy: string | undefined,
) => {
  if (type !== 'kanban') {
    return;
  }

  if (!groupBy) {
    throw new EngineError('VALIDATION', 'A kanban view needs groupBy: a select field of the object');
  }

  const field = resolveField(index, object, groupBy);

  if (field.type !== 'select' && field.type !== 'boolean') {
    throw new EngineError('VALIDATION', `groupBy must be a select field; "${field.name}" is a ${field.type}`);
  }
};
