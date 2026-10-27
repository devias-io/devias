import { coreIds } from '../core-ids';

/**
 * What only an agent does, declared like an action so an agent's `actionIds` can name it: it has no route, because a
 * person does not call it. `human` says what a person does instead, and a test keeps every tool that no HTTP action
 * serves on this list.
 */
export interface AgentActionSpec {
  id: string;
  /** The tool the model calls. */
  tool: string;
  summary: string;
  human: string;
}

export const AGENT_ACTIONS: readonly AgentActionSpec[] = [
  {
    id: coreIds.actions.ask_user,
    tool: 'ask_user',
    summary: 'Ask the person a question and wait for the answer',
    human: 'The person is the one asked: they answer in the conversation.',
  },
  {
    id: coreIds.actions.navigate,
    tool: 'navigate',
    summary: 'Open a record, an object, a page or a settings section in the studio',
    human: 'The person clicks through the studio.',
  },
  {
    id: coreIds.actions.finish_task,
    tool: 'finish_task',
    summary: 'Hand in the task an agent was given, with what it did, for review',
    human: 'A person moves the task to in review with update_task.',
  },
  {
    id: coreIds.actions.use_skill,
    tool: 'use_skill',
    summary: 'Load one of the skills the agent may use, for the procedure it describes',
    human: 'A person reads the skill in the agents section.',
  },
];
