import { z } from 'zod';
import { ActivityPageSchema, ActivityQuerySchema } from '../activity';
import { coreIds } from '../core-ids';
import { LookupHitSchema, LookupInputSchema, RecordWriteSchema } from '../metadata/inputs';
import { AggregateQuerySchema, AggregateResultSchema } from '../query/aggregate';
import { PageSchema, QuerySchema, RecordDataSchema } from '../query/ir';
import {
  RecordCommentInputSchema,
  RecordCommentPageSchema,
  RecordCommentPatchSchema,
  RecordCommentQuerySchema,
  RecordCommentSchema,
} from '../record-comments';
import { defineActionSpec } from './define';

/** The most creates, updates and deletes one batch (or one bulk delete) may carry. */
export const BATCH_MAX = 500;

const tags = ['records'];
const ObjectParams = z.object({ object: z.string().meta({ description: 'Object API name (nameSingular)' }) });
const RecordParams = ObjectParams.extend({ id: z.string() });

export const QueryBodySchema = QuerySchema.extend({ object: z.string().optional() }).meta({ id: 'QueryBody' });

export const AggregateBodySchema = AggregateQuerySchema.omit({ object: true }).meta({ id: 'AggregateBody' });

export const BatchInputSchema = z
  .object({
    create: z.array(RecordWriteSchema).max(BATCH_MAX).optional(),
    update: z
      .array(z.object({ id: z.string(), patch: RecordWriteSchema }))
      .max(BATCH_MAX)
      .optional(),
    delete: z.array(z.string()).max(BATCH_MAX).optional(),
  })
  .meta({ id: 'BatchInput' });

export const BatchResultSchema = z
  .object({
    created: z.array(RecordDataSchema),
    updated: z.array(RecordDataSchema),
    deleted: z.array(z.string()),
  })
  .meta({ id: 'BatchResult' });

export const UpsertBodySchema = z
  .object({
    /** One unique field and the value to find the record by: an outside system's id, an email. */
    match: z.record(z.string(), z.unknown()),
    /** Written to the record found, or to a new one (with `match` added). */
    values: RecordWriteSchema,
  })
  .meta({ id: 'UpsertBody' });

export const UpsertResultSchema = z
  .object({ record: RecordDataSchema, created: z.boolean() })
  .meta({ id: 'UpsertResult' });

/**
 * A file's rows, read for one object: which field each column fills (its API name or id, null to leave a column out) and
 * the rows as the text of their cells. The text is read by the rules of "Import records" in the docs.
 */
export const ImportBodySchema = z
  .object({
    columns: z
      .array(z.string().nullable())
      .min(1)
      .max(200)
      .describe('The field each column fills, by API name or id; null leaves the column out'),
    rows: z
      .array(z.array(z.string()))
      .max(BATCH_MAX)
      .describe(`The rows without the header, as text, at most ${BATCH_MAX} per call`),
    matchOn: z
      .string()
      .optional()
      .describe(
        'A unique field that is among the columns: a row whose value exists updates that record, not creates one',
      ),
    dateOrder: z.enum(['dmy', 'mdy']).optional().describe('How the file writes 13/11/2026: day first or month first'),
    timeZone: z
      .string()
      .optional()
      .describe('The time zone (Europe/Bucharest) of date-times that have no offset; UTC when left out'),
    firstRow: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        "The number the first row has in the person's spreadsheet, for the errors (2 when left out: row 1 is the header)",
      ),
    dryRun: z.boolean().optional().describe('Check everything and write nothing'),
  })
  .meta({ id: 'ImportBody' });
export type ImportBody = z.infer<typeof ImportBodySchema>;

/** The most problems an import reports one by one; `errorCount` says how many there were. */
export const IMPORT_ERRORS_MAX = 1000;

export const ImportErrorSchema = z
  .object({
    row: z.number().int().describe("The row's number in the spreadsheet (the header is row 1)"),
    field: z.string().optional().describe("The field's label, when the problem is in one cell"),
    message: z.string(),
  })
  .meta({ id: 'ImportError' });

export const ImportReportSchema = z
  .object({
    created: z.number().int(),
    updated: z.number().int(),
    /** Rows left out because of a problem; blank rows are ignored, not counted. */
    skipped: z.number().int(),
    errorCount: z.number().int(),
    errors: z.array(ImportErrorSchema).max(IMPORT_ERRORS_MAX),
    /** What a dry run would have created and updated, written nothing. */
    dryRun: z.boolean(),
    /** What the records it wrote carry in their events, to find them again; none for a dry run. */
    importId: z.string().optional(),
  })
  .meta({ id: 'ImportReport' });
export type ImportReport = z.infer<typeof ImportReportSchema>;

export const DeleteRecordsSchema = z
  .object({ ids: z.array(z.string()).min(1).max(BATCH_MAX) })
  .meta({ id: 'DeleteRecords' });

/** A record with the records its relation fields point at, so a reader can say who they are. */
export const RecordWithLabelsSchema = z
  .object({ record: RecordDataSchema, included: z.record(z.string(), z.array(RecordDataSchema)).optional() })
  .meta({ id: 'RecordWithLabels' });

export const recordActions = {
  list: defineActionSpec({
    id: coreIds.actions.list_records,
    ai: {
      tool: 'list_records',
      description:
        'List the records of one object you already know, with filters, free-text search, sorting and a row cap (max 50). Returns id, label and field values; related records\' labels come back under "labels" when you pass include. The response includes the total count. To find a record from a name across objects, use lookup_records.',
    },
    summary: 'List records',
    tags,
    permission: 'record.read',
    approval: 'auto',
    params: ObjectParams,
    body: QueryBodySchema,
    output: PageSchema,
    http: {
      method: 'post',
      path: '/api/workspaces/{workspaceId}/records/{object}/list',
      bodyDescription: 'Query IR; the path object wins over the body',
      outputDescription: 'A page of records',
    },
  }),
  aggregate: defineActionSpec({
    id: coreIds.actions.aggregate_records,
    ai: {
      tool: 'aggregate_records',
      description:
        "Count records and add up number or currency fields, per group or in total, computed over every matching record. Use it for totals, sums, averages and breakdowns (\"pipeline value by stage\", \"open tasks per deal\", \"deals won this year\") instead of paging through list_records. groupBy is a select, boolean, relation, text or date field; measures are { fn: 'count' } or { fn: 'sum' | 'avg' | 'min' | 'max', field }; filter is the query filter ({ field, op, value } combined with and / or / not). Select groups list every option in order; relation groups carry the related record's label.",
    },
    summary: 'Aggregate records',
    description:
      'Counts and measures (sum, average, min, max) over the records that match, per group of one field or in total. Select fields list every option, in order.',
    tags,
    permission: 'record.read',
    approval: 'auto',
    params: ObjectParams,
    body: AggregateBodySchema,
    output: AggregateResultSchema,
    http: {
      method: 'post',
      path: '/api/workspaces/{workspaceId}/records/{object}/aggregate',
      bodyDescription: 'What to group by and measure; the filter is the query filter',
      outputDescription: 'Groups with their count and measures, and the totals',
    },
  }),
  upsert: defineActionSpec({
    id: coreIds.actions.upsert_record,
    ai: {
      tool: 'upsert_record',
      description:
        'Create a record, or update the one that already has the same value in a unique field: match is { field: value } on one unique field (an external id, an email), values the fields to write. Says whether it created one. Use it to keep records in step with another system without duplicates.',
    },
    summary: 'Create or update a record by a unique field',
    description:
      'Finds the record whose unique field has the given value: updates it with `values`, or creates one with `values` and the match. The field must be unique.',
    tags,
    permission: 'record.write',
    approval: 'auto',
    params: ObjectParams,
    body: UpsertBodySchema,
    output: UpsertResultSchema,
    http: {
      method: 'post',
      path: '/api/workspaces/{workspaceId}/records/{object}/upsert',
      bodyDescription: 'The unique field to match on, and the values',
      outputDescription: 'The record, and whether it was created',
    },
  }),
  get: defineActionSpec({
    id: coreIds.actions.get_record,
    ai: { tool: null, category: 'covered_by', reason: 'get_record reads it with the labels of what it points at' },
    summary: 'Get a record',
    tags,
    permission: 'record.read',
    params: RecordParams,
    output: RecordDataSchema,
    http: {
      method: 'get',
      path: '/api/workspaces/{workspaceId}/records/{object}/{id}',
      outputDescription: 'The record',
    },
  }),
  getWithLabels: defineActionSpec({
    id: coreIds.actions.get_record_with_labels,
    ai: {
      tool: 'get_record',
      description: 'Read one record by id, with the labels of the records its relation fields point at.',
    },
    summary: 'Get a record with the labels of its relations',
    description: 'The record, and for each relation field the record it points at, so a reader can say who it is.',
    tags,
    permission: 'record.read',
    params: RecordParams,
    output: RecordWithLabelsSchema,
    http: {
      method: 'get',
      path: '/api/workspaces/{workspaceId}/records/{object}/{id}/labels',
      outputDescription: 'The record and the records its relations point at',
    },
  }),
  create: defineActionSpec({
    id: coreIds.actions.create_record,
    ai: {
      tool: 'create_record',
      description:
        'Create one record. Required fields must be present. Returns the new record; call navigate afterwards if the person should see it.',
    },
    summary: 'Create a record',
    tags,
    permission: 'record.write',
    // Reversible, and shown live in the studio: the agent writes records without asking by default.
    approval: 'auto',
    params: ObjectParams,
    body: RecordWriteSchema,
    bodyField: 'values',
    output: RecordDataSchema,
    http: {
      method: 'post',
      path: '/api/workspaces/{workspaceId}/records/{object}',
      status: 201,
      bodyDescription: 'Field values by API name',
      outputDescription: 'Created record',
    },
  }),
  update: defineActionSpec({
    id: coreIds.actions.update_record,
    ai: {
      tool: 'update_record',
      description: 'Update fields of one record by id. Only the given fields change; pass null to clear a field.',
    },
    summary: 'Update a record',
    tags,
    permission: 'record.write',
    // Reversible, and shown live in the studio: the agent writes records without asking by default.
    approval: 'auto',
    params: RecordParams,
    body: RecordWriteSchema,
    bodyField: 'values',
    output: RecordDataSchema,
    http: {
      method: 'patch',
      path: '/api/workspaces/{workspaceId}/records/{object}/{id}',
      bodyDescription: 'Partial field values',
      outputDescription: 'Updated record',
    },
  }),
  delete: defineActionSpec({
    id: coreIds.actions.delete_record,
    ai: { tool: null, category: 'covered_by', reason: 'delete_records deletes one record or many' },
    summary: 'Delete a record',
    tags,
    permission: 'record.write',
    params: RecordParams,
    http: {
      method: 'delete',
      path: '/api/workspaces/{workspaceId}/records/{object}/{id}',
      outputDescription: 'Deleted',
    },
  }),
  deleteMany: defineActionSpec({
    id: coreIds.actions.delete_records,
    ai: {
      tool: 'delete_records',
      description:
        'Delete records by id (up to 100 at once). This asks the person for approval before running; state what will be deleted first.',
    },
    summary: 'Delete records',
    tags,
    permission: 'record.write',
    params: ObjectParams,
    body: DeleteRecordsSchema,
    http: {
      method: 'delete',
      path: '/api/workspaces/{workspaceId}/records/{object}',
      errors: [400, 401, 403, 404, 409],
      outputDescription: 'Deleted',
    },
  }),
  batch: defineActionSpec({
    id: coreIds.actions.batch_write_records,
    ai: {
      tool: 'batch_write_records',
      description: `Create, update and delete records of one object in one transaction (up to ${BATCH_MAX} operations): all succeed or none. For many changes at once; create_record and update_record are simpler for one.`,
    },
    summary: 'Batch write records',
    tags,
    permission: 'record.write',
    params: ObjectParams,
    body: BatchInputSchema,
    output: BatchResultSchema,
    http: {
      method: 'post',
      path: '/api/workspaces/{workspaceId}/records/{object}/batch',
      bodyDescription: `Up to ${BATCH_MAX} operations in one transaction`,
      outputDescription: 'What was created, updated and deleted',
    },
  }),
  import: defineActionSpec({
    id: coreIds.actions.import_records,
    ai: {
      tool: 'import_records',
      description: `Import the rows of a CSV into one object, at most ${BATCH_MAX} per call: give the CSV text with a header row naming the fields (by label or API name). Cells are read the way people write them (numbers like 1,234.50, dates, an option by its label, a related record by its name). Rows with a problem are skipped and listed; the rest are written. With dryRun it checks and writes nothing: use it first, show the person what it found, then import. Asks for approval.`,
    },
    summary: 'Import records from the rows of a file',
    description:
      'Reads the cells as text by the rules of the import (numbers, dates, options, related records by name), validates every row, writes the valid ones and reports the rest by row. `dryRun` writes nothing. At most 500 rows per call: send a bigger file in several.',
    tags,
    permission: 'record.write',
    approval: 'approve',
    params: ObjectParams,
    body: ImportBodySchema,
    output: ImportReportSchema,
    http: {
      method: 'post',
      path: '/api/workspaces/{workspaceId}/records/{object}/import',
      bodyDescription: 'The columns, the rows as text and how to read them',
      outputDescription: 'How many were created, updated and skipped, and the problems by row',
    },
  }),
  lookup: defineActionSpec({
    id: coreIds.actions.lookup_records,
    ai: {
      tool: 'lookup_records',
      description:
        "Look up records by name or text across all objects (or the given ones); returns only the object, id and label of each hit. Use it to turn a name the person mentioned into a record id before updating, deleting or linking it. To read an object's records with filters, sorting or field values, use list_records.",
    },
    summary: 'Look up records',
    tags,
    permission: 'record.read',
    approval: 'auto',
    body: LookupInputSchema,
    output: z.array(LookupHitSchema),
    http: {
      method: 'post',
      path: '/api/workspaces/{workspaceId}/lookup',
      bodyDescription: 'Free-text search across objects',
      outputDescription: 'Search hits',
    },
  }),
};

export const activityActions = {
  list: defineActionSpec({
    id: coreIds.actions.list_record_activity,
    ai: {
      tool: 'list_record_activity',
      description: "A record's history, newest first: who changed which fields and when. Page with nextCursor.",
    },
    summary: "List a record's activity",
    description: 'Changes, newest first. Page with `nextCursor`.',
    tags: ['activity'],
    permission: 'record.read',
    params: RecordParams,
    query: ActivityQuerySchema,
    output: ActivityPageSchema,
    http: {
      method: 'get',
      path: '/api/workspaces/{workspaceId}/records/{object}/{id}/activity',
      errors: [400, 401, 403, 404, 409],
      outputDescription: 'A page of activity',
    },
  }),
};

export const recordCommentActions = {
  list: defineActionSpec({
    id: coreIds.actions.list_record_comments,
    ai: {
      tool: 'list_record_comments',
      description:
        "A record's comments, newest first, with their titles, bodies, authors and dates. Page with nextCursor.",
    },
    summary: "List a record's comments",
    description: 'Newest first. Page with `nextCursor`; `total` is how many the record has.',
    tags: ['comments'],
    permission: 'record.read',
    params: RecordParams,
    query: RecordCommentQuerySchema,
    output: RecordCommentPageSchema,
    http: {
      method: 'get',
      path: '/api/workspaces/{workspaceId}/records/{object}/{id}/comments',
      errors: [400, 401, 403, 404, 409],
      outputDescription: 'A page of comments',
    },
  }),
  create: defineActionSpec({
    id: coreIds.actions.comment_on_record,
    ai: {
      tool: 'comment_on_record',
      description:
        'Write a comment on a record: a short title and an optional body, as the person you act for. Use it for what should be remembered about the record. Asks for approval.',
    },
    summary: 'Add a comment to a record',
    tags: ['comments'],
    permission: 'record.write',
    params: RecordParams,
    body: RecordCommentInputSchema,
    output: RecordCommentSchema,
    http: {
      method: 'post',
      path: '/api/workspaces/{workspaceId}/records/{object}/{id}/comments',
      status: 201,
      bodyDescription: 'The comment: a title and an optional body',
      outputDescription: 'The comment',
    },
  }),
  update: defineActionSpec({
    id: coreIds.actions.update_record_comment,
    ai: { tool: 'update_record_comment', description: "Change a comment's title or body. Asks for approval." },
    summary: 'Edit a comment',
    description: 'Authors can edit their own comments; owners and admins any.',
    tags: ['comments'],
    permission: 'record.write',
    params: RecordParams.extend({ commentId: z.string() }),
    body: RecordCommentPatchSchema,
    output: RecordCommentSchema,
    http: {
      method: 'patch',
      path: '/api/workspaces/{workspaceId}/records/{object}/{id}/comments/{commentId}',
      bodyDescription: 'The title and/or the body to change',
      outputDescription: 'The comment',
    },
  }),
  delete: defineActionSpec({
    id: coreIds.actions.delete_record_comment,
    ai: { tool: 'delete_record_comment' },
    summary: 'Remove a comment',
    description: 'Authors can remove their own comments; owners and admins any.',
    tags: ['comments'],
    permission: 'record.write',
    params: RecordParams.extend({ commentId: z.string() }),
    http: {
      method: 'delete',
      path: '/api/workspaces/{workspaceId}/records/{object}/{id}/comments/{commentId}',
      outputDescription: 'Removed',
    },
  }),
};
