import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/** How long after the last keystroke edits are saved, unless the caller asks for another delay. */
export const DEFAULT_SAVE_DELAY_MS = 800;

/**
 * Batches edits to one thing (a record, a document) and saves them shortly after typing stops, on `flush()` (e.g.
 * blur) and when the component unmounts. `save` receives the edits merged since the last save. Mount one per thing
 * (key the component by id) so edits never cross.
 */
export function useAutosave(
  save: (patch: Record<string, unknown>) => Promise<unknown>,
  options: { delayMs?: number } = {},
) {
  const delayMs = options.delayMs ?? DEFAULT_SAVE_DELAY_MS;
  const [status, setStatus] = useState<SaveStatus>('idle');
  const pending = useRef<Record<string, unknown>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const run = useRef(async () => {});
  const saving = useRef<Promise<void>>(Promise.resolve());
  useLayoutEffect(() => {
    run.current = async () => {
      clearTimeout(timer.current);
      const patch = pending.current;

      if (Object.keys(patch).length === 0) {
        return;
      }

      pending.current = {};
      setStatus('saving');

      const done = (async () => {
        try {
          await save(patch);
          setStatus(Object.keys(pending.current).length > 0 ? 'saving' : 'saved');
        } catch {
          setStatus('error');
        }
      })();
      saving.current = done;
      await done;
    };
  });
  useEffect(() => () => void run.current(), []);

  /** Queue an edit; `delay` overrides how long after typing stops it is saved (the latest call wins). */
  const queue = useCallback(
    (patch: Record<string, unknown>, delay?: number) => {
      pending.current = { ...pending.current, ...patch };
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void run.current(), delay ?? delayMs);
    },
    [delayMs],
  );
  /** Saves what is waiting now; resolves once that, and any save already under way, is done. */
  const flush = useCallback(async () => {
    const earlier = saving.current;
    await run.current();
    await earlier;
  }, []);
  /** Drops unsaved edits, e.g. before deleting what they are about. */
  const discard = useCallback(() => {
    clearTimeout(timer.current);
    pending.current = {};
  }, []);

  return { status, queue, flush, discard };
}
