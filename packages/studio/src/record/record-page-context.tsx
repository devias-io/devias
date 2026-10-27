import type { ObjectMetadata, RecordData, RecordShell } from '@devias/core';
import { createContext, type ReactNode, useContext, useMemo, useRef } from 'react';
import type { SaveStatus, useRecordAutosave } from '../hooks/use-record-autosave';

/** How long after typing stops the page saves, unless a block says otherwise. */
export const DEFAULT_EDIT_DELAY_MS = 3000;

/** Where a block that takes the caret puts it: before its text, or after. */
export type FocusAt = 'start' | 'end';

export interface RecordPageContextValue {
  object: ObjectMetadata;
  record: RecordData;
  /** The shell the page is drawn in, for blocks that size themselves to it. */
  shell: RecordShell;
  /** The object is read-only: editing blocks draw their values without inputs. */
  readOnly: boolean;
  /** Queue an edit; it saves shortly after typing stops, on `flush()` and when the page is left. */
  edit: (patch: Record<string, unknown>, options?: { delayMs?: number }) => void;
  flush: () => void;
  status: SaveStatus;
  /** Ask to delete the record; the page owns the confirmation and what follows. */
  requestDelete: () => void;
  /** Blocks that take the caret hand it on (the title to the body). */
  focus: {
    /** Offer a place for the caret; returns how to take the offer back. */
    register: (name: string, focus: (at: FocusAt) => void) => () => void;
    /** Move the caret to the named place, or to the first one offered. */
    request: (at?: FocusAt, name?: string) => void;
  };
}

const RecordPageContext = createContext<RecordPageContextValue | null>(null);

/**
 * What the blocks of a record page share: the record, one edit session (so a title and a body save together, with
 * one status), and the page's delete flow. The page mounts one per record: key it by the record's id.
 */
export function RecordPageProvider({
  object,
  record,
  shell,
  autosave,
  onDelete,
  children,
}: {
  object: ObjectMetadata;
  record: RecordData;
  shell: RecordShell;
  autosave: ReturnType<typeof useRecordAutosave>;
  onDelete: () => void;
  children: ReactNode;
}) {
  const targets = useRef(new Map<string, (at: FocusAt) => void>());
  const { queue, flush, status } = autosave;
  const value = useMemo<RecordPageContextValue>(
    () => ({
      object,
      record,
      shell,
      readOnly: Boolean(object.readOnly),
      edit: (patch, options) => queue(patch, options?.delayMs),
      flush,
      status,
      requestDelete: onDelete,
      focus: {
        register: (name, focus) => {
          targets.current.set(name, focus);

          return () => {
            if (targets.current.get(name) === focus) {
              targets.current.delete(name);
            }
          };
        },
        request: (at = 'start', name) => {
          const target = name ? targets.current.get(name) : [...targets.current.values()][0];
          target?.(at);
        },
      },
    }),
    [object, record, shell, queue, flush, status, onDelete],
  );

  return <RecordPageContext.Provider value={value}>{children}</RecordPageContext.Provider>;
}

/** The record page the block is on; throws anywhere else. */
export const useRecordPage = (): RecordPageContextValue => {
  const value = useContext(RecordPageContext);

  if (!value) {
    throw new Error('useRecordPage must be used inside a record page');
  }

  return value;
};
