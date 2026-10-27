import {
  type ActivityEntry,
  BATCH_MAX,
  coreIds,
  type ImportReport,
  isImportable,
  looksLikeHeader,
  matchColumns,
  parseCsv,
  QUERY_MAX_LIMIT,
  richTextToMarkdown,
} from '@devias/core';
import { z } from 'zod';
import {
  FilterInputSchema,
  fieldsOf,
  recordLabel,
  recordRewriteWarnings,
  refuse,
  resolveField,
  resolveObject,
  SortInputSchema,
  SYSTEM_FIELDS,
  shapeRecord,
  toFilter,
  withRichText,
  withWarnings,
} from '../helpers';
import { carrying, defineAdapter, type ToolAdapters } from './types';

const ROW_CAP = 50;
const DELETE_CAP = 100;

const values = z
  .record(z.string(), z.unknown())
  .describe(
    'Field values by API name. Relation fields take a record id; select fields take an option value; rich_text fields take Markdown text.',
  );

/**
 * The model names an object by API name, id or label, a field by its name, and writes rich text as Markdown; the
 * actions take the object's API name and the stored forms. The mapping lives here, once, for the tools.
 */
export const recordAdapters: ToolAdapters = {
  [coreIds.actions.get_record_with_labels]: defineAdapter({
    input: z.object({ object: z.string().min(1), id: z.string().min(1) }),
    toAction: async ({ object: ref, id }, { schema }) => ({
      object: resolveObject(await schema(), ref).nameSingular,
      id,
    }),
    shape: async ({ record, included }, { object: ref }, { schema }) => {
      const index = await schema();
      const object = resolveObject(index, ref);

      return { object: object.nameSingular, record: shapeRecord(index, object, record, included) };
    },
  }),
  [coreIds.actions.list_records]: defineAdapter({
    input: z.object({
      object: z.string().min(1).describe('Object API name'),
      filter: FilterInputSchema.optional(),
      search: z.string().optional().describe('Free-text search across text fields'),
      sort: z.array(SortInputSchema).optional(),
      limit: z.number().int().min(1).max(ROW_CAP).optional().describe(`Rows to return (default 20, max ${ROW_CAP})`),
      fields: z
        .array(z.string())
        .optional()
        .describe('Field API names to return (createdAt and updatedAt too); omit for all fields'),
      include: z.array(z.string()).optional().describe('Relation field names whose target record labels to include'),
      cursor: z.string().optional().describe('nextCursor from a previous page'),
    }),
    toAction: async (input, { schema }) => {
      const index = await schema();
      const object = resolveObject(index, input.object);
      const include = input.include?.length
        ? Object.fromEntries(input.include.map((name) => [resolveField(index, object, name).name, true as const]))
        : undefined;

      return {
        object: object.nameSingular,
        filter: toFilter(input.filter),
        ...(input.search ? { search: input.search } : {}),
        ...(input.sort ? { sort: input.sort } : {}),
        ...(input.fields
          ? {
              select: input.fields.map((name) =>
                SYSTEM_FIELDS.has(name) ? name : resolveField(index, object, name).name,
              ),
            }
          : {}),
        ...(include ? { include } : {}),
        ...(input.cursor ? { cursor: input.cursor } : {}),
        limit: Math.min(input.limit ?? 20, ROW_CAP, QUERY_MAX_LIMIT),
        count: true,
      };
    },
    shape: async (page, input, { schema }) => {
      const index = await schema();
      const object = resolveObject(index, input.object);

      return {
        object: object.nameSingular,
        totalCount: page.totalCount ?? page.items.length,
        items: page.items.map((record: Parameters<typeof shapeRecord>[2]) =>
          shapeRecord(index, object, record, page.included),
        ),
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      };
    },
  }),
  [coreIds.actions.lookup_records]: defineAdapter({
    input: z.object({
      text: z.string().min(1),
      objects: z.array(z.string()).optional().describe('Restrict to these object API names'),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    toAction: async (input, { schema }) => {
      const index = await schema();
      const objects = input.objects?.map((ref) => resolveObject(index, ref).nameSingular);

      return { text: input.text, ...(objects ? { objects } : {}), limit: input.limit ?? 10 };
    },
    shape: (hits) => ({
      hits: hits.map((hit: { object: string; recordId: string; title: string; subtitle?: string }) => ({
        object: hit.object,
        id: hit.recordId,
        label: hit.title,
        ...(hit.subtitle ? { subtitle: hit.subtitle } : {}),
      })),
    }),
  }),
  [coreIds.actions.create_record]: defineAdapter({
    input: z.object({ object: z.string().min(1).describe('Object API name'), data: values }),
    toAction: async ({ object: ref, data }, { schema }) => {
      const index = await schema();
      const object = resolveObject(index, ref);

      return { object: object.nameSingular, values: withRichText(index, object, data) };
    },
    shape: async (record, { object: ref }, { schema }) => {
      const index = await schema();
      const object = resolveObject(index, ref);

      return {
        created: true,
        object: object.nameSingular,
        id: record.id,
        label: recordLabel(index, object, record),
        link: `record:${object.nameSingular}/${record.id}`,
        record: shapeRecord(index, object, record),
      };
    },
  }),
  [coreIds.actions.update_record]: defineAdapter({
    input: z.object({ object: z.string().min(1), id: z.string().min(1), patch: values }),
    toAction: async ({ object: ref, id, patch }, context) => {
      const index = await context.schema();
      const object = resolveObject(index, ref);
      const warnings = await recordRewriteWarnings(context, index, object, id, patch);

      return carrying({ object: object.nameSingular, id, values: withRichText(index, object, patch) }, warnings);
    },
    shape: async (record, { object: ref }, { schema }, warnings: string[]) => {
      const index = await schema();
      const object = resolveObject(index, ref);

      return withWarnings(
        {
          updated: true,
          object: object.nameSingular,
          id: record.id,
          label: recordLabel(index, object, record),
          link: `record:${object.nameSingular}/${record.id}`,
          record: shapeRecord(index, object, record),
        },
        warnings,
      );
    },
  }),
  [coreIds.actions.upsert_record]: defineAdapter({
    input: z.object({
      object: z.string().min(1).describe('Object API name'),
      match: z
        .record(z.string(), z.unknown())
        .describe('One unique field and the value to find the record by: { field: value }'),
      values,
    }),
    toAction: async ({ object: ref, match, values: written }, context) => {
      const index = await context.schema();
      const object = resolveObject(index, ref);
      const [name, value] = Object.entries(match)[0] ?? [];
      let warnings: string[] = [];

      // Only an update rewrites text, so the record that is there now is looked for when the write carries text.
      if (Object.keys(match).length === 1 && name !== undefined && value !== undefined && value !== null) {
        const found = (await context
          .read(coreIds.actions.list_records, {
            object: object.nameSingular,
            filter: { field: name, op: 'eq', value },
            limit: 1,
          })
          .catch(() => null)) as { items: { id: string }[] } | null;
        const existing = found?.items[0];

        if (existing) {
          warnings = await recordRewriteWarnings(context, index, object, existing.id, written);
        }
      }

      return carrying({ object: object.nameSingular, match, values: withRichText(index, object, written) }, warnings);
    },
    shape: async ({ record, created }, { object: ref }, { schema }, warnings: string[]) => {
      const index = await schema();
      const object = resolveObject(index, ref);

      return withWarnings(
        {
          created,
          object: object.nameSingular,
          id: record.id,
          label: recordLabel(index, object, record),
          link: `record:${object.nameSingular}/${record.id}`,
          record: shapeRecord(index, object, record),
        },
        warnings,
      );
    },
  }),
  [coreIds.actions.batch_write_records]: defineAdapter({
    input: z.object({
      object: z.string().min(1).describe('Object API name'),
      create: z.array(values).max(BATCH_MAX).optional().describe('Records to create: field values by API name'),
      update: z
        .array(z.object({ id: z.string().min(1), patch: values }))
        .max(BATCH_MAX)
        .optional(),
      delete: z.array(z.string().min(1)).max(BATCH_MAX).optional().describe('Ids of records to delete'),
    }),
    toAction: async ({ object: ref, create, update, delete: remove }, context) => {
      const index = await context.schema();
      const object = resolveObject(index, ref);
      const warnings = (
        await Promise.all(
          (update ?? []).map(({ id, patch }) => recordRewriteWarnings(context, index, object, id, patch)),
        )
      ).flat();

      return carrying(
        {
          object: object.nameSingular,
          ...(create ? { create: create.map((data) => withRichText(index, object, data)) } : {}),
          ...(update
            ? { update: update.map(({ id, patch }) => ({ id, patch: withRichText(index, object, patch) })) }
            : {}),
          ...(remove ? { delete: remove } : {}),
        },
        warnings,
      );
    },
    shape: async ({ created, updated, deleted }, { object: ref }, { schema }, warnings: string[]) => {
      const index = await schema();
      const object = resolveObject(index, ref);
      const shaped = (records: Parameters<typeof shapeRecord>[2][]) =>
        records.map((record) => shapeRecord(index, object, record));

      return withWarnings(
        { object: object.nameSingular, created: shaped(created), updated: shaped(updated), deleted },
        [...new Set(warnings)],
      );
    },
  }),
  [coreIds.actions.import_records]: defineAdapter({
    input: z.object({
      object: z.string().min(1).describe('Object API name'),
      csv: z
        .string()
        .min(1)
        .describe(
          `The rows as CSV text (a header row first, cells in quotes when they hold a comma or a line break), at most ${BATCH_MAX} rows per call: send more in several calls, the header again each time`,
        ),
      header: z.boolean().optional().describe('Whether the first row is a header; found from its cells when left out'),
      matchOn: z
        .string()
        .optional()
        .describe(
          'A unique field that is a column: a row whose value exists updates that record instead of creating one',
        ),
      dateOrder: z.enum(['dmy', 'mdy']).optional().describe('How 13/11/2026 is written: day first or month first'),
      dryRun: z.boolean().optional().describe('Check everything and write nothing'),
    }),
    toAction: async ({ object: ref, csv, header, matchOn, dateOrder, dryRun }, { schema }) => {
      const index = await schema();
      const object = resolveObject(index, ref);
      const fields = fieldsOf(index, object).filter(isImportable);
      const table = parseCsv(csv);
      const first = table[0];

      if (!first) {
        refuse('The CSV has no rows');
      }

      const hasHeader = header ?? looksLikeHeader(first, fields);
      const rows = hasHeader ? table.slice(1) : table;

      if (rows.length > BATCH_MAX) {
        refuse(
          `${rows.length} rows: at most ${BATCH_MAX} per call. Send the rest in more calls, with the header again.`,
        );
      }

      if (!hasHeader) {
        refuse(
          `The CSV needs a header row naming the field of each column. Fields: ${fields.map((f) => `${f.label} (${f.name})`).join(', ')}`,
        );
      }

      const matched = matchColumns(first, fields);
      const columns = matched.map((field) => field?.name ?? null);
      const field = matchOn
        ? fields.find((f) => f.name === matchOn || f.label.toLowerCase() === matchOn.toLowerCase())
        : null;

      if (matchOn && !field) {
        refuse(`matchOn "${matchOn}" is not a field of ${object.nameSingular}`);
      }

      return carrying(
        {
          object: object.nameSingular,
          columns,
          rows,
          ...(field ? { matchOn: field.name } : {}),
          ...(dateOrder ? { dateOrder } : {}),
          ...(dryRun ? { dryRun: true } : {}),
        },
        {
          read: first.map((name, i) => ({ column: name, field: matched[i]?.label ?? null })),
        },
      );
    },
    shape: async (report: ImportReport, { object: ref }, { schema }, carried: { read: unknown[] }) => {
      const object = resolveObject(await schema(), ref);
      const left = (carried.read as { column: string; field: string | null }[])
        .filter((column) => column.field === null)
        .map((column) => column.column);

      return {
        object: object.nameSingular,
        dryRun: report.dryRun,
        created: report.created,
        updated: report.updated,
        skipped: report.skipped,
        // How the header was read, so a column that matched nothing is seen and not silently lost.
        columns: carried.read,
        ...(left.length > 0 ? { notImported: left } : {}),
        ...(report.errorCount > 0
          ? {
              errorCount: report.errorCount,
              errors: report.errors.slice(0, ROW_CAP),
              ...(report.errorCount > ROW_CAP ? { note: `Only the first ${ROW_CAP} problems are listed` } : {}),
            }
          : {}),
        ...(report.importId ? { importId: report.importId } : {}),
      };
    },
  }),
  [coreIds.actions.list_record_activity]: defineAdapter({
    input: z.object({
      object: z.string().min(1).describe('Object API name'),
      id: z.string().min(1),
      cursor: z.string().optional().describe('nextCursor from a previous page'),
      limit: z.number().int().min(1).max(200).optional(),
    }),
    toAction: async ({ object: ref, ...rest }, { schema }) => ({
      object: resolveObject(await schema(), ref).nameSingular,
      ...rest,
    }),
    shape: async (page, { object: ref }, { schema }) => {
      const index = await schema();
      const object = resolveObject(index, ref);
      const texts = new Set(
        fieldsOf(index, object)
          .filter((field) => field.type === 'rich_text')
          .map((field) => field.name),
      );

      // The earlier and the later value of rich text are read as Markdown, as they are everywhere the model reads.
      return {
        ...page,
        items: page.items.map((entry: ActivityEntry) =>
          entry.kind === 'updated'
            ? {
                ...entry,
                changes: entry.changes.map((change) =>
                  texts.has(change.field)
                    ? {
                        ...change,
                        before: change.before == null ? change.before : richTextToMarkdown(change.before),
                        after: change.after == null ? change.after : richTextToMarkdown(change.after),
                      }
                    : change,
                ),
              }
            : entry,
        ),
      };
    },
  }),
  [coreIds.actions.delete_records]: defineAdapter({
    input: z.object({ object: z.string().min(1), ids: z.array(z.string().min(1)).min(1).max(DELETE_CAP) }),
    toAction: async ({ object: ref, ids }, { schema }) => ({
      object: resolveObject(await schema(), ref).nameSingular,
      ids: [...new Set(ids)],
    }),
    shape: async (_output, { object: ref, ids }, { schema }) => {
      const unique = [...new Set(ids)];

      return { deleted: unique.length, object: resolveObject(await schema(), ref).nameSingular, ids: unique };
    },
  }),
};
