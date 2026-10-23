import type {
  AiToolArea,
  AnyActionSpec,
  ApprovalMode,
  InputRequest,
  NavigateTarget,
  RunWorkflowInput,
  WorkflowRun,
} from '@devias/core';
import type { DataEngine, EngineContext, Logger, ScopedEngine } from '@devias/data-engine';
import type { z } from 'zod';

/**
 * Runs a workflow now. Steps may call module functions, which only the server can execute, so the server
 * passes its workflow runner in; without one, `run_workflow` reports that runs are unavailable.
 */
export interface WorkflowRunPort {
  runManual(ctx: EngineContext, workflowId: string, input: RunWorkflowInput): Promise<WorkflowRun>;
}

/**
 * The actions the host implements: their specs, from which tools are generated, and a way to run one as the
 * caller (input parsed against the spec, permission checked). The server passes its action registry.
 */
export interface ActionsPort {
  specs: AnyActionSpec[];
  invoke(ctx: EngineContext, actionId: string, input: unknown): Promise<unknown>;
}

/** A skill as `use_skill` returns it. */
export interface LoadedSkill {
  id: string;
  title: string;
  body: string;
}

/** Loads the skills the calling agent may use, from the workspace as it is now: an archived skill is gone. */
export interface SkillsPort {
  /** By id or by title (any case); none, or two with the same title, is an error that says what to do. */
  load(ref: string): Promise<LoadedSkill>;
}

/** What a tool sees while it runs: the caller's engine context and a way to steer the studio. */
export interface ToolRunContext {
  workspaceId: string;
  ctx: EngineContext;
  engine: DataEngine;
  /** Engine methods bound to the caller (records, schema). */
  scoped: ScopedEngine;
  logger: Logger;
  user?: { id: string; name: string };
  /** Queue a navigation the studio performs once the tool result is recorded. */
  navigate: (target: NavigateTarget) => void;
  /** Manual workflow runs, when the host provides them. */
  workflows?: WorkflowRunPort;
  /** The host's actions, when it provides them. */
  actions?: ActionsPort;
  /** The skills of the agent this call is for. */
  skills?: SkillsPort;
  /** What the person typed into this call's input request: for this run only, never stored or shown to the model. */
  secrets?: Record<string, string>;
  /** The input request the person answered, as it was shown to them. */
  request?: InputRequest;
}

export interface ToolDefinition<I = unknown> {
  name: string;
  description: string;
  input: z.ZodType<I>;
  /** Default approval mode; workspace settings may loosen it unless `locked`. */
  approval: ApprovalMode;
  locked?: boolean;
  /** Only reads: it may run without asking even after the conversation has read outside content. */
  readOnly?: boolean;
  /**
   * Its results carry content from outside the workspace (webhook payloads, other services' answers): they reach the
   * model marked untrusted, and once the conversation has read any, every tool that is not read-only asks first.
   */
  externalContent?: boolean;
  /** What the tool works on: groups it in the tool picker and decides which parts of the system prompt it needs. */
  area: AiToolArea;
  /** Reaches beyond what its name suggests (workflows, keys, members, modules, agents); shown as a flag, blocks nothing. */
  escalates?: boolean;
  /** Owning module for namespaced tools, null for built-ins. */
  moduleId: string | null;
  /** Hide the tool from callers who could never use it (e.g. members lack `metadata.write`). */
  available?: (ctx: EngineContext, engine: DataEngine) => boolean;
  /**
   * Values this call needs from the person that the model must never see (an API key). When it returns a request, the
   * call waits for the person whatever its approval mode, and their answers reach `run` as `context.secrets`.
   */
  requestInput?(input: I, context: ToolRunContext): Promise<InputRequest | null>;
  run(input: I, context: ToolRunContext): Promise<unknown>;
}

export const defineTool = <I>(definition: ToolDefinition<I>): ToolDefinition<I> => definition;

// biome-ignore lint/suspicious/noExplicitAny: each tool takes its own input type
export type AnyToolDefinition = ToolDefinition<any>;
