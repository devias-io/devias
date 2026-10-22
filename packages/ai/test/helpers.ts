import { fileURLToPath } from 'node:url';
import type { ChatEvent, SendMessageInput } from '@devias/core';
import {
  createDataEngine,
  type DataEngine,
  type EngineContext,
  engineActions,
  invokeAction,
  silentLogger,
} from '@devias/data-engine';
import { manifest as fixtureManifest } from '@devias/fixtures';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { ModelClient } from '../src/model/types';
import { type AiService, createAiService } from '../src/service';
import { createFakeModelClient, type FakeModelClient, type ScriptStep } from '../src/testing';
import { createToolRegistry } from '../src/tools/registry';
import type { ActionsPort, ToolDefinition, WorkflowRunPort } from '../src/tools/types';

const MIGRATIONS = fileURLToPath(new URL('../../../apps/server/drizzle', import.meta.url));

export interface Harness {
  engine: DataEngine;
  service: AiService;
  model: FakeModelClient;
  workspaceId: string;
  owner: EngineContext;
  member: EngineContext;
  user: { id: string; name: string };
  close(): Promise<void>;
}

/** Fresh PGlite with all migrations, one seeded workspace, and an AI service on a scripted model. */
export const createHarness = async (
  script: ScriptStep[] = [],
  options: {
    model?: ModelClient | null;
    maxIterations?: number;
    seed?: boolean;
    modelDelayMs?: number;
    workflows?: WorkflowRunPort;
    /** The host's actions: their specs become generated tools, `invoke` runs them. Default: the engine-only ones. */
    actions?: ActionsPort;
    /** Replace the built-in tools. */
    builtinTools?: ToolDefinition[];
  } = {},
): Promise<Harness> => {
  const client = new PGlite('memory://');
  const db = drizzle({ client, casing: 'snake_case' });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  const engine = createDataEngine({
    db,
    logger: silentLogger,
    seedManifests: options.seed === false ? [] : [fixtureManifest],
  });
  // The same handlers the server mounts for what needs only the engine, so generated tools run here.
  const actions: ActionsPort | undefined =
    options.actions ?? (options.builtinTools ? undefined : enginePort(engine, options.workflows));
  const workspaceId = 'ws_ai_test';
  await engine.workspaces.initialize(workspaceId);
  const fake = createFakeModelClient(script, { delayMs: options.modelDelayMs ?? 0 });
  const service = createAiService({
    engine,
    db,
    model: options.model === undefined ? fake : options.model,
    modelName: 'fake-model',
    effort: 'high',
    logger: silentLogger,
    ...(options.maxIterations ? { maxIterations: options.maxIterations } : {}),
    ...(options.workflows ? { workflows: options.workflows } : {}),
    ...(actions ? { actions } : {}),
    ...(options.builtinTools ? { builtinTools: options.builtinTools } : {}),
  });

  return {
    engine,
    service,
    model: fake,
    workspaceId,
    owner: { workspaceId, actor: { kind: 'user', id: 'u_owner' }, role: 'owner' },
    member: { workspaceId, actor: { kind: 'user', id: 'u_member' }, role: 'member' },
    user: { id: 'u_owner', name: 'Alice' },
    close: async () => {
      await service.close();
      await engine.close();
      await client.close();
    },
  };
};

export const collect = () => {
  const events: ChatEvent[] = [];

  return { events, sink: { emit: (event: ChatEvent) => void events.push(event) } };
};

/** Send one message and run the turn to its end (or its first pause), returning every event. */
export const send = async (
  h: Harness,
  ctx: EngineContext,
  conversationId: string,
  input: string | SendMessageInput,
): Promise<ChatEvent[]> => {
  const { events, sink } = collect();
  const handle = await h.service.startTurn(
    ctx,
    conversationId,
    typeof input === 'string' ? { content: input } : input,
    ctx.actor.id === 'u_owner' ? h.user : { id: ctx.actor.id, name: 'Member' },
  );
  await handle.run(sink);

  return events;
};

export const resolve = async (
  h: Harness,
  ctx: EngineContext,
  conversationId: string,
  toolCallId: string,
  approved: boolean,
  reason?: string,
): Promise<ChatEvent[]> => {
  const { events, sink } = collect();
  const handle = await h.service.startResolve(ctx, conversationId, toolCallId, { approved, reason }, h.user);
  await handle.run(sink);

  return events;
};

export const types = (events: ChatEvent[]): string[] => events.map((e) => e.type);

export const eventsOf = <T extends ChatEvent['type']>(events: ChatEvent[], type: T) =>
  events.filter((e): e is Extract<ChatEvent, { type: T }> => e.type === type);

export const lastUserText = (model: FakeModelClient): string => {
  const request = model.requests.at(-1);
  const message = request?.messages.at(-1);

  if (message?.role !== 'user') {
    return '';
  }

  return message.content
    .map((block) =>
      block.type === 'text'
        ? block.text
        : `[tool_result ${block.tool_use_id}${block.is_error ? ' error' : ''}] ${block.content}`,
    )
    .join('\n');
};

/** The actions that need only the engine, as the port a host would give the agent: what generated tools call. */
export const enginePort = (engine: DataEngine, workflows?: WorkflowRunPort): ActionsPort => {
  const handlers = engineActions({
    engine,
    ...(workflows
      ? {
          workflows: {
            runManual: workflows.runManual.bind(workflows),
            retryRun: async () => {
              throw new Error('retrying a run is not part of these tests');
            },
          },
        }
      : {}),
  });

  return {
    specs: handlers.map((action) => action.spec),
    invoke: (ctx, id, input) => invokeAction(engine, handlers, ctx, id, input),
  };
};

/** Every tool the platform has for this engine: the hand-written ones and those made from the engine's actions. */
export const platformTools = (engine: DataEngine): ToolDefinition[] =>
  createToolRegistry({ engine, actions: enginePort(engine) }).all();
