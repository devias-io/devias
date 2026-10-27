import type { ComponentType } from 'react';
import type { z } from 'zod';
import type { ToolCall } from '../ai';
import type { ModuleManifest } from '../manifest/manifest';
import type { FilterOp } from '../metadata/field-types';
import type { FieldMetadata, ObjectMetadata, ViewMetadata, WorkspaceSchema } from '../metadata/schema';
import type { Filter, Page, Query, RecordData, Sort } from '../query/ir';
import type { StructureNode, StructureResolver } from '../structure/nodes';

/**
 * Studio configuration contracts. React types are imported as types only; this module has no React runtime.
 */

export type IconName = string;

// ---------------------------------------------------------------------------------------------
// Field types
// ---------------------------------------------------------------------------------------------

export interface FieldCellProps<V = unknown, S = Record<string, unknown>> {
  field: FieldMetadata & { settings: S };
  value: V | null;
  record: RecordData;
  object: ObjectMetadata;
}

export interface FieldEditorProps<V = unknown, S = Record<string, unknown>> {
  field: FieldMetadata & { settings: S };
  value: V | null;
  onChange: (value: V | null) => void;
  mode: 'form' | 'inline';
  onCommit?: () => void;
  onCancel?: () => void;
  autoFocus?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  record?: RecordData;
  object?: ObjectMetadata;
}

export interface FilterInputProps<S = Record<string, unknown>> {
  field: FieldMetadata & { settings: S };
  op: FilterOp;
  value: unknown;
  onChange: (value: unknown) => void;
}

export interface FieldSettingsEditorProps<S = Record<string, unknown>> {
  /** The object the field is on, when it is known: a setting that names a sibling field lists its fields. */
  objectId?: string | undefined;
  value: Partial<S>;
  onChange: (value: Partial<S>) => void;
  schema: WorkspaceSchema;
}

export interface FieldTypeDefinition<V = unknown, S = Record<string, unknown>> {
  type: string;
  label: string;
  icon: IconName;
  category?: 'basic' | 'relation' | 'advanced';
  settingsSchema?: z.ZodType<S>;
  defaultSettings?: S;
  /** Overrides the core value schema for this type (core covers the built-ins). */
  valueSchema?: (field: FieldMetadata & { settings: S }) => z.ZodType<V>;
  defaultValue?: (field: FieldMetadata & { settings: S }) => V | null;
  cell: ComponentType<FieldCellProps<V, S>>;
  editor: ComponentType<FieldEditorProps<V, S>>;
  display?: ComponentType<FieldCellProps<V, S>>;
  filter?: { operators: FilterOp[]; input?: ComponentType<FilterInputProps<S>> };
  sortable?: boolean;
  groupable?: boolean;
  searchable?: boolean;
  toText: (value: V | null, field: FieldMetadata & { settings: S }) => string;
  settingsEditor?: ComponentType<FieldSettingsEditorProps<S>>;
}

// ---------------------------------------------------------------------------------------------
// View types
// ---------------------------------------------------------------------------------------------

export interface ViewState {
  filter?: Filter;
  sorts: Sort[];
  fields: { name: string; width?: number; visible: boolean }[];
  groupBy?: string;
  search: string;
  settings: Record<string, unknown>;
}

export interface RecordsQueryResult {
  items: RecordData[];
  included: Record<string, RecordData[]>;
  isLoading: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  fetchNextPage: () => void;
  totalCount?: number;
  error?: unknown;
  refetch: () => void;
}

export interface ViewActions {
  openRecord: (id: string) => void;
  /**
   * Starts a new record: opens the create dialog, or, when the view's settings have `quickCreate: true`, creates
   * an untitled record right away and opens it (e.g. documents).
   */
  createRecord: (initial?: Partial<RecordData>) => void;
  updateRecord: (id: string, patch: Partial<RecordData>) => Promise<void>;
  deleteRecords: (ids: string[]) => Promise<void>;
}

export interface ViewProps<S = Record<string, unknown>> {
  object: ObjectMetadata;
  view: ViewMetadata & { settings: S };
  state: ViewState;
  setState: (patch: Partial<ViewState>) => void;
  query: RecordsQueryResult;
  actions: ViewActions;
  selection: { ids: Set<string>; set: (ids: Iterable<string>) => void; clear: () => void };
}

export interface ViewTypeDefinition<S = Record<string, unknown>> {
  type: string;
  label: string;
  icon: IconName;
  settingsSchema?: z.ZodType<S>;
  defaultSettings?: (object: ObjectMetadata, fields: FieldMetadata[]) => S;
  capabilities?: { filter?: boolean; sort?: boolean; groupBy?: boolean; fields?: boolean; search?: boolean };
  component: ComponentType<ViewProps<S>>;
  toolbar?: ComponentType<ViewProps<S>>;
}

// ---------------------------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------------------------

/**
 * Where a block can render: a record page's layout, Home, a dialog, docked beside the content, or in the agent in
 * place of the card that asks the person to approve one of a module's tools.
 */
export type BlockSurface = 'record' | 'home' | 'dialog' | 'panel' | 'approval';

/** What a block receives. On a record page the record and its object are set; on the other surfaces they are not. */
export interface BlockProps<C = Record<string, unknown>> {
  /** The layout cell's config on a record page, `{}` elsewhere. */
  config: C;
  surface: BlockSurface;
  record?: RecordData;
  object?: ObjectMetadata;
}

/** What a block that only renders on record pages receives. */
export interface RecordBlockProps<C = Record<string, unknown>> extends BlockProps<C> {
  surface: 'record';
  record: RecordData;
  object: ObjectMetadata;
}

/**
 * What a block that only renders as an approval widget receives: the call that waits for the person, and the two ways
 * to answer it. It draws its own buttons, and the agent's turn continues once one of them is used.
 */
export interface ApprovalBlockProps<C = Record<string, unknown>> extends BlockProps<C> {
  surface: 'approval';
  /** The call: `name`, `input` (what will run), `reason` (why it asks, when it does) and its status. */
  call: ToolCall;
  /** An answer is on its way: the buttons should wait. */
  busy: boolean;
  approve: () => void;
  reject: () => void;
}

/**
 * A block's size on the Home grid, in grid units: twelve columns across and rows of 30px. People can drag and
 * resize blocks between the min and max sizes.
 */
export interface HomeBlockLayout {
  /** Columns wide (default 3, a quarter of the page). */
  w?: number;
  /** Rows tall (default 7). */
  h?: number;
  /** Default 3. */
  minW?: number;
  /** Default 4. */
  minH?: number;
  maxW?: number;
  maxH?: number;
}

/** On record pages: in layouts (by id) or placed automatically. */
export interface RecordSurface {
  /** Only on these objects' pages; default: any object's. */
  objectIds?: string[];
  /**
   * Where record pages show the block when their layout does not place it, so a module can add a section to another
   * module's page without that module knowing. On `tabs` pages: `overview` on the record's main view (the end of an
   * `overview` tab, else of the first tab), `tab` in a tab of its own named after the block. On `column` pages: `main`
   * in the column. On `split` pages: `main` in the main column, `aside` in the aside. Without it, the block only shows
   * where layouts put it.
   */
  placement?: 'overview' | 'tab' | 'main' | 'aside';
  /**
   * With `main` or `aside`: the id of the block this one follows. The block goes right after its cell, and at
   * the end of the column when that block is not on the page.
   */
  after?: string;
  /** Columns of twelve when placed automatically (default 12). */
  span?: number;
  /** Draw the block in the titled card other blocks use (default). Off for blocks that draw their own. */
  frame?: boolean;
  /** Draw the card without padding, for content that runs to its edges, such as a table of rows. */
  flush?: boolean;
}

/** On Home: a glance at one part of the workspace (the pipeline, this week's tasks, …) with a link to see more. */
export interface HomeSurface {
  /** Position in the default arrangement, lower first (default 50). */
  order?: number;
  /** Default size on the Home grid and the limits for resizing it. */
  layout?: HomeBlockLayout;
  /** `grid` (default): on the grid people arrange; `below`: full width in the centered column under it. */
  placement?: 'grid' | 'below';
}

/** In a dialog, opened by `open_block` command items. */
export interface DialogSurface {
  /** Dialog width (default `md`). */
  size?: 'sm' | 'md' | 'lg';
}

/** Docked beside the content area, one panel open at a time, with a toggle in the top bar. */
export interface PanelSurface {
  /** Keyboard shortcut that toggles the panel, e.g. `mod+j`. */
  shortcut?: string;
  /** Initial width as a percentage of the content area. */
  defaultSize?: number;
  minSize?: number;
  /**
   * A React hook the top bar calls to put a count on the panel's toggle (e.g. unread notifications); nothing shows
   * for 0, null or undefined. It runs inside the workspace providers, so it may query the client.
   */
  useBadge?: () => number | null | undefined;
}

/**
 * In the agent, as the card that asks the person to approve a call: for each tool named here that the agent
 * wants to run, the block is drawn instead of the default Approve / Reject card. The tools are named as the agent
 * calls them: a module's action is its `name`, e.g. `add_payment`.
 */
export interface ApprovalSurface {
  tools: string[];
}

/** The surfaces a block renders on, each with its options. A block declares at least one. */
export interface BlockSurfaces {
  record?: RecordSurface;
  home?: HomeSurface;
  dialog?: DialogSurface;
  panel?: PanelSurface;
  approval?: ApprovalSurface;
}

/**
 * A React component a module contributes under a id and places on surfaces: record pages (by layout or
 * automatically), Home, dialogs and the dock. `InsightCard` from `@devias/ui` gives Home blocks the house style.
 */
export interface BlockDefinition<C = Record<string, unknown>> {
  /** The block's id in the manifest (a uuid); layouts and command items refer to it. */
  id: string;
  label: string;
  icon: IconName;
  /** Validates and types the config layout cells pass; without one the block receives the cell's config as is. */
  config?: z.ZodType<C>;
  /** Shown only in workspaces that have these objects, e.g. once the module owning them is installed. */
  requires?: { objectIds?: string[] };
  surfaces: BlockSurfaces;
  component: ComponentType<BlockProps<C>>;
  /** Set while resolving the studio config: the module that contributed the block, if any. */
  module?: string;
}

// ---------------------------------------------------------------------------------------------
// Pages, commands, settings
// ---------------------------------------------------------------------------------------------

export interface PageDefinition {
  /**
   * The id its module's manifest declares it under (`ids.pages.forecast`), for a page a nav item or a command points at;
   * its label and icon come from that declaration. A page with parameters in its path has none.
   */
  id?: string;
  /**
   * Workspace-relative path, and the page's key: `billing`, `billing/new`, `billing/$invoiceId/edit`. TanStack syntax
   * for params: `$invoiceId`. The page lives at `/workspaces/:slug/<path>`.
   */
  path: string;
  component: ComponentType;
  /** The palette, breadcrumbs and the not-installed message. Falls back to the nearest titled ancestor. */
  label?: string;
  icon?: IconName;
  /** Wraps this page and the pages under `<path>/`; it renders an outlet. `component` shows at `<path>` inside it. */
  layout?: ComponentType;
  /**
   * The object whose "New" button opens this page instead of the create dialog (e.g. an invoice composer).
   */
  creates?: string;
  /** Set while resolving the studio config: the module that contributed the page, if any. */
  module?: string;
}

export interface CommandContext {
  workspaceId: string;
  navigate: (to: string) => void;
  openRecord: (object: string, id: string) => void;
  createRecord: (object: string) => void;
  /** Make a document and open it. */
  createDocument: () => void;
  /** Make an untitled task and open it. */
  createTask: () => void;
  schema: WorkspaceSchema;
  closeMenu: () => void;
}

export interface CommandDefinition {
  id: string;
  label: string;
  icon?: IconName;
  group?: string;
  keywords?: string[];
  shortcut?: string;
  when?: (ctx: CommandContext) => boolean;
  run: (ctx: CommandContext) => void | Promise<void>;
}

export interface CommandProvider {
  id: string;
  search: (query: string, ctx: CommandContext) => Promise<CommandDefinition[]> | CommandDefinition[];
}

/** A link to reach the people behind the product, such as an email address or a contact page. */
export interface ContactLink {
  /** Where it goes: `mailto:…` opens the mail app, `https://…` a new tab. */
  href: string;
  /** What the row says (default "Get in touch"). */
  label?: string;
  /** The row's icon (default `mail`). */
  icon?: IconName;
}

export interface SettingsSectionDefinition {
  name: string;
  label: string;
  icon?: IconName;
  group?: 'account' | 'workspace' | 'data' | 'developer';
  requiresRole?: 'owner' | 'admin' | 'member';
  /**
   * The section's page for one item (`settings/<name>/<item>`) draws its own header, so the settings page leaves out
   * the section's title above it. The component reads the item from the navigation's `params.item`.
   */
  detail?: boolean;
  component: ComponentType;
}

// ---------------------------------------------------------------------------------------------
// Modules and the studio
// ---------------------------------------------------------------------------------------------

// A registry holds definitions of different value, settings and config types, and their components take those types as
// props, so only `any` accepts them all.
// biome-ignore lint/suspicious/noExplicitAny: heterogeneous registry
export type AnyFieldType = FieldTypeDefinition<any, any>;
// biome-ignore lint/suspicious/noExplicitAny: heterogeneous registry
export type AnyViewType = ViewTypeDefinition<any>;
// biome-ignore lint/suspicious/noExplicitAny: heterogeneous registry
export type AnyBlock = BlockDefinition<any>;

/** What a module's studio side contributes: registries, slot overrides, and other modules it brings along. */
export interface ModuleStudioDefinition {
  /** Modules this one brings along; they are contributed before it. */
  modules?: StudioModule[];
  fieldTypes?: AnyFieldType[];
  viewTypes?: AnyViewType[];
  /** The module's own blocks, each by the id its manifest declares it under. */
  blocks?: AnyBlock[];
  pages?: PageDefinition[];
  commands?: CommandDefinition[];
  commandProviders?: CommandProvider[];
  settingsSections?: SettingsSectionDefinition[];
}

/** A module's studio side, bound to its manifest: what `defineStudio({ modules: [acme()] })` lists. */
export interface StudioModule extends Omit<ModuleStudioDefinition, 'blocks'> {
  readonly id: string;
  /** Resolved: each has its id. */
  blocks?: AnyBlock[];
  readonly manifest: ModuleManifest;
  readonly __module: true;
}

/** One entry of the resolved contribution order: a module, or the studio config's own contributions (no manifest). */
export interface StudioContribution extends Omit<ModuleStudioDefinition, 'blocks'> {
  id: string;
  blocks?: AnyBlock[];
  manifest?: ModuleManifest;
}

/** The studio: its modules in order, the sidebar structure, and its own contributions, merged last. */
export interface StudioConfig extends Omit<ModuleStudioDefinition, 'modules' | 'blocks'> {
  blocks?: AnyBlock[];
  /** What the studio calls itself on the sign-in pages (default `Devias`). */
  title?: string;
  basePath?: string;
  /** Modules in order: the studio's own (`studio()`), then the product's. Later ones win on collisions. */
  modules?: StudioModule[];
  structure?: StructureResolver;
  defaultPage?: string;
  /**
   * Images for agents, by icon name: an agent whose icon is a key here shows the image (a URL or path) in its place
   * wherever the studio draws it, and the line icon otherwise. The app decides what looks like what.
   */
  agentImages?: Record<string, string>;
  /** A way to reach the people behind the product: a row above Settings in the sidebar. Left out, there is none. */
  contact?: ContactLink;
  dev?: { autoApplyModules?: boolean };
}

export interface ConfigDiagnostic {
  level: 'warn' | 'error';
  code:
    | 'duplicate_module'
    | 'registry_override'
    | 'duplicate_id'
    | 'invalid_manifest'
    | 'missing_page'
    | 'block_declaration'
    | 'page_declaration';
  message: string;
}

export interface Registries {
  fieldTypes: Map<string, AnyFieldType>;
  viewTypes: Map<string, AnyViewType>;
  /** By id. */
  blocks: Map<string, AnyBlock>;
  /** By path. */
  pages: Map<string, PageDefinition>;
  commands: Map<string, CommandDefinition>;
  commandProviders: Map<string, CommandProvider>;
  settingsSections: Map<string, SettingsSectionDefinition>;
}

export interface ResolvedStudioConfig {
  title: string;
  basePath: string;
  defaultPage: string;
  /** Images for agents by icon name; empty when the app maps none. */
  agentImages: Record<string, string>;
  /** The contact link, when the app has one. */
  contact?: ContactLink;
  dev: { autoApplyModules: boolean };
  registries: Registries;
  structure: StructureNode;
  manifests: ModuleManifest[];
  diagnostics: ConfigDiagnostic[];
  /** Contribution order after flattening: modules first, the studio config's own contributions last. */
  contributions: StudioContribution[];
}

export type { Page, Query, RecordData };
