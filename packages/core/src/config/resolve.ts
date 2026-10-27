import { normalizeManifest } from '../manifest/authoring';
import { type ModuleManifest, ModuleManifestSchema } from '../manifest/manifest';
import { createStructureBuilder, defaultStructure, resolveStructureNode, walkStructure } from '../structure/builder';
import type { StructureNode } from '../structure/nodes';
import { coreBlockDeclarations } from './blocks';
import type {
  BlockDefinition,
  ConfigDiagnostic,
  IconName,
  PageDefinition,
  Registries,
  ResolvedStudioConfig,
  StudioConfig,
  StudioContribution,
  StudioModule,
} from './types';

/**
 * Flatten the module tree depth-first, post-order: the modules a module brings along are contributed before it.
 * A module listed twice keeps its first occurrence and emits a diagnostic.
 */
export const flattenModules = (
  modules: StudioModule[] | undefined,
  diagnostics: ConfigDiagnostic[],
): StudioContribution[] => {
  const seen = new Set<string>();
  const out: StudioContribution[] = [];
  const visit = (module: StudioModule) => {
    for (const child of module.modules ?? []) {
      visit(child);
    }

    if (seen.has(module.id)) {
      diagnostics.push({
        level: 'warn',
        code: 'duplicate_module',
        message: `Module "${module.id}" was added more than once; keeping the first.`,
      });

      return;
    }

    seen.add(module.id);
    out.push(module);
  };

  for (const module of modules ?? []) {
    visit(module);
  }

  return out;
};

/** Who a warning names when the studio config itself overrides something a module registered. */
const OWN_CONTRIBUTION = 'studio.config';

/** What the studio is called where it says so (the sign-in pages), unless the config gives a title. */
const DEFAULT_TITLE = 'Devias';

const emptyRegistries = (): Registries => ({
  fieldTypes: new Map(),
  viewTypes: new Map(),
  blocks: new Map(),
  pages: new Map(),
  commands: new Map(),
  commandProviders: new Map(),
  settingsSections: new Map(),
});

const setWithDiagnostic = <T>(
  map: Map<string, T>,
  key: string,
  value: T,
  registry: string,
  owner: string,
  diagnostics: ConfigDiagnostic[],
) => {
  if (map.has(key)) {
    diagnostics.push({
      level: 'warn',
      code: 'registry_override',
      message: `"${owner}" overrides ${registry} "${key}".`,
    });
  }

  map.set(key, value);
};

/**
 * Fold contributions into keyed registries, last contribution wins. A module's blocks and pages remember the module, so
 * the studio can hide them where it is not installed.
 */
export const mergeRegistries = (contributions: StudioContribution[], diagnostics: ConfigDiagnostic[]): Registries => {
  const registries = emptyRegistries();

  for (const c of contributions) {
    for (const ft of c.fieldTypes ?? []) {
      setWithDiagnostic(registries.fieldTypes, ft.type, ft, 'field type', c.id, diagnostics);
    }

    for (const vt of c.viewTypes ?? []) {
      setWithDiagnostic(registries.viewTypes, vt.type, vt, 'view type', c.id, diagnostics);
    }

    for (const b of c.blocks ?? []) {
      const block = c.manifest ? { ...b, module: c.manifest.id } : b;
      setWithDiagnostic(registries.blocks, b.id, block, 'block', c.id, diagnostics);
    }

    for (const p of c.pages ?? []) {
      // A page the manifest declares takes its label and icon from the declaration.
      const declared = p.id ? c.manifest?.pages.find((d) => d.id === p.id) : undefined;
      const page: PageDefinition = {
        ...p,
        ...(declared ? { label: declared.label, ...(declared.icon ? { icon: declared.icon as IconName } : {}) } : {}),
        ...(c.manifest ? { module: c.manifest.id } : {}),
      };
      setWithDiagnostic(registries.pages, p.path, page, 'page', c.id, diagnostics);
    }

    for (const cmd of c.commands ?? []) {
      setWithDiagnostic(registries.commands, cmd.id, cmd, 'command', c.id, diagnostics);
    }

    for (const p of c.commandProviders ?? []) {
      setWithDiagnostic(registries.commandProviders, p.id, p, 'command provider', c.id, diagnostics);
    }

    for (const s of c.settingsSections ?? []) {
      setWithDiagnostic(registries.settingsSections, s.name, s, 'settings section', c.id, diagnostics);
    }
  }

  return registries;
};

/**
 * A module's manifest declares the blocks its studio code registers, so the server and the agent know them:
 * report a block registered but not declared, declared but not registered, or declared for other surfaces.
 */
const blockDeclarationDiagnostics = (
  registered: Pick<BlockDefinition, 'id' | 'surfaces'>[],
  manifest: ModuleManifest,
  diagnostics: ConfigDiagnostic[],
) => {
  // The platform's own blocks are declared by core: a module may register them without declaring them.
  const declared = new Map([...coreBlockDeclarations, ...manifest.blocks].map((block) => [block.id, block]));
  const warn = (message: string) => diagnostics.push({ level: 'warn', code: 'block_declaration', message });

  for (const block of registered) {
    const declaration = declared.get(block.id);

    if (!declaration) {
      warn(`"${manifest.id}" registers block "${block.id}" but its manifest does not declare it.`);
      continue;
    }

    const surfaces = Object.keys(block.surfaces).sort().join(', ');

    if ([...declaration.surfaces].sort().join(', ') !== surfaces) {
      warn(`"${manifest.id}" declares block "${block.id}" for other surfaces than it renders on (${surfaces}).`);
    }
  }

  const ids = new Set(registered.map((block) => block.id));

  for (const block of manifest.blocks) {
    if (!ids.has(block.id)) {
      warn(`"${manifest.id}" declares block "${block.id}" but registers none.`);
    }
  }
};

/** A page a manifest declares is the one its studio code registers under that id: report one without the other. */
const pageDeclarationDiagnostics = (
  registered: Pick<PageDefinition, 'id' | 'path'>[],
  manifest: ModuleManifest,
  diagnostics: ConfigDiagnostic[],
) => {
  const declared = new Set(manifest.pages.map((page) => page.id));
  const warn = (message: string) => diagnostics.push({ level: 'warn', code: 'page_declaration', message });

  for (const page of registered) {
    if (page.id && !declared.has(page.id)) {
      warn(`"${manifest.id}" registers page "${page.path}" as "${page.id}" but its manifest does not declare it.`);
    }
  }

  const ids = new Set(registered.map((page) => page.id));

  for (const page of manifest.pages) {
    if (!ids.has(page.id)) {
      warn(`"${manifest.id}" declares page "${page.id}" but registers none.`);
    }
  }
};

const collectManifests = (contributions: StudioContribution[], diagnostics: ConfigDiagnostic[]): ModuleManifest[] => {
  const manifests: ModuleManifest[] = [];
  const ids = new Map<string, string>();

  for (const c of contributions) {
    if (!c.manifest) {
      continue;
    }

    const parsed = ModuleManifestSchema.safeParse(normalizeManifest(c.manifest));

    if (!parsed.success) {
      diagnostics.push({
        level: 'error',
        code: 'invalid_manifest',
        message: `Manifest of "${c.id}" is invalid: ${parsed.error.message}`,
      });
      continue;
    }

    const m = parsed.data;
    const declared = [
      ...m.objects.map((o) => o.id),
      ...m.objects.flatMap((o) => o.fields.map((f) => f.id)),
      ...m.fields.map((f) => f.id),
      ...m.views.map((v) => v.id),
      ...m.layouts.map((l) => l.id),
      ...m.navItems.map((n) => n.id),
      ...m.commandItems.map((ci) => ci.id),
    ];

    for (const id of declared) {
      const owner = ids.get(id);

      if (owner && owner !== m.id) {
        diagnostics.push({
          level: 'error',
          code: 'duplicate_id',
          message: `Id "${id}" is declared by both "${owner}" and "${m.id}".`,
        });
      }

      ids.set(id, m.id);
    }

    blockDeclarationDiagnostics(c.blocks ?? [], m, diagnostics);
    pageDeclarationDiagnostics(c.pages ?? [], m, diagnostics);
    manifests.push(m);
  }

  return manifests;
};

/**
 * Resolve a studio config once at boot: flatten modules, merge registries,
 * run the structure resolver, collect manifests and diagnostics.
 */
export const resolveConfig = (config: StudioConfig): ResolvedStudioConfig => {
  const diagnostics: ConfigDiagnostic[] = [];
  const { modules, structure, basePath, defaultPage, agentImages, contact, dev, title, ...own } = config;
  const contributions: StudioContribution[] = [
    ...flattenModules(modules, diagnostics),
    { ...own, id: OWN_CONTRIBUTION },
  ];
  const registries = mergeRegistries(contributions, diagnostics);

  const registerPage = (page: PageDefinition) => registries.pages.set(page.path, page);
  const S = createStructureBuilder(registerPage);
  const resolvedStructure: StructureNode = structure
    ? resolveStructureNode(structure(S, { config: { registries } }))
    : defaultStructure(S);
  walkStructure(resolvedStructure, (node) => {
    if (node.kind === 'page' && !registries.pages.has(node.pagePath)) {
      diagnostics.push({
        level: 'warn',
        code: 'missing_page',
        message: `Structure references page "${node.pagePath}" which is not registered.`,
      });
    }
  });

  const manifests = collectManifests(contributions, diagnostics);
  // Land on Home when it is installed (the studio module ships it), otherwise on the records browser.
  const resolvedDefaultPage = defaultPage ?? (registries.pages.has('home') ? 'home' : 'records');

  if (!registries.pages.has(resolvedDefaultPage)) {
    diagnostics.push({
      level: 'warn',
      code: 'missing_page',
      message: `Default page "${resolvedDefaultPage}" is not registered.`,
    });
  }

  return {
    title: title ?? DEFAULT_TITLE,
    basePath: basePath ?? '/',
    defaultPage: resolvedDefaultPage,
    agentImages: agentImages ?? {},
    ...(contact ? { contact } : {}),
    dev: { autoApplyModules: dev?.autoApplyModules ?? false },
    registries,
    structure: resolvedStructure,
    manifests,
    diagnostics,
    contributions,
  };
};
