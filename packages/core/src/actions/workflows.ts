import { z } from 'zod';
import { coreIds } from '../core-ids';
import {
  RecordWorkflowRunsQuerySchema,
  RunWorkflowInputSchema,
  WorkflowActivityQuerySchema,
  WorkflowActivitySchema,
  WorkflowInputSchema,
  WorkflowRunListSchema,
  WorkflowRunPageSchema,
  WorkflowRunQuerySchema,
  WorkflowRunSchema,
  WorkflowSchema,
} from '../workflow';
import { defineActionSpec } from './define';

const tags = ['workflows'];
const IdParams = z.object({ id: z.string() });

export const workflowActions = {
  list: defineActionSpec({
    id: coreIds.actions.list_workflows,
    ai: {
      tool: 'list_workflows',
      description:
        'List the workflows (automations) of the workspace: trigger, step count, whether they are on, and when they last and next run. list_modules has the actions an action step can call and the events a module_event trigger can start from. Call get_workflow for the steps of one workflow.',
    },
    summary: 'List workflows',
    tags,
    permission: 'workflow.read',
    output: z.array(WorkflowSchema),
    http: {
      method: 'get',
      path: '/api/workspaces/{workspaceId}/workflows',
      outputDescription: 'Every workflow of the workspace, oldest first',
    },
  }),
  create: defineActionSpec({
    id: coreIds.actions.create_workflow,
    ai: {
      tool: 'create_workflow',
      description:
        'Create a workflow: one trigger and a list of steps. Asks for approval. Triggers: record_event (a record of an object is created, updated or deleted; fields limits updates to changes of those fields; condition is a Filter on the record), manual (run from the Actions menu of a record of the object), schedule (a cron expression in UTC, five fields minute hour day month weekday, such as "0 9 * * 1-5" for weekdays at 09:00 or "*/15 * * * *" for every 15 minutes; with an object, once per record matching condition, up to 500 a tick), module_event (a module from list_modules delivers one of the given event types, or "*" for any; such a run has no record). Steps: action (run any action a workflow may run, with its input: { kind: \'action\', action, input }) or branch (a Filter condition on the record, then yes steps or no steps). To update the record that started the run: action update_record with input { object, id: \'{{record.id}}\', values }; to create one: create_record with { object, values }; a module\'s action: its name (from list_modules, such as send_email) with its fields as input; other core actions are named like their tools and take the input their tool takes (comment_on_record: { object, id, title, body }). Workflows run as themselves: they can read and write records and run module actions, never manage the workspace or act for a person. Values are literals or templates like {{record.name}}, {{record.id}}, {{today}}, {{now}}, {{event.type}}, {{event.payload.<path>}}, {{workflow.title}} and {{steps.<step id>.<key>}} (a created record: {{steps.<step id>.id}}); a value that is exactly one template keeps its type. Filter = { field, op, value? } | { and: Filter[] } | { or: Filter[] } | { not: Filter }. A new workflow is on unless enabled is false.',
    },
    summary: 'Create a workflow',
    description:
      'Owners and admins only. The trigger and steps are checked against the workspace metadata: objects, fields, filters and functions must exist.',
    tags,
    permission: 'workflow.manage',
    // A workflow acts as itself, so an agent's own setting may not make creating or changing one automatic.
    locked: true,
    body: WorkflowInputSchema,
    output: WorkflowSchema,
    http: {
      method: 'post',
      path: '/api/workspaces/{workspaceId}/workflows',
      status: 201,
      outputDescription: 'Created',
    },
  }),
  get: defineActionSpec({
    id: coreIds.actions.get_workflow,
    ai: {
      tool: 'get_workflow',
      description:
        'Read one workflow: its trigger, its full step tree (branches with their yes and no lanes) and its last few runs. Read a workflow before changing it.',
    },
    summary: 'Get a workflow',
    tags,
    permission: 'workflow.read',
    params: IdParams,
    output: WorkflowSchema,
    http: { method: 'get', path: '/api/workspaces/{workspaceId}/workflows/{id}', outputDescription: 'The workflow' },
  }),
  update: defineActionSpec({
    id: coreIds.actions.update_workflow,
    ai: {
      tool: 'update_workflow',
      description:
        'Change a workflow: rename it, turn it on or off, replace its trigger, or replace its steps. Only the given properties change, but steps replaces the whole step tree: read the workflow with get_workflow first and send every step you keep, with its id. A new trigger, or turning a workflow on, starts it from now; earlier changes are not replayed. Asks for approval.',
    },
    summary: 'Update a workflow',
    description:
      'Sends only what changes. A new trigger, or enabling the workflow, starts it from now: events that happened in between are not replayed.',
    tags,
    permission: 'workflow.manage',
    // A workflow acts as itself, so an agent's own setting may not make creating or changing one automatic.
    locked: true,
    params: IdParams,
    body: WorkflowInputSchema.partial(),
    output: WorkflowSchema,
    http: { method: 'patch', path: '/api/workspaces/{workspaceId}/workflows/{id}', outputDescription: 'Updated' },
  }),
  delete: defineActionSpec({
    id: coreIds.actions.delete_workflow,
    ai: {
      tool: 'delete_workflow',
      description:
        'Delete a workflow and its run history. Asks for approval; say which workflow first. To stop a workflow but keep it, use update_workflow with enabled: false.',
    },
    summary: 'Delete a workflow',
    description: 'Its runs go with it.',
    tags,
    permission: 'workflow.manage',
    params: IdParams,
    http: { method: 'delete', path: '/api/workspaces/{workspaceId}/workflows/{id}', outputDescription: 'Deleted' },
  }),
  listRuns: defineActionSpec({
    id: coreIds.actions.list_workflow_runs,
    ai: {
      tool: 'list_workflow_runs',
      description:
        "A workflow's runs, newest first, with what started each one and what every step did (succeeded, failed with its error, or skipped with the reason). Use it to explain why a workflow did or did not do something. At most 20 runs per call; page with cursor.",
    },
    summary: "List a workflow's runs",
    description: 'Newest first. Page with `nextCursor`.',
    tags,
    permission: 'workflow.read',
    params: IdParams,
    query: WorkflowRunQuerySchema,
    output: WorkflowRunPageSchema,
    http: {
      method: 'get',
      path: '/api/workspaces/{workspaceId}/workflows/{id}/runs',
      errors: [400, 401, 403, 404, 409],
      outputDescription: 'A page of runs',
    },
  }),
  activity: defineActionSpec({
    id: coreIds.actions.get_workflow_activity,
    ai: {
      tool: 'get_workflow_activity',
      description:
        'How the workspace’s workflows have been running: runs per day over the last `days` days (default 30), succeeded and failed, and for every workflow that has run (by id, see list_workflows), its runs and failures in that period and how its latest run ended, with its error. Use it for "is anything failing?" or "how busy were the automations this week?", then list_workflow_runs for one workflow’s details.',
    },
    summary: 'Get workflow activity',
    description:
      'How the workspace’s workflows have run: runs per day (succeeded and failed) over the last `days` days counted in `tz`, and for every workflow that has run, its runs and failures in that period and how its latest run ended.',
    tags,
    permission: 'workflow.read',
    query: WorkflowActivityQuerySchema,
    output: WorkflowActivitySchema,
    http: {
      method: 'get',
      path: '/api/workspaces/{workspaceId}/workflow-activity',
      errors: [400, 401, 403],
      outputDescription: 'Runs per day and per workflow',
    },
  }),
  retryRun: defineActionSpec({
    id: coreIds.actions.retry_workflow_run,
    ai: {
      tool: 'retry_workflow_run',
      description:
        'Run a workflow again on what one of its runs was about (the same record, or the same module event), now. Use it for a failed run once its cause is fixed; say what failed first. The steps run as the workflow, from the first.',
    },
    summary: 'Retry a workflow run',
    description:
      'Runs the workflow again with the trigger of an earlier run (its record or module event), and returns the new run, which names the one it retries in `trigger.retryOf`.',
    tags,
    permission: 'workflow.run',
    params: IdParams.extend({ runId: z.string() }),
    output: WorkflowRunSchema,
    http: {
      method: 'post',
      path: '/api/workspaces/{workspaceId}/workflows/{id}/runs/{runId}/retry',
      status: 201,
      outputDescription: 'The new run',
    },
  }),
  recordRuns: defineActionSpec({
    id: coreIds.actions.list_record_workflow_runs,
    ai: {
      tool: null,
      category: 'covered_by',
      reason: 'list_workflow_runs returns the runs of a workflow, and get_workflow its recent ones',
    },
    summary: 'List the workflow runs about a record',
    description:
      'The runs, newest first, that were about one record or, with `objectId`, about any record of an object (started by hand on it, by a change to it, or by a schedule that ran per record), whichever workflow they belong to. `state=open` keeps only those that wait for a runner, are being worked on or wait to try a step again: it is how a page tells a record is being worked on.',
    tags,
    permission: 'workflow.read',
    query: RecordWorkflowRunsQuerySchema,
    output: WorkflowRunListSchema,
    http: {
      method: 'get',
      path: '/api/workspaces/{workspaceId}/workflow-runs',
      errors: [400, 401, 403],
      outputDescription: 'The runs about the record',
    },
  }),
  run: defineActionSpec({
    id: coreIds.actions.run_workflow,
    ai: {
      tool: 'run_workflow',
      description:
        "Run a workflow now and return the finished run with each step's outcome. When the trigger names an object, pass the record to run on as recordId (the person must be able to read it). The steps run as the workflow, not as the person. The workflow must be on. Asks for approval.",
    },
    summary: 'Run a workflow now',
    description:
      'Runs the steps right away and returns the finished run. With `wait: false` it queues the run instead and returns it at once, pending, for a runner to take. When the trigger names an object, `recordId` picks the record; the caller must be able to read it. The steps run as the workflow actor.',
    tags,
    permission: 'workflow.run',
    params: IdParams,
    body: RunWorkflowInputSchema,
    output: WorkflowRunSchema,
    http: {
      method: 'post',
      path: '/api/workspaces/{workspaceId}/workflows/{id}/run',
      status: 201,
      bodyDescription: 'What to run on',
      outputDescription: 'The finished run, or the queued one when `wait` is false',
    },
  }),
};
