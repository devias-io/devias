import {
  BATCH_MAX,
  type FieldMetadata,
  IMPORT_ERRORS_MAX,
  type ImportBody,
  type ImportReport,
  isImportable,
  newId,
  type ObjectMetadata,
  primaryFieldOf,
  readCell,
  type SchemaIndex,
} from '@devias/core';
import type { z } from 'zod';
import type { EngineContext } from '../context';
import type { DataSource, StoredRecord } from '../datasource/interface';
import type { Db } from '../db/exec';
import { validationError } from '../errors';
import type { MetadataService } from '../metadata/service';
import { relationTargetOf } from '../metadata/store';
import { authorize } from '../permissions/policy';
import { resolveObject } from '../query/validate';
import type { BatchInput, BatchResult } from './service';

/** The members of a workspace, as the server's directory knows them: the engine has none of its own. */
export interface MemberDirectory {
  list(ctx: EngineContext): Promise<{ userId: string; name: string | null; email: string | null }[]>;
}

export interface ImportDeps {
  db: Db;
  metadata: MetadataService;
  dataSource: DataSource;
  batch: (
    ctx: EngineContext,
    object: string,
    input: BatchInput,
    options?: { importId?: string },
  ) => Promise<BatchResult>;
  schemas: (
    objectId: string,
    version: number,
    fields: FieldMetadata[],
  ) => { create: z.ZodType<Record<string, unknown>>; update: z.ZodType<Record<string, unknown>> };
  members: () => MemberDirectory | undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEXT_TYPES = new Set(['text', 'email', 'phone', 'url']);
/** The most candidates read back to find the records a chunk names. */
const FIND_LIMIT = 5000;

interface Problem {
  row: number;
  field?: string;
  message: string;
}

interface ParsedRow {
  row: number;
  values: Record<string, unknown>;
  lookups: { field: FieldMetadata; text: string }[];
  problems: Problem[];
}

const same = (a: unknown, b: unknown): boolean => String(a).toLowerCase() === String(b).toLowerCase();

const fieldOf = (fields: FieldMetadata[], ref: string): FieldMetadata | undefined =>
  fields.find((field) => field.name === ref || field.id === ref);

/** The fields of an object a cell's text may name a record by: its primary field and its unique text fields. */
const namingFields = (index: SchemaIndex, object: ObjectMetadata): FieldMetadata[] => {
  const primary = primaryFieldOf(index, object);
  const unique = (index.fieldsByObjectId.get(object.id) ?? []).filter(
    (field) => field.isUnique && TEXT_TYPES.has(field.type),
  );

  return [...new Set([...(primary ? [primary] : []), ...unique])].filter((field) => TEXT_TYPES.has(field.type));
};

/**
 * Read the rows of a file for one object, write the valid ones and say what became of the rest. Everything a cell can be
 * wrong about is a problem of its row (the row is skipped, the others go on); what is wrong with the call itself (an
 * unknown field, too many rows) is an error of the call.
 */
export const runImport = async (
  deps: ImportDeps,
  ctx: EngineContext,
  objectName: string,
  input: ImportBody,
): Promise<ImportReport> => {
  const { metadata } = deps;
  const snapshot = await metadata.getSnapshot(ctx.workspaceId);
  const { index } = snapshot;
  const object = resolveObject(index, objectName);
  const fields = index.fieldsByObjectId.get(object.id) ?? [];
  authorize(ctx, 'record.write', { object });

  if (input.rows.length > BATCH_MAX) {
    throw validationError(`An import may contain at most ${BATCH_MAX} rows per call`, { total: input.rows.length });
  }

  // The columns: each is a field, or left out.
  const columns: (FieldMetadata | null)[] = [];
  const named = new Set<string>();

  for (const [i, ref] of input.columns.entries()) {
    if (ref === null) {
      columns.push(null);
      continue;
    }

    const field = fieldOf(fields, ref);

    if (!field) {
      throw validationError(`${object.labelSingular} has no field "${ref}"`, { path: `columns[${i}]` });
    }

    if (!isImportable(field)) {
      throw validationError(`${field.label} cannot be filled from a file`, { path: `columns[${i}]` });
    }

    if (named.has(field.name)) {
      throw validationError(`${field.label} is the field of two columns`, { path: `columns[${i}]` });
    }

    named.add(field.name);
    columns.push(field);
  }

  const matchField = input.matchOn ? fieldOf(fields, input.matchOn) : undefined;

  if (input.matchOn && (!matchField?.isUnique || !named.has(matchField.name))) {
    throw validationError(
      `"${input.matchOn}" must be a unique field of ${object.labelSingular} that one of the columns fills`,
      { path: 'matchOn' },
    );
  }

  const firstRow = input.firstRow ?? 2;
  const options = { dateOrder: input.dateOrder, timeZone: input.timeZone };

  // 1. Read every cell.
  const parsed: ParsedRow[] = [];

  for (const [r, cells] of input.rows.entries()) {
    if (cells.every((cell) => cell.trim() === '')) {
      continue;
    }

    const row: ParsedRow = { row: firstRow + r, values: {}, lookups: [], problems: [] };

    for (const [c, field] of columns.entries()) {
      if (!field) {
        continue;
      }

      const cell = readCell(field, cells[c] ?? '', options);

      if (cell.kind === 'value') {
        row.values[field.name] = cell.value;
      } else if (cell.kind === 'lookup') {
        row.lookups.push({ field, text: cell.text });
      } else if (cell.kind === 'error') {
        row.problems.push({ row: row.row, field: field.label, message: cell.message });
      }
    }

    parsed.push(row);
  }

  // 2. Find the records the relations and members name.
  await resolveLookups(deps, ctx, index, parsed);

  // 3. Find the records the unique fields already have, and the repeats inside the file.
  const uniques = fields.filter((field) => field.isUnique && named.has(field.name));
  const existing = await existingByUnique(deps, ctx, object, uniques, parsed);
  const schemas = deps.schemas(object.id, snapshot.version, fields);
  const creates: { row: ParsedRow; values: Record<string, unknown> }[] = [];
  const updates: { row: ParsedRow; id: string; values: Record<string, unknown> }[] = [];
  const claimed = new Map<string, number>();
  let skipped = 0;
  const problems: Problem[] = [];

  for (const row of parsed) {
    const mine = [...row.problems];

    // Unique fields: a value the file repeats, or one that exists (which updates when it is the one to match on).
    let matched: StoredRecord | undefined;

    for (const field of uniques) {
      const value = row.values[field.name];

      if (value === undefined || value === null) {
        continue;
      }

      const key = `${field.name}\u0000${String(value).toLowerCase()}`;
      const earlier = claimed.get(key);

      if (earlier !== undefined) {
        mine.push({ row: row.row, field: field.label, message: `"${String(value)}" is also in row ${earlier}` });
        continue;
      }

      claimed.set(key, row.row);
      const found = existing.get(key);

      if (!found) {
        continue;
      }

      if (matchField && field.name === matchField.name) {
        matched = found;
      } else {
        mine.push({ row: row.row, field: field.label, message: `"${String(value)}" already exists` });
      }
    }

    if (matchField && !matched && row.values[matchField.name] === undefined) {
      mine.push({
        row: row.row,
        field: matchField.label,
        message: `${matchField.label} is empty, so no record can be matched`,
      });
    }

    if (mine.length === 0) {
      const target = matched ? schemas.update : schemas.create;
      // A new record needs what is required and has no default, whether or not a column fills it.
      const missing = matched
        ? []
        : fields.filter(
            (field) => field.isRequired && field.defaultValue === undefined && row.values[field.name] === undefined,
          );

      for (const field of missing) {
        mine.push({ row: row.row, field: field.label, message: `${field.label} is required` });
      }

      if (mine.length === 0) {
        const result = target.safeParse(row.values);

        if (!result.success) {
          for (const issue of result.error.issues) {
            const field = fields.find((one) => one.name === issue.path[0]);
            mine.push({ row: row.row, ...(field ? { field: field.label } : {}), message: issue.message });
          }
        } else if (matched) {
          updates.push({ row, id: matched.id, values: result.data });
        } else {
          creates.push({ row, values: result.data });
        }
      }
    }

    if (mine.length > 0) {
      skipped++;
      problems.push(...mine);
    }
  }

  const importId = input.dryRun ? undefined : newId();

  if (importId && (creates.length > 0 || updates.length > 0)) {
    await deps.batch(
      ctx,
      object.nameSingular,
      {
        create: creates.map((one) => one.values),
        update: updates.map((one) => ({ id: one.id, patch: one.values })),
      },
      { importId },
    );
  }

  problems.sort((a, b) => a.row - b.row);

  return {
    created: creates.length,
    updated: updates.length,
    skipped,
    errorCount: problems.length,
    errors: problems.slice(0, IMPORT_ERRORS_MAX),
    dryRun: input.dryRun === true,
    ...(importId ? { importId } : {}),
  };
};

/** Turn the texts of relations and members into ids; a text that names none or several is a problem of its row. */
const resolveLookups = async (
  deps: ImportDeps,
  ctx: EngineContext,
  index: SchemaIndex,
  rows: ParsedRow[],
): Promise<void> => {
  const relations = new Map<string, { field: FieldMetadata; texts: Set<string> }>();
  const members = new Set<string>();

  for (const row of rows) {
    for (const { field, text } of row.lookups) {
      if (field.type === 'member') {
        members.add(field.name);
      } else {
        const entry = relations.get(field.name) ?? { field, texts: new Set<string>() };
        entry.texts.add(text);
        relations.set(field.name, entry);
      }
    }
  }

  const found = new Map<string, Map<string, string[]>>();

  for (const { field, texts } of relations.values()) {
    const targetId = relationTargetOf(field.settings);
    const target = targetId ? index.objectsById.get(targetId) : undefined;

    if (!target) {
      continue;
    }

    const byText = new Map<string, string[]>();
    const ids = [...texts].filter((text) => UUID.test(text));
    const names = [...texts].filter((text) => !UUID.test(text));
    const live = await deps.dataSource.existingIds(deps.db, ctx.workspaceId, target.id, ids);

    for (const id of ids) {
      byText.set(id, live.has(id) ? [id] : []);
    }

    const keys = namingFields(index, target);
    const records = await deps.dataSource.findByText(
      deps.db,
      ctx.workspaceId,
      target,
      keys.map((key) => key.name),
      names,
      FIND_LIMIT,
    );

    for (const text of names) {
      byText.set(
        text,
        records.filter((record) => keys.some((key) => same(record.data[key.name] ?? '\u0000', text))).map((r) => r.id),
      );
    }

    found.set(field.name, byText);
  }

  const directory = members.size > 0 ? deps.members() : undefined;
  const people = directory ? await directory.list(ctx) : [];

  for (const row of rows) {
    for (const { field, text } of row.lookups) {
      if (field.type === 'member') {
        if (!directory) {
          row.values[field.name] = text;
          continue;
        }

        const matches = people.filter(
          (person) =>
            person.userId === text || same(person.email ?? '\u0000', text) || same(person.name ?? '\u0000', text),
        );

        if (matches.length === 1) {
          row.values[field.name] = (matches[0] as { userId: string }).userId;
        } else {
          row.problems.push({
            row: row.row,
            field: field.label,
            message:
              matches.length === 0 ? `No member is "${text}"` : `More than one member is "${text}": use their email`,
          });
        }

        continue;
      }

      const targetId = relationTargetOf(field.settings);
      const target = targetId ? index.objectsById.get(targetId) : undefined;
      const ids = [...new Set(found.get(field.name)?.get(text) ?? [])];

      if (ids.length === 1) {
        row.values[field.name] = ids[0];
      } else {
        const what = target?.labelSingular ?? 'record';
        row.problems.push({
          row: row.row,
          field: field.label,
          message:
            ids.length === 0
              ? `No ${what.toLowerCase()} is called "${text}"`
              : `${ids.length} ${(target?.labelPlural ?? 'records').toLowerCase()} are called "${text}": use a unique field or its id`,
        });
      }
    }
  }
};

/** The records that already have a unique value this file carries, by field and lower-cased value. */
const existingByUnique = async (
  deps: ImportDeps,
  ctx: EngineContext,
  object: ObjectMetadata,
  uniques: FieldMetadata[],
  rows: ParsedRow[],
): Promise<Map<string, StoredRecord>> => {
  const found = new Map<string, StoredRecord>();

  for (const field of uniques) {
    const texts = [
      ...new Set(
        rows
          .map((row) => row.values[field.name])
          .filter((value) => value !== undefined && value !== null)
          .map((value) => String(value)),
      ),
    ];
    const records = await deps.dataSource.findByText(deps.db, ctx.workspaceId, object, [field.name], texts, FIND_LIMIT);

    for (const record of records) {
      found.set(`${field.name}\u0000${String(record.data[field.name]).toLowerCase()}`, record);
    }
  }

  return found;
};
