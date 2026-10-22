import { DEFAULT_SAVE_DELAY_MS, type SaveStatus, useAutosave } from './use-autosave';
import { useUpdateRecord } from './use-mutations';

export { DEFAULT_SAVE_DELAY_MS, type SaveStatus };

/** Batches edits to one record and saves them shortly after typing stops, on `flush()` and when it unmounts. */
export function useRecordAutosave(object: string, id: string, options: { delayMs?: number } = {}) {
  const update = useUpdateRecord(object);

  return useAutosave((patch) => update.mutateAsync({ id, patch }), options);
}
