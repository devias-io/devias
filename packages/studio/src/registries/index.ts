import {
  type BlockDefinition,
  type BlockSurface,
  blocksOn,
  type FieldTypeDefinition,
  isPageAvailable,
  type PageDefinition,
  type ViewTypeDefinition,
} from '@devias/core';
import { useMemo } from 'react';
import { useSchema } from '../providers/schema';
import { useStudioConfig } from '../providers/studio-config';
import { unknownFieldType } from './unknown-field-type';

const unknownFieldTypes = new Map<string, FieldTypeDefinition>();

const fallbackFieldType = (type: string): FieldTypeDefinition => {
  let def = unknownFieldTypes.get(type);

  if (!def) {
    def = unknownFieldType(type);
    unknownFieldTypes.set(type, def);
  }

  return def;
};

/** Field type by name; unknown types render JSON with a badge. */
export const getFieldType = (fieldTypes: Map<string, FieldTypeDefinition>, type: string): FieldTypeDefinition =>
  fieldTypes.get(type) ?? fallbackFieldType(type);

export const useFieldType = (type: string): FieldTypeDefinition => {
  const { registries } = useStudioConfig();

  return getFieldType(registries.fieldTypes, type);
};

export const useFieldTypes = (): Map<string, FieldTypeDefinition> => useStudioConfig().registries.fieldTypes;

/** View type by name; unknown types fall back to the table. */
export const useViewType = (type: string): ViewTypeDefinition => {
  const { registries } = useStudioConfig();

  return useMemo(() => {
    const found = registries.viewTypes.get(type) ?? registries.viewTypes.get('table');

    if (found) {
      return found;
    }

    const [first] = registries.viewTypes.values();

    if (first) {
      return first;
    }

    throw new Error('No view types are registered; add studio() to the studio config.');
  }, [registries.viewTypes, type]);
};

/** A registered block by id, whether or not it is available in this workspace. */
export const useBlock = (id: string): BlockDefinition | undefined => useStudioConfig().registries.blocks.get(id);

/**
 * The blocks that render on a surface in this workspace: contributed by the studio or by an installed module, and
 * whose required objects exist. Home blocks come in their `order`.
 */
export const useBlocks = (surface: BlockSurface): BlockDefinition[] => {
  const { registries } = useStudioConfig();
  const { index } = useSchema();
  const core = useCoreModules();

  return useMemo(
    () => blocksOn(surface, registries.blocks.values(), index, core),
    [surface, registries.blocks, index, core],
  );
};

/** Core modules (the studio, the agent) are part of every workspace: what they contribute never waits for an install. */
export const useCoreModules = (): ReadonlySet<string> => {
  const { manifests } = useStudioConfig();

  return useMemo(() => new Set(manifests.filter((m) => m.core).map((m) => m.id)), [manifests]);
};

/** A registered page by path, whether or not it is available in this workspace. */
export const usePage = (path: string): PageDefinition | undefined => useStudioConfig().registries.pages.get(path);

/** The pages of this workspace: from the studio config, a core module or an installed module. */
export const useAvailablePages = (): Map<string, PageDefinition> => {
  const { registries } = useStudioConfig();
  const { index } = useSchema();
  const core = useCoreModules();

  return useMemo(
    () => new Map([...registries.pages].filter(([, page]) => isPageAvailable(page, index, core))),
    [registries.pages, index, core],
  );
};
