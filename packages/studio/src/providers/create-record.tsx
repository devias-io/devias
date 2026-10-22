import { primaryFieldOf, type RecordData, type ViewMetadata } from '@devias/core';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { useNavigateTo } from '../hooks/use-navigate-to';
import { keys } from '../query/keys';
import { CreateRecordDialog } from '../record/create-record-dialog';
import { links } from '../router/links';
import { useNavigation } from '../router/navigation';
import { UNTITLED_RECORD_LABEL } from '../views/view-state';
import { useClient } from './client';
import { useSchema } from './schema';
import { useStudioConfig } from './studio-config';
import { useWorkspace } from './workspace';

export interface CreateRecordRequest {
  object: string;
  initial?: Partial<RecordData>;
  onCreated?: (record: RecordData) => void;
}

interface CreateRecordContextValue {
  open: (request: CreateRecordRequest) => void;
}

const CreateRecordContext = createContext<CreateRecordContextValue | null>(null);

/** Whether the object's default view (or its first) asks for records to be created without the dialog. */
const quickCreates = (views: ViewMetadata[] | undefined): boolean => {
  const view = views?.find((candidate) => candidate.isDefault) ?? views?.[0];

  return view?.config.settings?.quickCreate === true;
};

/** One workspace-wide "New record" dialog, opened from views, commands, widgets and the command menu. */
export function CreateRecordProvider({ children }: { children: ReactNode }) {
  const { index } = useSchema();
  const config = useStudioConfig();
  const { slug } = useWorkspace();
  const navigation = useNavigation();
  const client = useClient();
  const queryClient = useQueryClient();
  const nav = useNavigateTo();
  const [request, setRequest] = useState<CreateRecordRequest | null>(null);
  const open = useCallback(
    (next: CreateRecordRequest) => {
      // A page can own creating an object (a composer); it replaces the dialog.
      const target = index.objectsByName.get(next.object) ?? index.objectsById.get(next.object);
      const page = [...config.registries.pages.values()].find(
        (candidate) => candidate.creates !== undefined && candidate.creates === target?.nameSingular,
      );

      if (page && !next.initial) {
        navigation.navigate(links.page(slug, page.path));

        return;
      }

      // An object whose views say `quickCreate` has no dialog: an untitled record is made and opened to be filled in.
      const primaryField = target ? primaryFieldOf(index, target) : undefined;

      if (target && primaryField && quickCreates(index.viewsByObjectId.get(target.id))) {
        client.records
          .create(target.nameSingular, { [primaryField.name]: UNTITLED_RECORD_LABEL, ...next.initial })
          .then((record) => {
            void queryClient.invalidateQueries({ queryKey: keys.records(client.workspaceId, target.nameSingular) });
            next.onCreated?.(record);
            nav.toRecord(target.nameSingular, record.id);
          })
          // A required field with nothing to start from needs the dialog after all.
          .catch(() => setRequest(next));

        return;
      }

      setRequest(next);
    },
    [config, index, slug, navigation, client, queryClient, nav],
  );
  const value = useMemo(() => ({ open }), [open]);
  const object = request
    ? (index.objectsByName.get(request.object) ?? index.objectsById.get(request.object))
    : undefined;

  return (
    <CreateRecordContext.Provider value={value}>
      {children}
      {request && object ? (
        <CreateRecordDialog
          object={object}
          open
          onOpenChange={(isOpen) => {
            if (!isOpen) {
              setRequest(null);
            }
          }}
          initial={request.initial}
          onCreated={request.onCreated}
        />
      ) : null}
    </CreateRecordContext.Provider>
  );
}

export const useOpenCreateRecord = (): ((request: CreateRecordRequest) => void) => {
  const value = useContext(CreateRecordContext);

  if (!value) {
    throw new Error('useOpenCreateRecord must be used inside a workspace route');
  }

  return value.open;
};
