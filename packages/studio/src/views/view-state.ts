import {
  type FieldMetadata,
  fieldNameOf,
  mapFilterFields,
  type ObjectMetadata,
  type ViewMetadata,
  type ViewState,
  type ViewTypeDefinition,
} from '@devias/core';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { browserStorage } from '../lib/browser-storage';

/** Local edits on top of the saved view; `null` marks a key cleared (session storage is JSON, which drops `undefined`). */
export type ViewStateOverrides = { [K in keyof ViewState]?: ViewState[K] | null };

interface ViewStateStore {
  overrides: Record<string, ViewStateOverrides>;
  update: (viewId: string, patch: Partial<ViewState>) => void;
  reset: (viewId: string) => void;
}

/** Local (unsaved) view overrides keyed by view id, persisted for the browser session. */
export const useViewStateStore = create<ViewStateStore>()(
  persist(
    (set) => ({
      overrides: {},
      update: (viewId, patch) => {
        const cleared = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, value ?? null]));
        set((s) => ({ overrides: { ...s.overrides, [viewId]: { ...(s.overrides[viewId] ?? {}), ...cleared } } }));
      },
      reset: (viewId) =>
        set((s) => {
          const next = { ...s.overrides };
          delete next[viewId];

          return { overrides: next };
        }),
    }),
    { name: 'devias.studio.view-state', storage: createJSONStorage(browserStorage('session')) },
  ),
);

/** Label given to records made by a view's `quickCreate`; record pages can recognize it and select it for typing. */
export const UNTITLED_RECORD_LABEL = 'Untitled';

/** The placeholder views `syntheticView` made: they are told apart by being one of these, not by their id. */
const synthetic = new WeakSet<ViewMetadata>();

/** The "All <objects>" table shown when an object has no saved views. */
export const syntheticView = (object: ObjectMetadata, fields: FieldMetadata[]): ViewMetadata => {
  const view: ViewMetadata = {
    workspaceId: object.workspaceId,
    objectId: object.id,
    id: `synthetic-${object.nameSingular}`,
    label: `All ${object.labelPlural.toLowerCase()}`,
    type: 'table',
    icon: 'table',
    isDefault: true,
    position: 0,
    moduleId: null,
    config: { fields: fields.slice(0, 8).map((f) => ({ fieldId: f.id, visible: true })), sorts: [], settings: {} },
  };

  synthetic.add(view);

  return view;
};

export const isSyntheticView = (view: ViewMetadata): boolean => synthetic.has(view);

/** The requested view (by id), else the default, else the first. */
export const pickView = (views: ViewMetadata[], viewId: string | undefined): ViewMetadata | undefined =>
  (viewId ? views.find((v) => v.id === viewId) : undefined) ?? views.find((v) => v.isDefault) ?? views[0];

/** Saved view config → the initial ViewState (local edits start from here; "Reset" returns to it). */
export const baseViewState = (
  view: ViewMetadata,
  fields: FieldMetadata[],
  viewType?: ViewTypeDefinition,
  object?: ObjectMetadata,
): ViewState => {
  // A saved view names its fields by id; the state speaks API names, like every query. A system column has a `core.` id.
  const nameOf = (ref: string) => fieldNameOf(fields, ref);
  const known = new Set(fields.map((f) => f.name));
  const configured = view.config.fields
    .map((f) => ({ ...f, name: nameOf(f.fieldId) }))
    .filter((f) => known.has(f.name));
  const fieldConfigs =
    configured.length > 0
      ? configured.map((f) => ({ name: f.name, ...(f.width ? { width: f.width } : {}), visible: f.visible ?? true }))
      : fields.map((f, i) => ({ name: f.name, visible: i < 8 }));

  for (const field of fields) {
    if (!fieldConfigs.some((c) => c.name === field.name)) {
      fieldConfigs.push({ name: field.name, visible: false });
    }
  }

  const defaults = viewType?.defaultSettings && object ? viewType.defaultSettings(object, fields) : {};

  return {
    ...(view.config.filter ? { filter: mapFilterFields(view.config.filter, nameOf) } : {}),
    sorts: (view.config.sorts ?? []).map((s) => ({ field: nameOf(s.fieldId), direction: s.direction })),
    fields: fieldConfigs,
    ...(view.config.groupById ? { groupBy: nameOf(view.config.groupById) } : {}),
    search: '',
    settings: { ...(defaults as Record<string, unknown>), ...view.config.settings },
  };
};

export const applyOverrides = (base: ViewState, overrides: ViewStateOverrides | undefined): ViewState => {
  if (!overrides) {
    return base;
  }

  const merged: Record<string, unknown> = { ...base, ...overrides };

  for (const key of Object.keys(overrides)) {
    if (merged[key] === null) {
      delete merged[key];
    }
  }

  return merged as unknown as ViewState;
};
