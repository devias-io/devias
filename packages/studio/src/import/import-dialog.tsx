import {
  BATCH_MAX,
  CSV_DELIMITERS,
  type CsvDelimiter,
  type DateOrder,
  type ImportBody,
  type ImportField,
  isImportable,
  looksLikeHeader,
  matchColumns,
  type ObjectMetadata,
  parseCsv,
} from '@devias/core';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldLabel,
  Icon,
  OptionSelect,
  Progress,
  Textarea,
} from '@devias/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useWorkflows } from '../hooks/use-workflows';
import { useClient } from '../providers/client';
import { useSchema } from '../providers/schema';
import { keys } from '../query/keys';
import { addReport, chunksOf, emptyTotals, type ImportTotals, problemRowsCsv } from './problems';

/** A file at most this big, and this many rows: more is a job for the API. */
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 50_000;
const PREVIEW_ROWS = 5;

type Step = 'file' | 'map' | 'check' | 'import';

const STEPS: { id: Step; label: string }[] = [
  { id: 'file', label: 'File' },
  { id: 'map', label: 'Columns' },
  { id: 'check', label: 'Check' },
  { id: 'import', label: 'Import' },
];

const DELIMITER_LABEL: Record<CsvDelimiter, string> = { ',': 'Comma', ';': 'Semicolon', '\t': 'Tab' };
const DATE_ORDER_OPTIONS = [
  { value: 'iso', label: 'Year first (2026-11-13)' },
  { value: 'dmy', label: 'Day first (13/11/2026)' },
  { value: 'mdy', label: 'Month first (11/13/2026)' },
] as const;

const tooBig = (rows: number) =>
  `It has ${rows.toLocaleString()} rows: at most ${MAX_ROWS.toLocaleString()} at a time. Split the file.`;

const readText = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'));
    reader.readAsText(file);
  });

const download = (name: string, text: string) => {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
};

const asField = (field: ImportField): ImportField => ({
  id: field.id,
  name: field.name,
  label: field.label,
  type: field.type,
  settings: field.settings,
});

export interface ImportDialogProps {
  object: ObjectMetadata;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Bring a CSV file into an object: choose or paste it, say which column fills which field, check it all without writing
 * anything, then import it in chunks. The reading of cells and the writing are the server's (`records.import`), so what the
 * check says is what the import does.
 */
export function ImportDialog({ object, open, onOpenChange }: ImportDialogProps) {
  const client = useClient();
  const queryClient = useQueryClient();
  const { index } = useSchema();
  const workflows = useWorkflows();
  const fields = useMemo(() => (index.fieldsByObjectId.get(object.id) ?? []).filter(isImportable), [index, object.id]);
  const [step, setStep] = useState<Step>('file');
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [delimiter, setDelimiter] = useState<CsvDelimiter | null>(null);
  const [header, setHeader] = useState(true);
  const [overrides, setOverrides] = useState<Record<number, string | null>>({});
  const [dateOrder, setDateOrder] = useState<'iso' | DateOrder>('iso');
  const [matchOn, setMatchOn] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [checked, setChecked] = useState<ImportTotals | null>(null);
  const [done, setDone] = useState<ImportTotals | null>(null);
  const stop = useRef(false);

  const rows = useMemo(() => (text.trim() === '' ? [] : parseCsv(text, delimiter ?? undefined)), [text, delimiter]);
  const guessedHeader = useMemo(() => (rows[0] ? looksLikeHeader(rows[0], fields) : true), [rows, fields]);
  const headerRow = header ? (rows[0] ?? null) : null;
  const dataRows = header ? rows.slice(1) : rows;
  const width = rows.reduce((most, row) => Math.max(most, row.length), 0);
  const suggested = useMemo(() => (headerRow ? matchColumns(headerRow, fields.map(asField)) : []), [headerRow, fields]);
  // The field of each column: what the person chose, else the one its header names.
  const mapping = Array.from({ length: width }, (_, i) =>
    i in overrides ? (overrides[i] ?? null) : (suggested[i]?.name ?? null),
  );
  const mapped = new Set(mapping.filter((name): name is string => name !== null));
  const uniques = fields.filter((field) => field.isUnique && mapped.has(field.name));
  const missing = fields.filter(
    (field) => field.isRequired && field.defaultValue === undefined && !mapped.has(field.name),
  );
  const needsDates = fields.some(
    (field) => mapped.has(field.name) && (field.type === 'date' || field.type === 'date_time'),
  );
  const quiet = (workflows.data ?? []).filter(
    (workflow) =>
      workflow.enabled &&
      workflow.trigger.kind === 'record_event' &&
      workflow.trigger.objectId === object.id &&
      !workflow.trigger.onImport,
  );
  const firstRow = header ? 2 : 1;
  const sheetRows = dataRows.filter((row) => row.some((cell) => cell.trim() !== '')).length;

  const reset = () => {
    setStep('file');
    setText('');
    setFileName('');
    setProblem(null);
    setDelimiter(null);
    setHeader(true);
    setOverrides({});
    setDateOrder('iso');
    setMatchOn('');
    setBusy(false);
    setProgress(0);
    setChecked(null);
    setDone(null);
  };

  /**
   * Take the text of a file (named) or what is typed in the box (not): a file that cannot be used is turned away and
   * the one before stays, but typed text is always kept, so the box can be emptied and written again.
   */
  const load = (content: string, name: string) => {
    const typed = name === '';
    const parsed = content.trim() === '' ? [] : parseCsv(content);
    const empty = parsed.every((row) => row.every((cell) => cell.trim() === ''));
    const tooMany = parsed.length > MAX_ROWS + 1;

    if (!typed && (empty || tooMany)) {
      setProblem(empty ? 'There is nothing in it' : tooBig(parsed.length));
      return;
    }

    setText(content);
    setFileName(name);
    setProblem(
      typed && content.trim() === '' ? null : empty ? 'There is nothing in it' : tooMany ? tooBig(parsed.length) : null,
    );

    if (!typed || text.trim() === '') {
      // A new file, or the first text typed: the header and the columns are guessed again.
      setDelimiter(null);
      setOverrides({});
      setMatchOn('');
      setHeader(parsed[0] ? looksLikeHeader(parsed[0], fields) : true);
    }
  };

  const choose = async (file: File | undefined) => {
    if (!file) {
      return;
    }

    if (file.size > MAX_BYTES) {
      setProblem(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB: at most ${MAX_BYTES / 1024 / 1024} MB.`);
      return;
    }

    load(await readText(file), file.name);
  };

  /** Send the rows in chunks, as a check (nothing is written) or for real; the totals show as it goes. */
  const execute = async (dryRun: boolean): Promise<ImportTotals | null> => {
    const chunks = chunksOf(dataRows, BATCH_MAX);
    let totals = emptyTotals();
    stop.current = false;
    setBusy(true);
    setProgress(0);

    try {
      for (const [i, chunk] of chunks.entries()) {
        if (stop.current) {
          break;
        }

        const body: ImportBody = {
          columns: mapping,
          rows: chunk,
          firstRow: firstRow + i * BATCH_MAX,
          dryRun,
          ...(matchOn ? { matchOn } : {}),
          ...(dateOrder !== 'iso' ? { dateOrder } : {}),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        };
        totals = addReport(totals, await client.records.import(object.nameSingular, body));
        setProgress(Math.round(((i + 1) / chunks.length) * 100));
      }

      return totals;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The import failed');

      return null;
    } finally {
      setBusy(false);
    }
  };

  const check = async () => {
    setStep('check');
    setChecked(null);
    setChecked(await execute(true));
  };

  const run = async () => {
    setStep('import');
    const totals = await execute(false);

    if (totals) {
      setDone(totals);
      await queryClient.invalidateQueries({ queryKey: keys.records(client.workspaceId, object.nameSingular) });
      toast.success(`${totals.created} created, ${totals.updated} updated`);
    } else {
      setStep('check');
    }
  };

  const downloadProblems = (totals: ImportTotals) =>
    download(`${object.namePlural}-problems.csv`, problemRowsCsv(headerRow, dataRows, totals.errors, firstRow));

  const close = (next: boolean) => {
    if (!next && busy) {
      stop.current = true;
    }

    onOpenChange(next);

    if (!next) {
      reset();
    }
  };

  const index_ = STEPS.findIndex((one) => one.id === step);
  const plural = object.labelPlural.toLowerCase();

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-0 p-0 sm:max-w-3xl" data-slot="import-dialog">
        <DialogHeader className="shrink-0 px-5 pt-5 pb-3">
          <DialogTitle>Import {plural}</DialogTitle>
          <DialogDescription>
            Bring in the rows of a CSV file. Nothing is written until you have checked it.
          </DialogDescription>
          <ol className="mt-2 flex items-center gap-2 text-xs" aria-label="Steps">
            {STEPS.map((one, i) => (
              <li
                key={one.id}
                aria-current={one.id === step ? 'step' : undefined}
                className={i === index_ ? 'font-medium text-foreground' : 'text-muted-foreground'}
              >
                {i + 1}. {one.label}
                {i < STEPS.length - 1 ? <span className="ms-2 text-muted-foreground">·</span> : null}
              </li>
            ))}
          </ol>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 text-xs">
          {step === 'file' ? (
            <div className="flex flex-col gap-4">
              <Field>
                <FieldLabel htmlFor="import-file">File</FieldLabel>
                <input
                  id="import-file"
                  type="file"
                  accept=".csv,.tsv,.txt,text/csv,text/plain"
                  className="text-xs file:me-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-xs"
                  onChange={(event) => void choose(event.target.files?.[0])}
                />
                <FieldDescription>
                  A CSV file, up to {MAX_ROWS.toLocaleString()} rows. In Excel or Sheets: save as CSV.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="import-paste">Or paste it</FieldLabel>
                <Textarea
                  id="import-paste"
                  rows={5}
                  className="font-mono text-xs"
                  placeholder={'name,email\nAda,ada@example.com'}
                  value={fileName ? '' : text}
                  onChange={(event) => load(event.target.value, '')}
                />
              </Field>
              {problem ? (
                <p role="alert" className="text-destructive">
                  {problem}
                </p>
              ) : null}
              {rows.length > 0 ? (
                <div className="flex flex-col gap-3" data-slot="import-preview">
                  <p className="text-muted-foreground">
                    {fileName ? <span className="font-medium text-foreground">{fileName}: </span> : null}
                    {sheetRows.toLocaleString()} {sheetRows === 1 ? 'row' : 'rows'}, {width}{' '}
                    {width === 1 ? 'column' : 'columns'}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="import-header"
                        checked={header}
                        onCheckedChange={(next) => setHeader(next === true)}
                      />
                      <label htmlFor="import-header">
                        First row is a header
                        {header !== guessedHeader ? (
                          <span className="text-muted-foreground">
                            (it looks {guessedHeader ? 'like one' : 'like data'})
                          </span>
                        ) : null}
                      </label>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Separated by</span>
                      <OptionSelect
                        aria-label="Delimiter"
                        size="sm"
                        value={
                          delimiter ??
                          (text.includes(';') && !text.split('\n')[0]?.includes(',')
                            ? ';'
                            : text.split('\n')[0]?.includes('\t')
                              ? '\t'
                              : ',')
                        }
                        onValueChange={(next) => setDelimiter(next as CsvDelimiter)}
                        options={CSV_DELIMITERS.map((one) => ({ value: one, label: DELIMITER_LABEL[one] }))}
                      />
                    </div>
                  </div>
                  <div className="overflow-x-auto rounded-md border border-border">
                    <table className="w-full text-left">
                      <tbody>
                        {rows.slice(0, PREVIEW_ROWS + (header ? 1 : 0)).map((row, r) => (
                          <tr
                            key={r}
                            className={r === 0 && header ? 'bg-muted/50 font-medium' : 'border-t border-border/60'}
                          >
                            {Array.from({ length: width }, (_, c) => (
                              <td key={c} className="max-w-48 truncate px-2 py-1.5">
                                {row[c] ?? ''}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {step === 'map' ? (
            <div className="flex flex-col gap-4">
              <div
                className="flex flex-col divide-y divide-border/60 rounded-md border border-border"
                data-slot="import-columns"
              >
                {mapping.map((name, c) => (
                  <div
                    key={c}
                    className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,14rem)] items-center gap-3 px-3 py-2"
                  >
                    <span className="truncate font-medium">{headerRow?.[c]?.trim() || `Column ${c + 1}`}</span>
                    <span className="truncate text-muted-foreground">
                      {dataRows
                        .slice(0, 3)
                        .map((row) => row[c])
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    <OptionSelect
                      aria-label={`Field for ${headerRow?.[c]?.trim() || `column ${c + 1}`}`}
                      size="sm"
                      className="w-full"
                      value={name ?? ''}
                      onValueChange={(next) =>
                        setOverrides((current) => ({ ...current, [c]: next === '' ? null : next }))
                      }
                      options={[
                        { value: '', label: "Don't import" },
                        ...fields.map((field) => ({
                          value: field.name,
                          label: field.label,
                          disabled: mapped.has(field.name) && field.name !== name,
                        })),
                      ]}
                    />
                  </div>
                ))}
              </div>
              {missing.length > 0 && !matchOn ? (
                <p role="alert" className="text-destructive">
                  {missing.map((field) => field.label).join(', ')} {missing.length === 1 ? 'is' : 'are'} required:
                  choose a column for {missing.length === 1 ? 'it' : 'them'}, or every row will be skipped.
                </p>
              ) : null}
              {needsDates ? (
                <Field>
                  <FieldLabel htmlFor="import-dates">Dates are written</FieldLabel>
                  <OptionSelect
                    id="import-dates"
                    size="sm"
                    value={dateOrder}
                    onValueChange={(next) => setDateOrder(next as 'iso' | DateOrder)}
                    options={DATE_ORDER_OPTIONS}
                  />
                  <FieldDescription>
                    A file cannot say whether 03/04/2026 is the 3rd of April or the 4th of March.
                  </FieldDescription>
                </Field>
              ) : null}
              {uniques.length > 0 ? (
                <Field>
                  <FieldLabel htmlFor="import-match">Rows that already exist</FieldLabel>
                  <OptionSelect
                    id="import-match"
                    size="sm"
                    value={matchOn}
                    onValueChange={setMatchOn}
                    options={[
                      { value: '', label: 'Skip them: only add new ones' },
                      ...uniques.map((field) => ({
                        value: field.name,
                        label: `Update the ${object.labelSingular.toLowerCase()} with the same ${field.label}`,
                      })),
                    ]}
                  />
                </Field>
              ) : null}
              {quiet.length > 0 ? (
                <p className="rounded-md bg-muted/60 px-3 py-2 text-muted-foreground" data-slot="import-workflows">
                  {quiet
                    .slice(0, 3)
                    .map((workflow) => workflow.title)
                    .join(', ')}
                  {quiet.length > 3 ? ` and ${quiet.length - 3} more` : ''} run{quiet.length === 1 ? 's' : ''} when{' '}
                  {plural} are created, but not for imported ones. A workflow can opt in.
                </p>
              ) : null}
            </div>
          ) : null}

          {step === 'check' ? (
            <div className="flex flex-col gap-3" data-slot="import-check">
              {busy || !checked ? (
                <Progress value={progress} aria-label="Checking">
                  <span className="text-muted-foreground">Checking {sheetRows.toLocaleString()} rows…</span>
                </Progress>
              ) : (
                <>
                  <p className="text-sm">
                    <strong>{checked.created.toLocaleString()}</strong> will be created
                    {checked.updated > 0 ? (
                      <>
                        , <strong>{checked.updated.toLocaleString()}</strong> updated
                      </>
                    ) : null}
                    {checked.skipped > 0 ? (
                      <>
                        , and <strong>{checked.skipped.toLocaleString()}</strong> have problems and will be skipped
                      </>
                    ) : null}
                    .
                  </p>
                  {checked.errors.length > 0 ? (
                    <div
                      className="max-h-56 overflow-y-auto rounded-md border border-border"
                      data-slot="import-problems"
                    >
                      <ul className="divide-y divide-border/60">
                        {checked.errors.slice(0, 50).map((error, i) => (
                          <li key={i} className="flex gap-3 px-3 py-1.5">
                            <span className="w-14 shrink-0 text-muted-foreground tabular-nums">Row {error.row}</span>
                            <span>
                              {error.field ? <span className="font-medium">{error.field}: </span> : null}
                              {error.message}
                            </span>
                          </li>
                        ))}
                      </ul>
                      {checked.errorCount > 50 ? (
                        <p className="border-t border-border/60 px-3 py-1.5 text-muted-foreground">
                          and {(checked.errorCount - 50).toLocaleString()} more: download them below.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {checked.errors.length > 0 ? (
                    <div>
                      <Button variant="outline" size="sm" onClick={() => downloadProblems(checked)}>
                        <Icon name="download" data-icon="inline-start" />
                        Download the rows with problems
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          ) : null}

          {step === 'import' ? (
            <div className="flex flex-col gap-3" data-slot="import-result">
              {done ? (
                <>
                  <p className="text-sm">
                    <strong>{done.created.toLocaleString()}</strong> created
                    {done.updated > 0 ? (
                      <>
                        , <strong>{done.updated.toLocaleString()}</strong> updated
                      </>
                    ) : null}
                    {done.skipped > 0 ? (
                      <>
                        , <strong>{done.skipped.toLocaleString()}</strong> skipped
                      </>
                    ) : null}
                    .
                  </p>
                  {done.errors.length > 0 ? (
                    <div>
                      <Button variant="outline" size="sm" onClick={() => downloadProblems(done)}>
                        <Icon name="download" data-icon="inline-start" />
                        Download the rows with problems
                      </Button>
                    </div>
                  ) : null}
                </>
              ) : (
                <Progress value={progress} aria-label="Importing">
                  <span className="text-muted-foreground">Importing {sheetRows.toLocaleString()} rows…</span>
                </Progress>
              )}
            </div>
          ) : null}
        </div>

        <DialogFooter className="m-0 shrink-0 px-5 py-3">
          {step === 'file' ? (
            <>
              <Button type="button" variant="outline" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={sheetRows === 0 || width === 0 || problem !== null}
                onClick={() => setStep('map')}
              >
                Next
              </Button>
            </>
          ) : null}
          {step === 'map' ? (
            <>
              <Button type="button" variant="outline" onClick={() => setStep('file')}>
                Back
              </Button>
              <Button
                type="button"
                disabled={mapped.size === 0 || (missing.length > 0 && !matchOn)}
                onClick={() => void check()}
              >
                Check
              </Button>
            </>
          ) : null}
          {step === 'check' ? (
            <>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setStep('map')}>
                Back
              </Button>
              {busy ? (
                <Button type="button" variant="outline" onClick={() => (stop.current = true)}>
                  Stop
                </Button>
              ) : (
                <Button
                  type="button"
                  disabled={!checked || checked.created + checked.updated === 0}
                  onClick={() => void run()}
                >
                  Import {checked ? (checked.created + checked.updated).toLocaleString() : ''} {plural}
                </Button>
              )}
            </>
          ) : null}
          {step === 'import' ? (
            done ? (
              <Button type="button" onClick={() => close(false)}>
                Done
              </Button>
            ) : (
              <Button type="button" variant="outline" onClick={() => (stop.current = true)}>
                Stop
              </Button>
            )
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
