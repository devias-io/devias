import type { ComponentType } from 'react';
import type { ModuleManifest } from '../manifest/manifest';
import type {
  ApprovalBlockProps,
  BlockDefinition,
  BlockProps,
  BlockSurfaces,
  CommandDefinition,
  CommandProvider,
  FieldTypeDefinition,
  ModuleStudioDefinition,
  PageDefinition,
  RecordBlockProps,
  SettingsSectionDefinition,
  StudioConfig,
  StudioModule,
  ViewTypeDefinition,
} from './types';

/** UI-side define* helpers: typed identity functions. */
export const defineStudio = (config: StudioConfig): StudioConfig => config;

export const defineFieldType = <V, S = Record<string, unknown>>(definition: FieldTypeDefinition<V, S>) => definition;
export const defineViewType = <S = Record<string, unknown>>(definition: ViewTypeDefinition<S>) => definition;
export const definePageComponent = (definition: PageDefinition) => definition;
export const defineCommand = (definition: CommandDefinition) => definition;
export const defineCommandProvider = (definition: CommandProvider) => definition;
export const defineSettingsSection = (definition: SettingsSectionDefinition) => definition;

/**
 * The props of a block's component: the record is there when record pages are the block's only surface, and the call
 * with its buttons when an approval widget is.
 */
export type BlockComponentProps<C, S extends BlockSurfaces> =
  Exclude<keyof S, 'record'> extends never
    ? RecordBlockProps<C>
    : Exclude<keyof S, 'approval'> extends never
      ? ApprovalBlockProps<C>
      : BlockProps<C>;

export interface BlockInput<C, S extends BlockSurfaces>
  extends Omit<BlockDefinition<C>, 'surfaces' | 'component' | 'module' | 'id'> {
  surfaces: S;
  component: ComponentType<BlockComponentProps<C, S>>;
}

/**
 * A block: `config` (a zod schema) types what layouts pass it, `surfaces` says where it renders. A block that only
 * declares `record` is typed with the record present; one that also renders elsewhere gets it optionally.
 */
export function defineBlockComponent<C = Record<string, unknown>, S extends BlockSurfaces = BlockSurfaces>(
  input: BlockInput<C, S> & { id: string },
): BlockDefinition<C>;
export function defineBlockComponent(input: unknown): unknown {
  // The hosts only render a block on the surfaces it declares, which is what the narrower props rely on.
  return input;
}

/** The studio side of a module: a factory for `defineStudio({ modules: [acme()] })` that also carries the manifest. */
export interface ModuleStudio<O = void> {
  (options: O): StudioModule;
  readonly id: string;
  readonly manifest: ModuleManifest;
}

/**
 * The studio side of a module, bound to its manifest: `acme()` is what the studio lists, while the CLI and the server
 * read `acme.manifest` without loading React. A definition may be a function of options (`acme({ shortcut })`).
 */
export const defineModuleStudio = <O = void>(
  manifest: ModuleManifest,
  definition: ModuleStudioDefinition | ((options: O) => ModuleStudioDefinition) = {},
): ModuleStudio<O> => {
  const factory = (options: O): StudioModule => {
    const given = typeof definition === 'function' ? definition(options) : definition;

    return {
      ...given,
      blocks: given.blocks ?? [],
      id: manifest.id,
      manifest,
      __module: true as const,
    };
  };

  return Object.assign(factory, { id: manifest.id, manifest });
};

export const isStudioModule = (value: unknown): value is StudioModule =>
  typeof value === 'object' && value !== null && (value as StudioModule).__module === true;
