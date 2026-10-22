import { type FieldMetadata, type ObjectMetadata, objectByKey, type ViewMetadata } from '@devias/core';
import { useSchema } from '../providers/schema';

/** Find an object by `nameSingular`, `namePlural`, id or row id. */
export const useObject = (key: string | undefined): ObjectMetadata | undefined => {
  const { index } = useSchema();

  return key ? objectByKey(index, key) : undefined;
};

export const useFields = (objectId: string | undefined): FieldMetadata[] => {
  const { index } = useSchema();

  return objectId ? (index.fieldsByObjectId.get(objectId) ?? []) : [];
};

export const useViews = (objectId: string | undefined): ViewMetadata[] => {
  const { index } = useSchema();

  return objectId ? (index.viewsByObjectId.get(objectId) ?? []) : [];
};
