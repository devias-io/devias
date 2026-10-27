import type { AiService } from '@devias/ai';
import type { EngineActionDeps } from '@devias/data-engine';
import type { Directory } from '../auth/directory';
import type { Notifier } from '../notifications/notifier';
import type { ModuleRuntime } from '../runtime/module-runtime';
import type { ModuleRegistry } from '../runtime/registry';
import type { WorkflowRunner } from '../runtime/workflow-runner';
import type { DeclaredAction } from './declared';

/** What action implementations may use. */
export interface ActionDeps extends EngineActionDeps {
  workflows: WorkflowRunner;
  registry: ModuleRegistry;
  runtime: ModuleRuntime;
  /** The server's public origin, for absolute webhook URLs. */
  publicUrl: string;
  /** Workspace members and api keys. */
  directory: Directory;
  /** Sends notifications, resolving who `to` means against the members. */
  notifier: Notifier;
  /** The actions registered modules declare. */
  declared: DeclaredAction[];
  ai: AiService;
}

export { type Action, implement } from '@devias/data-engine';
