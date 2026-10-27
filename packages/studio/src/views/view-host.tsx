import {
  fieldIdOf,
  mapFilterFields,
  type ObjectMetadata,
  primaryFieldOf,
  type RecordData,
  type ViewActions,
  type ViewMetadata,
  type ViewProps,
  type ViewState,
} from '@devias/core';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useCreateRecord, useDeleteRecords, useUpdateRecord } from '../hooks/use-mutations';
import { useNavigateTo } from '../hooks/use-navigate-to';
import { useInfiniteRecords } from '../hooks/use-records';
import { useFields, useViews } from '../hooks/use-schema-lookups';
import { ImportDialog } from '../import/import-dialog';
import { useClient } from '../providers/client';
import { useOpenCreateRecord } from '../providers/create-record';
import { useLabels } from '../providers/labels';
import { useSchema } from '../providers/schema';
import { useWorkspace } from '../providers/workspace';
import { keys } from '../query/keys';
import { useFieldTypes, useViewType } from '../registries';
import { ErrorBoundary } from '../shell/error-boundary';
import { buildQuery } from './build-query';
import { ViewToolbar } from './toolbar/view-toolbar';
import {
  applyOverrides,
  baseViewState,
  isSyntheticView,
  pickView,
  syntheticView,
  UNTITLED_RECORD_LABEL,
  useViewStateStore,
} from './view-state';

export interface ViewHostOptions {
  object: ObjectMetadata;
  /** View row id or id; falls back to the default view, then a synthetic "All" table. */
  viewId?: string;
  /** When omitted the view switcher is hidden (the view is pinned). */
  onViewChange?: (viewId: string) => void;
  /** Only consider views of this type (e.g. a page pinning an object's calendar view). */
  viewType?: string;
}

/**
 * Resolves the view, merges saved config with local overrides, builds the query and delegates rendering to
 * the view type. Owns the toolbar, selection and record actions.
 */
export function ViewHost({ object, viewId, onViewChange, viewType: pinnedType }: ViewHostOptions) {
  const client = useClient();
  const queryClient = useQueryClient();
  const { isAdmin } = useWorkspace();
  const fieldTypes = useFieldTypes();
  const fields = useFields(object.id);
  const allViews = useViews(object.id);
  const views = useMemo(
    () => (pinnedType ? allViews.filter((v) => v.type === pinnedType) : allViews),
    [allViews, pinnedType],
  );
  const view = useMemo<ViewMetadata>(
    () => pickView(views, viewId) ?? syntheticView(object, fields),
    [views, viewId, object, fields],
  );
  const viewType = useViewType(view.type);
  const overrides = useViewStateStore((s) => s.overrides[view.id]);
  const update = useViewStateStore((s) => s.update);
  const resetStore = useViewStateStore((s) => s.reset);
  const base = useMemo(() => baseViewState(view, fields, viewType, object), [view, fields, viewType, object]);
  const state = useMemo(() => applyOverrides(base, overrides), [base, overrides]);
  const setState = useCallback((patch: Partial<ViewState>) => update(view.id, patch), [update, view.id]);
  const query = useMemo(() => buildQuery(object, state, fieldTypes, fields), [object, state, fieldTypes, fields]);
  const result = useInfiniteRecords(query);

  const labels = useLabels();
  useEffect(() => {
    for (const [fieldName, records] of Object.entries(result.included)) {
      const field = fields.find((f) => f.name === fieldName);
      const target = field ? (field.settings as { targetObjectId?: string }).targetObjectId : undefined;

      if (target) {
        labels.get(target)?.seed(records);
      }
    }
  }, [result.included, fields, labels]);

  const [importing, setImporting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const selection = useMemo(
    () => ({
      ids: selected,
      set: (ids: Iterable<string>) => setSelected(new Set(ids)),
      clear: () => setSelected(new Set()),
    }),
    [selected],
  );

  const nav = useNavigateTo();
  const openCreate = useOpenCreateRecord();
  const createRecord = useCreateRecord(object.nameSingular);
  const updateRecord = useUpdateRecord(object.nameSingular);
  const deleteRecords = useDeleteRecords(object.nameSingular);
  const { index } = useSchema();
  const quickCreate = state.settings.quickCreate === true;
  const actions = useMemo<ViewActions>(
    () => ({
      openRecord: (id) => nav.toRecord(object.nameSingular, id),
      createRecord: (initial?: Partial<RecordData>) => {
        const primaryField = primaryFieldOf(index, object);

        if (!quickCreate || !primaryField) {
          openCreate({ object: object.nameSingular, initial });

          return;
        }

        // Quick create: an untitled record opens straight away (the mutation reports failures itself).
        createRecord
          .mutateAsync({ [primaryField.name]: UNTITLED_RECORD_LABEL, ...initial })
          .then((record) => nav.toRecord(object.nameSingular, record.id))
          .catch(() => {});
      },
      updateRecord: async (id, patch) => {
        await updateRecord.mutateAsync({ id, patch });
      },
      deleteRecords: async (ids) => {
        await deleteRecords.mutateAsync(ids);
        setSelected(new Set());
      },
    }),
    [nav, object, index, quickCreate, openCreate, createRecord, updateRecord, deleteRecords],
  );

  const [saving, setSaving] = useState(false);
  // The state speaks API names; a saved view names its fields by id (a system column by its `core.` id).
  const idOf = (name: string) => fieldIdOf(fields, name);
  const save = async () => {
    setSaving(true);

    try {
      await client.metadata.views.update(view.id, {
        config: {
          fields: state.fields.map((f) => ({
            fieldId: idOf(f.name),
            visible: f.visible,
            ...(f.width ? { width: f.width } : {}),
          })),
          // The server merges config shallowly: null clears a filter or grouping removed locally.
          filter: state.filter ? mapFilterFields(state.filter, idOf) : null,
          sorts: state.sorts.map((s) => ({ fieldId: idOf(s.field), direction: s.direction })),
          groupById: state.groupBy ? idOf(state.groupBy) : null,
          settings: state.settings,
        },
      });
      resetStore(view.id);
      await queryClient.invalidateQueries({ queryKey: keys.schema(client.workspaceId) });
      toast.success('View saved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save the view');
    } finally {
      setSaving(false);
    }
  };

  const viewProps: ViewProps = {
    object,
    view: { ...view, settings: state.settings },
    state,
    setState,
    query: result,
    actions,
    selection,
  };
  const ViewComponent = viewType.component;

  return (
    <div className="flex h-full min-h-0 flex-col" data-slot="view-host" data-view-type={view.type}>
      <ViewToolbar
        object={object}
        view={view}
        views={views}
        viewType={viewType}
        fields={fields}
        state={state}
        setState={setState}
        hasOverrides={Boolean(overrides && Object.keys(overrides).length > 0)}
        onReset={() => resetStore(view.id)}
        canSave={isAdmin && !isSyntheticView(view)}
        onSave={() => void save()}
        saving={saving}
        onViewChange={onViewChange}
        onNew={() => actions.createRecord()}
        onImport={() => setImporting(true)}
        totalCount={result.totalCount}
      />
      <div className="min-h-0 flex-1">
        <ErrorBoundary title={`The ${viewType.label.toLowerCase()} view failed to render`}>
          <ViewComponent {...viewProps} />
        </ErrorBoundary>
      </div>
      {importing ? <ImportDialog object={object} open={importing} onOpenChange={setImporting} /> : null}
    </div>
  );
}
