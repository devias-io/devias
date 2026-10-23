import type {
  ActionDefinitionInput,
  AgentDefinitionInput,
  BlockDeclarationInput,
  CommandItemDefinitionInput,
  ConnectionProviderInput,
  EventDefinitionInput,
  FieldDefinitionInput,
  LayoutDefinitionInput,
  ModuleManifestInput,
  NavItemDefinitionInput,
  ObjectDefinitionInput,
  PageDeclarationInput,
  PolicyDefinitionInput,
  SkillDefinitionInput,
  ViewDefinitionInput,
} from '../manifest/authoring';
import type { ModuleManifest } from '../manifest/manifest';
import { parseManifest } from '../manifest/manifest';

/**
 * Manifest-side define* helpers. They are identity functions with precise (const) types, so authoring
 * gets autocomplete and `InferRecord<typeof person>` works, while the runtime stays plain data.
 */
export const defineObject = <const T extends ObjectDefinitionInput>(definition: T): T => definition;
export const defineField = <const T extends FieldDefinitionInput>(definition: T): T => definition;
export const defineView = <const T extends ViewDefinitionInput>(definition: T): T => definition;
export const defineLayout = <const T extends LayoutDefinitionInput>(definition: T): T => definition;
export const defineNavItem = <const T extends NavItemDefinitionInput>(definition: T): T => definition;
export const defineCommandItem = <const T extends CommandItemDefinitionInput>(definition: T): T => definition;

/** What a module declares besides objects and views, as typed identity functions too. */
export const defineBlock = <const T extends BlockDeclarationInput>(definition: T): T => definition;
export const definePage = <const T extends PageDeclarationInput>(definition: T): T => definition;
export const defineAction = <const T extends ActionDefinitionInput>(definition: T): T => definition;
export const defineAgent = <const T extends AgentDefinitionInput>(definition: T): T => definition;
export const defineSkill = <const T extends SkillDefinitionInput>(definition: T): T => definition;
export const defineConnection = <const T extends ConnectionProviderInput>(definition: T): T => definition;
export const defineEvent = <const T extends EventDefinitionInput>(definition: T): T => definition;
export const definePolicy = <const T extends PolicyDefinitionInput>(definition: T): T => definition;

/**
 * Validate and normalize a manifest at module load, so a broken module fails fast. */
export const defineModule = <const T extends ModuleManifestInput>(manifest: T): ModuleManifest =>
  parseManifest(manifest);
