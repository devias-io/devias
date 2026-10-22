import { generateDefaultLayout, type Layout, type ObjectMetadata, type RecordData } from '@devias/core';
import { Button, EmptyState, Page, Skeleton } from '@devias/ui';
import { useMemo, useState } from 'react';
import { PlainOptionsContext } from '../fields/shared';
import { useDeleteRecords } from '../hooks/use-mutations';
import { useRecordAutosave } from '../hooks/use-record-autosave';
import { useRecord } from '../hooks/use-records';
import { useSchema } from '../providers/schema';
import { useWorkspace } from '../providers/workspace';
import { links } from '../router/links';
import { useNavigation } from '../router/navigation';
import { DeleteRecordDialog } from './delete-record-dialog';
import { RecordPageProvider } from './record-page-context';
import { ColumnShell } from './shells/column-shell';
import { SplitShell } from './shells/split-shell';
import { TabsShell } from './shells/tabs-shell';

/** The page of the layout's shape: each shape has a shell of its own that knows what the layout holds. */
function Shell({ object, record, layout }: { object: ObjectMetadata; record: RecordData; layout: Layout }) {
  switch (layout.shell) {
    case 'tabs':
      return <TabsShell object={object} record={record} layout={layout} />;
    case 'column':
      return <ColumnShell object={object} record={record} layout={layout} />;
    case 'split':
      return <SplitShell object={object} record={record} layout={layout} />;
  }
}

/**
 * One record's page, once it has loaded: the edit session and the delete flow every shell shares, around the shell the
 * object's layout names. Mounted per record, so edits never cross records.
 */
function RecordPageBody({ object, record }: { object: ObjectMetadata; record: RecordData }) {
  const { index } = useSchema();
  const { slug } = useWorkspace();
  const navigation = useNavigation();
  const autosave = useRecordAutosave(object.nameSingular, record.id);
  const remove = useDeleteRecords(object.nameSingular);
  const [confirm, setConfirm] = useState(false);
  const layout = useMemo(() => {
    const layouts = index.layoutsByObjectId.get(object.id) ?? [];

    return layouts.find((l) => l.isDefault) ?? layouts[0] ?? generateDefaultLayout(index, object);
  }, [index, object]);

  // Options are plain grey labels on a record page: its stage or status is read, not scanned for colour.
  return (
    <PlainOptionsContext.Provider value>
      <RecordPageProvider
        object={object}
        record={record}
        shell={layout.shell}
        autosave={autosave}
        onDelete={() => setConfirm(true)}
      >
        <Shell object={object} record={record} layout={layout} />
        <DeleteRecordDialog
          object={object}
          open={confirm}
          onOpenChange={setConfirm}
          onConfirm={async () => {
            setConfirm(false);
            autosave.discard();
            await remove.mutateAsync([record.id]);
            navigation.navigate(links.object(slug, object.nameSingular));
          }}
        />
      </RecordPageProvider>
    </PlainOptionsContext.Provider>
  );
}

export function RecordPage({ object, recordId }: { object: ObjectMetadata; recordId: string }) {
  const { slug } = useWorkspace();
  const navigation = useNavigation();
  const record = useRecord(object.nameSingular, recordId);

  if (record.isPending) {
    return (
      <Page className="mx-auto w-full max-w-[90rem] px-6 pt-8 sm:px-10">
        <Skeleton className="mb-3 h-5 w-40" />
        <Skeleton className="mb-8 h-14 w-80" />
        <Skeleton className="h-64 w-full" />
      </Page>
    );
  }

  if (record.isError || !record.data) {
    return (
      <EmptyState
        icon="circle-help"
        title={`${object.labelSingular} not found`}
        description="It may have been deleted."
        action={
          <Button
            size="lg"
            variant="outline"
            onClick={() => navigation.navigate(links.object(slug, object.nameSingular))}
          >
            Back to {object.labelPlural.toLowerCase()}
          </Button>
        }
      />
    );
  }

  return <RecordPageBody key={record.data.id} object={object} record={record.data} />;
}
